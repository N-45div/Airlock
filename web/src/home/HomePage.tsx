import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HeldBreathCanvas, Sigil } from '../art/Art.tsx';
import { LINKS, PRODUCT } from '../brand.ts';
import { nearView } from '../near.ts';
import { SandboxPanel } from '../report/Sandbox.tsx';
import type { SandboxReport } from '../../../server/types.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Samples } from './Samples.tsx';
import { ScanForm } from './ScanForm.tsx';
import showcase from './showcase.json';
import wild from './wild.json';

interface Showcase {
  runs: { id: string; what: string; verdict: string; receiptHash: string; held: number }[];
  catch: { id: string; receiptHash: string; sandbox: SandboxReport } | null;
}

export interface WildSummary {
  date: string;
  /** Malicious runs that showed nothing distinguishable and whose npm install failed. */
  installFailed: number;
  malicious: { total: number; caught: number; phoned: number; fetched: number; quiet: number; failed: number };
  honest: { total: number; caught: number; phoned: number; fetched: number; quiet: number; failed: number };
  rows: { name: string; version: string; kind: 'malicious' | 'honest'; outcome: string; decoys: string[]; saw: string; script: string }[];
}

const VERDICT_WORD: Record<string, string> = { safe: 'Looks safe', caution: 'Be careful', dangerous: 'Don’t run it' };

const PIPELINE: { tone: 'held' | 'drift' | 'cleared'; icon: IconName; step: string; title: string; text: string; out: string }[] = [
  {
    tone: 'held',
    icon: 'terminal',
    step: 'Run',
    title: 'Let it try to steal',
    text: 'Its install and setup steps run in a throwaway VM. The home folder holds decoy wallets and keys, the environment holds decoy tokens, and every host but the package registries is answered from inside the VM.',
    out: 'The exact request a stealer sends, with the decoys it took inside.',
  },
  {
    tone: 'drift',
    icon: 'shield',
    step: 'Judge',
    title: 'Judge it privately',
    text: 'A model inside a TEE on NEAR AI Cloud reads the code and what it did. Its Intel TDX and NVIDIA attestation is checked first, the traffic is end-to-end encrypted, and every reply is signature-checked.',
    out: 'Looks safe, Be careful or Don’t run it, each finding pinned to a file and line.',
  },
  {
    tone: 'cleared',
    icon: 'key',
    step: 'Record',
    title: 'Record it on NEAR',
    text: 'The contract stores a verdict only after verifying the model’s signature on chain. A receipt lets anyone check the whole review offline, with no key and no network.',
    out: 'A public verdict your agent, your browser and everyone after you read for free.',
  },
];

const GUARDS: { icon: IconName; where: string; title: string; text: string; code?: string; link?: { href: string; label: string } }[] = [
  {
    icon: 'terminal',
    where: 'Coding agents',
    title: 'Claude Code and Codex check NEAR first',
    text: 'A hook runs before the agent’s shell commands. A clone or install of a repository marked Don’t run it is blocked; anything unchecked waits for you.',
    code: '$ git clone github.com/…\nDENY  "Don\'t run it" on NEAR\n      blocked before it runs',
  },
  {
    icon: 'shield',
    where: 'GitHub and npm',
    title: 'A button on every repository page',
    text: 'The Chrome extension adds Check before you run to GitHub and npm, and shows a verdict already on NEAR, read straight from public RPC.',
    link: { href: LINKS.extension, label: 'Chrome extension' },
  },
  {
    icon: 'stop',
    where: 'The AI agent in your browser',
    title: 'It checks the tools a site hands your agent',
    text: 'With WebMCP, sites offer tools to browser agents. Airlock never offers one that asks for a seed phrase or hides instructions, and makes every money-moving call wait for your click.',
    link: { href: '/demo/agent-tools.html', label: 'Try the test page' },
  },
];

const LOOKS_FOR: { icon: IconName; title: string; text: string }[] = [
  { icon: 'key', title: 'Reaching for wallets and keys', text: 'Browser wallets, NEAR and Solana CLI keys, keystores, seed phrases, .env files, tokens in the environment.' },
  { icon: 'terminal', title: 'Code that runs by itself', text: 'npm install hooks, setup.py, editor tasks and dev container commands: the first minute is where the damage happens.' },
  { icon: 'send', title: 'Sending data out', text: 'Collectors, bots, webhooks and bare IP addresses. In the sandbox, the request itself is kept.' },
  { icon: 'hidden', title: 'Hidden or packed code', text: 'Encoded strings decoded and run, payloads tucked into vendored folders, one-line files no one can read.' },
  { icon: 'message', title: 'Text planted to steer AI tools', text: 'Notes in a README or rules file telling an agent to run something, or to call the code safe.' },
];

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

