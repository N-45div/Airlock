// The sandbox benchmark: each packed wallet sample reviewed twice by the private reviewer, once
// reading only and once after its install steps ran in the sandbox against decoy wallets.
//   npm run bench:sandbox              rerun all ten reviews (needs NEARAI_API_KEY and Vercel credentials)
//   npm run bench:sandbox -- --render  rebuild METRICS.md from bench/sandbox/ (no key, no network)
// Receipts and evidence are written to bench/sandbox/ as <id>--read.json and <id>--detonate.json
// (with <id>--detonate.evidence.json); npm run judge verifies them all offline.

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Receipt } from './receipt.ts';
import type { SandboxEvidence } from './sandbox/chamber.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SANDBOX_BENCH = path.join(root, 'bench', 'sandbox');

export const SANDBOX_CASES: { id: string; what: string; expected: 'dangerous' | 'not dangerous' }[] = [
  { id: 'wallet-postinstall', what: 'An npm postinstall script that collects wallet files', expected: 'dangerous' },
  { id: 'hidden-loader', what: 'The same, with every path and the host base64-encoded', expected: 'dangerous' },
  { id: 'vendored-dep', what: 'Clean app code; the payload sits in vendor/ and runs on install', expected: 'dangerous' },
  { id: 'setup-py-stealer', what: 'A Python setup.py that sends keys over HTTPS', expected: 'dangerous' },
  { id: 'near-deploy', what: 'Honest control: a deploy script reads a NEAR key only when you run it', expected: 'not dangerous' },
];

const LABEL: Record<string, string> = { safe: 'Looks safe', caution: 'Be careful', dangerous: "Don't run it" };

async function load<T>(file: string): Promise<T | null> {
  return readFile(file, 'utf8').then((t) => JSON.parse(t) as T, () => null);
}

/** The METRICS.md section, built only from the files in bench/sandbox/. Empty if there are none. */
export async function renderSandboxSection(dir = SANDBOX_BENCH): Promise<string> {
  const rows: string[] = [];
  let dangerousRight = 0;
  let caught = 0;
  let stealers = 0;
  let controlsClean = 0;
  let controls = 0;
  let receipts = 0;
  let date = '';
  for (const c of SANDBOX_CASES) {
    const read = await load<Receipt>(path.join(dir, `${c.id}--read.json`));
    const run = await load<Receipt>(path.join(dir, `${c.id}--detonate.json`));
    const ev = await load<SandboxEvidence>(path.join(dir, `${c.id}--detonate.evidence.json`));
    if (!read || !run || !ev) continue;
    receipts += 2;
    date = [date, read.createdAt, run.createdAt].sort().at(-1)!.slice(0, 10);
    const sent = ev.exfil.filter((x) => x.decoys.length);
    const wallets = [...new Set(sent.flatMap((x) => x.decoys))];
    if (c.expected === 'dangerous') {
      stealers += 1;
      if (read.verdict.verdict === 'dangerous' && run.verdict.verdict === 'dangerous') dangerousRight += 1;
      if (sent.length) caught += 1;
    } else {
      controls += 1;
      if (!ev.wallets.length && !ev.contacts.length && !ev.exfil.length && read.verdict.verdict !== 'dangerous' && run.verdict.verdict !== 'dangerous') controlsClean += 1;
    }
    const caughtCell = sent.length ? `${sent.map((x) => `${x.method} ${x.host}`).join(', ')}: ${wallets.join(', ')}` : ev.wallets.length || ev.contacts.length ? `touched ${ev.wallets.length}, contacted ${ev.contacts.length}, nothing caught sending` : 'nothing touched, nothing sent';
    rows.push(`| ${c.id} | ${c.what} | ${LABEL[read.verdict.verdict] ?? read.verdict.verdict} | ${LABEL[run.verdict.verdict] ?? run.verdict.verdict} | ${caughtCell} | $${read.costUsd.toFixed(4)} / $${run.costUsd.toFixed(4)} |`);
  }
  if (!rows.length) return '';
  return [
    '',
    `## Sandbox: reading the code vs running it (${date})`,
    '',
    'Five harmless samples, packed in `samples/packed/wallet-stealers.pack`: four wallet stealers and one honest control.',
    'Each was reviewed twice by the private reviewer (`Qwen/Qwen3.8-27B`): once reading the code only, and once after',
    "Airlock ran its install steps in the sandbox, a throwaway VM whose home folder held decoy wallets and keys, with every",
    'host other than the package registries answered from inside the VM. Rebuild with `npm run bench:sandbox -- --render`;',
    `all ${receipts} receipts, and the evidence each sandbox receipt binds, verify offline with \`npm run judge\`.`,
    '',
    '| Sample | What it is | Reading only | With the sandbox | Caught sending (decoys inside) | Model cost, read / sandbox |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `- Reading alone already called all ${stealers} stealers "Don't run it" (${dangerousRight}/${stealers} in both modes): on code it can read, the model saw through base64 and a vendored payload.`,
    `- With the sandbox, ${caught}/${stealers} were also caught red-handed: the request each one sent to its server was kept, and it named exactly the wallets and keys that stealer took. Reading says "this looks like a stealer"; the sandbox shows what it took.`,
    `- The honest control touched no decoy, reached no host, and was not called "Don't run it" in either mode (${controlsClean}/${controls}).`,
    '- Model cost only; the VM time for a sandbox run is not included. Five samples is a smoke test, not a measure of how often the sandbox catches what reading misses: these samples carry their payload in code the model can read.',
    '',
  ].join('\n');
}

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, ['--no-warnings', path.join(root, 'server', 'private-cli.ts'), ...args], { cwd: root, env: process.env, maxBuffer: 32 * 1024 * 1024 }, (error) =>
      resolve(error ? 1 : 0),
    );
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
  });
}

if (import.meta.main) {
  // bench.ts --render writes METRICS.md with this section appended. It runs as its own process,
  // because bench.ts imports this module.
  const metrics = () =>
    new Promise<void>((resolve, reject) =>
      execFile(process.execPath, ['--no-warnings', path.join(root, 'server', 'bench.ts'), '--render'], { cwd: root }, (error) => (error ? reject(error) : resolve())),
    );
  if (!process.argv.includes('--render')) {
    if (!process.env.NEARAI_API_KEY) {
      console.error('Set NEARAI_API_KEY and Vercel credentials to rerun; --render rebuilds METRICS.md without them.');
      process.exit(2);
    }
    await mkdir(SANDBOX_BENCH, { recursive: true });
    for (const c of SANDBOX_CASES) {
      await run([`wallet:${c.id}`, '--receipt', path.join(SANDBOX_BENCH, `${c.id}--read.json`)]);
      await run([`wallet:${c.id}`, '--detonate', '--receipt', path.join(SANDBOX_BENCH, `${c.id}--detonate.json`)]);
    }
  }
  await metrics();
  console.log('wrote METRICS.md');
}
