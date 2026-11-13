// The real-malware benchmark: does the sandbox catch install-time npm malware it has never seen, and
// does it leave honest packages alone?
//
// The malware comes from Datadog's open dataset of malicious packages
// (https://github.com/DataDog/malicious-software-packages-dataset, Apache-2.0), where every sample is an
// encrypted zip. No sample is ever downloaded or opened on the machine running this script: each throwaway
// Vercel Sandbox VM downloads its own archive, checks its git blob id, and opens it before the lockdown,
// then runs `npm install` with the internet cut down to package registries, decoy wallets and keys in its
// home folder, decoy secrets in its environment, and every other host answered from inside the VM.
// Run it from a Vercel account of its own, not the one that serves the live site.
//
//   node --env-file=.env.wild server/wild-bench.ts select <listing.txt>   pick candidates (listing: git ls-tree -r of the dataset)
//   node --env-file=.env.wild server/wild-bench.ts prescreen              read each candidate's package.json inside one VM
//   node --env-file=.env.wild server/wild-bench.ts run [id ...]           run each sample in its own VM
//   node server/wild-bench.ts render                                      print the METRICS.md section

import { Sandbox } from '@vercel/sandbox';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ChamberSource, type SandboxEvidence, runChamber } from './sandbox/chamber.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(root, 'bench', 'wild');
const DATASET = 'DataDog/malicious-software-packages-dataset';
const PASSWORD = 'infected';
/** How many malicious samples and honest packages the benchmark runs. */
const MALICIOUS = 20;
const HONEST = 10;
/** Popular packages that run something on install, the kind that could raise false alarms. */
const HONEST_CANDIDATES = ['esbuild', 'sharp', '@swc/core', 'bcrypt', 'sqlite3', 'better-sqlite3', 'puppeteer', 'electron', 'core-js', 'cypress', 'protobufjs', 'canvas', 'msw', '@parcel/watcher', 'unrs-resolver', 'lefthook', 'nx', 'turbo'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

interface Candidate {
  id: string;
  name: string;
  version: string;
  /** Datadog's discovery date, from the file name. */
  discovered: string;
  url: string;
  blob: string;
}
interface Screened extends Candidate {
  bytes?: number;
  scripts?: Partial<Record<(typeof INSTALL_SCRIPTS)[number], string>>;
  error?: string;
}
interface Entry {
  id: string;
  kind: 'malicious' | 'honest';
  name: string;
  version: string;
  discovered?: string;
  scripts?: Screened['scripts'];
  url?: string;
  blob?: string;
}
type Outcome = 'caught' | 'phoned' | 'fetched' | 'quiet' | 'failed';
interface Row extends Entry {
  outcome: Outcome;
  steps: { label: string; exit: number | null; seconds: number; timedOut: boolean }[];
  decoysTouched: string[];
  hosts: string[];
  sent: { method: string; host: string; bytes: number; decoys: string[] }[];
  refused: number;
  error?: string;
}

const slug = (name: string, version: string) => `${name.replace(/^@/, '').replace(/[^a-z0-9._-]+/gi, '-')}@${version}`.slice(0, 80);

function credentials(): { token: string; teamId: string; projectId: string } {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  if (!token || !teamId || !projectId) throw new Error('Needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID (node --env-file=.env.wild ...).');
  return { token, teamId, projectId };
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DIR, name), 'utf8')) as T;
}
async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * The newest packages in the dataset's malicious_intent npm folder, one version each, leaving out
 * prebuilt binaries for Windows and macOS (they do nothing on the Linux VM). From a `git ls-tree -r`
 * listing of a blobless clone, which holds no sample at all.
 */
