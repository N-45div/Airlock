// Review one repository privately on NEAR AI Cloud and print what happened:
//   npm run scan:private -- take-home                       Airlock's sample take-home task
//   npm run scan:private -- https://github.com/owner/name   a public GitHub repository
//   npm run scan:private -- ./path/to/folder                a folder on this machine (read in place)
//   npm run scan:private -- wallet:hidden-loader            a packed wallet-stealer sample
// Options: --model <id>   --max-usd <dollars, default 0.05>   --receipt <file.json>
//          --record   --out <file.json>   --allow-gateway-signature   --no-tls-pinning
//          --detonate   --evidence <file.json>
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
//
// --detonate first runs the repository's install and setup steps in Airlock's sandbox: a throwaway
// VM with decoy wallets and keys and the network cut to package registries (server/sandbox; needs
// VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID). The model then reads the code knowing what it
// did there, so one verdict covers both. The receipt binds a hash of that evidence, and the evidence
// is written next to it (--evidence, default <receipt>.evidence.json) for verify:receipt to check.

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
import { DEFAULT_MODEL, listPrivateModels } from './near-models.ts';
import { BUDGET, reviewPrivately } from './private-review.ts';
import type { SandboxEvidence } from './sandbox/chamber.ts';
import { sandboxDigest } from './sandbox/evidence.ts';
import { WALLET_PACK, packedSampleDir } from './sample-pack.ts';
import { evidenceFileFor } from './verify-receipt.ts';
import { buildReceipt, receiptHash, treeHash } from './receipt.ts';
import { EXPLORER, REGISTRY, recordReceipt } from './registry.ts';

const run = promisify(execFile);

interface Args {
  target: string;
  model: string;
  out?: string;
  receipt?: string;
  record: boolean;
  allowGateway: boolean;
  tlsPinning: boolean;
  maxUsd: number;
  detonate: boolean;
  evidence?: string;
}

function parseArgs(argv: string[]): Args {
  const rest = [...argv];
  const args: Args = {
    target: '',
    model: process.env.AIRLOCK_NEAR_MODEL || DEFAULT_MODEL,
    record: false,
    detonate: false,
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
    else if (a === '--detonate') args.detonate = true;
    else if (a === '--evidence') args.evidence = rest.shift();
    else if (a === '--allow-gateway-signature') args.allowGateway = true;
    else if (a === '--no-tls-pinning') args.tlsPinning = false;
    else if (a === '--max-usd') args.maxUsd = Number(rest.shift());
    else if (!args.target) args.target = a;
  }
  return args;
}

/** Gets the target onto disk (or points at it in place) and says what it is. */
async function locate(target: string, work: string): Promise<{ dir: string; repo: RepoInfo }> {
  if (target.startsWith('wallet:')) {
    const id = target.slice('wallet:'.length);
    const dir = path.join(work, 'repo');
    return { dir, repo: await fetchSample({ url: `sample:${id}`, host: 'sample', owner: 'airlock', name: id }, await packedSampleDir(id, WALLET_PACK), dir) };
  }
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
    console.error('usage: npm run scan:private -- <github url | sample id | wallet:<id> | folder> [--model <id>] [--max-usd <dollars>] [--receipt <file.json>] [--record] [--detonate] [--evidence <file.json>]');
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

    let sandbox: SandboxEvidence | undefined;
    if (args.detonate) {
      // Loaded only here, so a plain review never needs the sandbox SDK or a Vercel token.
      const { folderFiles, runChamber } = await import('./sandbox/chamber.ts');
      console.log('detonating: running its install and setup steps in a throwaway VM with decoy wallets');
      const source = repo.host === 'github' ? { git: repo.url, ...(repo.commit ? { revision: repo.commit } : {}) } : { files: await folderFiles(dir) };
      sandbox = await runChamber(source, { onProgress: (m) => console.log(`  · ${m}`) });
      for (const s of sandbox.steps) console.log(`  ran ${s.label}: ${s.timedOut ? 'timed out' : `exit ${s.exitCode}`}, ${s.seconds}s`);
      for (const w of sandbox.wallets) console.log(`  CAUGHT ${w.action} ${w.decoy} (${w.path}) by ${w.by}`);
      for (const c of sandbox.contacts) console.log(`  CAUGHT tried to reach ${c.host ?? `${c.ip}:${c.port}`} by ${c.by}`);
      for (const x of sandbox.exfil.filter((e) => e.decoys.length)) {
        console.log(`  CAUGHT RED-HANDED ${x.method} ${x.tls ? 'https' : 'http'}://${x.host}${x.path} (${x.bytes} bytes) carrying ${x.decoys.join(', ')}`);
      }
      if (!sandbox.capture.on) console.log(`  (no capture: ${sandbox.capture.note ?? 'the sinkhole did not start'})`);
      if (!sandbox.wallets.length && !sandbox.contacts.length && !sandbox.exfil.length) console.log('  nothing it ran touched a decoy or the network');
      console.log('');
    }

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
      ...(sandbox ? { sandbox } : {}),
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
      const receipt = buildReceipt({ repo, tree, result, attestation: client.attestation, exchanges: client.exchanges, ...(sandbox ? { sandbox: sandboxDigest(sandbox) } : {}) });
      if (args.receipt) {
        await writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
        console.log(`receipt ${receiptHash(receipt)} written to ${args.receipt}; check it with npm run verify:receipt -- ${args.receipt}`);
      }
      if (sandbox) {
        const file = args.evidence ?? (args.receipt ? evidenceFileFor(args.receipt) : undefined);
        if (file) {
          await writeFile(file, `${JSON.stringify(sandbox, null, 2)}\n`);
          console.log(`sandbox evidence written to ${file} (the receipt binds its hash ${receipt.sandbox!.sha256.slice(0, 16)}…)`);
        }
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
