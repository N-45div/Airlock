import { useEffect, useMemo } from 'react';
import { HeldBreathCanvas, Sigil } from '../art/Art.tsx';
import { PRODUCT } from '../brand.ts';
import { SandboxPanel } from '../report/Sandbox.tsx';
import type { SandboxReport } from '../../../server/types.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Card, SectionHeading } from '../ui/primitives.tsx';
import { Samples } from './Samples.tsx';
import { ScanForm } from './ScanForm.tsx';
import showcase from './showcase.json';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'terminal',
    title: 'Run it against decoys',
    text: 'Its install and setup steps run in a throwaway VM whose home folder holds decoy wallets and keys. Anything that reaches for one is caught sending it.',
  },
  {
    icon: 'shield',
    title: 'Judge it privately',
    text: 'A model inside a TEE on NEAR AI Cloud reads the code and what it did, end-to-end encrypted. Every reply is signed by the enclave and checked.',
  },
  {
    icon: 'key',
    title: 'Record it on NEAR',
    text: 'The verdict goes on NEAR with a receipt anyone can check offline. Your agent, your browser and everyone after you read it for free.',
  },
];

const LOOKS_FOR: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'key',
    title: 'Code that reaches for your wallets',
    text: 'Browser wallets like MetaMask and Phantom, NEAR and Solana CLI keys, Ethereum keystores, seed phrases and .env files.',
  },
  {
    icon: 'terminal',
    title: 'Code that runs on install or when you open the folder',
    text: 'npm install hooks, setup.py, editor tasks and dev container commands: where the damage usually happens, in the first minute.',
  },
  {
    icon: 'send',
    title: 'Sending data somewhere it shouldn’t',
    text: 'Collectors, bots, webhooks and bare IP addresses. In the sandbox, the request itself is kept.',
  },
  {
    icon: 'hidden',
    title: 'Hidden or packed code',
    text: 'Encoded strings that are decoded and run, payloads tucked into vendored folders, one-line files no one can read.',
  },
  {
    icon: 'message',
    title: 'Text planted to steer AI tools',
    text: 'Notes in a README, comment or rules file telling an AI agent to run something or call the code safe.',
  },
];

const VERDICT_WORD: Record<string, string> = { safe: 'Looks safe', caution: 'Be careful', dangerous: 'Don’t run it' };

interface Showcase {
  runs: { id: string; what: string; verdict: string; receiptHash: string; held: number }[];
  catch: { id: string; receiptHash: string; sandbox: SandboxReport } | null;
}

function initialUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('url') ?? '';
  } catch {
    return '';
  }
}

function useNarrow(): boolean {
  return useMemo(() => window.matchMedia?.('(max-width: 760px)').matches ?? false, []);
}

