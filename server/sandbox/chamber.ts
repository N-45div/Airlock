// The sandbox: a throwaway Vercel Sandbox micro-VM where a stranger's repository is installed and
// set up the way a person would, with a home folder full of decoy wallets and keys, internet only
// to package registries, and every program, file open, host lookup and connection recorded.
//
// Order matters. Everything trusted happens first, before the repository's code exists or can run:
// the tracer is installed, the repository is cloned or copied in, the decoys are written. Then the
// network is locked to registries and the sinkhole takes over DNS: every other host name resolves
// to the VM itself, where the sinkhole receives what the code sends and keeps the bytes, HTTPS
// included (the VM trusts a certificate authority made for this run). Only then do the repository's
// steps run, each under strace, as a user that can't sudo, so the code can't touch the tracer, the
// sinkhole or their logs. The VM is stopped at the end whatever happens.
//
// Needs a Vercel access token: VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.

import { Sandbox } from '@vercel/sandbox';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type Exfil, type Refusal, readCapture } from './capture.ts';
import { HOME, decoyEnv, decoyFiles, decoyTokens, newMarker } from './decoys.ts';
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
  /** Whether the sinkhole ran, and why not if it didn't. Without it, contacts are lookups only. */
  capture: { on: boolean; note?: string };
  /** What the code sent to the hosts it tried to reach, caught by the sinkhole. */
  exfil: Exfil[];
  /** HTTPS clients that refused the sinkhole's certificate. */
  refused: Refusal[];
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

/** The certificate authority the VM trusts for this run, under a name a script wouldn't single out. */
const CA_FILE = '/usr/local/share/ca-certificates/corp-root.crt';

/**
 * The script, run as root, that runs one step: strace runs the step's command as `dev`, a user that
 * can't sudo, from the repository's folder with a clean environment. The step's window is stamped on
 * the VM's clock, so the sinkhole's requests can be matched to it, and anything the step left running
 * is killed before the next.
 */
export function stepScript(step: Step, index: number, seconds: number, decoyVars: string[] = []): string {
  const trace = `${WORK}/trace-${index}.log`;
  for (const v of decoyVars) if (!/^[A-Z_]+=[A-Za-z0-9_]+$/.test(v)) throw new Error(`Unsafe decoy variable: ${v.split('=')[0]}`);
  const env = [
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `HOME=${HOME}`,
    'USER=dev',
    'LOGNAME=dev',
    'LANG=C.UTF-8',
    'TERM=dumb',
    'CI=1',
    `NODE_EXTRA_CA_CERTS=${CA_FILE}`,
    'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt',
    'REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt',
    ...decoyVars,
  ].join(' ');
  return [
    'cd /tmp',
    `date +%s%3N > ${WORK}/start-${index}`,
    `timeout -k 5 ${seconds} strace -f -qq -s 512 -o ${trace}.full -e trace=${CALLS} -u dev /usr/bin/env -i ${env} /bin/bash -c ${quote(`cd ${REPO_DIR} && ${step.command}`)} > ${WORK}/out-${index}.log 2>&1`,
    `echo $? > ${WORK}/exit-${index}`,
    `date +%s%3N > ${WORK}/end-${index}`,
    'pkill -9 -u dev || true',
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
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq strace git openssl ca-certificates python3-setuptools >/dev/null',
    // The repository's code runs as dev. Until the lockdown, the folders belong to the sandbox's
    // own user, so the files can be written in.
    'id -u dev >/dev/null 2>&1 || sudo useradd -M -d /home/dev -s /bin/bash dev',
    `sudo install -d -o "$(id -u)" -g "$(id -g)" ${HOME} ${HOME}/code ${WORK}`,
  ].join('\n');
}

/** After the files are in: hand the home folder to dev, and close the work folder to everyone but root. */
export function lockdownScript(): string {
  return ['set -e', `sudo chown -R dev:dev ${HOME}`, `sudo chown -R root:root ${WORK}`, `sudo chmod 700 ${WORK}`].join('\n');
}

/** Starts the sinkhole as root and points the VM's DNS at it. Exits non-zero if it couldn't. */
export function sinkholeScript(): string {
  return [
    'set -e',
    `node ${WORK}/sinkhole.mjs make-ca ${WORK}/ca`,
    `cp ${WORK}/ca/ca.crt ${CA_FILE}`,
    'update-ca-certificates >/dev/null 2>&1',
    // Registries are still looked up for real, through the VM's own resolver.
    `UP=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)`,
    `sed -i "s/__UPSTREAM__/$UP/" ${WORK}/sinkhole.json`,
    `nohup node ${WORK}/sinkhole.mjs serve ${WORK}/sinkhole.json > ${WORK}/sinkhole.out 2>&1 &`,
    `for i in $(seq 1 50); do [ -f ${WORK}/ready ] && break; sleep 0.2; done`,
    `[ -f ${WORK}/ready ] || { cat ${WORK}/sinkhole.out >&2; exit 1; }`,
    // The platform mounts /etc/resolv.conf into the VM, so it can't be replaced: write into it in
    // place, or mount ours over it if that's refused.
    `cp -L /etc/resolv.conf ${WORK}/resolv.orig`,
    `printf 'nameserver 127.0.0.1\\n' > /etc/airlock-resolv.conf && chmod 644 /etc/airlock-resolv.conf`,
    `cat /etc/airlock-resolv.conf > /etc/resolv.conf 2>/dev/null || mount --bind /etc/airlock-resolv.conf /etc/resolv.conf`,
    `grep -q '^nameserver 127.0.0.1' /etc/resolv.conf`,
  ].join('\n');
}

