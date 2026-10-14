// Validation for the server address people can set on the options page.
// Pure functions: no chrome.* here, so node --test can cover them.

/**
 * Accepts an https:// address, or http://localhost for a server on this
 * computer. Returns { ok: true, value } with no trailing slash, or
 * { ok: false, error } with a sentence to show the person.
 */
export function normalizeApiBase(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { ok: false, error: 'Enter the address of the Airlock server.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return { ok: false, error: 'Start the address with https:// (or http://localhost for a server on this computer).' };
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a web address. Check it for typos.' };
  }
  const local = url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !local) {
    return { ok: false, error: 'Use an https:// address. Plain http:// works only for localhost.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Leave the user name and password out of the address.' };
  }
  if (url.search || url.hash) {
    return { ok: false, error: 'Leave out anything after a ? or #.' };
  }
  let path = url.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  return { ok: true, value: `${url.origin}${path}` };
}

/** The match pattern a host permission needs to reach this server.
 * Chrome match patterns without a port match every port. */
export function originPattern(apiBase) {
  const url = new URL(apiBase);
  return `${url.protocol}//${url.hostname}/*`;
}