export function HomePage() {
  const narrow = useNarrow();
  const data = showcase as Showcase;
  useEffect(() => {
    document.title = `${PRODUCT} · Check a stranger’s code before it touches your wallets`;
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);

  return (
    <div className="page page--home">
      <section className="stage" aria-labelledby="hero-title">
        <HeldBreathCanvas className="stage__canvas" seed="airlock:held-breath" chamber={narrow ? { x: 0.5, y: 0.8, r: 0.3 } : { x: 0.76, y: 0.5, r: 0.34 }} />
        <div className="stage__scrim" aria-hidden="true" />
        <div className="stage__inner">
          <p className="stage__eyebrow">Private AI on NEAR AI Cloud · verdicts on NEAR</p>
          <h1 id="hero-title" className="stage__title">
            Your laptop is your wallet.
            <span>Check a stranger’s code before it touches it.</span>
          </h1>
          <p className="stage__lede">
            {PRODUCT} runs the install in a sealed VM full of decoy wallets, has a model inside a TEE judge what it did, and
            records the verdict on NEAR. A plain answer, with proof.
          </p>
          <ScanForm autoFocus initialUrl={initialUrl()} />
          <ul className="stage__facts">
            <li>
              <Icon name="stop" size={15} /> Stealers caught sending your wallets
            </li>
            <li>
              <Icon name="shield" size={15} /> Judged privately in a TEE
            </li>
            <li>
              <Icon name="check" size={15} /> Every verdict checkable, forever
            </li>
          </ul>
        </div>
        <p className="stage__caption">
          Live: drift crosses the chamber. What carries a key is held at the seal.
        </p>
      </section>

      <Samples />

      <section id="how-it-works" aria-labelledby="how-title">
        <SectionHeading id="how-title" eyebrow="How it works" title="Run it, judge it, record it" />
        <ol className="steps">
          {STEPS.map((step, i) => (
            <Card as="li" key={step.title} className="step">
              <div className="step__top">
                <span className="step__icon">
                  <Icon name={step.icon} size={20} />
                </span>
                <span className="step__num">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__text">{step.text}</p>
            </Card>
          ))}
        </ol>
      </section>

      {data.catch ? (
        <section className="catch" aria-labelledby="catch-title">
          <div className="catch__side">
            <SectionHeading id="catch-title" eyebrow="From the benchmark" title="Caught red-handed" />
            <p className="split__text">
              A stealer that hides its targets in base64. Its install script ran against decoys, reached for three keys and
              sent them to its server. The sandbox answered as that server and kept the request.
            </p>
            <figure className="catch__sigil">
              <Sigil seed={data.catch.receiptHash} verdict="dangerous" held={new Set(data.catch.sandbox.sent.flatMap((s) => s.decoys)).size} size={200} />
              <figcaption>
                Its sigil, drawn from receipt <code>{data.catch.receiptHash.slice(0, 12)}…</code>. The held lights are the
                three keys it sent.
              </figcaption>
            </figure>
          </div>
          <SandboxPanel sandbox={data.catch.sandbox} />
        </section>
      ) : null}

      {data.runs.length ? (
        <section aria-labelledby="faces-title">
          <SectionHeading id="faces-title" eyebrow="Every verdict has a face" title="Drawn from the receipt it can be checked against" />
          <p className="split__text faces__lede">
            The outer ring is the receipt hash, one tick per bit: two sigils match exactly when their receipts do. The color
            is the verdict, and each held light is a wallet the sandbox caught leaving.
          </p>
          <ul className="faces">
            {data.runs.map((r) => (
              <li key={r.id} className="faces__item">
                <Sigil seed={r.receiptHash} verdict={r.verdict as 'safe' | 'caution' | 'dangerous'} held={r.held} size={136} />
                <p className="faces__name">{r.id}</p>
                <p className={`faces__verdict faces__verdict--${r.verdict}`}>{VERDICT_WORD[r.verdict] ?? r.verdict}</p>
                <p className="faces__what">{r.what}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="split" aria-labelledby="looks-title">
        <div>
          <SectionHeading id="looks-title" eyebrow="What it looks for" title="Where the harm usually hides" />
          <p className="split__text">
            Most harmful repositories do their damage in the first minute: when you install them or open the folder. {PRODUCT}{' '}
            starts there, runs it, and follows what those files load.
          </p>
        </div>
        <Card pad="none">
          <ul className="checklist">
            {LOOKS_FOR.map((item) => (
              <li key={item.title} className="checklist__item">
                <span className="checklist__icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <span>
                  <span className="checklist__title">{item.title}</span>
                  <span className="checklist__text">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="agents" aria-labelledby="agents-title">
        <div>
          <SectionHeading id="agents-title" eyebrow="For coding agents" title="Your agent checks NEAR before it clones" />
          <p className="split__text">
            A hook for Claude Code and Codex runs before every shell command. When one would clone or install a repository,
            it reads the verdict from NEAR: <strong>Don’t run it</strong> is blocked, anything unchecked waits for you.
          </p>
        </div>
        <Card pad="lg" className="agents__code">
          <pre>
            <code>{`$ npm run guard -- --config     # the hook settings

$ npm run guard -- check "git clone github.com/…"
DENY   Airlock: "Don't run it" for github.com/…
       (verdict #…, recorded on NEAR)
       Blocked: don't fetch or run this repository.`}</code>
          </pre>
        </Card>
      </section>
    </div>
  );
}
