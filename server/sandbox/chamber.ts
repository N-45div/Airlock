// The sandbox: a throwaway Vercel Sandbox micro-VM where a stranger's repository is installed and
// set up the way a person would, with a home folder full of decoy wallets and keys, internet only
// to package registries, and every program, file open, host lookup and connection recorded.
//
// Order matters. Everything trusted happens first, before the repository's code exists or can run:
// the tracer is installed, the repository is cloned or copied in, the decoys are written. Then the
// network is locked to registries, and only then do the repository's steps run, each under strace
// with a clean environment. The VM is stopped at the end whatever happens.
//
// Needs a Vercel access token: VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.

import { Sandbox } from '@vercel/sandbox';
import { HOME, decoyFiles, newMarker } from './decoys.ts';
import { type Step, planSteps } from './plan.ts';
import { type Contact, REGISTRIES, type StepTrace, type WalletTouch, readTrace } from './trace.ts';

/** Where the repository sits inside the sandbox. */
export const REPO_DIR = `${HOME}/code/project`;
const WORK = '/tmp/airlock';

/** System calls the tracer records: programs, the process tree, file opens and lookups, connections, DNS. */
const CALLS = 'execve,clone,clone3,fork,vfork,open,openat,openat2,newfstatat,statx,access,faccessat,faccessat2,connect,sendto,sendmmsg,sendmsg';

/** The lines worth downloading: the process tree, network calls, and anything under the decoy home except npm's cache. */
const KEEP = `'(execve|clone3?|v?fork|connect|sendto|sendmmsg|sendmsg)\\(|<\\.\\.\\. (clone3?|v?fork) resumed>|"${HOME}/(\\.|projects/)'`;

export type ChamberSource = { git: string; revision?: string } | { files: { path: string; content: Buffer }[] };

export interface ChamberStep extends Step {
  exitCode: number | null;
  timedOut: boolean;
  seconds: number;
  /** npm's "> package@version event" lines, so a script can be named after its package. */
  scripts: Record<string, string>;
  trace: StepTrace;
}

export interface SandboxEvidence {
  provider: 'vercel-sandbox';
  sandboxId: string;
  /** Unique to this run: every decoy carries it. */
  marker: string;
  /** Hosts the repository's code could reach while it ran. */
  allowedHosts: string[];
  steps: ChamberStep[];
  wallets: (WalletTouch & { step: string })[];
  contacts: (Contact & { step: string })[];
  programs: { command: string; step: string }[];
}

export interface ChamberOptions {
  credentials?: { token: string; teamId: string; projectId: string };
  stepSeconds?: number;
  maxSteps?: number;
  /** Progress, for the CLI and the report's live view. */
  onProgress?: (message: string) => void;
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A folder's files as the chamber copies them in: relative paths, no .git, no node_modules, no symlinks. */
export async function folderFiles(dir: string): Promise<{ path: string; content: Buffer }[]> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const files: { path: string; content: Buffer }[] = [];
  const walk = async (d: string, rel: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(d, entry.name), r);
      else if (entry.isFile()) files.push({ path: r, content: await readFile(join(d, entry.name)) });
    }
  };
  await walk(dir, '');
  return files;
}

/** The shell script that runs one step under the tracer, from the repository's folder, with a clean environment. */
export function stepScript(step: Step, index: number, seconds: number): string {
  const trace = `${WORK}/trace-${index}.log`;
  return [
    `cd ${REPO_DIR}`,
    `env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=${HOME} USER=dev LOGNAME=dev LANG=C.UTF-8 TERM=dumb CI=1 \\`,
    `  timeout -k 5 ${seconds} strace -f -qq -s 512 -o ${trace}.full -e trace=${CALLS} bash -c ${quote(step.command)} > ${WORK}/out-${index}.log 2>&1`,
    `echo $? > ${WORK}/exit-${index}`,
    `grep -E ${KEEP} ${trace}.full | grep -v '"${HOME}/\\.npm/' > ${trace} || true`,
    `rm -f ${trace}.full`,
    `grep -E '^> ' ${WORK}/out-${index}.log | head -400 > ${WORK}/scripts-${index}.log || true`,
  ].join('\n');
}

/** The trusted setup, run before the repository exists in the sandbox. */
export function setupScript(): string {
  return [
    'set -e',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq strace git >/dev/null',
    `sudo install -d -o "$(id -u)" -g "$(id -g)" ${HOME} ${HOME}/code ${WORK}`,
  ].join('\n');
}

/** npm prints "> name@version event" then "> command" for each script it runs in the foreground. */
export function npmScripts(lines: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = lines.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2).trim());
  for (let i = 0; i + 1 < rows.length; i++) {
    const head = /^(\S+@\S+) (\w+)$/.exec(rows[i]!);
    if (head && rows[i + 1] && !/^(\S+@\S+) (\w+)$/.test(rows[i + 1]!)) {
      out[rows[i + 1]!] = `${head[1]} ${head[2]} script`;
      i++;
    }
  }
  return out;
}