/** The sinkhole's settings; the upstream resolver is filled in inside the VM. */
export function sinkholeConfig(): string {
  return JSON.stringify({
    dnsPort: 53,
    httpPort: 80,
    httpsPort: 443,
    upstream: '__UPSTREAM__',
    allow: REGISTRIES,
    log: `${WORK}/capture.jsonl`,
    caDir: `${WORK}/ca`,
    ready: `${WORK}/ready`,
  });
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

async function sh(sandbox: Sandbox, script: string, timeoutMs: number, sudo = false): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const r = await sandbox.runCommand({ cmd: 'bash', args: ['-c', script], timeoutMs, sudo });
  return { exitCode: r.exitCode, stdout: await r.stdout(), stderr: await r.stderr() };
}

/** Reads a file in the root-only work folder; null if it isn't there. */
async function rootText(sandbox: Sandbox, path: string): Promise<string | null> {
  const r = await sh(sandbox, `cat ${quote(path)}`, 60_000, true).catch(() => null);
  return r && r.exitCode === 0 ? r.stdout : null;
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
  // Without a token, the SDK uses VERCEL_OIDC_TOKEN, which `vercel env pull` writes for a linked project.
  if (!credentials && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error('The sandbox needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID, or VERCEL_OIDC_TOKEN (run vercel link, then vercel env pull).');
  }

  say('Starting a throwaway micro-VM');
  const sandbox = await Sandbox.create({
    ...(credentials ?? {}),
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

    // The sinkhole and its settings go in while the work folder is still writable.
    await put(sandbox, [
      { path: `${WORK}/sinkhole.mjs`, content: await readFile(fileURLToPath(new URL('./vm/sinkhole.mjs', import.meta.url))) },
      { path: `${WORK}/sinkhole.json`, content: sinkholeConfig() },
    ]);
    const locked = await sh(sandbox, lockdownScript(), 60_000);
    if (locked.exitCode !== 0) throw new Error(`Couldn't lock the sandbox down: ${locked.stderr.slice(-300)}`);

    say('Cutting the internet down to package registries');
    await sandbox.updateNetworkPolicy({ allow: REGISTRIES });

    say('Starting the sinkhole: every other host now answers from inside the VM');
    const sink = await sh(sandbox, sinkholeScript(), 120_000, true);
    const capture = sink.exitCode === 0 ? { on: true } : { on: false, note: `the sinkhole didn't start, so hosts are lookups only: ${sink.stderr.trim().slice(-200)}` };
    if (!capture.on) say('The sinkhole did not start; recording lookups only');

    const done: ChamberStep[] = [];
    const windows: { label: string; start: number; end: number }[] = [];
    for (const [i, step] of steps.entries()) {
      say(`Running ${step.label}`);
      const started = Date.now();
      await sh(sandbox, stepScript(step, i, seconds, decoyEnv(marker)), (seconds + 60) * 1000, true).catch(() => null);
      const exitCode = Number((await rootText(sandbox, `${WORK}/exit-${i}`))?.trim() ?? NaN);
      const scripts = npmScripts((await rootText(sandbox, `${WORK}/scripts-${i}.log`)) ?? '');
      const trace = readTrace((await rootText(sandbox, `${WORK}/trace-${i}.log`)) ?? '', { step: step.label });
      const start = Number((await rootText(sandbox, `${WORK}/start-${i}`))?.trim());
      const end = Number((await rootText(sandbox, `${WORK}/end-${i}`))?.trim());
      if (Number.isFinite(start) && Number.isFinite(end)) windows.push({ label: step.label, start, end });
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
    const contacts = done.flatMap((s) => s.trace.contacts.map((c) => ({ ...c, by: named(s, c.by), step: s.label })));
    const caught = capture.on
      ? readCapture((await rootText(sandbox, `${WORK}/capture.jsonl`)) ?? '', { tokens: decoyTokens(marker), steps: windows, contacts })
      : { exfil: [], refused: [] };
    return {
      provider: 'vercel-sandbox',
      sandboxId: sandbox.name,
      marker,
      allowedHosts: REGISTRIES,
      steps: done,
      wallets: done.flatMap((s) => s.trace.wallets.map((w) => ({ ...w, by: named(s, w.by), step: s.label }))),
      contacts,
      programs: done.flatMap((s) => s.trace.programs.map((command) => ({ command, step: s.label }))),
      capture,
      exfil: caught.exfil,
      refused: caught.refused,
    };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
