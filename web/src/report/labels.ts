// Plain words for everything the server sends as a code.

import type { Approval, Category, RepoInfo, Severity, Source, ToolEvent, Verdict } from '../../../server/types.ts';
import { PRODUCT } from '../brand.ts';
import type { IconName } from '../ui/Icon.tsx';
import type { Tone } from '../ui/primitives.tsx';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'danger' },
  medium: { label: 'Medium', tone: 'caution' },
  low: { label: 'Low', tone: 'neutral' },
  info: { label: 'Info', tone: 'neutral' },
};

export const CATEGORY: Record<Category, string> = {
  'runs-on-install': 'Runs on install',
  'runs-on-open': 'Runs when the folder opens',
  'secret-access': 'Reads secrets',
  'wallet-access': 'Touches crypto wallets',
  exfiltration: 'Sends data out',
  obfuscation: 'Hidden or packed code',
  'ai-instructions': 'Text aimed at AI tools',
  clipboard: 'Uses the clipboard',
  binary: 'Ships programs or archives',
  other: 'Other',
};

export const SOURCE: Record<Source, string> = {
  static: 'Static check',
  agent: 'Agent',
  armoriq: 'ArmorIQ',
  sandbox: 'Sandbox',
};

export const VERDICT: Record<Verdict, { title: string; tone: 'safe' | 'caution' | 'danger'; icon: IconName }> = {
  safe: { title: 'Looks safe', tone: 'safe', icon: 'shield' },
  caution: { title: 'Be careful', tone: 'caution', icon: 'alert' },
  dangerous: { title: 'Don’t run it', tone: 'danger', icon: 'stop' },
};

export function repoName(repo: RepoInfo): string {
  return repo.host === 'sample' ? repo.name : `${repo.owner}/${repo.name}`;
}

export function githubUrl(repo: RepoInfo): string | null {
  if (repo.host !== 'github' || !repo.owner || !repo.name) return null;
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

/** A link to one line of the exact commit that was scanned, when it is safe to build one. */
export function githubLineUrl(repo: RepoInfo, file: string, line?: number): string | null {
  const base = githubUrl(repo);
  if (!base || !repo.commit || !/^[0-9a-f]{40}$/i.test(repo.commit)) return null;
  const clean = file.replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.split('/').some((part) => part === '..' || part === '')) return null;
  const path = clean.split('/').map(encodeURIComponent).join('/');
  return `${base}/blob/${repo.commit}/${path}${line ? `#L${line}` : ''}`;
}

// The fence

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash']);
const FETCH_TOOLS = new Set(['WebFetch', 'WebSearch']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export type ToolKind = 'read' | 'command' | 'fetch' | 'edit' | 'other';

export function toolKind(tool: string): ToolKind {
  if (READ_TOOLS.has(tool) || /^mcp__airlock__search_meaning$/.test(tool)) return 'read';
  if (COMMAND_TOOLS.has(tool)) return 'command';
  if (FETCH_TOOLS.has(tool)) return 'fetch';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  return 'other';
}

export const KIND_WORDS: Record<ToolKind, [string, string]> = {
  read: ['read', 'reads'],
  command: ['command', 'commands'],
  fetch: ['page fetch', 'page fetches'],
  edit: ['edit', 'edits'],
  other: ['other call', 'other calls'],
};

/** Tool names as the agent knows them, without MCP plumbing. */
export function toolName(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool;
  const name = tool.slice(tool.lastIndexOf('__') + 2);
  return name || tool;
}

/** The input summary, readable: a shell call the server could not summarize arrives as JSON. */
export function displaySummary(summary: string): string {
  const json = /^\{"command":"([\s\S]*)$/.exec(summary);
  if (!json?.[1]) return summary;
  // Read the JSON string up to its closing quote; the server may have cut it short.
  const text = json[1];
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') break;
    if (c === '\\' && i + 1 < text.length) {
      const next = text[++i];
      out += next === 'n' || next === 't' ? ' ' : next === 'r' ? '' : next;
      continue;
    }
    out += c;
  }
  return out;
}

/** One line of the fence log. A call that waited for the person is shown once,
 * on the row where it was held, with how it was settled. */
export interface FenceRow {
  event: ToolEvent;
  /** Set when this call was held for the person first. */
  held?: ToolEvent;
  /** The person did not answer in time. */
  expired?: boolean;
}

export function fenceRows(events: ToolEvent[], approvals: Approval[]): FenceRow[] {
  const rows: FenceRow[] = [];
  const open = new Map<string, number>();
  for (const event of events) {
    const key = `${event.tool}\u0000${event.summary}`;
    if (event.decision === 'held') {
      open.set(key, rows.length);
      rows.push({ event });
      continue;
    }
    const at = open.get(key);
    const heldRow = at === undefined ? undefined : rows[at];
    if (at !== undefined && heldRow) {
      open.delete(key);
      const expired =
        event.decision === 'denied' &&
        approvals.some((a) => a.status === 'expired' && a.tool === event.tool && a.summary === event.summary);
      rows[at] = { event, held: heldRow.event, expired };
    } else {
      rows.push({ event });
    }
  }
  return rows;
}

export interface DecisionLook {
  label: string;
  tone: Tone;
  icon: IconName;
  /** How the summary line counts it: "allowed", "blocked", ... */
  verb: string;
}

export function decisionLook(row: FenceRow): DecisionLook {
  const { decision, by } = row.event;
  switch (decision) {
    case 'allowed':
      return { label: by === 'armoriq' ? 'Allowed by ArmorIQ' : 'Allowed', tone: 'quiet', icon: 'check', verb: 'allowed' };
    case 'blocked':
      return {
        label: by === 'armoriq' ? 'Blocked by ArmorIQ' : by === 'airlock' ? `Blocked by ${PRODUCT} backstop` : 'Blocked',
        tone: 'danger',
        icon: 'blocked',
        verb: 'blocked',
      };
    case 'held':
      return { label: 'Waiting for you', tone: 'caution', icon: 'clock', verb: 'waiting for you' };
    case 'approved':
      return { label: 'Approved by you', tone: 'accent', icon: 'check', verb: 'approved by you' };
    case 'denied':
      return row.expired
        ? { label: 'No answer in time', tone: 'neutral', icon: 'clock', verb: 'not answered in time' }
        : { label: 'Declined by you', tone: 'neutral', icon: 'close', verb: 'declined by you' };
    case 'failed':
      return { label: 'Failed', tone: 'neutral', icon: 'info', verb: 'failed' };
  }
}

export function heldByLabel(by: ToolEvent['by']): string {
  return by === 'armoriq' ? 'Held by ArmorIQ' : by === 'airlock' ? `Held by ${PRODUCT}` : 'Held';
}

const VERB_ORDER = ['allowed', 'blocked', 'waiting for you', 'approved by you', 'declined by you', 'not answered in time', 'failed'];
const KIND_ORDER: ToolKind[] = ['read', 'command', 'fetch', 'edit', 'other'];

/** "14 reads allowed · 1 command blocked" */
export function fenceCounts(rows: FenceRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${decisionLook(row).verb}|${toolKind(row.event.tool)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const verb of VERB_ORDER) {
    for (const kind of KIND_ORDER) {
      const n = counts.get(`${verb}|${kind}`);
      if (!n) continue;
      const [one, many] = KIND_WORDS[kind];
      parts.push(`${n} ${n === 1 ? one : many} ${verb}`);
    }
  }
  return parts.join(' · ');
}
