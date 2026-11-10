// Checks a private-review receipt with no API key and no network:
//   npm run verify:receipt -- receipt.json [--repo-dir <folder>]
//   npm run verify:offline        every receipt in fixtures/receipts
//
// 1. The model's Intel TDX quote is genuine (Intel's signature chain, checked against the
//    collateral saved at scan time), not a debug TD, and its TCB status is UpToDate.
// 2. The quote's report data binds the model's signing key and this scan's fresh nonce.
// 3. Every reply was signed (Ed25519) by that attested key, over "<model>:<request hash>:<response hash>".
// 4. The final reply's bytes hash to what was signed, decrypt with the disclosed one-time key,
//    and contain exactly the verdict the receipt states.
// 5. With --repo-dir, the folder's files hash to the tree the receipt names.

import { verify as verifySignature, createPublicKey } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dcap from '@phala/dcap-qvl';
import { prepareE2eeChatRequest } from '@nearai/inference-sdk';
import { withSeedReplay } from './nacl-rng.ts';
import { RECEIPT_SCHEMA, type Receipt, canonicalJson, receiptHash, sha256Hex, treeHash, verdictDigest } from './receipt.ts';
import type { SandboxEvidence } from './sandbox/chamber.ts';
import { sandboxDigest } from './sandbox/evidence.ts';
import { WALLET_PACK, packedSampleDir, packedSampleIds } from './sample-pack.ts';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** TCB statuses accepted for the model's TEE. */
export const ACCEPTED_TCB = ['UpToDate'];

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The verdict decrypted by the last verifyReceipt call, for callers that show the findings. */
export let lastDecrypted: unknown;

