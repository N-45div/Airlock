// End-to-end check of the agent guard in real Chrome with WebMCP on: serves the test page
// (web/public/demo/agent-tools.html, a pretend crypto app offering five tools to agents) on
// localhost, opens it once without the extension and once with it, and checks that
//   - without Airlock an agent sees all five tools;
//   - with Airlock the two traps are never offered, a money-moving call waits for a real click
//     (Allow runs it, Block refuses it), and the toolbar badge counts what was held.
//
//   node extension/scripts/agent-guard-check.mjs [--shots <dir>]
//
// --shots saves screenshots of each step. Needs Chrome 149+ (WebMCP behind --enable-features) and
// Extensions.loadUnpacked over the DevTools pipe. The guard normally runs only after the person
// turns it on in Settings and grants access to all sites; a test copy of the extension declares it
// for localhost instead, since automation can't press Chrome's permission prompt.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTENSION_DIR, readManifest, runtimeFiles } from './files.mjs';

const CANDIDATES = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
const chrome = process.env.CHROME ?? (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome not found. Set CHROME to its path.');
  process.exit(2);
}
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const WEB_PUBLIC = path.resolve(EXTENSION_DIR, '..', 'web', 'public');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temp = mkdtempSync(path.join(tmpdir(), 'airlock-agent-guard-'));

// ---- A test copy of the extension with the guard declared for localhost ----
const extDir = path.join(temp, 'extension');
for (const file of runtimeFiles()) {
  mkdirSync(path.dirname(path.join(extDir, file)), { recursive: true });
  cpSync(path.join(EXTENSION_DIR, file), path.join(extDir, file));
}
const manifest = readManifest();
manifest.host_permissions = [...manifest.host_permissions, 'http://localhost/*'];
manifest.content_scripts = [
  ...manifest.content_scripts,
  { matches: ['http://localhost/*'], js: ['lib/agent-tools.js', 'agent-guard.js'], run_at: 'document_start', world: 'MAIN', all_frames: true },
  { matches: ['http://localhost/*'], js: ['agent-guard-bridge.js'], run_at: 'document_start', all_frames: true },
];
writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ---- The test page on localhost ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.join(WEB_PUBLIC, rel);
  if (!file.startsWith(WEB_PUBLIC) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, 'localhost', resolve));
const pageUrl = `http://localhost:${server.address().port}/demo/agent-tools.html`;

// ---- Chrome over the DevTools pipe ----
function launch(name) {
  const profile = path.join(temp, `profile-${name}`);
  const child = spawn(chrome, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--enable-features=WebMCP', '--no-first-run', '--no-default-browser-check', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    child.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    return new Promise((resolve, reject) => {
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    });
  };
  return { child, send };
}

async function openPage(send) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: pageUrl }, sessionId);
  await sleep(2500);
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  const shot = async (name) => {
    if (!shots) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
  };
  return { targetId, sessionId, evaluate, shot };
}

const TOOL_NAMES = `(async () => (await document.modelContext.getTools()).map((t) => t.name).sort())()`;
const clickCall = (name) => `(() => {
  const row = [...document.querySelectorAll('#tools .tool')].find((li) => li.querySelector('code')?.textContent === '${name}');
  row.querySelector('button').click();
  return true;
})()`;
const LAST_LOG = `document.querySelector('#log li')?.textContent ?? ''`;

/** Finds a button by its text inside the guard's closed shadow root and presses it with a real
 * (trusted) mouse click, the way a person would. */
async function press(send, sessionId, label) {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }, sessionId);
  let found = null;
  const walk = (node) => {
    if (found) return;
    if (node.localName === 'button' && (node.children ?? []).some((c) => c.nodeType === 3 && c.nodeValue === label)) found = node;
    for (const c of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(c);
  };
  walk(root);
  if (!found) throw new Error(`no "${label}" button on the page`);
  const { model } = await send('DOM.getBoxModel', { backendNodeId: found.backendNodeId }, sessionId);
  const [x1, y1, , , x3, y3] = model.content;
  const x = (x1 + x3) / 2;
  const y = (y1 + y3) / 2;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId);
}

