// Review one repository privately on NEAR AI Cloud and print what happened:
//   npm run scan:private -- take-home                       Airlock's sample take-home task
//   npm run scan:private -- https://github.com/owner/name   a public GitHub repository
//   npm run scan:private -- ./path/to/folder                a folder on this machine (read in place)
// Options: --model <id>   --max-usd <dollars, default 0.05>   --receipt <file.json>
//          --record   --out <file.json>   --allow-gateway-signature   --no-tls-pinning
// Needs NEARAI_API_KEY (cloud.near.ai).
//
// --no-tls-pinning is for networks that intercept TLS (corporate or sandbox proxies). The
// Node client normally checks that the TLS certificate it sees is the one the Gateway's
// attestation names; behind such a proxy it sees the proxy's certificate and stops. With the
// flag, attestation, encryption and signature checks all still run; only that pin is skipped.
//
// --receipt writes evidence anyone can check offline with npm run verify:receipt (docs/receipts.md).
// --record also records the verdict on Airlock's NEAR testnet registry (docs/registry.md), with
// the recorder key in NEAR_KEY_FILE; the contract verifies the model's signature before storing it.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetchRepo, fetchSample, parseRepoUrl } from './fetch-repo.ts';
import { takeInventory } from './inventory.ts';
import { SAMPLES, sampleRepo, sampleSource } from './samples.ts';
import type { RepoInfo } from './types.ts';
import { RecordingClient } from './near-client.ts';
import { listPrivateModels } from './near-models.ts';
import { BUDGET, reviewPrivately } from './private-review.ts';
import { buildReceipt, receiptHash, treeHash } from './receipt.ts';
import { EXPLORER, REGISTRY, recordReceipt } from './registry.ts';

const run = promisify(execFile);
// Picked from the benchmark (METRICS.md): same verdicts as glm-5.3-flash, cheaper per review.
export const DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';

interface Args {
  target: string;
  model: string;
  out?: string;
  receipt?: string;
  record: boolean;
  allowGateway: boolean;
  tlsPinning: boolean;
  maxUsd: number;
}

function parseArgs(argv: string[]): Args {
  const rest = [...argv];
  const args: Args = {
    target: '',
    model: process.env.AIRLOCK_NEAR_MODEL || DEFAULT_MODEL,
    record: false,
    allowGateway: false,
    tlsPinning: process.env.AIRLOCK_NEAR_TLS_PINNING !== '0',
    maxUsd: Number(process.env.AIRLOCK_NEAR_MAX_USD ?? BUDGET.maxUsd),
  };
  while (rest.length) {
    const a = rest.shift()!;
    if (a === '--model') args.model = rest.shift() ?? args.model;
    else if (a === '--out') args.out = rest.shift();
    else if (a === '--receipt') args.receipt = rest.shift();
    else if (a === '--record') args.record = true;
    else if (a === '--allow-gateway-signature') args.allowGateway = true;
    else if (a === '--no-tls-pinning') args.tlsPinning = false;
    else if (a === '--max-usd') args.maxUsd = Number(rest.shift());
    else if (!args.target) args.target = a;
  }
  return args;
}