export async function verifyReceipt(receipt: Receipt, opts: { repoDir?: string; evidence?: SandboxEvidence } = {}): Promise<Check[]> {
  lastDecrypted = undefined;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const attempt = async (name: string, fn: () => Promise<string> | string) => {
    try {
      add(name, true, await fn());
    } catch (error) {
      add(name, false, (error as Error).message);
    }
  };
  const a = receipt.attestation;

  await attempt('receipt format', () => {
    if (receipt.schema !== RECEIPT_SCHEMA) throw new Error(`unknown schema ${String(receipt.schema)}`);
    if (receipt.engine !== 'near-ai-tee') throw new Error(`unknown engine ${String(receipt.engine)}`);
    if (a.model !== receipt.model) throw new Error('the attested model is not the receipt model');
    return `${RECEIPT_SCHEMA}, model ${receipt.model}`;
  });

  let reportData: Buffer | undefined;
  await attempt('Intel TDX quote', () => {
    const quote = Buffer.from(a.quote, 'hex');
    const at = Math.floor(a.verifiedAt / 1000);
    const result = dcap.verify(quote, a.collateral, at);
    const td10 = result.report.asTd10();
    if (!td10) throw new Error('the quote is not a TDX TD 1.0 report');
    if ((td10.tdAttributes[0] ?? 0) & 1) throw new Error('the TD runs in debug mode');
    if (!ACCEPTED_TCB.includes(result.status)) throw new Error(`TCB status is ${result.status}`);
    if (result.status !== a.tcbStatus) throw new Error(`TCB status is ${result.status}, the receipt says ${a.tcbStatus}`);
    reportData = Buffer.from(td10.reportData);
    return `signed by Intel's attestation chain, TCB ${result.status} at ${new Date(at * 1000).toISOString()}, not debug`;
  });

  await attempt('quote binds key and nonce', () => {
    if (!reportData || reportData.length !== 64) throw new Error('no report data (the quote check failed)');
    const signer = Buffer.from(a.signer, 'hex');
    const expected = Buffer.alloc(32);
    signer.copy(expected);
    if (!reportData.subarray(0, 32).equals(expected)) throw new Error('report data does not name the signing key');
    if (!reportData.subarray(32, 64).equals(Buffer.from(a.nonce, 'hex'))) throw new Error("report data does not hold this scan's nonce");
    if (a.signingAlgo !== 'ed25519' || a.e2eePublicKey.toLowerCase() !== a.signer.toLowerCase()) {
      throw new Error('the encryption key is not the attested signing key');
    }
    return `key ${a.signer.slice(0, 16)}… and nonce ${a.nonce.slice(0, 16)}… are inside the quote`;
  });

  await attempt('every reply signed by the attested key', () => {
    if (receipt.turns.length === 0) throw new Error('no replies');
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(a.signer, 'hex')]), format: 'der', type: 'spki' });
    receipt.turns.forEach((t, i) => {
      const where = `reply ${i + 1}`;
      if (t.signatureKind !== 'provider_tee') throw new Error(`${where} is signed by the ${t.signatureKind}, not the model TEE`);
      if (t.signer.toLowerCase() !== a.signer.toLowerCase()) throw new Error(`${where} has another signer`);
      if (t.signedText !== `${receipt.model}:${t.requestSha256}:${t.responseSha256}`) throw new Error(`${where}: signed text does not match the recorded hashes`);
      if (!verifySignature(null, Buffer.from(t.signedText, 'utf8'), key, Buffer.from(t.signature, 'hex'))) throw new Error(`${where}: bad signature`);
    });
    return `${receipt.turns.length} Ed25519 signatures over model, request hash and response hash`;
  });

  await attempt('final reply contains the verdict', async () => {
    const last = receipt.turns.at(-1)!;
    if (receipt.final.completionId !== last.completionId) throw new Error('the verdict is not in the last signed reply');
    if (sha256Hex(Buffer.from(receipt.final.responseBody, 'utf8')) !== last.responseSha256) throw new Error('the final reply bytes are not the ones signed');
    const plain = await decryptFinal(receipt);
    const call = plain.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === 'submit_verdict');
    if (!call) throw new Error('the decrypted reply has no submit_verdict call');
    const args = JSON.parse(call.function.arguments) as unknown;
    if (canonicalJson(verdictDigest(args)) !== canonicalJson(receipt.verdict)) throw new Error('the decrypted verdict differs from the receipt');
    lastDecrypted = args;
    return `decrypted with the disclosed one-time key: "${receipt.verdict.verdict}", ${receipt.verdict.findings} findings, hash matches`;
  });

  if (opts.repoDir) {
    await attempt('repository files', async () => {
      const tree = await treeHash(opts.repoDir!);
      if (tree.sha256 !== receipt.repo.tree.sha256) throw new Error(`${opts.repoDir} hashes to ${tree.sha256.slice(0, 16)}…, the receipt names ${receipt.repo.tree.sha256.slice(0, 16)}…`);
      const rel = path.relative(process.cwd(), opts.repoDir!) || '.';
      const where = opts.repoDir!.includes(`${path.sep}airlock-samples${path.sep}`) ? `the packed sample ${receipt.repo.id.replace(/^sample:/, '')}` : rel;
      return `${tree.files} files in ${where} match the reviewed tree`;
    });
  }

  if (opts.evidence) {
    await attempt('sandbox evidence', () => {
      if (!receipt.sandbox) throw new Error('this receipt names no sandbox run');
      const digest = sandboxDigest(opts.evidence!);
      if (digest.sha256 !== receipt.sandbox.sha256) throw new Error(`the evidence hashes to ${digest.sha256.slice(0, 16)}…, the receipt names ${receipt.sandbox.sha256.slice(0, 16)}…`);
      const { wallets, contacts, steps, sentWithDecoys } = receipt.sandbox;
      const caught = sentWithDecoys ? `, ${sentWithDecoys} request${sentWithDecoys === 1 ? '' : 's'} caught carrying decoys` : '';
      return `matches the run the model was shown: ${steps} step${steps === 1 ? '' : 's'}, ${wallets} decoy wallet${wallets === 1 ? '' : 's'} or keys touched, ${contacts} host${contacts === 1 ? '' : 's'} contacted${caught}`;
    });
  }
  return checks;
}

