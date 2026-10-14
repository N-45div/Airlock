// Live state of one scan, from GET /api/scans/:id/stream.
//
// The stream sends a snapshot first, then each change. If it drops, the browser
// reconnects and the new snapshot replaces what we had. When it ends or fails we
// also ask for the scan directly: a finished scan's last event can be cut off as
// the server closes the stream, and a missing scan answers 404 there.

import { useEffect, useReducer } from 'react';
import type { Approval, Scan, ScanEvent } from '../../../server/types.ts';
import { api, ApiError } from '../api.ts';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface Thought {
  n: number;
  at: number;
  text: string;
}

export interface ScanState {
  scan: Scan | null;
  /** The server has no scan with this id. */
  missing: boolean;
  connection: Connection;
  thoughts: Thought[];
  /** The latest status note, when the server sent one. */
  note?: string;
  /** When this page first saw each approval, for its countdown. */
  seen: Record<string, number>;
  /** The result arrived while this page was watching (not on first load). */
  finishedLive: boolean;
}

export type ScanAction =
  | { type: 'event'; event: ScanEvent; now: number }
  | { type: 'connection'; connection: Connection }
  | { type: 'missing' }
  | { type: 'answered'; approval: Approval };

export const isFinished = (scan: Scan | null | undefined) => scan?.status === 'done' || scan?.status === 'failed';

const INTERRUPTED = 'This check stopped on our side before it finished. Nothing from the repository was run.';

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function markSeen(seen: Record<string, number>, approvals: Approval[], now: number): Record<string, number> {
  const fresh = approvals.filter((a) => seen[a.id] === undefined);
  if (fresh.length === 0) return seen;
  const next = { ...seen };
  for (const a of fresh) next[a.id] = now;
  return next;
}

function applyEvent(state: ScanState, event: ScanEvent, now: number): ScanState {
  const scan = state.scan;
  switch (event.type) {
    case 'scan':
      return { ...state, scan: event.scan, seen: markSeen(state.seen, event.scan.approvals, now) };
    case 'done':
      return {
        ...state,
        scan: event.scan,
        connection: 'closed',
        finishedLive: state.finishedLive || (scan !== null && !isFinished(scan)),
        seen: markSeen(state.seen, event.scan.approvals, now),
      };
    case 'status':
      return scan ? { ...state, scan: { ...scan, status: event.status }, note: event.note } : state;
    case 'finding':
      return scan ? { ...state, scan: { ...scan, findings: upsert(scan.findings, event.finding) } } : state;
    case 'tool':
      return scan ? { ...state, scan: { ...scan, events: upsert(scan.events, event.event) } } : state;
    case 'approval':
      return scan
        ? {
            ...state,
            scan: { ...scan, approvals: upsert(scan.approvals, event.approval) },
            seen: markSeen(state.seen, [event.approval], now),
          }
        : state;
    case 'thought': {
      const n = (state.thoughts.at(-1)?.n ?? 0) + 1;
      return { ...state, thoughts: [...state.thoughts, { n, at: now, text: event.text }].slice(-200) };
    }
    case 'error':
      return scan ? { ...state, scan: { ...scan, status: 'failed', error: event.message } } : state;
    default:
      return state;
  }
}

export function scanReducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case 'event':
      return applyEvent(state, action.event, action.now);
    case 'connection':
      return state.connection === 'closed' || state.connection === action.connection
        ? state
        : { ...state, connection: action.connection };
    case 'missing':
      if (state.scan && !isFinished(state.scan)) {
        // It was running and the server no longer knows it, as after a restart.
        return { ...state, connection: 'closed', scan: { ...state.scan, status: 'failed', error: INTERRUPTED } };
      }
      return { ...state, missing: !state.scan, connection: 'closed' };
    case 'answered':
      return state.scan
        ? { ...state, scan: { ...state.scan, approvals: upsert(state.scan.approvals, action.approval) } }
        : state;
  }
}

export const initialScanState: ScanState = {
  scan: null,
  missing: false,
  connection: 'connecting',
  thoughts: [],
  seen: {},
  finishedLive: false,
};

/** Follows one scan's stream and reports every change to `dispatch`. Returns a function that stops it. */
export function followScan(id: string, dispatch: (action: ScanAction) => void): () => void {
  let source: EventSource | null = null;
  let retry: number | undefined;
  let stopped = false;
  let checking = false;
  let failures = 0;

  const stop = () => {
    stopped = true;
    source?.close();
    window.clearTimeout(retry);
  };

  const check = async (): Promise<'running' | 'over' | 'unreachable'> => {
    try {
      const scan = await api.scan(id);
      if (stopped) return 'over';
      if (isFinished(scan)) {
        dispatch({ type: 'event', event: { type: 'done', scan }, now: Date.now() });
        stop();
        return 'over';
      }
      dispatch({ type: 'event', event: { type: 'scan', scan }, now: Date.now() });
      return 'running';
    } catch (error) {
      if (stopped) return 'over';
      if (error instanceof ApiError && error.status === 404) {
        dispatch({ type: 'missing' });
        stop();
        return 'over';
      }
      return 'unreachable';
    }
  };

  const connect = () => {
    if (stopped) return;
    const es = new EventSource(api.streamUrl(id));
    source = es;
    es.onopen = () => {
      failures = 0;
      dispatch({ type: 'connection', connection: 'live' });
    };
    es.onmessage = (message: MessageEvent<string>) => {
      let event: ScanEvent;
      try {
        event = JSON.parse(message.data) as ScanEvent;
      } catch {
        return;
      }
      dispatch({ type: 'event', event, now: Date.now() });
      if (event.type === 'done') stop();
    };
    es.onerror = () => {
      if (stopped || checking) return;
      checking = true;
      dispatch({ type: 'connection', connection: 'reconnecting' });
      void check().then((result) => {
        checking = false;
        if (stopped || result === 'over') return;
        // CONNECTING means the browser is already retrying; CLOSED means it gave up.
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          failures += 1;
          retry = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(failures, 4)));
        }
      });
    };
  };

  connect();
  return stop;
}

export function useScan(id: string): [ScanState, (approval: Approval) => void] {
  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  useEffect(() => followScan(id, dispatch), [id]);
  return [state, (approval: Approval) => dispatch({ type: 'answered', approval })];
}
