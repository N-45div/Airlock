// A receipt for one private review: enough evidence for anyone to check, offline and without a
// key, that the verdict came from a model in a genuine Intel TDX TEE that signed every reply.
// See docs/receipts.md for what a receipt proves and what it doesn't.

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AttestationRecord, ExchangeRecord } from './near-client.ts';
import type { PrivateReviewResult } from './private-review.ts';
import { RepoTools } from './repo-tools.ts';
import type { SandboxDigest } from './sandbox/evidence.ts';
import type { RepoInfo } from './types.ts';

export const RECEIPT_SCHEMA = 'airlock.receipt.v2';

export interface ReceiptTurn {
  completionId: string;
  signatureKind: 'provider_tee' | 'gateway';
  signingAlgo: string;
  signer: string;
  signature: string;
  /** "<model>:<sha256 of request bytes>:<sha256 of response bytes>", the text the TEE signed. */
  signedText: string;
  requestSha256: string;
  responseSha256: string;
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA;
  createdAt: string;
  engine: 'near-ai-tee';
  model: string;
  repo: {
    /** "github.com/owner/name", "sample:<id>", or "private:<sha256>" for a local folder. */
    id: string;
    url?: string;
    commit?: string;
    /** For private ids: the random salt hashed with the folder name. Keep the receipt private. */
    salt?: string;
    /** SHA-256 of a manifest of every file the reviewer could read. */
    tree: { files: number; sha256: string };
  };
  /** The verdict label in the clear, and a hash of the model's exact submit_verdict arguments.
   * The findings themselves are only in the encrypted final reply: checking the receipt
   * decrypts it, compares, and shows them. So a receipt never carries repository text in the
   * clear (some samples quote text written to steer AI reviewers). */
  verdict: { verdict: string; findings: number; sha256: string };
  attestation: AttestationRecord;
  turns: ReceiptTurn[];
  /** The final reply exactly as received, encrypted, with the seed of its one-time key. */
  final: { completionId: string; responseBody: string; clientSeed: string };
  usage: PrivateReviewResult['usage'];
  costUsd: number;
  /** Set when the repository's install and setup steps also ran in Airlock's sandbox and the model
   * saw what they did. Counts in the clear and a hash of the full evidence, which is shared as its
   * own file (its strings come from the repository, so they stay out of the receipt, as findings do).
   * Like the tree hash, it is the scanner's statement of what the model was shown. */
  sandbox?: SandboxDigest;
}

export const sha256Hex = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** What a receipt keeps of the model's verdict: its label, findings count and a hash of the whole. */
export function verdictDigest(args: unknown): Receipt['verdict'] {
  const v = (args ?? {}) as { verdict?: unknown; findings?: unknown };
  return {
    verdict: String(v.verdict ?? ''),
    findings: Array.isArray(v.findings) ? v.findings.length : 0,
    sha256: sha256Hex(canonicalJson(args)),
  };
}

/** JSON with object keys sorted at every level and no extra whitespace, so a hash is stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The receipt's identity: what gets recorded on NEAR. */
export function receiptHash(receipt: Receipt): string {
  return sha256Hex(canonicalJson(receipt));
}

/** Hashes every file the reviewer could read (same rules as its tools: no .git, no
 * node_modules, no symlinks) as a sorted "sha256  path" manifest. */
export async function treeHash(dir: string): Promise<{ files: number; sha256: string }> {
  const tools = new RepoTools(dir);
  const lines: string[] = [];
  for await (const file of tools.walk(tools.root)) {
    lines.push(`${sha256Hex(await readFile(file))}  ${tools.relative(file)}`);
  }
  lines.sort((a, b) => {
    const pa = a.slice(66);
    const pb = b.slice(66);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  return { files: lines.length, sha256: sha256Hex(lines.map((l) => `${l}\n`).join('')) };
}

/** How a repository is named in a receipt and on chain. Local folders get a salted hash, so
 * their names never leave this machine unless the receipt itself is shared. */
export function repoIdentity(repo: RepoInfo): Pick<Receipt['repo'], 'id' | 'url' | 'salt'> {
  if (repo.host === 'github') {
    return { id: `github.com/${repo.owner}/${repo.name}`.toLowerCase(), url: repo.url };
  }
  if (repo.url.startsWith('sample:')) return { id: repo.url };
  const salt = randomBytes(16).toString('hex');
  return { id: `private:${sha256Hex(`${salt}:${repo.url}`)}`, salt };
}

export function buildReceipt(input: {
  repo: RepoInfo;
  tree: { files: number; sha256: string };
  result: PrivateReviewResult;
  attestation: AttestationRecord;
  exchanges: Map<string, ExchangeRecord>;
  sandbox?: SandboxDigest;
}): Receipt {
  const { result, attestation, exchanges } = input;
  const turns: ReceiptTurn[] = result.turns.map((t) => {
    const exchange = exchanges.get(t.completionId);
    if (!exchange) throw new Error(`No recorded exchange for completion ${t.completionId}.`);
    return {
      completionId: t.completionId,
      signatureKind: t.signatureKind,
      signingAlgo: t.signingAlgo,
      signer: t.signingAddress,
      signature: t.signature,
      signedText: t.signedText,
      requestSha256: exchange.requestSha256,
      responseSha256: exchange.responseSha256,
    };
  });
  const final = exchanges.get(result.verdictCompletionId);
  if (!final) throw new Error('The reply that carried the verdict was not recorded.');
  const commit = input.repo.commit && input.repo.commit !== 'sample' && input.repo.commit !== 'local' ? input.repo.commit : undefined;
  return {
    schema: RECEIPT_SCHEMA,
    createdAt: new Date(attestation.verifiedAt).toISOString(),
    engine: 'near-ai-tee',
    model: attestation.model,
    repo: { ...repoIdentity(input.repo), ...(commit ? { commit } : {}), tree: input.tree },
    verdict: verdictDigest(JSON.parse(result.verdictArguments) as unknown),
    attestation,
    turns,
    final: { completionId: final.completionId, responseBody: final.responseBody, clientSeed: final.clientSeed },
    usage: result.usage,
    costUsd: Number(result.costUsd.toFixed(6)),
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
  };
}
