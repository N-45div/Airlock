// Reads an strace log (strace -f, one line per system call, each starting with the process id)
// from one sandbox step and says what the code did that matters: which decoy wallets and keys it
// opened or looked for, which hosts it tried to reach, and which programs it started, each
// credited to the script that did it.

import { HOME, type DecoyKind, homeRelative, matchDecoy } from './decoys.ts';

/** Hosts the sandbox lets package managers reach; looking them up is expected. */
export const REGISTRIES = ['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org'];

export interface WalletTouch {
  decoy: string;
  kind: DecoyKind;
  /** "~/.config/solana/id.json" */
  path: string;
  /** opened: read the file or listed the folder. looked: checked whether it exists. */
  action: 'opened' | 'looked';
  /** The script that did it: "node scripts/setup.js". */
  by: string;
}

export interface Contact {
  /** A host name it looked up, or an address it connected to. */
  host?: string;
  ip?: string;
  port?: number;
  by: string;
}

export interface StepTrace {
  wallets: WalletTouch[];
  contacts: Contact[];
  /** Programs started by the project's own scripts, not by the package manager. */
  programs: string[];
}

/** Undoes strace's C-style string escapes into bytes. */
export function unescapeC(s: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      out.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, v: 11, f: 12, a: 7, b: 8, '"': 34, '\\': 92, "'": 39 };
    if (n in simple) out.push(simple[n]!);
    else if (n === 'x') {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1))![0];
      out.push(parseInt(hex, 16));
      i += hex.length;
    } else if (/[0-7]/.test(n)) {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i))![0];
      out.push(parseInt(oct, 8) & 0xff);
      i += oct.length - 1;
    } else out.push(n.charCodeAt(0));
  }
  return Buffer.from(out);
}

