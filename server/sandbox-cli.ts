// Detonate a repository in a throwaway sandbox and print what its code reached for:
//   npm run sandbox -- https://github.com/owner/name     a public GitHub repo (cloned inside the VM)
//   npm run sandbox -- wallet:hidden-loader              a packed wallet-stealer sample
//   npm run sandbox -- ./path/to/folder                  a folder on this machine
// Options: --json <file>   --max-steps <n>   --step-seconds <n>
// Needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID (the sandbox runs on Vercel Sandbox).
//
// The repository's code runs with no real wallets and no real internet: the home folder holds decoy
// keys, and the network is cut to package registries before any step runs. Opening a decoy, or
// trying to reach a host that isn't a registry, is caught and shown here. Nothing it does leaves the VM.

import { stat, writeFile } from 'node:fs/promises';
import { folderFiles, runChamber, type ChamberSource, type SandboxEvidence } from './sandbox/chamber.ts';
import { packedSampleDir, WALLET_PACK } from './sample-pack.ts';

interface Args {
  target: string;
  json?: string;
  maxSteps?: number;
  stepSeconds?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { target: '' };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift()!;
    if (a === '--json') args.json = rest.shift();
    else if (a === '--max-steps') args.maxSteps = Number(rest.shift());
    else if (a === '--step-seconds') args.stepSeconds = Number(rest.shift());
    else if (!args.target) args.target = a;
  }
  return args;
}

async function locate(target: string): Promise<{ source: ChamberSource; label: string }> {
  if (/^https?:\/\/github\.com\//i.test(target)) return { source: { git: target.replace(/\.git$/, '') }, label: target };
  if (target.startsWith('wallet:')) {
    const id = target.slice('wallet:'.length);
    const dir = await packedSampleDir(id, WALLET_PACK);
    return { source: { files: await folderFiles(dir) }, label: `wallet-stealer sample "${id}"` };
  }
  const local = await stat(target).catch(() => null);
  if (local?.isDirectory()) return { source: { files: await folderFiles(target) }, label: target };
  throw new Error(`Don't know how to open "${target}". Use a GitHub URL, wallet:<id>, or a folder.`);
}

function report(ev: SandboxEvidence, label: string): void {
  const line = '─'.repeat(64);
  console.log(`\n${line}\n  Sandbox report: ${label}\n${line}`);
  console.log(`  Ran in a throwaway VM (${ev.provider}), network cut to: ${ev.allowedHosts.join(', ')}\n`);

  for (const s of ev.steps) {
    const status = s.timedOut ? 'timed out' : s.exitCode === 0 ? 'ok' : `exit ${s.exitCode}`;
    console.log(`  • ${s.label}  (${status}, ${s.seconds}s) — ${s.why}`);
  }

  const redHanded = ev.exfil.filter((x) => x.decoys.length);
  if (redHanded.length) {
    console.log(`\n  CAUGHT RED-HANDED: it tried to send your wallets away (${redHanded.length} request${redHanded.length === 1 ? '' : 's'}):`);
    for (const x of redHanded) {
      console.log(`    ✗ ${x.method} ${x.tls ? 'https' : 'http'}://${x.host}${x.path}   ${(x.bytes / 1024).toFixed(1)} KB`);
      console.log(`        inside it: ${x.decoys.map((d) => `${d} ✓`).join('  ')}`);
      console.log(`        by ${x.by}  during ${x.step}.  It never left the sandbox.`);
    }
  }
  if (!ev.capture.on) console.log(`\n  (No capture this run: ${ev.capture.note ?? 'the sinkhole did not start'}.)`);

  if (ev.wallets.length === 0 && ev.contacts.length === 0 && ev.exfil.length === 0) {
    console.log(`\n  CLEAN: nothing the code ran opened a wallet or key, and nothing tried to reach the network.`);
  } else {
    if (ev.wallets.length) {
      console.log(`\n  WALLETS AND KEYS TOUCHED (${ev.wallets.length}):`);
      for (const w of ev.wallets) console.log(`    ✗ ${w.decoy}  (${w.action} ${w.path})\n        by ${w.by}  during ${w.step}`);
    }
    if (ev.contacts.length) {
      console.log(`\n  TRIED TO REACH (${ev.contacts.length}):`);
      for (const c of ev.contacts) console.log(`    ✗ ${c.host ?? `${c.ip}:${c.port}`}\n        by ${c.by}  during ${c.step}`);
    }
    console.log(`\n  Install-time or setup code that reaches for a wallet and phones out is how a stranger's\n  repository drains the machine it runs on. Here it ran against decoys, inside a sealed VM.`);
  }
  console.log(line);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error('usage: npm run sandbox -- <github-url | wallet:<id> | ./folder> [--json file] [--max-steps n] [--step-seconds n]');
    process.exit(2);
  }
  const { source, label } = await locate(args.target);
  const ev = await runChamber(source, {
    ...(args.maxSteps ? { maxSteps: args.maxSteps } : {}),
    ...(args.stepSeconds ? { stepSeconds: args.stepSeconds } : {}),
    onProgress: (m) => console.error(`  · ${m}`),
  });
  report(ev, label);
  if (args.json) {
    await writeFile(args.json, `${JSON.stringify(ev, null, 2)}\n`);
    console.log(`\n  Evidence written to ${args.json}`);
  }
  // A dangerous verdict is exit 1, so a shell or CI can act on it.
  process.exit(ev.wallets.length || ev.contacts.length || ev.exfil.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`sandbox: ${(error as Error).message}`);
  process.exit(2);
});