let failed = false;
const expect = (ok, text) => {
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

const browsers = [];
try {
  // 1. Without Airlock.
  {
    const b = launch('plain');
    browsers.push(b);
    console.log(`Chrome: ${(await b.send('Browser.getVersion')).product}, page: ${pageUrl}`);
    const page = await openPage(b.send);
    const names = await page.evaluate(TOOL_NAMES);
    expect(Array.isArray(names) && names.length === 5, `without Airlock an agent sees all five tools: ${names}`);
    await page.shot('1-without-airlock');
    b.child.kill();
  }

  // 2. With Airlock.
  const b = launch('guarded');
  browsers.push(b);
  const { id } = await b.send('Extensions.loadUnpacked', { path: extDir });
  const page = await openPage(b.send);
  const names = await page.evaluate(TOOL_NAMES);
  expect(JSON.stringify(names) === JSON.stringify(['get_portfolio', 'sign_transaction', 'swap_tokens']), `with Airlock the traps are never offered: ${names}`);
  await page.shot('2-with-airlock');

  await page.evaluate(clickCall('get_portfolio'));
  await sleep(500);
  expect((await page.evaluate(LAST_LOG)).startsWith('get_portfolio returned'), 'a read-only tool runs without asking');

  await page.evaluate(clickCall('sign_transaction'));
  await sleep(800);
  expect((await page.evaluate(LAST_LOG)).startsWith('Agent calls sign_transaction'), 'a signing call waits for the person');
  await page.shot('3-asks-you');
  await press(b.send, page.sessionId, 'Allow once');
  await sleep(600);
  const allowed = await page.evaluate(LAST_LOG);
  expect(allowed.startsWith('sign_transaction returned: Signed and sent'), `Allow runs it: ${allowed}`);

  await page.evaluate(clickCall('swap_tokens'));
  await sleep(800);
  await press(b.send, page.sessionId, 'Block');
  await sleep(600);
  const blocked = await page.evaluate(LAST_LOG);
  // Chrome hands the agent its own generic failure message, not the guard's; the record below
  // shows the call counted as blocked.
  expect(blocked.startsWith('swap_tokens failed'), `Block refuses it: ${blocked}`);
  await page.shot('4-after');

  // What the extension's button shows: the background worker's record and the badge.
  const { targetInfos } = await b.send('Target.getTargets');
  const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
  const { sessionId: sw } = await b.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  const tabId = Number(
    (await b.send('Runtime.evaluate', { expression: `(async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('/demo/agent-tools'))?.id)()`, awaitPromise: true, returnByValue: true }, sw)).result.value,
  );
  const state = (
    await b.send(
      'Runtime.evaluate',
      {
        expression: `(async () => {
          const s = await chrome.storage.session.get('agentTools:${tabId}');
          const tools = Object.values(s['agentTools:${tabId}']?.frames ?? {}).flatMap((f) => f.tools);
          return { badge: await chrome.action.getBadgeText({ tabId: ${tabId} }), tools: tools.map((t) => t.name + ':' + t.status + ':' + t.calls.allowed + '/' + t.calls.blocked).sort() };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sw,
    )
  ).result.value;
  expect(state.badge === '4', `the toolbar badge counts the four tools held (two kept away, two that ask): "${state.badge}"`);
  expect(
    JSON.stringify(state.tools) ===
      JSON.stringify(['claim_rewards:blocked:0/0', 'get_portfolio:allowed:0/0', 'restore_wallet:blocked:0/0', 'sign_transaction:asks-you:1/0', 'swap_tokens:asks-you:0/1']),
    `the popup's record: ${state.tools.join(', ')}`,
  );
} catch (err) {
  failed = true;
  console.error(err.stack ?? err.message);
} finally {
  for (const b of browsers) b.child.kill();
  server.close();
  await sleep(600);
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (shots) console.log(`screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
