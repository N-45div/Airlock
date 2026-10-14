// The contract between the server, the web app and the Chrome extension.
// Everything here travels as JSON; keep it free of runtime code.

/** What we tell the person, in plain words. */
export type Verdict = 'safe' | 'caution' | 'dangerous';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type Category =
  | 'runs-on-install' // package scripts, setup.py, build hooks
  | 'runs-on-open' // editor tasks that start when the folder opens
  | 'secret-access' // SSH keys, .env, browser profiles, cloud credentials
  | 'wallet-access' // crypto wallet files, extension storage, seed phrases
  | 'exfiltration' // sends data out: Telegram bots, Discord webhooks, paste sites, raw IPs
  | 'obfuscation' // packed, encoded or minified code that runs
  | 'ai-instructions' // text planted to steer an AI agent
  | 'clipboard' // reads or rewrites the clipboard (address swapping)
  | 'binary' // executables or archives shipped in the repo
  | 'other';

/** Where a finding came from. */
export type Source = 'static' | 'agent' | 'armoriq' | 'sandbox';

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  /** One or two sentences a non-expert can follow. */
  detail: string;
  source: Source;
  file?: string;
  line?: number;
  snippet?: string;
}

/** A single tool call the reviewing agent made, and what the fence decided. */
export interface ToolEvent {
  id: string;
  at: string;
  tool: string;
  /** Short, human summary of the input: a path, a pattern, a command. */
  summary: string;
  decision: 'allowed' | 'held' | 'blocked' | 'approved' | 'denied' | 'failed';
  /** Who made the decision: ArmorIQ's policy, Airlock's own backstop, or the person. */
  by: 'armoriq' | 'airlock' | 'person';
  reason?: string;
}

export interface Approval {
  id: string;
  tool: string;
  summary: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

export type ScanStatus =
  | 'queued'
  | 'fetching'
  | 'prescanning'
  | 'reviewing'
  | 'waiting'
  | 'sandbox'
  | 'done'
  | 'failed';

export interface RepoInfo {
  url: string;
  host: 'github' | 'sample';
  owner: string;
  name: string;
  /** Commit that was scanned, so a report always names exact code. */
  commit?: string;
  files?: number;
  bytes?: number;
}

export interface Scan {
  id: string;
  repo: RepoInfo;
  status: ScanStatus;
  verdict?: Verdict;
  /** One sentence: the answer to "should I run this?" */
  headline?: string;
  summary?: string;
  findings: Finding[];
  events: ToolEvent[];
  approvals: Approval[];
  startedAt: string;
  finishedAt?: string;
  costUsd?: number;
  error?: string;
}

/** Server-sent events on GET /api/scans/:id/stream. */
export type ScanEvent =
  | { type: 'scan'; scan: Scan } // full snapshot, sent first
  | { type: 'status'; status: ScanStatus; note?: string }
  | { type: 'finding'; finding: Finding }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'approval'; approval: Approval }
  | { type: 'thought'; text: string } // the agent's short progress notes
  | { type: 'done'; scan: Scan }
  | { type: 'error'; message: string };

// HTTP API
//
// POST /api/scans                       { url } -> { id, key }   (key lets its holder answer approvals)
// GET  /api/scans/:id                   -> Scan
// GET  /api/scans/:id/stream            -> text/event-stream of ScanEvent
// POST /api/scans/:id/approvals/:aid    { decision: 'approve' | 'deny' }, header x-airlock-key -> Approval
// GET  /api/lookup?url=<repo url>       -> { scan: Scan | null }  latest finished scan of that repo
// GET  /api/samples                     -> Sample[]
// GET  /r/:id                           the shareable report page

export interface CreateScanResponse {
  id: string;
  key: string;
}

export interface Sample {
  id: string;
  title: string;
  blurb: string;
  url: string;
}
