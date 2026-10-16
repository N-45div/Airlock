// Settings: the server address (validated, and permission asked for a new
// https:// origin) and whether repository pages look up earlier verdicts.

import { DEFAULT_API_BASE, DEFAULT_AUTO_LOOKUP, getSettings, PRODUCT_NAME, STORAGE_KEYS } from './config.js';
import { normalizeApiBase, originPattern } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
let saved = { apiBase: DEFAULT_API_BASE, autoLookup: DEFAULT_AUTO_LOOKUP };
let statusTimer = 0;

function showStatus(text, kind = 'ok') {
  clearTimeout(statusTimer);
  $('status').textContent = text;
  $('status').dataset.kind = kind;
  if (kind === 'ok' && text) statusTimer = setTimeout(() => showStatus(''), 4000);
}

function fill(settings) {
  $('api-base').value = settings.apiBase;
  $('auto-lookup').checked = settings.autoLookup;
}

/** Gives back an optional https:// permission the extension no longer needs.
 * The required origin (Airlock's own server) can't be removed, which is fine. */
async function releaseOrigin(oldBase, newBase) {
  if (originPattern(oldBase) === originPattern(newBase)) return;
  try {
    await chrome.permissions.remove({ origins: [originPattern(oldBase)] });
  } catch {
    // A required origin, or already gone.
  }
}

async function save(apiBase, autoLookup) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.apiBase]: apiBase, [STORAGE_KEYS.autoLookup]: autoLookup });
  await releaseOrigin(saved.apiBase, apiBase);
  saved = { apiBase, autoLookup };
  fill(saved);
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const parsed = normalizeApiBase($('api-base').value);
  if (!parsed.ok) {
    showStatus(parsed.error, 'error');
    $('api-base').focus();
    return;
  }
  // Ask first, while the click still counts as the person's gesture.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [originPattern(parsed.value)] });
  } catch {
    granted = false;
  }
  if (!granted) {
    showStatus(`${PRODUCT_NAME} needs your permission to talk to that server. Nothing was saved.`, 'error');
    return;
  }
  try {
    await save(parsed.value, $('auto-lookup').checked);
    showStatus('Saved.');
  } catch {
    showStatus('Chrome could not save the settings. Try again.', 'error');
  }
});

$('reset').addEventListener('click', async () => {
  await chrome.storage.sync.remove([STORAGE_KEYS.apiBase, STORAGE_KEYS.autoLookup]);
  await releaseOrigin(saved.apiBase, DEFAULT_API_BASE);
  saved = { apiBase: DEFAULT_API_BASE, autoLookup: DEFAULT_AUTO_LOOKUP };
  fill(saved);
  showStatus('Back to the defaults.');
});

for (const el of document.querySelectorAll('[data-product-name]')) el.textContent = PRODUCT_NAME;
document.title = `${PRODUCT_NAME} settings`;
saved = await getSettings();
fill(saved);