async function sh(sandbox: Sandbox, script: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const r = await sandbox.runCommand({ cmd: 'bash', args: ['-c', script], timeoutMs });
  return { exitCode: r.exitCode, stdout: await r.stdout(), stderr: await r.stderr() };
}

/** Writes files at absolute paths, creating their folders first. */
async function put(sandbox: Sandbox, files: { path: string; content: string | Buffer }[]): Promise<void> {
  const dirs = [...new Set(files.map((f) => f.path.slice(0, f.path.lastIndexOf('/'))))];
  for (let i = 0; i < dirs.length; i += 100) await sh(sandbox, `mkdir -p ${dirs.slice(i, i + 100).map(quote).join(' ')}`, 60_000);
  await sandbox.writeFiles(files);
}

async function text(sandbox: Sandbox, path: string): Promise<string | null> {
  const b = await sandbox.readFileToBuffer({ path }).catch(() => null);
  return b ? b.toString('utf8') : null;
}

/** Runs a repository's steps in a fresh sandbox and says what its code did. */
export async function runChamber(source: ChamberSource, opts: ChamberOptions = {}): Promise<SandboxEvidence> {
  const say = opts.onProgress ?? (() => {});
  const seconds = opts.stepSeconds ?? 90;
  const credentials =
    opts.credentials ??
    (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID
      ? { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID }
      : undefined);
  if (!credentials) throw new Error('The sandbox needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.');

  say('Starting a throwaway micro-VM');
  const sandbox = await Sandbox.create({
    ...credentials,
    resources: { vcpus: 1 },
    timeout: 15 * 60_000,
    networkPolicy: 'allow-all',
    persistent: false,
    tags: { purpose: 'airlock-sandbox' },
  });
  try {
    say('Installing the tracer');
    const setup = await sh(sandbox, setupScript(), 180_000);
    if (setup.exitCode !== 0) throw new Error(`Sandbox setup failed: ${setup.stderr.slice(-300)}`);

    if ('git' in source) {
      say('Cloning the repository inside the sandbox');
      const rev = source.revision ? ` && git -C ${REPO_DIR} fetch -q --depth 1 origin ${quote(source.revision)} && git -C ${REPO_DIR} checkout -q FETCH_HEAD` : '';
      const clone = await sh(sandbox, `git clone -q --depth 1 --no-recurse-submodules -c core.symlinks=false ${quote(source.git)} ${REPO_DIR}${rev}`, 180_000);
      if (clone.exitCode !== 0) throw new Error(`Couldn't clone the repository in the sandbox: ${clone.stderr.slice(-300)}`);
    } else {
      say('Copying the files into the sandbox');
      await put(sandbox, source.files.map((f) => ({ path: `${REPO_DIR}/${f.path}`, content: f.content })));
    }

    const marker = newMarker();
    say('Planting decoy wallets and keys');
    await put(sandbox, decoyFiles(marker));

    const steps = await planSteps((rel) => text(sandbox, `${REPO_DIR}/${rel}`), opts.maxSteps ?? 6);

    say('Cutting the internet down to package registries');
    await sandbox.updateNetworkPolicy({ allow: REGISTRIES });

    const done: ChamberStep[] = [];
    for (const [i, step] of steps.entries()) {
      say(`Running ${step.label}`);
      const started = Date.now();
      await sh(sandbox, stepScript(step, i, seconds), (seconds + 60) * 1000).catch(() => null);
      const exitCode = Number((await text(sandbox, `${WORK}/exit-${i}`))?.trim() ?? NaN);
      const scripts = npmScripts((await text(sandbox, `${WORK}/scripts-${i}.log`)) ?? '');
      const trace = readTrace((await text(sandbox, `${WORK}/trace-${i}.log`)) ?? '', { step: step.label });
      done.push({
        ...step,
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
        timedOut: exitCode === 124 || exitCode === 137,
        seconds: Math.round((Date.now() - started) / 1000),
        scripts,
        trace,
      });
    }

    const named = (s: ChamberStep, by: string) => (s.scripts[by] ? `${by} (${s.scripts[by]})` : by);
    return {
      provider: 'vercel-sandbox',
      sandboxId: sandbox.name,
      marker,
      allowedHosts: REGISTRIES,
      steps: done,
      wallets: done.flatMap((s) => s.trace.wallets.map((w) => ({ ...w, by: named(s, w.by), step: s.label }))),
      contacts: done.flatMap((s) => s.trace.contacts.map((c) => ({ ...c, by: named(s, c.by), step: s.label }))),
      programs: done.flatMap((s) => s.trace.programs.map((command) => ({ command, step: s.label }))),
    };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
