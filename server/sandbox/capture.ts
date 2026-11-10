// Reads the sinkhole's log (server/sandbox/vm/sinkhole.mjs) after a sandbox run: every request the
// repository's code sent to "its server", which decoy wallets and keys were inside it, which script
// sent it and during which step.

import { createHash } from 'node:crypto';
import { decoysIn } from './payload.ts';
import type { Contact } from './trace.ts';

/** The first bytes of each request kept in the evidence; the full size and hash are kept too. */
const SAMPLE_BYTES = 2048;

export interface Exfil {
  host: string;
  method: string;
  path: string;
  tls: boolean;
  bytes: number;
  contentType: string | null;
  /** Decoys whose tokens are inside what was sent: caught red-handed. */
  decoys: string[];
  by: string;
  step: string;
  sha256: string;
  /** The first 2 KB of the body, base64. The decoys in it are fake; the format is the attacker's. */
  sample: string;
}

export interface Refusal {
  host: string | null;
  error: string;
  step: string;
}

export interface CaptureResult {
  exfil: Exfil[];
  /** HTTPS clients that refused the sinkhole's certificate (pinned or strict): the bytes stay unseen. */
  refused: Refusal[];
}

interface Line {
  t?: string;
  at?: number;
  host?: string | null;
  method?: string;
  path?: string;
  tls?: boolean;
  bytes?: number;
  contentType?: string | null;
  body?: string;
  error?: string;
}

export function readCapture(
  jsonl: string,
  opts: {
    tokens: { label: string; token: string }[];
    /** Each step's window on the VM's clock, in milliseconds. */
    steps: { label: string; start: number; end: number }[];
    /** Who looked up which host, from the trace, to credit each request to a script. */
    contacts: (Contact & { step: string })[];
  },
): CaptureResult {
  const stepAt = (at: number | undefined) => opts.steps.find((s) => at !== undefined && at >= s.start && at <= s.end + 2000)?.label ?? opts.steps.at(-1)?.label ?? 'setup';
  const who = (host: string, step: string) => opts.contacts.find((c) => c.host === host && c.step === step)?.by ?? opts.contacts.find((c) => c.host === host)?.by ?? 'a project script';

  const exfil: Exfil[] = [];
  const refused: Refusal[] = [];
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    const step = stepAt(line.at);
    if (line.t === 'http') {
      const body = Buffer.from(line.body ?? '', 'base64');
      const host = String(line.host ?? '');
      exfil.push({
        host,
        method: String(line.method ?? 'GET'),
        path: String(line.path ?? '/').slice(0, 300),
        tls: !!line.tls,
        bytes: line.bytes ?? body.length,
        contentType: line.contentType ?? null,
        decoys: decoysIn(body, opts.tokens),
        by: who(host, step),
        step,
        sha256: createHash('sha256').update(body).digest('hex'),
        sample: body.subarray(0, SAMPLE_BYTES).toString('base64'),
      });
    } else if (line.t === 'tls-refused') {
      refused.push({ host: line.host ?? null, error: String(line.error ?? '').slice(0, 80), step });
    }
  }
  return { exfil, refused };
}
