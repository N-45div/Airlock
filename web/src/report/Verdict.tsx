import { useState } from 'react';
import type { Scan } from '../../../server/types.ts';
import { startScan } from '../api.ts';
import { CTA } from '../brand.ts';
import { messageOf } from '../home/ScanForm.tsx';
import { navigate } from '../router.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Button, Card } from '../ui/primitives.tsx';
import { plural } from './format.ts';
import { fenceCounts, SEVERITY, SEVERITY_ORDER, VERDICT, type FenceRow } from './labels.ts';

function findingsFact(scan: Scan): string {
  const n = scan.findings.length;
  if (n === 0) return 'No findings';
  const parts = SEVERITY_ORDER.map((sev) => {
    const count = scan.findings.filter((f) => f.severity === sev).length;
    return count ? `${count} ${SEVERITY[sev].label.toLowerCase()}` : '';
  }).filter(Boolean);
  return `${plural(n, 'finding')}: ${parts.join(', ')}`;
}

export function VerdictCard({ scan, rows }: { scan: Scan; rows: FenceRow[] }) {
  if (!scan.verdict) return null;
  const look = VERDICT[scan.verdict];
  const fence = fenceCounts(rows);
  return (
    <Card as="section" tone={look.tone} pad="lg" className={`verdict verdict--${look.tone}`} id="verdict" aria-labelledby="verdict-title">
      <div className="verdict__top">
        <span className="verdict__badge">
          <Icon name={look.icon} size={24} />
        </span>
        <p className="eyebrow">Verdict</p>
      </div>
      <h2 id="verdict-title" className="verdict__title">
        {look.title}
      </h2>
      {scan.headline ? <p className="verdict__headline">{scan.headline}</p> : null}
      {scan.summary ? <p className="verdict__summary">{scan.summary}</p> : null}
      <ul className="verdict__facts">
        <li>
          <Icon name="file" size={16} />
          <span>{findingsFact(scan)}</span>
        </li>
        {fence ? (
          <li>
            <Icon name="fence" size={16} />
            <span>The fence: {fence}</span>
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

export function FailedCard({ scan }: { scan: Scan }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      navigate(await startScan(scan.repo.url));
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <Card as="section" pad="lg" className="failed" aria-labelledby="failed-title">
      <div className="verdict__top">
        <span className="verdict__badge failed__badge">
          <Icon name="info" size={24} />
        </span>
        <p className="eyebrow">No verdict</p>
      </div>
      <h2 id="failed-title" className="failed__title">
        We could not finish this check
      </h2>
      <p className="failed__error">{scan.error || 'The review stopped before it reached a verdict.'}</p>
      <p className="failed__note">Nothing from the repository was run. You can try again.</p>
      <div className="failed__actions">
        <Button variant="primary" busy={busy} iconAfter="arrow" onClick={() => void retry()}>
          {CTA}
        </Button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          <Icon name="info" size={17} />
          <span>{error}</span>
        </p>
      ) : null}
    </Card>
  );
}
