import type { Finding, RepoInfo, Scan } from '../../../server/types.ts';
import { Icon } from '../ui/Icon.tsx';
import { Card, Chip, SectionHeading } from '../ui/primitives.tsx';
import { plural } from './format.ts';
import { CATEGORY, githubLineUrl, SEVERITY, SEVERITY_ORDER, SOURCE } from './labels.ts';

function Location({ finding, repo }: { finding: Finding; repo: RepoInfo }) {
  if (!finding.file) return null;
  const where = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
  const href = githubLineUrl(repo, finding.file, finding.line);
  return (
    <p className="finding__where">
      <Icon name="file" size={15} />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          <code>{where}</code>
          <span className="visually-hidden"> (opens GitHub at this line)</span>
        </a>
      ) : (
        <code>{where}</code>
      )}
    </p>
  );
}

function FindingCard({ finding, repo }: { finding: Finding; repo: RepoInfo }) {
  const severity = SEVERITY[finding.severity];
  return (
    <Card as="li" className={`finding finding--${finding.severity}`}>
      <div className="finding__tags">
        <Chip tone={severity.tone}>{severity.label}</Chip>
        <Chip>{CATEGORY[finding.category] ?? CATEGORY.other}</Chip>
        <Chip tone="quiet" title="Where this finding came from">
          {SOURCE[finding.source] ?? finding.source}
        </Chip>
      </div>
      <h4 className="finding__title">{finding.title}</h4>
      <p className="finding__detail">{finding.detail}</p>
      <Location finding={finding} repo={repo} />
      {finding.snippet ? (
        <pre className="snippet">
          <code>{finding.snippet}</code>
        </pre>
      ) : null}
    </Card>
  );
}

export function Findings({ scan }: { scan: Scan }) {
  const done = scan.status === 'done';
  const running = scan.status !== 'done' && scan.status !== 'failed';
  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: scan.findings.filter((f) => f.severity === severity),
  })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="findings-title">
      <SectionHeading
        id="findings-title"
        eyebrow="Findings"
        title={running ? 'Found so far' : 'What the review found'}
        aside={scan.findings.length > 0 ? plural(scan.findings.length, 'finding') : undefined}
      />
      {groups.length === 0 ? (
        <Card className="findings__empty">
          {done
            ? 'Nothing to flag. The review found no code that runs by itself, reads secrets or sends data out.'
            : running
              ? 'Findings show up here as the review finds them. The agent explains each one at the end.'
              : 'The check stopped before it found anything.'}
        </Card>
      ) : (
        <div className="findings">
          {groups.map(({ severity, items }) => (
            <div key={severity} className="severity-group">
              <h3 className="severity-group__title">
                <Chip tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Chip>
                <span>{plural(items.length, 'finding')}</span>
              </h3>
              <ul className="severity-group__list">
                {items.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} repo={scan.repo} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
