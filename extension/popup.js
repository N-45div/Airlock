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
  const { repoUrl, result, busy } = view;
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
  let note = '';
  if (!res.ok) note = `Could not look for earlier checks. ${res.error}`;
  else if (!view.result) note = 'No one has checked this repository yet.';
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
  $('repo-source').textContent = source === 'page' ? 'Repository on this page' : 'Repository';
  render();
}

function showPaste() {
  $('paste').hidden = false;
  $('show-paste').hidden = true;
  $('paste-input').focus();
}

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
  const repoUrl = await pageRepo();
  $('status').hidden = true;
  if (repoUrl) {
    showRepo(repoUrl, 'page');
    $('show-paste').hidden = false;
    await lookup();
  } else {
    showPaste();
  }
}

void init();
