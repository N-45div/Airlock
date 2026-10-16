// Draws the extension's icons from the web app's mark (web/public/favicon.svg),
// so the toolbar, the store and the site share one design. Renders in a
// throwaway headless Chrome: node extension/scripts/make-icons.mjs
// Set CHROME to the browser binary if it isn't in the usual place.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.join(here, '..', 'icons');
const MARK = readFileSync(path.join(here, '..', '..', 'web', 'public', 'favicon.svg'), 'utf8');
/** [file, canvas, artwork]: the store icon keeps 16 px of clear padding around 96 px of art. */
const SIZES = [['icon-16.png', 16, 16], ['icon-32.png', 32, 32], ['icon-48.png', 48, 48], ['icon-128.png', 128, 96]];

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

const profile = mkdtempSync(path.join(tmpdir(), 'airlock-icons-'));
const page = path.join(profile, 'mark.html');
writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${MARK.replace('<svg ', '<svg id="m" ')}`);
const child = spawn(chrome, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', 'about:blank'],
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

try {
  const { targetId } = await send('Target.createTarget', { url: `file:///${page.split(path.sep).join('/')}` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(800);
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
  for (const [file, canvas, art] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: canvas, height: canvas, deviceScaleFactor: 1, mobile: false }, sessionId);
    const pad = (canvas - art) / 2;
    await send('Runtime.evaluate', { expression: `Object.assign(document.getElementById('m').style, { width: '${art}px', height: '${art}px', margin: '${pad}px' })` }, sessionId);
    await sleep(200);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: canvas, height: canvas, scale: 1 } }, sessionId);
    writeFileSync(path.join(ICONS, file), Buffer.from(data, 'base64'));
    console.log(`icons/${file} (mark)`);
  }
} finally {
  child.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
