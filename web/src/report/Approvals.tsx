import { useId, useState } from 'react';
import type { Approval, Scan } from '../../../server/types.ts';
import { api } from '../api.ts';
import { messageOf } from '../home/ScanForm.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Button, Card } from '../ui/primitives.tsx';
import { formatClock, useNow } from './format.ts';
import { toolName } from './labels.ts';

/** The server lets a question wait this long, then carries on without it. */
const APPROVAL_MS = 3 * 60 * 1000;

/** When a question runs out. Approvals carry no time of their own, so this uses the
 * moment the fence held the matching call, or else when this page first saw it. */
function expiresAt(scan: Scan, approval: Approval, seenAt: number | undefined): number {
  const held = scan.events.findLast(
    (e) => e.decision === 'held' && e.tool === approval.tool && e.summary === approval.summary,
  );
  const start = held ? Date.parse(held.at) : NaN;
  return (Number.isFinite(start) ? start : (seenAt ?? Date.now())) + APPROVAL_MS;
}

function Question({ approval }: { approval: Approval }) {
  if (approval.tool === 'WebFetch') {
    return (
      <>
        The agent wants to fetch <code className="approval__target">{approval.summary}</code>. Allow once?
      </>
    );
  }
  return (
    <>
      The agent wants to use {toolName(approval.tool)} on <code className="approval__target">{approval.summary}</code>.
      Allow once?
    </>
  );
}

function ApprovalPrompt({
  scanId,
  approval,
  expires,
  now,
  scanKey,
  onAnswered,
}: {
  scanId: string;
  approval: Approval;
  expires: number;
  now: number;
  scanKey: string | null;
  onAnswered: (approval: Approval) => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const left = Math.max(0, expires - now);

  const answer = async (decision: 'approve' | 'deny') => {
    if (!scanKey) return;
    setBusy(decision);
    setError(null);
    try {
      onAnswered(await api.answer(scanId, approval.id, scanKey, decision));
    } catch (err) {
      setError(messageOf(err));
      setBusy(null);
    }
  };

  return (
    <Card as="section" tone="caution" className="approval" aria-labelledby={titleId}>
      <div className="approval__top">
        <span className="approval__icon">
          <Icon name="clock" size={18} />
        </span>
        <p className="eyebrow approval__eyebrow">{scanKey ? 'Waiting for you' : 'Waiting for an answer'}</p>
        <span className="approval__timer">
          {left > 0 ? `${formatClock(left)} left` : 'Closing'}
          <span className="visually-hidden"> to answer</span>
        </span>
      </div>
      <p id={titleId} className="approval__question">
        <Question approval={approval} />
      </p>
      {approval.reason ? <p className="approval__reason">{approval.reason}</p> : null}
      {scanKey ? (
        <div className="approval__actions">
          <Button
            variant="primary"
            icon="check"
            busy={busy === 'approve'}
            disabled={busy !== null}
            onClick={() => void answer('approve')}
          >
            Allow
          </Button>
          <Button variant="secondary" icon="close" busy={busy === 'deny'} disabled={busy !== null} onClick={() => void answer('deny')}>
            Decline
          </Button>
        </div>
      ) : (
        <p className="approval__waiting">Waiting for the person who started this scan.</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          <Icon name="info" size={17} />
          <span>{error}</span>
        </p>
      ) : null}
      <p className="approval__fine">
        The fetch happens on our side, never on your computer. If no one answers in 3 minutes, the agent carries on without it.
      </p>
    </Card>
  );
}

export function Approvals({
  scan,
  seen,
  scanKey,
  onAnswered,
}: {
  scan: Scan;
  seen: Record<string, number>;
  scanKey: string | null;
  onAnswered: (approval: Approval) => void;
}) {
  const pending = scan.approvals.filter((a) => a.status === 'pending');
  const now = useNow(1000, pending.length > 0);
  if (pending.length === 0) return null;
  return (
    <div className="approvals">
      {pending.map((approval) => (
        <ApprovalPrompt
          key={approval.id}
          scanId={scan.id}
          approval={approval}
          expires={expiresAt(scan, approval, seen[approval.id])}
          now={now}
          scanKey={scanKey}
          onAnswered={onAnswered}
        />
      ))}
    </div>
  );
}
