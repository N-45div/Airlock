// Airlock guard: before a coding agent clones a GitHub repository, installs it, or pipes one of its
// scripts into a shell, look up Airlock's verdict for that repository on NEAR.
//
// As a Claude Code hook (PreToolUse on Bash; `npm run guard -- --config` prints the settings,
// and `npm run guard -- --config --codex` the same for OpenAI Codex, which can't ask, so it blocks):
//   "Don't run it"                                  the command is blocked and the agent told why
//   "Be careful", a verdict for an older commit,
//   or no verdict yet for a GitHub repository       you are asked before it runs
//   "Looks safe" at the repository's current commit the command runs as usual, with a note
// By hand, with the same rules (exit code 2 = blocked, 1 = would ask, 0 = goes ahead):
//   npm run guard -- check "git clone https://github.com/owner/name"
//
// Reading a verdict is a free view call to public NEAR RPC: no key, no wallet, and nothing is sent
// to Airlock. An npm package name is matched to its GitHub repository through the npm registry;
// a package with no verdict goes ahead, since most never get one. Settings: AIRLOCK_GUARD_UNKNOWN
// (`ask` or `allow` for GitHub repositories with no verdict, default `ask`), AIRLOCK_SITE, and
// the registry settings in server/registry.ts.

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { VerdictRecord } from './registry.ts';

const run = promisify(execFile);
const SITE = (process.env.AIRLOCK_SITE ?? 'https://airlock-check.vercel.app').replace(/\/+$/, '');

export interface Target {
  /** Registry id: github.com/owner/name, lower case. */
  repo: string;
  /** https://github.com/Owner/Name as written. */
  url: string;
  /** How the command reaches the repository. */
  via: 'github' | 'npm';
  /** The npm package name, when via is npm. */
  pkg?: string;
}

export type Action = 'deny' | 'ask' | 'allow';

export interface Decision {
  target: Target;
  action: Action;
  message: string;
}

// Commands that put a stranger's code on this machine and usually run it.
const FETCHES =
  /(?:^|[\s;&|(])(?:git\s+clone|gh\s+repo\s+clone|npm\s+(?:i|install|add|exec)|npx|pnpm\s+(?:add|i|install|dlx)|pnpx|yarn\s+(?:add|dlx)|bunx|bun\s+(?:add|i|install|x)|pip3?\s+install|pipx\s+(?:install|run)|uvx|uv\s+(?:add|pip\s+install|tool\s+(?:install|run))|cargo\s+install|go\s+(?:install|run|get))(?=\s|$)/;
const PIPED_TO_SHELL = /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da)?sh|python3?|node|perl|ruby)\b/;

