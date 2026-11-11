// The toolbar popup: the repository in the current tab (asked of the content
// script, since the extension has no permission to read tab addresses), its
// latest verdict, and a box to paste any other repository.

import { getSettings, HOW_IT_WORKS_PATH, PRODUCT_NAME } from './config.js';
import { parseRepoInput, repoLabel } from './lib/repo.js';

const $ = (id) => document.getElementById(id);

const view = {
  repoUrl: null,
  /** verdictView from lib/api.js */
  result: null,
  /** chainView from lib/near.js, and its links */
  chain: null,
  chainLinks: null,
  busy: false,
};

async function send(msg) {
  try {
    const res = await chrome.runtime.sendMessage(msg);
    return res || { ok: false, error: `${PRODUCT_NAME} did not answer. Try again.` };
  } catch {
    return { ok: false, error: `${PRODUCT_NAME} did not answer. Try again.` };
  }
}

function showError(text) {
  $('error').textContent = text || '';
  $('error').hidden = !text;
}

/** Asks the content script in the active tab which repository it shows. */
async function pageRepo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') return null;
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'airlock:page-repo' });
    const parsed = parseRepoInput(res?.repoUrl ?? '');
    return parsed.ok ? parsed.url : null;
  } catch {
    return null; // No content script here: not GitHub or npm, or opened before install.
  }
}

function render() {
  const { repoUrl, result, busy, chain, chainLinks } = view;
  $('repo').hidden = !repoUrl;
  if (!repoUrl) return;
  $('repo-link').textContent = repoLabel(repoUrl);
  $('repo-link').href = repoUrl;
  $('verdict').hidden = !result;
  if (result) {
    $('verdict-chip').textContent = result.label;
    $('verdict-chip').dataset.tone = result.verdict;
    $('verdict-headline').textContent = result.headline;
    $('verdict-headline').hidden = !result.headline;
  }
  $('chain').hidden = !chain;
  if (chain) {
    $('chain-chip').textContent = chain.label;
    $('chain-chip').dataset.tone = chain.verdict;
    const date = chain.recordedAt ? new Date(chain.recordedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    $('chain-meta').textContent = [`${chain.findings} finding${chain.findings === 1 ? '' : 's'}`, chain.model, date].filter(Boolean).join(' · ');
    $('chain-page').href = chainLinks.page;
    $('chain-contract').href = chainLinks.contract;
  }
  const primary = $('primary');
  if (busy) primary.textContent = 'Starting a check…';
  else primary.textContent = result ? 'Open the report' : 'Check before you run';
  primary.setAttribute('aria-disabled', String(busy));
  $('again').hidden = !result || busy;
}

async function lookup() {
  const repoUrl = view.repoUrl;
  $('lookup-note').textContent = 'Looking for an earlier check…';
  const res = await send({ type: 'airlock:lookup', url: repoUrl, reason: 'popup' });
  if (view.repoUrl !== repoUrl) return res;
  view.result = res.ok ? res.result || null : null;
  view.chain = res.ok && res.chain && res.chainLinks ? res.chain : null;
  view.chainLinks = view.chain ? res.chainLinks : null;
  let note = '';
  if (!res.ok) note = `Could not look for earlier checks. ${res.error}`;
  else if (!view.result && !view.chain) note = 'No one has checked this repository yet.';
  $('lookup-note').textContent = note;
  render();
  return res;
}

async function startCheck() {
  if (view.busy || !view.repoUrl) return;
  showError('');
  view.busy = true;
  render();
  const res = await send({ type: 'airlock:check', url: view.repoUrl });
  view.busy = false;
  render();
  if (res.ok) window.close(); // The report opened in a new tab.
  else showError(res.error);
}

async function openReport() {
  if (!view.result) return;
  const res = await send({ type: 'airlock:open-report', id: view.result.id });
  if (res.ok) window.close();
  else showError(res.error);
}

function showRepo(repoUrl, source) {
  view.repoUrl = repoUrl;
  view.result = null;
  view.chain = null;
  view.chainLinks = null;
  $('repo-source').textContent = source === 'page' ? 'Repository on this page' : 'Repository';
  render();
}

function showPaste() {
  $('paste').hidden = false;
  $('show-paste').hidden = true;
  $('paste-input').focus();
}

// ---- The agent guard's report for this tab ----

const STATUS = {
  blocked: { label: 'Kept from agents', tone: 'dangerous' },
  'asks-you': { label: 'Asks you first', tone: 'caution' },
  'you-submit': { label: 'You press submit', tone: 'caution' },
  allowed: { label: 'Allowed', tone: 'safe' },
};
const ORDER = ['blocked', 'asks-you', 'you-submit', 'allowed'];

function toolItem(tool, origin) {
  const li = document.createElement('li');
  li.className = 'agents__item';
  const row = document.createElement('p');
  row.className = 'agents__row';
  const chip = document.createElement('span');
  const status = STATUS[tool.status] ?? STATUS.allowed;
  chip.className = 'chip';
  chip.dataset.tone = status.tone;
  chip.textContent = status.label;
  const name = document.createElement('code');
  name.textContent = tool.name;
  row.append(chip, ' ', name);
  li.append(row);
  for (const reason of tool.reasons.slice(0, 2)) {
    const p = document.createElement('p');
    p.className = 'muted agents__why';
    p.textContent = reason.text;
    li.append(p);
  }
  const calls = [];
  if (tool.calls.allowed) calls.push(`${tool.calls.allowed} allowed`);
  if (tool.calls.blocked) calls.push(`${tool.calls.blocked} blocked`);
  if (calls.length || origin) {
    const p = document.createElement('p');
    p.className = 'muted agents__why';
    p.textContent = [calls.length ? `Agent calls: ${calls.join(', ')}` : '', origin].filter(Boolean).join(' · ');
    li.append(p);
  }
  return li;
}

async function agentTools() {
  let tabId = -1;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? -1;
  } catch {
    // No tab: leave it at -1.
  }
  const res = await send({ type: 'airlock:tab-agent-tools', tabId });
  if (!res.ok) return 0;
  if (!res.enabled) {
    $('guard-off').hidden = false;
    return 0;
  }
  const frames = res.frames.length > 1;
  const tools = res.frames.flatMap((f) => f.tools.map((t) => ({ tool: t, origin: frames ? f.origin : '' })));
  tools.sort((a, b) => ORDER.indexOf(a.tool.status) - ORDER.indexOf(b.tool.status));
  $('agents').hidden = false;
  const kept = tools.filter((t) => t.tool.status === 'blocked').length;
  const asks = tools.filter((t) => t.tool.status === 'asks-you' || t.tool.status === 'you-submit').length;
  $('agents-note').textContent = !tools.length
    ? 'None: this page offers no tools to AI agents, or WebMCP is off in this browser.'
    : [`${tools.length} tool${tools.length === 1 ? '' : 's'}`, kept ? `${kept} kept from agents` : '', asks ? `${asks} wait${asks === 1 ? 's' : ''} for you` : ''].filter(Boolean).join(' · ');
  $('agents-list').replaceChildren(...tools.map((t) => toolItem(t.tool, t.origin)));
  return tools.length;
}

