// Talks to the Airlock server (see server/types.ts for the contract).
// Used by the background worker; the content script and popup reach it
// through messages, so every network call leaves from one place.

import { PRODUCT_NAME } from '../config.js';

/** The three answers, in the words the person sees. */
export const VERDICTS = {
  safe: { label: 'Looks safe' },
  caution: { label: 'Be careful' },
  dangerous: { label: "Don't run it" },
};

const SCAN_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isScanId(id) {
  return typeof id === 'string' && SCAN_ID.test(id);
}

export function lookupEndpoint(apiBase, repoUrl) {
  return `${apiBase}/api/lookup?url=${encodeURIComponent(repoUrl)}`;
}

export function scansEndpoint(apiBase) {
  return `${apiBase}/api/scans`;
}

/** The shareable report. The key rides in the fragment, which the browser
 * never sends to the server, so only this tab can answer approval prompts. */
export function reportUrl(apiBase, id, key) {
  if (!isScanId(id)) throw new ApiError(`${PRODUCT_NAME} sent back a report id the extension does not recognise.`);
  const base = `${apiBase}/r/${encodeURIComponent(id)}`;
  return typeof key === 'string' && key ? `${base}#key=${encodeURIComponent(key)}` : base;
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** What to show for a finished scan, or null when there is nothing to show. */
export function verdictView(scan) {
  if (!scan || typeof scan !== 'object' || scan.status !== 'done') return null;
  const verdict = scan.verdict;
  if (!Object.hasOwn(VERDICTS, verdict) || !isScanId(scan.id)) return null;
  const headline = typeof scan.headline === 'string' ? clip(scan.headline.trim(), 280) : '';
  return {
    id: scan.id,
    verdict,
    label: VERDICTS[verdict].label,
    headline,
    finishedAt: typeof scan.finishedAt === 'string' ? scan.finishedAt : null,
  };
}

/** A sentence for a failed response. The server sends { error } on 4xx. */
export function errorText(status, body) {
  const message = body && typeof body.error === 'string' ? body.error.trim() : '';
  if (message) return clip(message, 300);
  if (status === 404) return `This ${PRODUCT_NAME} server does not know that request. Check the server address in Settings.`;
  if (status === 429) return 'There have been a lot of checks just now. Try again in a few minutes.';
  if (status >= 500) return `The ${PRODUCT_NAME} server ran into a problem. Try again in a minute.`;
  return `The ${PRODUCT_NAME} server turned the request down (error ${status}).`;
}

async function request(url, init, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new ApiError(`${PRODUCT_NAME} took too long to answer. Try again in a moment.`);
    }
    throw new ApiError(`Could not reach ${PRODUCT_NAME}. Check your connection, or the server address in Settings.`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON; errorText falls back to the status.
  }
  if (!res.ok) throw new ApiError(errorText(res.status, body), res.status);
  return body;
}

/** The latest finished check of this repository, as a verdictView, or null. */
export async function lookupScan(apiBase, repoUrl, { timeoutMs = 10_000 } = {}) {
  const body = await request(lookupEndpoint(apiBase, repoUrl), { method: 'GET' }, timeoutMs);
  return verdictView(body?.scan ?? null);
}

/** Starts a check. Returns { id, key } (CreateScanResponse). */
export async function createScan(apiBase, repoUrl, { timeoutMs = 20_000 } = {}) {
  const body = await request(
    scansEndpoint(apiBase),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: repoUrl }),
    },
    timeoutMs,
  );
  if (!body || !isScanId(body.id) || typeof body.key !== 'string' || !body.key || body.key.length > 512) {
    throw new ApiError(`${PRODUCT_NAME} sent an answer the extension does not understand. It may need an update.`);
  }
  return { id: body.id, key: body.key };
}
