// Runs scans one after another, keeps each scan's live state and history, and
// saves finished reports to disk so a shared link keeps working.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchError, fetchRepo, fetchSample, parseRepoUrl } from './fetch-repo.ts';
import { takeInventory } from './inventory.ts';
import { type Receipt, receiptHash } from './receipt.ts';
import { review } from './review.ts';
import type { ReviewOptions, ReviewResult } from './review.ts';
import { SAMPLES, sampleRepo, sampleSource } from './samples.ts';
import type { Approval, Finding, RepoInfo, SandboxReport, Scan, ScanEvent, ScanProof, ScanStatus, ToolEvent } from './types.ts';

/** A review engine: Claude (review.ts) or NEAR AI Cloud (near-engine.ts), which adds a proof. */
export type Reviewer = (opts: ReviewOptions) => Promise<ReviewResult & { proof?: ScanProof; sandbox?: SandboxReport; files?: Scan['files'] }>;

export const LIMITS = {
  /** Scans running at once; the rest wait in line. */
  concurrent: Number(process.env.AIRLOCK_CONCURRENT ?? 2),
  /** Scans one address may start per hour. */
  perIpHour: Number(process.env.AIRLOCK_PER_IP_HOUR ?? 6),
  /** Spend across all scans per UTC day, in USD. */
  dailyUsd: Number(process.env.AIRLOCK_DAILY_USD ?? 25),
  /** A finished scan of the same repo this recent is reused. */
  reuseMs: 6 * 60 * 60 * 1000,
  approvalMs: 3 * 60 * 1000,
  /** How long a private check's report stays in memory after it finishes, so its page can load it. */
  privateMs: 15 * 60 * 1000,
  /** A review that runs longer is stopped, so one stuck scan can't hold the line. */
  reviewMs: Number(process.env.AIRLOCK_REVIEW_MINUTES ?? 8) * 60 * 1000,
};

export class ScanError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface Live {
  scan: Scan;
  key: string;
  bus: EventEmitter;
  answers: Map<string, (answer: 'yes' | 'no' | 'expired') => void>;
}

export class Scanner {
  private readonly live = new Map<string, Live>();
  private readonly finished = new Map<string, Scan>();
  /** Finished private checks, in memory only, each dropped after LIMITS.privateMs. */
  private readonly fleeting = new Map<string, Scan>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly starts = new Map<string, number[]>();
  private spend = { day: '', usd: 0 };

  private readonly dataDir: string;
  private readonly review: Reviewer;

  /** `reviewer` replaces the Claude review: the NEAR AI Cloud engine, or a stand-in for tests. */
  constructor(dataDir: string, reviewer: Reviewer = review) {
    this.dataDir = dataDir;
    this.review = reviewer;
  }

  async load(): Promise<void> {
    await mkdir(path.join(this.dataDir, 'scans'), { recursive: true });
    for (const name of await readdir(path.join(this.dataDir, 'scans'))) {
      if (!name.endsWith('.json')) continue;
      try {
        const scan = JSON.parse(await readFile(path.join(this.dataDir, 'scans', name), 'utf8')) as Scan;
        this.finished.set(scan.id, scan);
      } catch {
        // A half-written report is skipped, not fatal.
      }
    }
  }

