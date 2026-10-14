// Talks to the Airlock server. The types are the server's own contract.

import type { Approval, CreateScanResponse, Sample, Scan } from '../../server/types.ts';
import { PRODUCT } from './brand.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function fallbackMessage(status: number): string {
  if (status === 404) return 'We could not find that.';
  if (status === 429) return 'You have started a lot of checks just now. Try again in a little while.';
  if (status === 503) return `${PRODUCT} is busy right now. Try again in a few minutes.`;
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return 'That did not work. Check the link and try again.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(`We could not reach ${PRODUCT}. Check your connection and try again.`, 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : undefined;
    throw new ApiError(typeof error === 'string' && error ? error : fallbackMessage(res.status), res.status);
  }
  return body as T;
}

export const api = {
  samples: () => request<Sample[]>('/api/samples'),
  startScan: (url: string) => request<CreateScanResponse>('/api/scans', { method: 'POST', body: JSON.stringify({ url }) }),
  scan: (id: string) => request<Scan>(`/api/scans/${encodeURIComponent(id)}`),
  answer: (id: string, approvalId: string, key: string, decision: 'approve' | 'deny') =>
    request<Approval>(`/api/scans/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      headers: { 'x-airlock-key': key },
      body: JSON.stringify({ decision }),
    }),
  streamUrl: (id: string) => `/api/scans/${encodeURIComponent(id)}/stream`,
};

// The key that lets this browser answer a scan's approval prompts. It stays in
// this tab's session storage and never goes into a shared link.

const keyName = (id: string) => `airlock:key:${id}`;

export function saveKey(id: string, key: string): void {
  if (!key) return;
  try {
    sessionStorage.setItem(keyName(id), key);
  } catch {
    // Storage can be blocked; the scan still works, only approvals need the key.
  }
}

export function loadKey(id: string): string | null {
  try {
    return sessionStorage.getItem(keyName(id));
  } catch {
    return null;
  }
}

/** The Chrome extension opens /r/<id>#key=...; keep the key and drop it from the address bar. */
export function absorbKeyFromHash(id: string): void {
  const match = /(?:^#|&)key=([^&]+)/.exec(window.location.hash);
  if (!match?.[1]) return;
  let key = match[1];
  try {
    key = decodeURIComponent(key);
  } catch {
    // Keep it as written.
  }
  saveKey(id, key);
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

/** Starts a scan and returns where its report lives. */
export async function startScan(url: string): Promise<string> {
  const { id, key } = await api.startScan(url);
  // An empty key means the server reused a recent finished scan of the same repository.
  if (key) saveKey(id, key);
  return `/r/${encodeURIComponent(id)}`;
}