interface PlainCompletion {
  choices?: { message?: { tool_calls?: { function: { name: string; arguments: string } }[] } }[];
}

/** Rebuilds the final request's one-time client key from its seed and lets the SDK decrypt the
 * recorded reply with it. No network: preparing a request only encrypts locally. */
async function decryptFinal(receipt: Receipt): Promise<PlainCompletion> {
  const seed = Buffer.from(receipt.final.clientSeed, 'hex');
  const prepared = await withSeedReplay(seed, () =>
    prepareE2eeChatRequest({
      request: new Request('https://offline.invalid/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: receipt.model, messages: [{ role: 'user', content: 'offline check' }] }),
      }),
      modelKey: { signingAlgo: 'ed25519', publicKey: receipt.attestation.e2eePublicKey },
    }),
  );
  const response = new Response(receipt.final.responseBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
  return (await (await prepared.decryptResponse(response)).json()) as PlainCompletion;
}

export function printChecks(file: string, receipt: Receipt, checks: Check[]): boolean {
  const ok = checks.every((c) => c.ok);
  console.log(`${file}\n  receipt ${receiptHash(receipt)}  repo ${receipt.repo.id}`);
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  console.log(`  ${ok ? 'VERIFIED' : 'NOT VERIFIED'}\n`);
  return ok;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '..', 'fixtures', 'receipts');

/** Where a receipt's sandbox evidence is saved by default: r.json -> r.evidence.json. */
export function evidenceFileFor(receiptFile: string): string {
  return receiptFile.replace(/(\.json)?$/i, '.evidence.json');
}

/** For a sample receipt, the sample folder it was made from. */
export async function sampleDir(receipt: Receipt): Promise<string | undefined> {
  if (!receipt.repo.id.startsWith('sample:')) return undefined;
  const id = receipt.repo.id.slice('sample:'.length);
  if ((await packedSampleIds()).includes(id)) return packedSampleDir(id);
  if ((await packedSampleIds(WALLET_PACK)).includes(id)) return packedSampleDir(id, WALLET_PACK);
  return path.join(here, '..', 'samples', 'bench', id);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let files: string[];
  let repoDir: string | undefined;
  let evidenceFile: string | undefined;
  const offline = argv[0] === '--fixtures';
  if (offline) {
    files = (await readdir(FIXTURES)).filter((f) => f.endsWith('.json') && !f.endsWith('.evidence.json')).sort().map((f) => path.join(FIXTURES, f));
  } else {
    const i = argv.indexOf('--repo-dir');
    if (i >= 0) repoDir = argv.splice(i, 2)[1];
    const e = argv.indexOf('--evidence');
    if (e >= 0) evidenceFile = argv.splice(e, 2)[1];
    files = argv;
  }
  if (files.length === 0) {
    console.error('usage: npm run verify:receipt -- <receipt.json> [--repo-dir <folder>] [--evidence <file.evidence.json>]');
    process.exit(2);
  }
  let all = true;
  for (const file of files) {
    const receipt = JSON.parse(await readFile(file, 'utf8')) as Receipt;
    const dir = repoDir ?? (await sampleDir(receipt));
    // A sandbox run's evidence sits next to its receipt as <name>.evidence.json unless named.
    const evidencePath = evidenceFile ?? (receipt.sandbox ? evidenceFileFor(file) : undefined);
    const evidence = evidencePath ? ((await readFile(evidencePath, 'utf8').then(JSON.parse, () => undefined)) as SandboxEvidence | undefined) : undefined;
    if (receipt.sandbox && !evidence) console.log(`  (this receipt binds a sandbox run; pass --evidence <file> to check it)`);
    all = printChecks(path.relative(process.cwd(), file) || file, receipt, await verifyReceipt(receipt, { ...(dir ? { repoDir: dir } : {}), ...(evidence ? { evidence } : {}) })) && all;
  }
  process.exit(all ? 0 : 1);
}