  /** A stored receipt, by its SHA-256: from a hosted NEAR AI review, or one shipped in the repository. */
  async receipt(hash: string): Promise<string | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const own = await readFile(path.join(this.dataDir, 'receipts', `${hash}.json`), 'utf8').catch(() => null);
    return own ?? (await bundledReceipts()).get(hash) ?? null;
  }

  /** The sandbox evidence a receipt binds: saved next to it by the NEAR engine, or shipped with a bundled receipt. */
  async evidence(hash: string): Promise<string | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const own = await readFile(path.join(this.dataDir, 'receipts', `${hash}.evidence.json`), 'utf8').catch(() => null);
    return own ?? (await bundledEvidence()).get(hash) ?? null;
  }

  get(id: string): Scan | undefined {
    return this.live.get(id)?.scan ?? this.finished.get(id) ?? this.fleeting.get(id);
  }

  /** The newest finished scan of a repository, for the extension's badge. */
  latest(url: string): Scan | null {
    let repo: RepoInfo;
    try {
      repo = parseRepoUrl(url);
    } catch {
      return null;
    }
    let best: Scan | null = null;
    for (const scan of this.finished.values()) {
      // GitHub owner and repository names are case-insensitive.
      if (scan.repo.url.toLowerCase() !== repo.url.toLowerCase() || scan.status !== 'done') continue;
      if (!best || scan.startedAt > best.startedAt) best = scan;
    }
    return best;
  }

  subscribe(id: string, listener: (e: ScanEvent) => void): () => void {
    const live = this.live.get(id);
    if (!live) return () => {};
    live.bus.on('event', listener);
    return () => live.bus.off('event', listener);
  }

  /** Starts a scan of `input` (a GitHub URL or a sample id). Returns the id and
   * the key that lets its holder answer approval prompts. */
  start(input: string, ip: string, opts: { private?: boolean } = {}): { id: string; key: string } {
    const sample = SAMPLES.find((s) => s.id === input || s.url === input);
    const repo = sample ? sampleRepo(sample) : parseRepoUrl(input);

    // A sample started by its id always runs fresh, so the demo is live; a pasted link may reuse. A
    // private check never reuses another person's report.
    if (!opts.private && (!sample || sample.id !== input)) {
      const recent = this.latest(repo.url);
      if (recent && Date.now() - Date.parse(recent.startedAt) < LIMITS.reuseMs) return { id: recent.id, key: '' };
    }
    this.rateLimit(ip);
    if (this.spentToday() >= LIMITS.dailyUsd) {
      throw new ScanError('Airlock has used up today’s scanning budget. Try again tomorrow (UTC).', 503);
    }

    const id = randomBytes(6).toString('base64url');
    const key = randomBytes(18).toString('base64url');
    const scan: Scan = { id, repo, status: 'queued', findings: [], events: [], approvals: [], startedAt: new Date().toISOString(), ...(opts.private ? { private: true } : {}) };
    const live: Live = { scan, key, bus: new EventEmitter(), answers: new Map() };
    live.bus.setMaxListeners(100);
    this.live.set(id, live);
    this.queue.push(id);
    this.pump();
    return { id, key };
  }

  answer(id: string, approvalId: string, key: string, yes: boolean): Approval {
    const live = this.live.get(id);
    if (!live) throw new ScanError('That scan is not running.', 404);
    if (!sameKey(key, live.key)) throw new ScanError('Only the person who started this scan can answer.', 403);
    const approval = live.scan.approvals.find((a) => a.id === approvalId);
    const resolve = live.answers.get(approvalId);
    if (!approval || !resolve || approval.status !== 'pending') throw new ScanError('That question is no longer open.', 409);
    approval.status = yes ? 'approved' : 'denied';
    resolve(yes ? 'yes' : 'no');
    live.answers.delete(approvalId);
    this.emit(live, { type: 'approval', approval });
    return approval;
  }

  private rateLimit(ip: string): void {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recent = (this.starts.get(ip) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= LIMITS.perIpHour) {
      throw new ScanError(`You have started ${LIMITS.perIpHour} scans this hour. Try again a little later.`, 429);
    }
    recent.push(Date.now());
    this.starts.set(ip, recent);
  }

  private spentToday(): number {
    const day = new Date().toISOString().slice(0, 10);
    if (this.spend.day !== day) this.spend = { day, usd: 0 };
    return this.spend.usd;
  }

  private pump(): void {
    while (this.running < LIMITS.concurrent && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const live = this.live.get(id);
      if (!live) continue;
      this.running += 1;
      this.run(live)
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }

  private emit(live: Live, event: ScanEvent): void {
    live.bus.emit('event', event);
  }

  private status(live: Live, status: ScanStatus, note?: string): void {
    live.scan.status = status;
    this.emit(live, { type: 'status', status, ...(note ? { note } : {}) });
  }

  private addFinding(live: Live, finding: Finding): void {
    live.scan.findings.push(finding);
    this.emit(live, { type: 'finding', finding });
  }

  private async run(live: Live): Promise<void> {
    const { scan } = live;
    const work = path.join(this.dataDir, 'work', scan.id);
    const dir = path.join(work, 'repo');
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), LIMITS.reviewMs).unref();
    try {
      await mkdir(work, { recursive: true });
      this.status(live, 'fetching');
      const sample = SAMPLES.find((s) => s.url === scan.repo.url);
      const source = await sampleSource(sample);
      scan.repo = source ? await fetchSample(scan.repo, source, dir) : await fetchRepo(scan.repo, dir);
      this.emit(live, { type: 'scan', scan });

      this.status(live, 'prescanning');
      const inventory = await takeInventory(dir);
      for (const f of inventory.findings) this.addFinding(live, f);

      this.status(live, 'reviewing');
      let asked = 0;
      const result = await this.review({
        dir,
        signal: deadline.signal,
        fenceTest: true,
        keep: !scan.private,
        repo: scan.repo,
        inventory,
        hooks: {
          onTool: (event: ToolEvent) => {
            scan.events.push(event);
            this.emit(live, { type: 'tool', event });
          },
          onThought: (text) => this.emit(live, { type: 'thought', text }),
          askPerson: (request) =>
            new Promise<'yes' | 'no' | 'expired'>((resolve) => {
              const now = Date.now();
              const approval: Approval = {
                id: `q${++asked}`,
                ...request,
                status: 'pending',
                askedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + LIMITS.approvalMs).toISOString(),
              };
              scan.approvals.push(approval);
              live.answers.set(approval.id, resolve);
              this.status(live, 'waiting');
              this.emit(live, { type: 'approval', approval });
              setTimeout(() => {
                if (approval.status !== 'pending') return;
                approval.status = 'expired';
                live.answers.delete(approval.id);
                this.emit(live, { type: 'approval', approval });
                resolve('expired');
              }, LIMITS.approvalMs).unref();
            }).finally(() => this.status(live, 'reviewing')),
        },
      });
      this.spentToday();
      this.spend.usd += result.costUsd;
      scan.costUsd = result.costUsd;
      for (const f of result.findings) this.addFinding(live, f);
      scan.verdict = result.verdict;
      scan.headline = result.headline;
      scan.summary = result.summary;
      if (result.proof) scan.proof = result.proof;
      if (result.sandbox) scan.sandbox = result.sandbox;
      if (result.files) scan.files = result.files;
      scan.status = 'done';
    } catch (error) {
      scan.status = 'failed';
      scan.error =
        error instanceof FetchError || error instanceof ScanError
          ? error.message
          : deadline.signal.aborted
            ? `The review ran longer than ${Math.round(LIMITS.reviewMs / 60_000)} minutes and was stopped. Nothing from the repository ran on your computer or on this server.`
            : 'The review could not finish. Nothing from the repository ran on your computer or on this server.';
      if (!(error instanceof FetchError)) console.error(`scan ${scan.id} failed:`, error);
      this.emit(live, { type: 'error', message: scan.error });
    } finally {
      clearTimeout(timer);
      scan.finishedAt = new Date().toISOString();
      for (const approval of scan.approvals) if (approval.status === 'pending') approval.status = 'expired';
      if (scan.private) {
        // Never written to disk; dropped from memory once its page has had time to load it.
        this.fleeting.set(scan.id, scan);
        setTimeout(() => this.fleeting.delete(scan.id), LIMITS.privateMs).unref();
      } else {
        await writeFile(path.join(this.dataDir, 'scans', `${scan.id}.json`), JSON.stringify(scan, null, 2)).catch(() => {});
        this.finished.set(scan.id, scan);
      }
      this.emit(live, { type: 'done', scan });
      this.live.delete(scan.id);
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
}