$('guard-on').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#agent-guard') });
  window.close();
});

$('primary').addEventListener('click', () => (view.result ? openReport() : startCheck()));
$('again').addEventListener('click', () => startCheck());
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('show-paste').addEventListener('click', showPaste);

$('paste').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const parsed = parseRepoInput($('paste-input').value);
  if (!parsed.ok) {
    showError(parsed.error);
    $('paste-input').focus();
    return;
  }
  showRepo(parsed.url, 'pasted');
  const res = await lookup();
  // Nothing on record: start the check straight away, since that is what was asked.
  if (res.ok && !view.result) await startCheck();
});

async function init() {
  for (const el of document.querySelectorAll('[data-product-name]')) el.textContent = PRODUCT_NAME;
  document.title = PRODUCT_NAME;
  const { apiBase } = await getSettings();
  $('more').href = `${apiBase}${HOW_IT_WORKS_PATH}`;
  const [repoUrl, agentToolCount] = await Promise.all([pageRepo(), agentTools()]);
  $('status').hidden = true;
  if (repoUrl) {
    showRepo(repoUrl, 'page');
    $('show-paste').hidden = false;
    await lookup();
  } else if (agentToolCount) {
    // A page with agent tools: lead with them, and keep the paste box one click away.
    $('show-paste').hidden = false;
  } else {
    showPaste();
  }
}

void init();
