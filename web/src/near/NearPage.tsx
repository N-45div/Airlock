// /near: every verdict recorded on NEAR, newest first, or one repository's with ?repo=.
// The page reads the registry from public RPC in the browser; nothing comes from our server.

import { useEffect, useState } from 'react';
import { PRODUCT } from '../brand.ts';
import { accountUrl, nearView, receiptUrl, RECORDER, REGISTRY, repoLabelOf, repoUrlOf, type OnchainVerdict } from '../near.ts';
import { VERDICT } from '../report/labels.ts';
import { Card, Chip } from '../ui/primitives.tsx';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: OnchainVerdict[]; count: number };

export function NearPage() {
  const repo = new URLSearchParams(window.location.search).get('repo')?.trim() || null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    document.title = `Verdicts on NEAR · ${PRODUCT}`;
    const abort = new AbortController();
    (async () => {
      try {
        const [rows, count] = await Promise.all([
          repo ? nearView<OnchainVerdict[]>('get_repo', { repo, limit: 50 }, abort.signal) : nearView<OnchainVerdict[]>('get_recent', { limit: 50 }, abort.signal),
          nearView<number>('count', {}, abort.signal),
        ]);
        setLoad({ status: 'ready', rows, count });
      } catch (error) {
        if (!abort.signal.aborted) setLoad({ status: 'error', message: (error as Error).message });
      }
    })();
    return () => abort.abort();
  }, [repo]);

  return (
    <div className="page page--near">
      <header className="near-head">
        <p className="eyebrow">On NEAR testnet</p>
        <h1 className="near-head__title">{repo ? `Verdicts for ${repoLabelOf(repo)}` : 'Verdicts on NEAR'}</h1>
        <p className="near-head__text">
          Each verdict below was stored by the{' '}
          <a href={accountUrl(REGISTRY)} target="_blank" rel="noopener noreferrer">
            <code>{REGISTRY}</code>
          </a>{' '}
          contract only after it verified, on chain, the signature of a NEAR AI Cloud model running in an attested
          TEE. Its receipt lets anyone decrypt that model's reply and check every step offline. This page reads the
          contract directly from public NEAR RPC.
        </p>
        {repo ? (
          <p className="near-head__text">
            <a href="/near">See every verdict</a>
          </p>
        ) : null}
      </header>

      {load.status === 'loading' ? <p className="muted-note" role="status">Reading the registry on NEAR…</p> : null}
      {load.status === 'error' ? (
        <Card tone="caution" pad="md">
          <p>Could not read the registry from NEAR right now ({load.message}). Try again in a moment.</p>
        </Card>
      ) : null}
      {load.status === 'ready' ? (
        <>
          <p className="muted-note">
            {repo ? `${load.rows.length} verdict${load.rows.length === 1 ? '' : 's'} for this repository` : `${load.count} verdicts in all, newest first`}
          </p>
          {load.rows.length === 0 ? <Card pad="md">No verdicts recorded for this repository yet.</Card> : null}
          <ol className="near-list">
            {load.rows.map((row) => (
              <VerdictRow key={row.id} row={row} />
            ))}
          </ol>
        </>
      ) : null}

      <Card as="section" pad="md" className="near-check" aria-labelledby="near-check-title">
        <h2 id="near-check-title" className="near-check__title">
          Check one yourself
        </h2>
        <ol className="near-check__steps">
          <li>
            Download a verdict's receipt, then run <code>npm run verify:receipt -- receipt.json</code> in a copy of{' '}
            <a href="https://github.com/N-45div/Airlock">Airlock</a>. No key or network needed.
          </li>
          <li>
            Run <code>npm run registry -- check receipt.json</code> to see the same verdict on NEAR, stored by{' '}
            <code>{RECORDER}</code> after the contract checked the model's signature.
          </li>
        </ol>
      </Card>
    </div>
  );
}

function VerdictRow({ row }: { row: OnchainVerdict }) {
  const v = VERDICT[row.verdict];
  const url = repoUrlOf(row.repo);
  return (
    <li>
      <Card as="article" pad="md" className="near-row">
        <div className="near-row__top">
          <Chip tone={v.tone} icon={v.icon}>
            {v.title}
          </Chip>
          <span className="near-row__repo">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {repoLabelOf(row.repo)}
              </a>
            ) : (
              repoLabelOf(row.repo)
            )}
          </span>
          <span className="near-row__id">#{row.id}</span>
        </div>
        <dl className="near-row__facts">
          <div>
            <dt>Revision</dt>
            <dd>
              <code>{row.revision.slice(0, 12)}</code>
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{row.model}</dd>
          </div>
          <div>
            <dt>Findings</dt>
            <dd>{row.findings}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{new Date(row.recorded_at_ms).toLocaleString()}</dd>
          </div>
          <div>
            <dt>By</dt>
            <dd>
              <a href={accountUrl(row.recorder)} target="_blank" rel="noopener noreferrer">
                {row.recorder}
              </a>
            </dd>
          </div>
        </dl>
        <p className="near-row__links">
          <a href={receiptUrl(row.receipt_hash)} download={`airlock-receipt-${row.receipt_hash.slice(0, 12)}.json`}>
            Download the receipt
          </a>
          <span aria-hidden="true"> · </span>
          <span className="near-row__hash" title={`Receipt SHA-256 ${row.receipt_hash}\nModel key ${row.signer}`}>
            receipt <code>{row.receipt_hash.slice(0, 16)}…</code>
          </span>
        </p>
      </Card>
    </li>
  );
}