const GITHUB_REFS = [
  // Not gist.github.com or api.github.com: only the repository host itself.
  /(?:\b(?:https?|git|ssh|git\+https|git\+ssh):\/\/(?:git@)?|\bgit@|(?<![\w.-]))(?:www\.)?github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/gi,
  /\bgithub:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/gi,
  /\braw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/gi,
  /\bgh\s+repo\s+clone\s+([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/gi,
];

function githubTarget(owner: string, rawName: string): Target | null {
  const name = rawName.replace(/\.git$/i, '').replace(/\.+$/, '');
  if (!owner || !name) return null;
  return { repo: `github.com/${owner}/${name}`.toLowerCase(), url: `https://github.com/${owner}/${name}`, via: 'github' };
}

/** GitHub repositories a shell command would fetch and run. Empty when it fetches nothing. */
export function githubTargets(command: string): Target[] {
  if (!FETCHES.test(command) && !PIPED_TO_SHELL.test(command)) return [];
  const found = new Map<string, Target>();
  for (const re of GITHUB_REFS) {
    for (const m of command.matchAll(re)) {
      const t = githubTarget(m[1]!, m[2]!);
      if (t && !found.has(t.repo)) found.set(t.repo, t);
    }
  }
  return [...found.values()];
}

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
// Package managers and the verbs after which every argument is a package (`all`), or only the first (`first`).
const NPM_VERBS: [RegExp, 'all' | 'first'][] = [
  [/^(?:npm|pnpm|yarn|bun)$/, 'all'],
  [/^(?:npx|pnpx|bunx)$/, 'first'],
];
const ALL_ARGS = new Set(['i', 'install', 'add']);
const FIRST_ARG = new Set(['dlx', 'exec', 'x']);

/** npm package names a command installs or runs, without versions. Paths, URLs and git specs are left out. */
export function npmPackages(command: string): string[] {
  const names: string[] = [];
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let i = words.findIndex((w) => NPM_VERBS.some(([re]) => re.test(w)));
    if (i < 0) continue;
    const tool = words[i]!;
    let mode = NPM_VERBS.find(([re]) => re.test(tool))![1];
    if (mode === 'all') {
      const verb = words[i + 1] ?? '';
      if (FIRST_ARG.has(verb)) mode = 'first';
      else if (!ALL_ARGS.has(verb)) continue;
      i += 1;
    }
    for (const word of words.slice(i + 1)) {
      if (word.startsWith('-')) continue;
      const name = word.replace(/^(@?[^@]+)@.*$/, '$1').toLowerCase();
      if (NPM_NAME.test(name) && !word.includes(':')) names.push(name);
      if (mode === 'first') break;
    }
  }
  return [...new Set(names)];
}

/** A package.json "repository" field to a GitHub target, or null. */
export function repositoryTarget(repository: unknown, pkg: string): Target | null {
  const link = typeof repository === 'string' ? repository : (repository as { url?: unknown } | null)?.url;
  if (typeof link !== 'string') return null;
  const text = link.trim().replace(/^github:/i, 'https://github.com/');
  const m = /^(?:[a-z+]+:\/\/)?(?:git@)?(?:www\.)?github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/i.exec(text) ?? /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(text);
  const t = m ? githubTarget(m[1]!, m[2]!) : null;
  return t ? { ...t, via: 'npm', pkg } : null;
}

async function npmTarget(pkg: string): Promise<Target | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return repositoryTarget(((await res.json()) as { repository?: unknown }).repository, pkg);
  } catch {
    return null;
  }
}

const LABEL = { safe: 'Looks safe', caution: 'Be careful', dangerous: "Don't run it" } as const;
const SEVERITY: Record<Action, number> = { allow: 0, ask: 1, deny: 2 };

function describe(r: VerdictRecord): string {
  const date = new Date(r.recorded_at_ms).toISOString().slice(0, 10);
  return `verdict #${r.id} for commit ${r.revision.slice(0, 7)}, ${r.findings} finding${r.findings === 1 ? '' : 's'}, by ${r.model} in a NEAR AI Cloud TEE, recorded ${date}`;
}

const reportLink = (t: Target) => `${SITE}/near?repo=${encodeURIComponent(t.repo)}`;

/** What to do about one repository, given its newest verdict and its current commit. Pure. */
export function decide(t: Target, record: VerdictRecord | null, head: string | null, unknown: 'ask' | 'allow' = 'ask'): Decision {
  const name = t.via === 'npm' ? `npm package ${t.pkg} (${t.repo})` : t.repo;
  if (!record) {
    if (t.via === 'npm') return { target: t, action: 'allow', message: `Airlock: no verdict on NEAR for ${name}.` };
    return {
      target: t,
      action: unknown,
      message: `Airlock: no verdict on NEAR for ${name} yet. Check it first at ${SITE}/?url=${encodeURIComponent(t.url)} (about a minute), or on your own machine: npm run scan:private -- ${t.url}`,
    };
  }
  const said = `Airlock: "${LABEL[record.verdict]}" for ${name} (${describe(record)}). Report: ${reportLink(t)}`;
  if (record.verdict === 'dangerous') {
    return { target: t, action: 'deny', message: `${said}\nBlocked: don't fetch or run this repository. Tell the person why, and point them to the report.` };
  }
  if (record.verdict === 'caution') return { target: t, action: 'ask', message: `${said}\nSomething in it runs by itself. Read the findings before going ahead.` };
  if (t.via === 'github' && head && !head.startsWith(record.revision) && !record.revision.startsWith(head)) {
    return { target: t, action: 'ask', message: `${said}\nThe repository has changed since: it is now at ${head.slice(0, 7)}, which nobody has checked.` };
  }
  if (t.via === 'npm') {
    // The package names its own repository, and any package can name any repository.
    return { target: t, action: 'allow', message: `${said}\nThis verdict is for the repository the package names. The package published on npm was not checked.` };
  }
  return { target: t, action: 'allow', message: said };
}