export function pickCandidates(listing: string, count: number): Candidate[] {
  const all: Candidate[] = [];
  for (const line of listing.split('\n')) {
    const [meta, file] = line.split('\t');
    const blob = meta?.split(' ')[2];
    const m = /^samples\/npm\/malicious_intent\/(.+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})-[^/]+\.zip$/.exec(file ?? '');
    if (!m || !blob || !/^[0-9a-f]{40}$/.test(blob)) continue;
    // The dataset writes a scoped package @scope/name as @scope@name.
    const name = m[1]!.replace(/^(@[^@/]+)@/, '$1/');
    if (/(win32|darwin|windows|macos)/i.test(name)) continue;
    all.push({ id: '', name, version: m[2]!, discovered: m[3]!, url: `https://raw.githubusercontent.com/${DATASET}/main/${file!.split('/').map(encodeURIComponent).join('/')}`, blob });
  }
  all.sort((a, b) => b.discovered.localeCompare(a.discovered) || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of all) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ ...c, id: slug(c.name, c.version) });
    if (out.length >= count) break;
  }
  return out;
}

/** Reads each candidate's package.json inside one VM: no sample code runs, and none leaves the VM but the scripts' text. */
const PRESCREEN = `import hashlib, io, json, sys, urllib.request, zipfile
items = json.load(open(sys.argv[1]))
out = []
for it in items:
    r = {"id": it["id"]}
    try:
        data = urllib.request.urlopen(it["url"], timeout=60).read()
        r["bytes"] = len(data)
        if hashlib.sha1(b"blob %d\\0" % len(data) + data).hexdigest() != it["blob"]:
            r["error"] = "the archive's git blob id doesn't match"
        else:
            z = zipfile.ZipFile(io.BytesIO(data))
            found = sorted([n for n in z.namelist() if n.endswith("package.json") and "node_modules/" not in n], key=lambda n: n.count("/"))
            if not found:
                r["error"] = "no package.json"
            else:
                pkg = json.loads(z.read(found[0], pwd=b"${PASSWORD}").decode("utf-8", "replace"))
                s = pkg.get("scripts") or {}
                r["scripts"] = {k: str(s[k])[:160] for k in ("preinstall", "install", "postinstall") if k in s}
    except Exception as e:
        r["error"] = str(e)[:200]
    out.append(r)
print(json.dumps(out))
`;

