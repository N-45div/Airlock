import { useState } from 'react';
import type { Scan } from '../../../server/types.ts';
import { PRODUCT } from '../brand.ts';
import { Icon } from '../ui/Icon.tsx';
import { Button, Chip } from '../ui/primitives.tsx';
import { formatBytes, fullTime, plural, relativeTime, shortCommit, useNow } from './format.ts';
import { githubUrl } from './labels.ts';
import { isFinished } from './useScan.ts';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access needs a secure context and permission; fall back below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'offscreen';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyLink({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const url = `${window.location.origin}/r/${encodeURIComponent(id)}`;

  const copy = async () => {
    const ok = await copyText(url);
    setState(ok ? 'copied' : 'failed');
    if (ok) window.setTimeout(() => setState('idle'), 2400);
  };

  return (
    <div className="copy-link">
      <Button variant="secondary" size="sm" icon={state === 'copied' ? 'check' : 'copy'} onClick={() => void copy()}>
        {state === 'copied' ? 'Link copied' : 'Copy link to this report'}
      </Button>
      <span className="visually-hidden" aria-live="polite">
        {state === 'copied' ? 'Link copied to the clipboard.' : ''}
      </span>
      {state === 'failed' ? (
        <input
          className="copy-link__field"
          readOnly
          value={url}
          aria-label="Link to this report"
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}

export function RepoHeader({ scan }: { scan: Scan }) {
  const now = useNow(30_000);
  const { repo } = scan;
  const link = githubUrl(repo);
  const commit = shortCommit(repo.commit);

  return (
    <header className="report-head">
      <div className="report-head__main">
        <p className="eyebrow">{isFinished(scan) ? 'Report' : 'Checking'}</p>
        <h1 className="report-head__title">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer noopener" className="repo-link">
              <span className="repo-link__owner">{repo.owner}/</span>
              <span>{repo.name}</span>
              <Icon name="external" size={18} className="repo-link__icon" />
              <span className="visually-hidden"> (opens GitHub)</span>
            </a>
          ) : (
            <span>{repo.name}</span>
          )}
        </h1>
        <ul className="report-head__meta">
          {repo.host === 'sample' ? (
            <li>
              <Chip tone="accent">{PRODUCT} sample</Chip>
            </li>
          ) : null}
          {commit ? (
            <li>
              Commit <code className="report-head__commit">{commit}</code>
            </li>
          ) : null}
          {repo.files !== undefined ? (
            <li>
              {plural(repo.files, 'file')}
              {repo.bytes ? `, ${formatBytes(repo.bytes)}` : ''}
            </li>
          ) : null}
          <li>
            <time dateTime={scan.startedAt} title={fullTime(scan.startedAt)}>
              Started {relativeTime(scan.startedAt, now)}
            </time>
          </li>
        </ul>
      </div>
      <CopyLink id={scan.id} />
    </header>
  );
}