async function currentCommit(url: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['ls-remote', url, 'HEAD'], { timeout: 8000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return /^[0-9a-f]{40}/.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Every repository a command reaches, each with what to do about it. Empty when it fetches nothing. */
export async function check(command: string, unknown: 'ask' | 'allow' = 'ask'): Promise<Decision[]> {
  const targets = githubTargets(command);
  const seen = new Set(targets.map((t) => t.repo));
  for (const t of await Promise.all(npmPackages(command).slice(0, 5).map(npmTarget))) {
    if (t && !seen.has(t.repo)) {
      seen.add(t.repo);
      targets.push(t);
    }
  }
  if (targets.length === 0) return [];
  const { view, RECORDER } = await import('./registry.ts');
  return Promise.all(
    targets.map(async (t): Promise<Decision> => {
      let record: VerdictRecord | null;
      try {
        record = await view<VerdictRecord | null>('get_latest', { repo: t.repo, recorder: RECORDER });
      } catch (error) {
        const action: Action = t.via === 'npm' ? 'allow' : 'ask';
        return { target: t, action, message: `Airlock: couldn't read the verdict for ${t.repo} from NEAR (${(error as Error).message}).` };
      }
      const head = record?.verdict === 'safe' && t.via === 'github' ? await currentCommit(t.url) : null;
      return decide(t, record, head, unknown);
    }),
  );
}

/** The most careful action among the decisions. */
export function overall(decisions: Decision[]): Action {
  return decisions.reduce<Action>((worst, d) => (SEVERITY[d.action] > SEVERITY[worst] ? d.action : worst), 'allow');
}

/**
 * PreToolUse output for these decisions, or null to stay out of the way. Claude Code shows an
 * `ask` reason to the person; a note on a command that goes ahead reaches both the person and
 * the agent. Codex can't ask yet, so for Codex an `ask` blocks and says to ask the person.
 */
export function hookOutput(decisions: Decision[], agent: 'claude' | 'codex' = 'claude'): Record<string, unknown> | null {
  let action = overall(decisions);
  const notes = decisions.filter((d) => d.action !== 'allow' || !/no verdict on NEAR for npm/.test(d.message));
  if (notes.length === 0) return null;
  let reason = notes.map((d) => d.message).join('\n\n');
  if (action === 'allow') return { systemMessage: reason, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason } };
  if (action === 'ask' && agent === 'codex') {
    action = 'deny';
    reason += '\n\nNot run: ask the person first. If they still want it, they can run the command themselves.';
  }
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: action, permissionDecisionReason: reason } };
}

function hookConfig(agent: 'claude' | 'codex'): string {
  const self = realpathSync(fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const command = `node --no-warnings "${self}"${agent === 'codex' ? ' --codex' : ''}`;
  const config = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 30 }] }] } };
  return JSON.stringify(config, null, 2);
}

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main(): Promise<void> {
  const unknown = process.env.AIRLOCK_GUARD_UNKNOWN === 'allow' ? 'allow' : 'ask';
  const agent = process.argv.includes('--codex') ? 'codex' : 'claude';
  const [mode, ...rest] = process.argv.slice(2).filter((a) => a !== '--codex');
  if (mode === '--config') {
    console.log(hookConfig(agent));
    return;
  }
  if (mode === 'check') {
    let command = rest.join(' ').trim();
    if (!command) throw new Error('Usage: npm run guard -- check "git clone https://github.com/owner/name"');
    if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(command)) command = `git clone ${command}`;
    const decisions = await check(command, unknown);
    if (decisions.length === 0) console.log('Fetches no repository: nothing to check.');
    for (const d of decisions) console.log(`${d.action.toUpperCase().padEnd(5)}  ${d.message.replace(/\n/g, '\n       ')}\n`);
    process.exitCode = SEVERITY[overall(decisions)];
    return;
  }
  // Hook mode: Claude Code sends the tool call on stdin.
  const input = JSON.parse((await readStdin()) || '{}') as { tool_name?: string; tool_input?: { command?: unknown } };
  if (input.tool_name !== 'Bash' || typeof input.tool_input?.command !== 'string') return;
  const output = hookOutput(await check(input.tool_input.command, unknown), agent);
  if (output) console.log(JSON.stringify(output));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    // A broken guard must not break the agent: say so and let Claude Code's own permissions decide.
    console.error(`Airlock guard: ${(error as Error).message}`);
    process.exitCode = process.argv[2] === 'check' ? 1 : 0;
  });
}