async function prescreen(candidates: Candidate[]): Promise<Screened[]> {
  const sandbox = await Sandbox.create({ ...credentials(), resources: { vcpus: 1 }, timeout: 15 * 60_000, networkPolicy: 'allow-all', persistent: false, tags: { purpose: 'airlock-wild-prescreen' } });
  try {
    await sandbox.writeFiles([
      { path: '/tmp/screen/items.json', content: Buffer.from(JSON.stringify(candidates)) },
      { path: '/tmp/screen/screen.py', content: Buffer.from(PRESCREEN) },
    ]);
    await sandbox.runCommand({ cmd: 'bash', args: ['-c', 'command -v python3 >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq python3)'] });
    const r = await sandbox.runCommand({ cmd: 'python3', args: ['/tmp/screen/screen.py', '/tmp/screen/items.json'] });
    if (r.exitCode !== 0) throw new Error(`prescreen failed: ${(await r.stderr()).slice(-400)}`);
    const results = JSON.parse(await r.stdout()) as (Partial<Screened> & { id: string })[];
    return candidates.map((c) => ({ ...c, ...results.find((x) => x.id === c.id) }));
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

/** The latest version of each honest package that runs something on install, from the npm registry. */
async function honestEntries(count: number): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const name of HONEST_CANDIDATES) {
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`);
    if (!res.ok) continue;
    const pkg = (await res.json()) as { version: string; scripts?: Record<string, string> };
    const scripts = Object.fromEntries(INSTALL_SCRIPTS.filter((k) => pkg.scripts?.[k]).map((k) => [k, pkg.scripts![k]!.slice(0, 160)]));
    if (Object.keys(scripts).length === 0) continue;
    out.push({ id: `honest-${slug(name, pkg.version)}`, kind: 'honest', name, version: pkg.version, scripts });
    if (out.length >= count) break;
  }
  return out;
}

function source(e: Entry): ChamberSource {
  if (e.kind === 'malicious') return { archive: { url: e.url!, blob: e.blob!, password: PASSWORD } };
  // An honest package is installed the way people install it: as a dependency of a project.
  const manifest = { name: 'airlock-control', version: '1.0.0', private: true, dependencies: { [e.name]: e.version } };
  return { files: [{ path: 'package.json', content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }] };
}

/** Out-of-band collectors: services made to receive a callback, which an installer has no reason to call. */
const COLLECTOR = /(^|.)(pipedream.net|webhook.site|oast.(fun|live|me|online|pro|site)|oastify.com|burpcollaborator.net|interact.sh|nip.io|sslip.io|requestbin.(com|net)|canarytokens.com|dnslog.cn|ceye.io|beeceptor.com|ngrok(-free)?.(io|app|dev))$/i;

/** A name or path carrying the machine's details: the sandbox user's name as a label or segment, or a long hex label. */
export function carriesMachineData(host: string, path = ''): boolean {
  const labels = host.toLowerCase().split('.');
  const segments = path.toLowerCase().split(/[/?&=]/);
  return labels.includes('dev') || segments.includes('dev') || labels.some((l) => /^[0-9a-f]{16,}$/.test(l));
}

/**
 * caught: a request carried decoy secrets out. phoned: the code sent data about the machine home: a
 * request with a body, any contact with an out-of-band collector, or a name or path carrying the
 * machine's details (data hidden in DNS names counts). fetched: it only downloaded files or looked
 * hosts up, as installers that fetch prebuilt binaries do. quiet: nothing left the project.
 */
export function outcomeOf(ev: SandboxEvidence): Outcome {
  if (ev.exfil.some((x) => x.decoys.length > 0)) return 'caught';
  const phoned =
    ev.exfil.some((x) => x.bytes > 0 || COLLECTOR.test(x.host) || carriesMachineData(x.host, x.path)) ||
    ev.contacts.some((c) => !!c.host && (COLLECTOR.test(c.host) || carriesMachineData(c.host)));
  if (phoned) return 'phoned';
  if (ev.exfil.length > 0 || ev.contacts.some((c) => c.host) || ev.refused.length > 0) return 'fetched';
  return 'quiet';
}

function row(e: Entry, ev: SandboxEvidence | null, error?: string): Row {
  if (!ev) return { ...e, outcome: 'failed', steps: [], decoysTouched: [], hosts: [], sent: [], refused: 0, ...(error ? { error } : {}) };
  return {
    ...e,
    outcome: outcomeOf(ev),
    steps: ev.steps.map((s) => ({ label: s.label, exit: s.exitCode, seconds: s.seconds, timedOut: s.timedOut })),
    decoysTouched: [...new Set(ev.wallets.map((w) => w.decoy))],
    hosts: [...new Set(ev.contacts.map((c) => c.host).filter((h): h is string => !!h))],
    sent: ev.exfil.map((x) => ({ method: x.method, host: x.host, bytes: x.bytes, decoys: x.decoys })),
    refused: ev.refused.length,
  };
}

async function runAll(entries: Entry[], parallel = 3): Promise<Row[]> {
  const rows: Row[] = [];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const e = entries[next++]!;
      const started = Date.now();
      try {
        const ev = await runChamber(source(e), { credentials: credentials(), stepSeconds: 90, maxSteps: 3 });
        await writeJson(`${e.id}.evidence.json`, ev);
        rows.push(row(e, ev));
      } catch (error) {
        rows.push(row(e, null, (error as Error).message.slice(0, 300)));
      }
      const r = rows.at(-1)!;
      console.log(`${r.outcome.padEnd(8)} ${e.kind.padEnd(9)} ${e.id}  ${Math.round((Date.now() - started) / 1000)}s${r.sent.length ? `  sent ${r.sent.length}${r.sent.some((s) => s.decoys.length) ? ` with ${[...new Set(r.sent.flatMap((s) => s.decoys))].join(', ')}` : ''}` : ''}${r.error ? `  (${r.error.slice(0, 100)})` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return entries.map((e) => rows.find((r) => r.id === e.id)!);
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  caught: 'Caught red-handed: sent decoy secrets out',
  phoned: 'Caught phoning home with the machine’s details',
  fetched: 'Only downloaded files or looked up hosts',
  quiet: 'Did nothing visible on install',
  failed: 'Sandbox run failed',
};

/** Malicious runs that showed nothing distinguishable and whose npm install exited with an error. */
function installFailed(rows: Row[]): Row[] {
  return rows.filter((r) => r.kind === 'malicious' && (r.outcome === 'fetched' || r.outcome === 'quiet') && r.steps.some((st) => st.label === 'npm install' && st.exit !== 0));
}

/** What the sandbox saw, in a line: each request as method, the site it went to (its last two labels) and its body size. */
function sawText(r: Row): string {
  const site = (host: string) => (/^[\d.]+$/.test(host) ? host : host.split('.').slice(-2).join('.'));
  const requests = [...new Set(r.sent.map((s) => `${s.method} ${site(s.host)}${s.bytes ? ` (${s.bytes} B body)` : ''}`))];
  return (
    [
      requests.length ? requests.slice(0, 3).join(', ') + (requests.length > 3 ? ', …' : '') : '',
      r.sent.some((s) => s.decoys.length) ? `with ${[...new Set(r.sent.flatMap((s) => s.decoys))].join(', ')}` : '',
      r.decoysTouched.length ? `opened ${r.decoysTouched.join(', ')}` : '',
      !r.sent.length && r.hosts.length ? `DNS lookup under ${[...new Set(r.hosts.map(site))].join(', ')}` : '',
      r.error ? `error: ${r.error.replace(/[|`]/g, ' ').slice(0, 80)}` : '',
    ]
      .filter(Boolean)
      .join('; ') || 'nothing'
  );
}

export function render(rows: Row[]): string {
  const mal = rows.filter((r) => r.kind === 'malicious');
  const honest = rows.filter((r) => r.kind === 'honest');
  const count = (rs: Row[], o: Outcome) => rs.filter((r) => r.outcome === o).length;
  const lines = [
    '## Sandbox against real npm malware (2026-11-13)',
    '',
    `${mal.length} real malicious npm packages from [Datadog's open dataset](https://github.com/${DATASET}) (Apache-2.0): the newest`,
    'packages in its `malicious_intent` folder whose package.json runs something on install, one version each, leaving out',
    `Windows and macOS binaries. And ${honest.length} popular honest packages that also run something on install, installed as a dependency.`,
    'Each ran in its own throwaway Vercel Sandbox VM, on a Vercel account separate from the live site. The VM downloaded and',
    'opened its own encrypted sample, so no sample existed unencrypted outside it. Rebuild this section with',
    '`node server/wild-bench.ts render`; every run\'s evidence is in `bench/wild/`.',
    '',
    'This measures the sandbox alone, with no AI review, so it shows what running the code reveals by itself. How a run is',
    'classed (`outcomeOf` in `server/wild-bench.ts`): *phoning home* is a request with a body, any contact with an out-of-band',
    'collector service (pipedream.net, webhook.site, oast.*, nip.io and the like), or a host name or path carrying the',
    "machine's details (the sandbox user's name, or a long hex label: data hidden in DNS). Only downloading files or looking",
    'hosts up, as installers that fetch prebuilt binaries do, is not.',
    '',
    '| Outcome | Malicious | Honest |',
    '| --- | --- | --- |',
    ...(['caught', 'phoned', 'fetched', 'quiet', 'failed'] as Outcome[]).map((o) => `| ${OUTCOME_TEXT[o]} | ${count(mal, o)}/${mal.length} | ${count(honest, o)}/${honest.length} |`),
    '',
    `In ${installFailed(rows).length} of the ${mal.filter((r) => r.outcome === 'fetched' || r.outcome === 'quiet').length} malicious runs that showed nothing distinguishable, \`npm install\` itself failed in the sandbox,`,
    'mostly on a dependency since removed from npm or a git dependency the sandbox does not allow, so their install script may',
    'never have run. That is a limit of replaying removed packages, not evidence that they are harmless.',
    '',
    '| Package | Discovered | Install script | Outcome | What the sandbox saw |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => {
      const script = Object.entries(r.scripts ?? {}).map(([k, v]) => `${k}: \`${v.replace(/[|`]/g, ' ').slice(0, 60)}\``).join('; ') || '-';
      const saw = sawText(r);
      return `| ${r.kind === 'honest' ? `${r.name}@${r.version} (honest)` : `\`${r.name}@${r.version}\``} | ${r.discovered ?? '-'} | ${script} | ${OUTCOME_TEXT[r.outcome]} | ${saw} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'select' && rest[0]) {
    const candidates = pickCandidates(await readFile(rest[0], 'utf8'), 60);
    await writeJson('candidates.json', candidates);
    console.log(`${candidates.length} candidates, newest ${candidates[0]?.discovered}, oldest ${candidates.at(-1)?.discovered}`);
  } else if (cmd === 'prescreen') {
    const screened = await prescreen(await readJson<Candidate[]>('candidates.json'));
    const malicious: Entry[] = screened
      .filter((s) => !s.error && s.scripts && Object.keys(s.scripts).length > 0)
      .slice(0, MALICIOUS)
      .map((s) => ({ id: s.id, kind: 'malicious', name: s.name, version: s.version, discovered: s.discovered, scripts: s.scripts!, url: s.url, blob: s.blob }));
    const honest = await honestEntries(HONEST);
    await writeJson('screened.json', screened.map(({ url: _u, ...s }) => s));
    await writeJson('manifest.json', [...malicious, ...honest]);
    console.log(`screened ${screened.length}: ${screened.filter((s) => s.scripts && Object.keys(s.scripts).length).length} run something on install, ${screened.filter((s) => s.error).length} errors`);
    console.log(`manifest: ${malicious.length} malicious, ${honest.length} honest`);
  } else if (cmd === 'run') {
    const manifest = await readJson<Entry[]>('manifest.json');
    const pick = rest.length ? manifest.filter((e) => rest.includes(e.id)) : manifest;
    const rows = await runAll(pick);
    const previous = await readJson<Row[]>('results.json').catch(() => [] as Row[]);
    const merged = manifest.map((e) => rows.find((r) => r.id === e.id) ?? previous.find((r) => r.id === e.id)).filter((r): r is Row => !!r);
    await writeJson('results.json', merged);
    console.log(`\n${render(merged)}`);
  } else if (cmd === 'classify') {
    // Recomputes every outcome from the saved evidence, with no VM.
    const rows = await readJson<Row[]>('results.json');
    for (const r of rows) {
      const ev = await readJson<SandboxEvidence>(`${r.id}.evidence.json`).catch(() => null);
      if (ev) r.outcome = outcomeOf(ev);
    }
    await writeJson('results.json', rows);
    console.log(render(rows));
  } else if (cmd === 'render') {
    console.log(render(await readJson<Row[]>('results.json')));
  } else if (cmd === 'web') {
    // The home page's summary (web/src/home/wild.json): counts and the packages, no evidence.
    const rows = await readJson<Row[]>('results.json');
    const tally = (kind: Row['kind']) => {
      const rs = rows.filter((r) => r.kind === kind);
      return { total: rs.length, ...Object.fromEntries((['caught', 'phoned', 'fetched', 'quiet', 'failed'] as Outcome[]).map((o) => [o, rs.filter((r) => r.outcome === o).length])) };
    };
    const summary = {
      date: '2026-11-13',
      installFailed: installFailed(rows).length,
      malicious: tally('malicious'),
      honest: tally('honest'),
      rows: rows.map((r) => ({
        name: r.name,
        version: r.version,
        kind: r.kind,
        outcome: r.outcome,
        decoys: [...new Set(r.sent.flatMap((s) => s.decoys))],
        saw: sawText(r),
        script: Object.values(r.scripts ?? {})[0] ?? '',
      })),
    };
    await writeFile(path.join(root, 'web', 'src', 'home', 'wild.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log('wrote web/src/home/wild.json');
  } else {
    console.error('usage: node --env-file=.env.wild server/wild-bench.ts select <listing.txt> | prescreen | run [id ...] | render');
    process.exit(2);
  }
}
