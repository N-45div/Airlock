// The service worker. Every network call goes through here, so the host
// permission for the Airlock server applies and pages never see the requests.
//
// Messages (all answer { ok: true, ... } or { ok: false, error }):
//   airlock:detect       { href, repositoryLinks }  -> { repoUrl }
//   airlock:lookup       { url, reason }            -> { result: verdictView | null }
//   airlock:check        { url }                    -> { id, key }  and opens the report
//   airlock:open-report  { id, key? }               -> {}           opens the report

import { getSettings } from './config.js';
import { ApiError, createScan, isScanId, lookupScan, reportUrl } from './lib/api.js';
import { parseRepoInput, repoFromPage } from './lib/repo.js';

const LOOKUP_TTL_MS = 60_000;
/** apiBase + repo -> { at, result }. Lives as long as the worker does. */
const lookups = new Map();

function canonicalRepo(url) {
  const parsed = parseRepoInput(typeof url === 'string' ? url : '');
  if (!parsed.ok) throw new ApiError(parsed.error);
  return parsed.url;
}

async function openTab(url, sender) {
  const tab = sender.tab;
  const options = { url };
  if (tab && typeof tab.id === 'number' && tab.id >= 0) {
    options.openerTabId = tab.id;
    if (typeof tab.windowId === 'number') options.windowId = tab.windowId;
    if (typeof tab.index === 'number') options.index = tab.index + 1;
  }
  try {
    await chrome.tabs.create(options);
  } catch {
    await chrome.tabs.create({ url });
  }
}

const handlers = {
  async 'airlock:detect'(msg) {
    const links = Array.isArray(msg.repositoryLinks)
      ? msg.repositoryLinks.filter((link) => typeof link === 'string').slice(0, 10)
      : [];
    const href = typeof msg.href === 'string' ? msg.href : '';
    return { repoUrl: repoFromPage({ href, repositoryLinks: links }) };
  },

  async 'airlock:lookup'(msg) {
    const repoUrl = canonicalRepo(msg.url);
    const { apiBase, autoLookup } = await getSettings();
    // Pages ask on their own as they open; the person can turn that off.
    if (msg.reason === 'page' && !autoLookup) return { result: null, skipped: true };
    const cacheKey = `${apiBase} ${repoUrl}`;
    const cached = lookups.get(cacheKey);
    if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return { result: cached.result };
    const result = await lookupScan(apiBase, repoUrl);
    lookups.set(cacheKey, { at: Date.now(), result });
    if (lookups.size > 200) lookups.delete(lookups.keys().next().value);
    return { result };
  },

  async 'airlock:check'(msg, sender) {
    const repoUrl = canonicalRepo(msg.url);
    const { apiBase } = await getSettings();
    const { id, key } = await createScan(apiBase, repoUrl);
    lookups.delete(`${apiBase} ${repoUrl}`);
    await openTab(reportUrl(apiBase, id, key), sender);
    return { id, key };
  },

  async 'airlock:open-report'(msg, sender) {
    if (!isScanId(msg.id)) throw new ApiError('That report link is not valid.');
    const { apiBase } = await getSettings();
    await openTab(reportUrl(apiBase, msg.id, typeof msg.key === 'string' ? msg.key : ''), sender);
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const handler = Object.hasOwn(handlers, msg.type) ? handlers[msg.type] : null;
  if (!handler) return false;
  handler(msg, sender).then(
    (value) => sendResponse({ ok: true, ...value }),
    (err) => {
      const error = err instanceof ApiError ? err.message : 'Something went wrong inside the extension. Try again.';
      if (!(err instanceof ApiError)) console.error(err);
      sendResponse({ ok: false, error });
    },
  );
  return true; // answer asynchronously
});

// A new server address or setting means earlier answers may not apply.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') lookups.clear();
});
