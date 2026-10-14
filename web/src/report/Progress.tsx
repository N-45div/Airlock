import { useEffect, useState } from 'react';
import type { Scan, ScanStatus } from '../../../server/types.ts';
import { Icon, Spinner } from '../ui/Icon.tsx';
import { Card, Chip, cx } from '../ui/primitives.tsx';
import { formatClock, useNow } from './format.ts';
import type { ScanState } from './useScan.ts';

const STEPS = ['Fetching', 'Taking inventory', 'Reviewing', 'Verdict'] as const;

/** Which step is under way: 0-3, or 4 when all are done, or -1 while in line. */
function activeStep(status: ScanStatus): number {
  switch (status) {
    case 'queued':
      return -1;
    case 'fetching':
      return 0;
    case 'prescanning':
      return 1;
    case 'reviewing':
    case 'waiting':
    case 'sandbox':
      return 2;
    case 'done':
      return 4;
    case 'failed':
      return -2;
  }
}

function statusLine(scan: Scan, canAnswer: boolean): { lead?: string; text: string } {
  switch (scan.status) {
    case 'queued':
      return { text: 'In line. Your check starts in a moment.' };
    case 'fetching':
      return { text: 'Downloading a copy of the code. Nothing from it is run.' };
    case 'prescanning':
      return { text: 'Listing what the repository would run by itself.' };
    case 'reviewing':
    case 'sandbox':
      return { text: 'The agent is reading the code inside the fence.' };
    case 'waiting':
      return canAnswer
        ? { lead: 'Waiting for you.', text: 'The agent asked for something only you can allow.' }
        : { lead: 'Waiting.', text: 'Waiting for the person who started this check to answer the agent.' };
    case 'done':
      return { text: 'Finished.' };
    case 'failed':
      return { text: 'Stopped.' };
  }
}

export function Progress({ scan }: { scan: Scan }) {
  const active = activeStep(scan.status);
  return (
    <ol className="progress">
      {STEPS.map((label, i) => {
        const state = active > i ? 'done' : active === i ? 'active' : 'todo';
        const waiting = state === 'active' && scan.status === 'waiting';
        return (
          <li
            key={label}
            className={cx('progress__step', `is-${state}`, waiting && 'is-waiting')}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span className="progress__bar" />
            <span className="progress__label">
              {state === 'done' ? <Icon name="check" size={14} /> : null}
              {label}
              <span className="visually-hidden">
                {state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ' (not started)'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The card shown while a check runs: steps, what is happening now, and the agent's latest note. */
export function LiveStatus({ state, canAnswer }: { state: ScanState; canAnswer: boolean }) {
  const scan = state.scan!;
  const now = useNow(1000);
  const elapsed = now - Date.parse(scan.startedAt);
  const latest = state.thoughts.slice(-3);
  const waiting = scan.status === 'waiting';
  const line = statusLine(scan, canAnswer);
  // Only mention a dropped connection if it lasts; the stream also ends briefly when a check finishes.
  const [showConnection, setShowConnection] = useState(false);
  useEffect(() => {
    if (state.connection !== 'reconnecting') {
      setShowConnection(false);
      return;
    }
    const timer = window.setTimeout(() => setShowConnection(true), 1500);
    return () => window.clearTimeout(timer);
  }, [state.connection]);

  return (
    <Card className="live" pad="md">
      <Progress scan={scan} />
      <div className="live__now">
        <span className={cx('live__pulse', waiting && 'is-waiting')}>
          {waiting ? <Icon name="clock" size={18} /> : <Spinner size={18} />}
        </span>
        <p className="live__line" role="status" aria-live="polite">
          {line.lead ? <strong className="live__waiting">{line.lead} </strong> : null}
          {line.text}
          {state.note ? <span className="live__note"> {state.note}</span> : null}
        </p>
        <span className="live__clock" aria-hidden="true">
          {Number.isFinite(elapsed) ? formatClock(elapsed) : ''}
        </span>
      </div>
      {showConnection ? (
        <p className="live__conn">
          <Chip tone="caution" icon="clock">
            Reconnecting
          </Chip>
          <span>The check keeps running on our side.</span>
        </p>
      ) : null}
      {latest.length > 0 ? (
        <ol className="live__notes" aria-label="The agent's latest notes">
          {latest.map((t) => (
            <li key={t.n}>{t.text}</li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