let bundled: Promise<{ receipts: Map<string, string>; evidence: Map<string, string> }> | undefined;

/** Receipts committed with Airlock (fixtures/, bench/, the sandbox benchmark in bench/sandbox/ and earlier
 * benchmark runs in bench/archive/), so every verdict already on NEAR links to one, and the sandbox
 * evidence shipped next to a receipt. */
function loadBundled(): Promise<{ receipts: Map<string, string>; evidence: Map<string, string> }> {
  bundled ??= (async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const receipts = new Map<string, string>();
    const evidence = new Map<string, string>();
    const archive = (await readdir(path.join(root, 'bench', 'archive')).catch(() => [] as string[])).map((d) => `bench/archive/${d}`);
    for (const dir of ['fixtures/receipts', 'bench/receipts', 'bench/sandbox', ...archive]) {
      for (const name of await readdir(path.join(root, dir)).catch(() => [] as string[])) {
        if (!name.endsWith('.json') || name === 'results.json' || name.endsWith('.evidence.json')) continue;
        const text = await readFile(path.join(root, dir, name), 'utf8');
        const hash = receiptHash(JSON.parse(text) as Receipt);
        receipts.set(hash, text);
        const sidecar = await readFile(path.join(root, dir, name.replace(/\.json$/, '.evidence.json')), 'utf8').catch(() => null);
        if (sidecar) evidence.set(hash, sidecar);
      }
    }
    return { receipts, evidence };
  })();
  return bundled;
}

const bundledReceipts = async () => (await loadBundled()).receipts;
const bundledEvidence = async () => (await loadBundled()).evidence;

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