/** Gets the target onto disk (or points at it in place) and says what it is. */
async function locate(target: string, work: string): Promise<{ dir: string; repo: RepoInfo }> {
  const sample = SAMPLES.find((s) => s.id === target);
  const source = await sampleSource(sample);
  if (sample && source) {
    const dir = path.join(work, 'repo');
    return { dir, repo: await fetchSample(sampleRepo(sample), source, dir) };
  }
  if (sample) target = sample.url;
  const local = await stat(target).catch(() => null);
  if (local?.isDirectory()) {
    // A folder on this machine is read where it is: the code goes nowhere except, encrypted, to the TEE.
    const dir = path.resolve(target);
    const commit = await run('git', ['-C', dir, 'rev-parse', 'HEAD']).then((r) => r.stdout.trim(), () => 'local');
    return { dir, repo: { url: `local:${path.basename(dir)}`, host: 'sample', owner: 'local', name: path.basename(dir), commit } };
  }
  const dir = path.join(work, 'repo');
  return { dir, repo: await fetchRepo(parseRepoUrl(target), dir) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error('usage: npm run scan:private -- <github url | sample id | folder> [--model <id>] [--max-usd <dollars>] [--receipt <file.json>] [--record]');
    process.exit(2);
  }
  const apiKey = process.env.NEARAI_API_KEY;
  if (!apiKey) {
    console.error('Set NEARAI_API_KEY (create one at cloud.near.ai) to run a live private review.');
    process.exit(2);
  }
  if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0) {
    console.error('--max-usd must be a positive number of dollars, e.g. 0.05');
    process.exit(2);
  }
  const models = await listPrivateModels();
  const chosen = models.find((m) => m.id === args.model);
  if (!chosen) {
    console.error(`${args.model} is not a NEAR AI Cloud model with TEE attestation and tool calls. Run npm run models to see them.`);
    process.exit(2);
  }

  const work = await mkdtemp(path.join(os.tmpdir(), 'airlock-private-'));
  try {
    const { dir, repo } = await locate(args.target, work);
    const inventory = await takeInventory(dir);
    const tree = await treeHash(dir);
    console.log(`${repo.url} @ ${repo.commit}: ${inventory.files.length} files, ${inventory.findings.length} static findings`);
    console.log(`model ${chosen.id}, end-to-end encrypted, every reply checked against its TEE signature`);
    console.log(`budget $${args.maxUsd.toFixed(2)} for this scan ($${chosen.inputPerMillion}/M input, $${chosen.cachedInputPerMillion}/M cached input, $${chosen.outputPerMillion}/M output)`);
    if (!args.tlsPinning) console.log('TLS pinning to the attested Gateway is off (--no-tls-pinning); all other checks run');
    console.log('');

    const client = await RecordingClient.connect({ apiKey, model: chosen.id, tlsPinning: args.tlsPinning });
    const att = client.attestation;
    console.log(`  attested ${att.model}: Intel TDX ${att.tcbStatus}, GPU evidence ${att.gpuEvidence}, key ${att.signer.slice(0, 16)}…`);
    const result = await reviewPrivately({
      dir,
      repo,
      inventory,
      client,
      model: chosen.id,
      prices: chosen,
      maxUsd: args.maxUsd,
      allowGatewaySignature: args.allowGateway,
      hooks: {
        onTool: (e) => console.log(`  ${e.decision.padEnd(8)} ${e.tool} ${e.summary}${e.reason ? `  (${e.reason})` : ''}`),
        onThought: (t) => console.log(`  … ${t.split('\n')[0]}`),
        onTurn: (p) => console.log(`  verified ${p.signatureKind} ${p.signingAlgo} ${p.signingAddress.slice(0, 16)}…${p.tcbStatus ? ` tcb=${p.tcbStatus}` : ''}`),
        onUsage: (u) => console.log(`  spent $${u.costUsd.toFixed(4)} of $${args.maxUsd.toFixed(2)} after reply ${u.turn}`),
      },
    });

    console.log(`\n${result.verdict.toUpperCase()}: ${result.headline}\n${result.summary}`);
    for (const f of [...inventory.findings, ...result.findings]) {
      console.log(`- [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`);
    }
    const kinds = [...new Set(result.turns.map((t) => t.signatureKind))].join(', ');
    console.log(`\n${result.turns.length} replies, all verified (${kinds}).`);
    console.log(
      `${result.usage.inputTokens} input tokens (${result.usage.cachedInputTokens} from cache), ${result.usage.outputTokens} output, about $${result.costUsd.toFixed(4)}${result.budgetReached ? ' (budget reached: the verdict came early)' : ''}`,
    );
    if (args.receipt || args.record) {
      const receipt = buildReceipt({ repo, tree, result, attestation: client.attestation, exchanges: client.exchanges });
      if (args.receipt) {
        await writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
        console.log(`receipt ${receiptHash(receipt)} written to ${args.receipt}; check it with npm run verify:receipt -- ${args.receipt}`);
      }
      if (args.record) {
        try {
          const tx = await recordReceipt(receipt);
          console.log(`recorded on ${REGISTRY}: ${EXPLORER}/txns/${tx}`);
        } catch (error) {
          const message = (error as Error).message;
          console.error(`not recorded: ${message}`);
          if (message.includes('not a registered model key')) {
            console.error(`The registry's owner trusts a model key after checking its attestation: npm run registry -- register-key ${args.receipt ?? '<receipt.json>'}`);
          }
          process.exitCode = 1;
        }
      }
    }
    if (args.out) {
      await writeFile(args.out, `${JSON.stringify({ repo, model: chosen.id, inventory: inventory.findings, ...result }, null, 2)}\n`);
      console.log(`wrote ${args.out}`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  // The OpenAI client wraps transport failures as "Connection error."; show what's underneath.
  const reasons: string[] = [];
  for (let e: unknown = error; e && reasons.length < 5; e = (e as { cause?: unknown }).cause) {
    const text = (e as Error).message ?? String(e);
    if (!reasons.includes(text)) reasons.push(text);
  }
  const message = reasons.join('\n  because: ');
  console.error(`\n${message}`);
  if (message.includes('spki_fingerprint_mismatch')) {
    console.error('The TLS certificate seen on this network is not the one NEAR AI\'s attestation names. A proxy that\nintercepts TLS does this. If you trust this network, run again with --no-tls-pinning.');
  }
  process.exit(1);
}
