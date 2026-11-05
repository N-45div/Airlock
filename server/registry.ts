// Airlock's verdict registry on NEAR testnet (contracts/verdict-registry).
//
// Reading needs no key and no NEAR tooling (plain JSON-RPC):
//   npm run registry -- latest sample:take-home        Airlock's newest verdict for a repo
//   npm run registry -- repo github.com/owner/name     all recorders' verdicts for a repo
//   npm run registry -- recent [--limit 10]            newest verdicts
//   npm run registry -- config                          owner, recorders, cap, model keys
//   npm run registry -- check <receipt.json>           is this receipt's verdict on chain?
// Writing (owner or recorder key, see docs/registry.md):
//   npm run registry -- register-key <receipt.json>    owner: trust the receipt's attested model key
//   npm run registry -- record <receipt.json>          recorder: record the receipt's verdict
//
// Environment: AIRLOCK_REGISTRY (default airlock-verdicts.testnet), AIRLOCK_RECORDER
// (default airlock-recorder.testnet), NEAR_RPC (default https://test.rpc.fastnear.com), and for
// writes NEAR_KEY_FILE (a near-cli credentials JSON) or NEAR_ACCOUNT_ID + NEAR_PRIVATE_KEY.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Account, teraToGas } from 'near-api-js';
import type { Receipt } from './receipt.ts';
import { receiptHash } from './receipt.ts';

export const REGISTRY = process.env.AIRLOCK_REGISTRY ?? 'airlock-verdicts.testnet';
export const RECORDER = process.env.AIRLOCK_RECORDER ?? 'airlock-recorder.testnet';
export const RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io';

export interface VerdictRecord {
  id: number;
  repo: string;
  revision: string;
  verdict: 'safe' | 'caution' | 'dangerous';
  findings: number;
  model: string;
  receipt_hash: string;
  signer: string;
  signature: string;
  response_sha256: string;
  recorder: string;
  recorded_at_ms: number;
}

/** Calls a view method over public JSON-RPC. No key, no account, no dependencies. */
export async function view<T>(method: string, args: Record<string, unknown> = {}, opts: { registry?: string; rpc?: string } = {}): Promise<T> {
  const res = await fetch(opts.rpc ?? RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'airlock',
      method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: opts.registry ?? REGISTRY, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { cause?: { name?: string }; message?: string } };
  if (body.error || body.result?.error || !body.result?.result) {
    throw new Error(`NEAR RPC: ${body.result?.error ?? body.error?.cause?.name ?? body.error?.message ?? 'no result'}`);
  }
  return JSON.parse(Buffer.from(body.result.result).toString('utf8')) as T;
}

/** What the registry stores for a receipt: the arguments of record_verdict. */
export function verdictArgs(receipt: Receipt): Record<string, unknown> {
  const last = receipt.turns.at(-1);
  if (!last) throw new Error('The receipt has no signed replies.');
  if (receipt.final.completionId !== last.completionId) throw new Error('The verdict is not in the last signed reply.');
  return {
    verdict: {
      repo: receipt.repo.id,
      revision: receipt.repo.commit ?? receipt.repo.tree.sha256,
      verdict: receipt.verdict.verdict,
      findings: receipt.verdict.findings,
      model: receipt.model,
      receipt_hash: receiptHash(receipt),
      proof: { signer: last.signer, signature: last.signature, signed_text: last.signedText },
    },
  };
}

/** Arguments for register_model_key, from a receipt whose attestation the caller checked. */
export function modelKeyArgs(receipt: Receipt): Record<string, unknown> {
  const a = receipt.attestation;
  return {
    key: a.signer,
    model: a.model,
    tcb_status: a.tcbStatus,
    quote_sha256: createHash('sha256').update(Buffer.from(a.quote, 'hex')).digest('hex'),
    verified_at_ms: a.verifiedAt,
  };
}

interface Credentials {
  accountId: string;
  privateKey: string;
}

export async function loadCredentials(): Promise<Credentials> {
  if (process.env.NEAR_KEY_FILE) {
    const keyFile = process.env.NEAR_KEY_FILE;
    const file = JSON.parse(await readFile(keyFile, 'utf8')) as { account_id?: string; private_key?: string; secret_key?: string };
    const privateKey = file.private_key ?? file.secret_key;
    // near-cli-rs names the account in the path: <network>/<account>.json or <network>/<account>/<key>.json.
    const parts = keyFile.split(/[\\/]/);
    const fromPath = parts.at(-1)!.startsWith('ed25519_') ? parts.at(-2) : parts.at(-1)!.replace(/\.json$/, '');
    const accountId = process.env.NEAR_ACCOUNT_ID ?? file.account_id ?? fromPath;
    if (!accountId || !privateKey) throw new Error(`${keyFile} is not a near-cli credentials file.`);
    return { accountId, privateKey };
  }
  if (process.env.NEAR_ACCOUNT_ID && process.env.NEAR_PRIVATE_KEY) return { accountId: process.env.NEAR_ACCOUNT_ID, privateKey: process.env.NEAR_PRIVATE_KEY };
  throw new Error('Set NEAR_KEY_FILE (a near-cli credentials JSON) or NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to write to the registry.');
}