/** The number of verdicts on NEAR, read from the contract; the last known number until it answers. */
function useVerdictCount(fallback: number): number {
  const [count, setCount] = useState(fallback);
  useEffect(() => {
    const abort = new AbortController();
    nearView<number>('count', {}, abort.signal)
      .then((n) => typeof n === 'number' && setCount(n))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return count;
}

function Chapter({ id, n, eyebrow, title, lede, children, tone = 'plain' }: { id: string; n: string; eyebrow: string; title: ReactNode; lede?: ReactNode; children: ReactNode; tone?: 'plain' | 'alt' | 'night' }) {
  return (
    <section id={id} className={`chapter chapter--${tone}`} aria-labelledby={`${id}-title`}>
      <header className="chapter__head">
        <p className="chapter__eyebrow">
          <span className="chapter__n">{n}</span>
          {eyebrow}
        </p>
        <h2 id={`${id}-title`} className="chapter__title">
          {title}
        </h2>
        {lede ? <p className="chapter__lede">{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function HomePage() {
  const narrow = useNarrow();
  const data = showcase as Showcase;
  const real = wild as WildSummary;
  const verdicts = useVerdictCount(68);
  const caughtSamples = data.runs.filter((r) => r.verdict === 'dangerous').length;
  useEffect(() => {
    document.title = `${PRODUCT} · Check a stranger’s code before it touches your wallets`;
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);

  const stats: { value: string; label: string; href: string }[] = [
    { value: `${real.malicious.caught + real.malicious.phoned}/${real.malicious.total}`, label: `real npm malware packages caught phoning home at install, and ${real.honest.caught + real.honest.phoned} of ${real.honest.total} honest ones`, href: '#real-malware' },
    { value: `${caughtSamples}/${caughtSamples}`, label: 'sample wallet stealers caught red-handed, naming every wallet they took', href: '#caught' },
    { value: '26/26', label: 'right verdicts from the private reviewer on the benchmark', href: `${LINKS.source}/blob/main/METRICS.md` },
    { value: String(verdicts), label: 'verdicts on NEAR, each signature-checked by the contract', href: '/near' },
  ];

  return (
    <div className="page page--home">
      <section className="stage" aria-labelledby="hero-title">
        <HeldBreathCanvas className="stage__canvas" seed="airlock:held-breath" chamber={narrow ? { x: 0.5, y: 0.84, r: 0.3 } : { x: 0.74, y: 0.5, r: 0.36 }} />
        <div className="stage__scrim" aria-hidden="true" />
        <div className="stage__inner">
          <p className="stage__eyebrow">Built at NEAR HACKATHON · private AI on NEAR AI Cloud · verdicts on NEAR</p>
          <h1 id="hero-title" className="stage__title">
            Scanners read the code and guess.
            <span>{PRODUCT} lets it steal.</span>
          </h1>
          <p className="stage__lede">
            Before you or your AI agent run a stranger’s repository, {PRODUCT} runs its install in a sealed VM full of decoy
            wallets, catches the request that carries them out, has a model in a TEE judge it, and records the verdict on NEAR.
          </p>
          <ScanForm autoFocus initialUrl={initialUrl()} />
        </div>
        <p className="stage__caption">Held Breath, live: drift crosses the chamber. What carries a key is held at the seal.</p>
      </section>

      <ul className="proof-strip" aria-label="What Airlock has shown so far">
        {stats.map((s) => (
          <li key={s.label}>
            <a href={s.href} className="proof-strip__item">
              <span className="proof-strip__value">{s.value}</span>
              <span className="proof-strip__label">{s.label}</span>
            </a>
          </li>
        ))}
      </ul>

      <Chapter
        id="try"
        n="01"
        eyebrow="Try it"
        title="Watch it catch a stealer, in one click"
        lede="One click starts a real check of a sample: the private review in a TEE, the receipt and the NEAR transaction. The samples that ship with Airlock are harmless; a stealer among them can only send to a host that doesn’t exist."
      >
        <Samples />
      </Chapter>

      <Chapter
        id="how-it-works"
        n="02"
        tone="alt"
        eyebrow="How it works"
        title="Run it. Judge it. Record it."
        lede="Three steps, each one you can check yourself. Reading code can only guess at intent; running it against decoys shows what it takes."
      >
        <ol className="pipeline">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className={`pipeline__stage pipeline__stage--${p.tone}`}>
              <div className="pipeline__top">
                <span className="pipeline__node" aria-hidden="true">
                  <Icon name={p.icon} size={20} />
                </span>
                <span className="pipeline__step">
                  {String(i + 1).padStart(2, '0')} · {p.step}
                </span>
              </div>
              <h3 className="pipeline__title">{p.title}</h3>
              <p className="pipeline__text">{p.text}</p>
              <p className="pipeline__out">
                <span>You get</span>
                {p.out}
              </p>
            </li>
          ))}
        </ol>
      </Chapter>

      {data.catch ? (
        <Chapter
          id="caught"
          n="03"
          eyebrow="Proof"
          title="Caught red-handed"
          lede="A stealer that hides its targets in base64. Its install script ran against decoys, reached for three keys and sent them to its server. The sandbox answered as that server and kept the request."
        >
          <div className="catch">
            <figure className="catch__sigil">
              <Sigil seed={data.catch.receiptHash} verdict="dangerous" held={new Set(data.catch.sandbox.sent.flatMap((s) => s.decoys)).size} size={220} />
              <figcaption>
                Its sigil, drawn from receipt <code>{data.catch.receiptHash.slice(0, 12)}…</code>: the outer ring is the receipt
                hash, one tick per bit, and the three held lights are the keys it sent.
              </figcaption>
            </figure>
            <SandboxPanel sandbox={data.catch.sandbox} />
          </div>
        </Chapter>
      ) : null}

      <Chapter
        id="real-malware"
        n="04"
        tone="alt"
        eyebrow="Against real malware"
        title={`${real.malicious.caught + real.malicious.phoned} of ${real.malicious.total} real npm malware packages caught phoning home`}
        lede={
          <>
            The newest install-time malware in{' '}
            <a href="https://github.com/DataDog/malicious-software-packages-dataset" target="_blank" rel="noopener noreferrer">
              Datadog’s open dataset
            </a>
            , each opened and run inside its own sealed VM, next to popular packages that also run something on install. The
            sandbox alone, with no AI review: what running the code reveals by itself.
          </>
        }
      >
        <div className="wild">
          <div className="wild__bars" role="img" aria-label={`Malicious: ${real.malicious.caught + real.malicious.phoned} of ${real.malicious.total} caught phoning home. Honest: ${real.honest.caught + real.honest.phoned} of ${real.honest.total}.`}>
            <WildBar title="Malicious" counts={real.malicious} />
            <WildBar title="Honest" counts={real.honest} />
            <ul className="wild__legend" aria-hidden="true">
              <li className="wild__key wild__key--phoned">Caught phoning home</li>
              <li className="wild__key wild__key--fetched">Only downloaded files</li>
              <li className="wild__key wild__key--quiet">Nothing visible at install</li>
            </ul>
            <ul className="wild__takeaways">
              <li>
                <strong>
                  {real.malicious.caught + real.malicious.phoned} of {real.malicious.total}
                </strong>{' '}
                sent the machine’s user, folder or hostname home at install: POSTs to collectors, data hidden in DNS names. The
                sandbox kept every request.
              </li>
              <li>
                <strong>
                  {real.honest.caught + real.honest.phoned} of {real.honest.total}
                </strong>{' '}
                honest packages did. The {real.honest.fetched} that reached out only downloaded their prebuilt binaries.
              </li>
              <li>
                <strong>
                  {real.malicious.fetched + real.malicious.quiet} of {real.malicious.total}
                </strong>{' '}
                showed nothing distinguishable. For {real.installFailed} of them npm install itself failed in the sandbox (a
                dependency since removed from npm, or a git dependency the sandbox doesn’t allow), so their script may never
                have run. The private review reads the code to cover what running can’t show.
              </li>
            </ul>
          </div>
          <ul className="wild__list">
            {real.rows
              .filter((r) => r.kind === 'malicious' && (r.outcome === 'caught' || r.outcome === 'phoned'))
              .slice(0, 9)
              .map((r) => (
                <li key={r.name} className="wild__row">
                  <code className="wild__pkg">
                    {r.name}@{r.version}
                  </code>
                  <span className={`wild__outcome wild__outcome--${r.outcome}`}>{r.outcome === 'caught' ? `Sent ${r.decoys.join(', ')}` : r.saw}</span>
                </li>
              ))}
          </ul>
        </div>
        <p className="chapter__note">
          Each sample ran in its own VM on a Vercel account apart from this site’s, and opened its own encrypted archive, so
          no sample existed outside it. The full table, every run’s evidence and the exact rule for what counts as phoning
          home are in{' '}
          <a href={`${LINKS.source}/blob/main/METRICS.md#sandbox-against-real-npm-malware-${real.date}`}>METRICS.md</a>.
        </p>
      </Chapter>

      <Chapter id="guards" n="05" eyebrow="Where it guards you" title="One verdict, read where code gets run" lede="A verdict on NEAR is free to read, so it can sit in front of every place a stranger’s code gets in.">
        <ul className="guards">
          {GUARDS.map((g) => (
            <li key={g.where} className="guard">
              <p className="guard__where">
                <Icon name={g.icon} size={16} />
                {g.where}
              </p>
              <h3 className="guard__title">{g.title}</h3>
              <p className="guard__text">{g.text}</p>
              {g.code ? (
                <pre className="guard__code">
                  <code>{g.code}</code>
                </pre>
              ) : null}
              {g.link ? (
                <a className="guard__link" href={g.link.href}>
                  {g.link.label} <Icon name="arrow" size={14} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <ul className="looks-for" aria-label="What Airlock looks for">
          {LOOKS_FOR.map((item) => (
            <li key={item.title}>
              <span className="looks-for__icon">
                <Icon name={item.icon} size={17} />
              </span>
              <span className="looks-for__title">{item.title}</span>
              <span className="looks-for__text">{item.text}</span>
            </li>
          ))}
        </ul>
      </Chapter>

      {data.runs.length ? (
        <Chapter
          id="faces"
          n="06"
          tone="alt"
          eyebrow="Every verdict has a face"
          title="A sigil drawn from the receipt it can be checked against"
          lede="The outer ring is the receipt hash, one tick per bit, so two sigils match exactly when their receipts do. The color is the verdict; each held light is a wallet the sandbox caught leaving."
        >
          <ul className="faces">
            {data.runs.map((r) => (
              <li key={r.id} className="faces__item">
                <Sigil seed={r.receiptHash} verdict={r.verdict as 'safe' | 'caution' | 'dangerous'} held={r.held} size={128} />
                <p className="faces__name">{r.id}</p>
                <p className={`faces__verdict faces__verdict--${r.verdict}`}>{VERDICT_WORD[r.verdict] ?? r.verdict}</p>
                <p className="faces__what">{r.what}</p>
              </li>
            ))}
          </ul>
        </Chapter>
      ) : null}

      <Chapter id="verify" n="07" tone="night" eyebrow="For judges" title="Check every claim yourself" lede="Nothing here asks to be taken on trust. Three ways in, from two minutes to ten.">
        <ol className="verify">
          <li className="verify__card">
            <p className="verify__time">2 minutes · in the browser</p>
            <h3>Run a check and read its proof</h3>
            <p>Start any sample above. Open the report’s Verified review panel: the attestation, the signed replies, the receipt, and the NEAR transaction.</p>
            <a href="/near">
              Every verdict on NEAR <Icon name="arrow" size={14} />
            </a>
          </li>
          <li className="verify__card">
            <p className="verify__time">5 minutes · no key, no network</p>
            <h3>Verify every receipt offline</h3>
            <pre>
              <code>{'npm ci && npm run judge\n…\nreceipts 74/74 verified offline\nPASS'}</code>
            </pre>
          </li>
          <li className="verify__card">
            <p className="verify__time">10 minutes · the source</p>
            <h3>Read how it works</h3>
            <p>The README’s do-this-see-that steps, the threat model, and the benchmark tables with every receipt.</p>
            <a href={LINKS.source}>
              Source on GitHub <Icon name="arrow" size={14} />
            </a>
          </li>
        </ol>
      </Chapter>
    </div>
  );
}

const SEGMENTS = ['caught', 'phoned', 'fetched', 'quiet', 'failed'] as const;

function WildBar({ title, counts }: { title: string; counts: WildSummary['malicious'] }) {
  return (
    <div className="wild__bar">
      <p className="wild__bar-title">
        {title} <span>{counts.total} packages</span>
      </p>
      <div className="wild__track">
        {SEGMENTS.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className={`wild__seg wild__seg--${s}`} style={{ flexGrow: counts[s] }} title={`${s}: ${counts[s]}`}>
            {counts[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
