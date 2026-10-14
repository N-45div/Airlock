import { useEffect, useMemo, useState } from 'react';
import type { Scan } from '../../../server/types.ts';
import { absorbKeyFromHash, loadKey } from '../api.ts';
import { PRODUCT } from '../brand.ts';
import { ScanForm } from '../home/ScanForm.tsx';
import { Card } from '../ui/primitives.tsx';
import { Approvals } from './Approvals.tsx';
import { FencePanel } from './Fence.tsx';
import { Findings } from './Findings.tsx';
import { formatCost, formatDuration } from './format.ts';
import { fenceRows, repoName, VERDICT } from './labels.ts';
import { LiveStatus } from './Progress.tsx';
import { RepoHeader } from './RepoHeader.tsx';
import { isFinished, useScan } from './useScan.ts';
import { FailedCard, VerdictCard } from './Verdict.tsx';

export function ReportPage({ id }: { id: string }) {
  // The extension hands over the approval key in the fragment; keep it for this tab only.
  const [key] = useState(() => {
    absorbKeyFromHash(id);
    return loadKey(id);
  });
  const [state, answered] = useScan(id);
  const { scan } = state;
  const finished = isFinished(scan);
  const rows = useMemo(() => (scan ? fenceRows(scan.events, scan.approvals) : []), [scan]);

  useEffect(() => {
    if (state.missing) {
      document.title = `Report not found · ${PRODUCT}`;
      return;
    }
    if (!scan) return;
    const name = repoName(scan.repo);
    if (scan.status === 'done' && scan.verdict) document.title = `${VERDICT[scan.verdict].title}: ${name} · ${PRODUCT}`;
    else if (scan.status === 'failed') document.title = `Check stopped: ${name} · ${PRODUCT}`;
    else document.title = `Checking ${name} · ${PRODUCT}`;
  }, [scan, state.missing]);

  // When the verdict lands while someone watches, bring it into view.
  useEffect(() => {
    if (!state.finishedLive) return;
    const card = document.getElementById('verdict') ?? document.querySelector<HTMLElement>('.failed');
    if (!card) return;
    const top = card.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }, [state.finishedLive]);

  if (state.missing) return <MissingReport />;
  if (!scan) return <LoadingReport />;

  if (finished) {
    // The answer first, then the evidence.
    return (
      <div className="page page--report">
        <RepoHeader scan={scan} />
        {scan.status === 'done' ? <VerdictCard scan={scan} rows={rows} /> : <FailedCard scan={scan} />}
        <Findings scan={scan} />
        <FencePanel rows={rows} live={false} thoughts={state.thoughts} />
        <ReportFooter scan={scan} />
      </div>
    );
  }

  // While it runs, the fence is where things happen; findings so far follow.
  return (
    <div className="page page--report">
      <RepoHeader scan={scan} />
      <LiveStatus state={state} canAnswer={!!key} />
      <Approvals scan={scan} seen={state.seen} scanKey={key} onAnswered={answered} />
      <FencePanel rows={rows} live thoughts={state.thoughts} />
      <Findings scan={scan} />
    </div>
  );
}

function ReportFooter({ scan }: { scan: Scan }) {
  const took = scan.finishedAt ? Date.parse(scan.finishedAt) - Date.parse(scan.startedAt) : NaN;
  const parts = [
    Number.isFinite(took) ? `Took ${formatDuration(took)}` : null,
    typeof scan.costUsd === 'number' ? `Cost ${formatCost(scan.costUsd)}` : null,
    `Report ${scan.id}`,
  ].filter(Boolean);
  return <p className="report-foot">{parts.join(' · ')}</p>;
}

function LoadingReport() {
  return (
    <div className="page page--report" aria-busy="true">
      <div className="report-head" aria-hidden="true">
        <div className="report-head__main">
          <span className="placeholder-line placeholder-line--short" />
          <span className="placeholder-line placeholder-line--title" />
        </div>
      </div>
      <p className="muted-note" role="status">
        Opening the report…
      </p>
    </div>
  );
}

export function MissingReport() {
  return (
    <div className="page page--report">
      <Card as="section" pad="lg" aria-labelledby="missing-title">
        <p className="eyebrow">Not found</p>
        <h1 id="missing-title" className="missing__title">
          We could not find that report
        </h1>
        <p className="missing__text">
          The link may be mistyped, or the report is no longer kept. You can check the repository again; it takes about
          a minute.
        </p>
        <ScanForm />
      </Card>
    </div>
  );
}