/** Sends one function call and returns the transaction hash. */
export async function callRegistry(method: string, args: Record<string, unknown>, creds: Credentials): Promise<string> {
  const account = new Account(creds.accountId, RPC, creds.privateKey as `ed25519:${string}`);
  const outcome = await account.callFunctionRaw({ contractId: REGISTRY, methodName: method, args, gas: teraToGas('50') });
  const failure = (outcome.status as { Failure?: unknown }).Failure;
  if (failure) throw new Error(`${method} failed: ${JSON.stringify(failure).slice(0, 400)}`);
  return outcome.transaction.hash;
}

/** Records a receipt's verdict with the recorder's key (a function-call key is enough). */
export async function recordReceipt(receipt: Receipt, creds?: Credentials): Promise<string> {
  return callRegistry('record_verdict', verdictArgs(receipt), creds ?? (await loadCredentials()));
}

const short = (r: VerdictRecord) =>
  `#${r.id} ${r.verdict.toUpperCase().padEnd(9)} ${r.repo} @ ${r.revision.slice(0, 12)}  ${r.findings} findings  ${r.model}  by ${r.recorder}  ${new Date(r.recorded_at_ms).toISOString()}\n    receipt ${r.receipt_hash}`;

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv.splice(i, 2)[1] : undefined;
  };
  const limit = Number(flag('--limit') ?? 10);
  const recorder = flag('--recorder') ?? RECORDER;
  const [cmd, arg] = argv;
  const readReceipt = async () => JSON.parse(await readFile(arg ?? '', 'utf8')) as Receipt;
  try {
    if (cmd === 'latest' && arg) {
      const r = await view<VerdictRecord | null>('get_latest', { repo: arg, recorder });
      console.log(r ? short(r) : `No verdict from ${recorder} for ${arg} on ${REGISTRY}.`);
    } else if (cmd === 'repo' && arg) {
      const rs = await view<VerdictRecord[]>('get_repo', { repo: arg, limit });
      console.log(rs.length ? rs.map(short).join('\n') : `No verdicts for ${arg}.`);
    } else if (cmd === 'recent') {
      const rs = await view<VerdictRecord[]>('get_recent', { limit });
      console.log(`${await view<number>('count')} verdicts on ${REGISTRY}, newest first:\n${rs.map(short).join('\n')}`);
    } else if (cmd === 'config') {
      console.log(JSON.stringify({ registry: REGISTRY, rpc: RPC, ...(await view<object>('get_config')), model_keys: await view('list_model_keys') }, null, 2));
    } else if (cmd === 'check' && arg) {
      const receipt = await readReceipt();
      const args = verdictArgs(receipt).verdict as { repo: string; revision: string; receipt_hash: string };
      // Several reviews of one revision can be on chain (other models, reruns), so look for this
      // receipt's hash among the repository's verdicts. One recorded seconds ago needs a block or
      // two to reach final state.
      let r: VerdictRecord | undefined;
      for (let attempt = 0; attempt < 6 && !r; attempt++) {
        if (attempt) await new Promise((done) => setTimeout(done, 3000));
        const all = await view<VerdictRecord[]>('get_repo', { repo: args.repo, limit: 100 });
        r = all.find((x) => x.receipt_hash === args.receipt_hash && x.recorder === recorder);
      }
      if (!r) throw new Error(`Not on chain: no verdict from ${recorder} for ${args.repo} with receipt ${args.receipt_hash}.`);
      if (r.revision !== args.revision) throw new Error(`On chain for another revision: ${r.revision}.`);
      console.log(`ON CHAIN: ${short(r)}\n  the contract verified the model's reply signature before storing it`);
    } else if (cmd === 'register-key' && arg) {
      const receipt = await readReceipt();
      // Trust a key only after its attestation checks out: Intel TDX quote, key and nonce binding.
      const { verifyReceipt } = await import('./verify-receipt.ts');
      const failed = (await verifyReceipt(receipt)).filter((c) => !c.ok);
      if (failed.length) throw new Error(`Not registering: the receipt does not verify (${failed.map((c) => `${c.name}: ${c.detail}`).join('; ')}).`);
      const tx = await callRegistry('register_model_key', modelKeyArgs(receipt), await loadCredentials());
      console.log(`registered model key ${receipt.attestation.signer.slice(0, 16)}… for ${receipt.model}: ${EXPLORER}/txns/${tx}`);
    } else if (cmd === 'record' && arg) {
      const receipt = await readReceipt();
      const tx = await recordReceipt(receipt);
      console.log(`recorded ${receipt.verdict.verdict} for ${receipt.repo.id}: ${EXPLORER}/txns/${tx}`);
    } else {
      console.error('usage: npm run registry -- latest <repo> | repo <repo> | recent | config | check <receipt.json> | register-key <receipt.json> | record <receipt.json>');
      process.exit(2);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
