// One place for the product name and the server address. The name also
// appears in manifest.json (JSON can't import); a test keeps the two equal.

import { normalizeApiBase } from './lib/settings.js';

export const PRODUCT_NAME = 'Airlock';

/** Where the Airlock server and web app live. Change this when production
 * has a URL, and add that origin to host_permissions in manifest.json. */
export const DEFAULT_API_BASE = 'https://65-1-213-193.sslip.io';

/** The web app page that explains how a check works. */
export const HOW_IT_WORKS_PATH = '/#how-it-works';

/** chrome.storage.sync keys. */
export const STORAGE_KEYS = {
  apiBase: 'apiBase',
  /** When true, repository pages ask the server for an earlier verdict as they open. */
  autoLookup: 'autoLookup',
};

export const DEFAULT_AUTO_LOOKUP = true;

export async function getSettings() {
  let stored = {};
  try {
    stored = await chrome.storage.sync.get([STORAGE_KEYS.apiBase, STORAGE_KEYS.autoLookup]);
  } catch {
    // Storage can be unavailable for a moment while the browser starts; use defaults.
  }
  const base = normalizeApiBase(stored[STORAGE_KEYS.apiBase]);
  const autoLookup = stored[STORAGE_KEYS.autoLookup];
  return {
    apiBase: base.ok ? base.value : DEFAULT_API_BASE,
    autoLookup: typeof autoLookup === 'boolean' ? autoLookup : DEFAULT_AUTO_LOOKUP,
  };
}