/** Every "..." string literal in a line, unescaped. */
export function stringLiterals(line: string): Buffer[] {
  const found: Buffer[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  for (const m of line.matchAll(re)) found.push(unescapeC(m[1]!));
  return found;
}

/** The host name asked for, if these bytes are a DNS query. */
export function dnsQueryName(bytes: Buffer): string | undefined {
  if (bytes.length < 17 || bytes[2]! & 0x80 || bytes.readUInt16BE(4) === 0) return undefined;
  const labels: string[] = [];
  let i = 12;
  while (i < bytes.length) {
    const len = bytes[i]!;
    if (len === 0) break;
    if (len > 63 || i + 1 + len > bytes.length) return undefined;
    const label = bytes.subarray(i + 1, i + 1 + len).toString('latin1');
    if (!/^[A-Za-z0-9_-]+$/.test(label)) return undefined;
    labels.push(label.toLowerCase());
    i += 1 + len;
  }
  return labels.length >= 1 ? labels.join('.') : undefined;
}

const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh']);
const INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'deno', 'bun']);
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A readable name for what a process runs, or undefined if it isn't a script of its own. */
function scriptOf(argv: string[]): string | undefined {
  const [exe = '', ...rest] = argv;
  const name = base(exe);
  if (SHELLS.has(name)) {
    const c = rest.indexOf('-c');
    if (c >= 0 && rest[c + 1]) return rest[c + 1];
    const file = rest.find((a) => !a.startsWith('-'));
    return file ? `${name} ${file}` : undefined;
  }
  if (INTERPRETERS.has(name) || INTERPRETERS.has(name.replace(/\d+(\.\d+)?$/, ''))) {
    const file = rest.find((a) => !a.startsWith('-'));
    // npm, npx and other tools are node scripts too, but they are the package manager, not the project.
    if (!file || /\/(?:npm|npx|pnpm|yarn|corepack)(?:-cli\.js)?$|node_modules\/(?:npm|corepack)\//.test(file)) return undefined;
    return `${name} ${file}`;
  }
  return undefined;
}

const SYSCALL = /^(\d+)\s+(?:<\.\.\. (\w+) resumed>|(\w+)\()(.*)$/;

interface Call {
  pid: number;
  name: string;
  /** True for the second half of a call strace printed in two parts. */
  resumed: boolean;
  rest: string;
}

/**
 * Reads one step's strace log. The first program started is the step's own shell: what it does
 * directly, and what the package manager does under it, counts as the step; what a project's
 * script does is credited to that script.
 */
export function readTrace(log: string, opts: { step: string; home?: string; allowedHosts?: string[] }): StepTrace {
  const home = opts.home ?? HOME;
  const allowed = new Set((opts.allowedHosts ?? REGISTRIES).map((h) => h.toLowerCase()));
  const calls: Call[] = [];
  for (const line of log.split('\n')) {
    const m = SYSCALL.exec(line.trim());
    if (m) calls.push({ pid: Number(m[1]), name: m[2] ?? m[3]!, resumed: !!m[2], rest: m[4]! });
  }

  // Pass 1: who started whom. With -f, a child's first calls can print before its parent's clone
  // returns the child's id, so the whole tree is read first.
  const parent = new Map<number, number>();
  let root: number | undefined;
  for (const c of calls) {
    if (/^(clone3?|v?fork)$/.test(c.name)) {
      const child = /=\s*(\d+)\s*$/.exec(c.rest);
      if (child) parent.set(Number(child[1]), c.pid);
    } else if (root === undefined && c.name === 'execve' && !c.resumed && !/=\s*-1\s/.test(c.rest)) root = c.pid;
  }

  // Pass 2: in order, with each process's current program.
  const current = new Map<number, string[]>();
  /** The nearest process at or above pid, below the step's own shell, that runs a project script. */
  const by = (pid: number): string => {
    for (let p: number | undefined = pid, hops = 0; p !== undefined && p !== root && hops < 64; p = parent.get(p), hops++) {
      const s = scriptOf(current.get(p) ?? []);
      if (s) return s;
    }
    return opts.step;
  };

  const wallets = new Map<string, WalletTouch>();
  const contacts = new Map<string, Contact>();
  const programs = new Set<string>();

  for (const { pid, name: call, resumed, rest } of calls) {
    if (call === 'execve' && !resumed) {
      if (/=\s*-1\s/.test(rest)) continue;
      const argv = stringLiterals(rest).map((b) => b.toString('utf8')).slice(1);
      current.set(pid, argv);
      if (pid === root) continue;
      // A project script, or any program a project script started (curl, wget, a shipped binary).
      const startedBy = parent.has(pid) ? by(parent.get(pid)!) : opts.step;
      if (scriptOf(argv) !== undefined || startedBy !== opts.step) {
        programs.add(argv.map((a) => (a.length > 120 ? `${a.slice(0, 117)}...` : a)).join(' ').slice(0, 200));
      }
      continue;
    }
    if (resumed) continue;

    if (/^(open|openat|openat2|newfstatat|statx|stat|lstat|access|faccessat2?|readlink|readlinkat|opendir|getdents64)$/.test(call)) {
      const lit = stringLiterals(rest)[0]?.toString('utf8');
      if (!lit || !lit.startsWith('/')) continue;
      const decoy = matchDecoy(lit, home);
      if (!decoy) continue;
      const action: WalletTouch['action'] = /^open/.test(call) ? 'opened' : 'looked';
      const who = by(pid);
      const key = `${decoy.label}|${who}`;
      const prior = wallets.get(key);
      if (!prior || (prior.action === 'looked' && action === 'opened')) {
        wallets.set(key, { decoy: decoy.label, kind: decoy.kind, path: homeRelative(lit, home), action, by: who });
      }
      continue;
    }

    if (call === 'connect') {
      const v4 = /sa_family=AF_INET, sin_port=htons\((\d+)\), sin_addr=inet_addr\("([\d.]+)"\)/.exec(rest);
      const v6 = /sa_family=AF_INET6, sin6_port=htons\((\d+)\).*?inet_pton\(AF_INET6, "([^"]+)"/.exec(rest);
      const hit = v4 ?? v6;
      if (!hit) continue;
      const port = Number(hit[1]);
      const ip = hit[2]!;
      if (port === 53 || /^127\.|^::1$|^::ffff:127\./.test(ip)) continue;
      const who = by(pid);
      // The package manager's own connections go to registries it was allowed to reach.
      if (who === opts.step) continue;
      contacts.set(`${ip}:${port}|${who}`, { ip, port, by: who });
      continue;
    }

    if (/^(sendto|sendmmsg|sendmsg)$/.test(call)) {
      for (const bytes of stringLiterals(rest)) {
        const name = dnsQueryName(bytes);
        if (!name || allowed.has(name)) continue;
        const who = by(pid);
        contacts.set(`${name}|${who}`, { host: name, by: who });
      }
    }
  }

  return { wallets: [...wallets.values()], contacts: [...contacts.values()], programs: [...programs] };
}
