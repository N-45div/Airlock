import { useEffect, type ReactNode } from 'react';
import { PRODUCT } from './brand.ts';
import { Card } from './ui/primitives.tsx';

const ITEMS: { title: string; text: ReactNode }[] = [
  {
    title: 'What we keep',
    text: `The repository URL you check, the report, its receipt and the sandbox evidence the receipt binds, so the share link keeps working and anyone can check it. Nothing personal.`,
  },
  {
    title: 'What we don’t do',
    text: `No accounts, no cookies, no tracking, no analytics. Fonts and scripts load from ${PRODUCT} itself.`,
  },
  {
    title: 'The repository’s code',
    text: 'It is fetched from GitHub for the check and deleted when the check ends. Its install and setup steps may run in a throwaway VM on Vercel Sandbox that holds only decoy wallets and keys; the VM is destroyed when the check ends. Nothing runs on your computer.',
  },
  {
    title: 'Who reads it',
    text: 'A model running in a TEE on NEAR AI Cloud. The code and every message go end-to-end encrypted to the attested model, and every reply is signed by it. NEAR AI’s gateway sees that a request was made, its size and timing, not what is in it.',
  },
  {
    title: 'What goes on NEAR',
    text: 'Each verdict’s label, its number of findings, the commit and the receipt’s hash, publicly on NEAR testnet. Never the code, and never what the findings say.',
  },
  {
    title: 'Code that must stay on your machine',
    text: (
      <>
        Use the command line: <code>npm run scan:private -- ./your-folder</code> reads a folder where it is and sends it, encrypted,
        only to the model in the TEE. No {PRODUCT} server is involved, and nothing is kept.
      </>
    ),
  },
  {
    title: 'The Chrome extension',
    text: (
      <>
        It sends the URL of a repository you check. If the setting “Show earlier verdicts when I open a repository page”
        is on (it is off unless you turn it on), it reads earlier verdicts from NEAR and from {PRODUCT}, only for the
        repository pages you open.
      </>
    ),
  },
  {
    title: 'In your browser',
    text: 'So that you can answer questions during a check, this tab keeps a short key in session storage. It is not a cookie, and it is gone when you close the tab.',
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
