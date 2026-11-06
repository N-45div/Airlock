// Reads Airlock's verdict registry on NEAR testnet straight from public RPC: no key, no
// account, and nothing passes through Airlock's server. See docs/registry.md.

import type { Verdict } from '../../server/types.ts';

export const REGISTRY = 'airlock-verdicts.testnet';
export const RECORDER = 'airlock-recorder.testnet';
export const NEAR_RPC = 'https://test.rpc.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io';

export interface OnchainVerdict {
  id: number;
  repo: string;
  revision: string;
  verdict: Verdict;
  findings: number;
  model: string;
  receipt_hash: string;
  signer: string;
  signature: string;
  response_sha256: string;
  recorder: string;
  recorded_at_ms: number;
}

function toBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Calls a view method of the registry. */
export async function nearView<T>(method: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(NEAR_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'airlock',
      method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: REGISTRY, method_name: method, args_base64: toBase64(JSON.stringify(args)) },
    }),
    ...(signal ? { signal } : {}),
  });
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string } };
  if (!body.result?.result) throw new Error(body.result?.error ?? body.error?.message ?? `NEAR RPC answered ${res.status}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

/** "github.com/owner/name" -> GitHub URL; samples and private commitments have none. */
export function repoUrlOf(id: string): string | null {
  return id.startsWith('github.com/') ? `https://${id}` : null;
}

export function repoLabelOf(id: string): string {
  if (id.startsWith('github.com/')) return id.slice('github.com/'.length);
  if (id.startsWith('sample:')) return `${id.slice('sample:'.length)} (Airlock sample)`;
  if (id.startsWith('private:')) return 'A private repository';
  return id;
}

/** The registry's id for a repository URL, e.g. https://github.com/Owner/Name -> github.com/owner/name. */
export function registryIdOf(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : null;
}

export const receiptUrl = (hash: string) => `/api/receipts/${hash}`;
export const accountUrl = (account: string) => `${EXPLORER}/address/${account}`;
export const txUrl = (tx: string) => `${EXPLORER}/txns/${tx}`;
