// Loads the unpacked extension into a throwaway headless Chrome and checks
// where the button lands on live GitHub pages. Run it when GitHub changes its
// markup: node extension/scripts/live-check.mjs [owner/name]
// Needs Chrome 126+ (Extensions.loadUnpacked over the DevTools pipe). Set
// CHROME to the browser binary if it isn't in the usual place. It never
// presses the button, so no check is started.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXTENSION_DIR } from './files.mjs';

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
const repo = process.argv[2] ?? 'expressjs/express';
const profile = mkdtempSync(path.join(tmpdir(), 'airlock-live-check-'));
const child = spawn(chrome, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

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
function send(method, params = {}, sessionId) {
  const id = nextId++;
  child.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROBE = `(() => {
  const hosts = [...document.querySelectorAll('[data-airlock-ext]')];
  const h = hosts[0];
  let place = 'none';
  if (h?.closest('ul[data-testid="repo-header-actions"]')) place = 'repo header actions';
  else if (h?.closest('.pagehead-actions')) place = 'pagehead-actions (older UI)';
  else if (h && getComputedStyle(h).position === 'fixed') place = 'fixed pill';
  else if (h) place = 'elsewhere: ' + h.parentElement?.tagName;
  return { count: hosts.length, place };
})()`;

let failed = false;
try {
  const { id } = await send('Extensions.loadUnpacked', { path: path.resolve(EXTENSION_DIR) });
  console.log(`loaded the extension as ${id} in ${(await send('Browser.getVersion')).product}`);
  const pages = [
    [`https://github.com/${repo}`, 'repo header actions'],
    [`https://github.com/${repo}/issues`, 'fixed pill'],
  ];
  for (const [url, expected] of pages) {
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await sleep(9000);
    const { result } = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId);
    const { count, place } = result.value;
    const ok = count === 1 && place === expected;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${url}: ${count} button(s), ${place} (expected ${expected})`);
    await send('Target.closeTarget', { targetId });
  }
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  child.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(failed ? 1 : 0);
