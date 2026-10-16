import { useEffect, type ReactNode } from 'react';
import { PRODUCT } from './brand.ts';
import { Card } from './ui/primitives.tsx';

const ITEMS: { title: string; text: ReactNode }[] = [
  {
    title: 'What we keep',
    text: `The repository URL you check and the scan report: the findings, the log of tool calls and the verdict, so the share link keeps working. Nothing personal.`,
  },
  {
    title: 'What we don’t do',
    text: `No accounts, no cookies, no tracking, no analytics. Fonts and scripts load from ${PRODUCT} itself.`,
  },
  {
    title: 'The repository’s code',
    text: 'It is fetched from GitHub for the scan and deleted when the scan ends. It is read, never run.',
  },
  {
    title: 'Who else sees it',
    text: 'Reviews are done by Anthropic’s Claude, and every tool call the reviewing agent makes is checked by ArmorIQ, so the repository’s contents pass through those services. ArmorIQ receives a trace of the agent’s tool calls, sanitized and with secrets redacted.',
  },
  {
    title: 'The Chrome extension',
    text: (
      <>
        It sends the URL of a repository you check. If the setting “Show earlier verdicts when I open a repository page”
        is on (it is off unless you turn it on), it also sends the address of the GitHub and npm repository pages you open,
        only to look up an earlier verdict.
      </>
    ),
  },
  {
    title: 'In your browser',
    text: 'So that you can answer the agent’s questions during a scan, this tab keeps a short key in session storage. It is not a cookie, and it is gone when you close the tab.',
  },
  {
    title: 'Limits on use',
    text: 'To limit how many checks one address can start, the server holds your IP address in memory. It is not written into reports.',
  },
];

export function PrivacyPage() {
  useEffect(() => {
    document.title = `Privacy · ${PRODUCT}`;
  }, []);

  return (
    <div className="page page--doc">
      <header className="doc-head">
        <p className="eyebrow">Privacy</p>
        <h1 className="doc-head__title">What {PRODUCT} keeps, and what it doesn’t</h1>
        <p className="doc-head__lede">
          {PRODUCT} keeps as little as it can: the repository you asked about and the report, so its link works. Nothing
          about you.
        </p>
      </header>
      <Card pad="none">
        <dl className="doc-list">
          {ITEMS.map((item) => (
            <div key={item.title} className="doc-list__row">
              <dt className="doc-list__title">{item.title}</dt>
              <dd className="doc-list__text">{item.text}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <p className="doc-foot">Last updated 14 October 2026.</p>
    </div>
  );
}
