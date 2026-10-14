import { useEffect } from 'react';
import { PRODUCT, TAGLINE } from '../brand.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { Card, SectionHeading } from '../ui/primitives.tsx';
import { Samples } from './Samples.tsx';
import { ScanForm } from './ScanForm.tsx';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'read',
    title: 'Read',
    text: 'The agent reads the code. It never runs it, installs it or opens it in an editor.',
  },
  {
    icon: 'fence',
    title: 'Fence',
    text: `ArmorIQ’s policy decides every tool call: reads are allowed, commands are blocked, and fetching a page waits for you. ${PRODUCT}’s own backstop sits behind it.`,
  },
  {
    icon: 'shield',
    title: 'Verdict',
    text: 'A plain-words answer, every finding with its file and line, and a link you can share.',
  },
];

const LOOKS_FOR: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'terminal',
    title: 'Code that runs on install or when you open the folder',
    text: 'npm install hooks, setup.py, editor tasks and dev container commands.',
  },
  {
    icon: 'key',
    title: 'Reading SSH keys, .env files, browser data or crypto wallets',
    text: 'The things a fake take-home task or free trading bot is usually after.',
  },
  {
    icon: 'send',
    title: 'Sending data to bots, webhooks or bare IP addresses',
    text: 'Telegram and Discord bots, paste sites, and servers with no name.',
  },
  {
    icon: 'hidden',
    title: 'Hidden or packed code',
    text: 'Encoded strings that are decoded and run, and one-line files no one can read.',
  },
  {
    icon: 'message',
    title: 'Text planted to steer AI tools',
    text: 'Notes in a README or a comment telling an AI to run something or call the code safe.',
  },
];

function initialUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('url') ?? '';
  } catch {
    return '';
  }
}

export function HomePage() {
  useEffect(() => {
    document.title = `${PRODUCT} · Check a repository before you run it`;
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="hero__title">
          {TAGLINE}
        </h1>
        <p className="hero__lede">
          Paste a GitHub link. An AI agent reads the code inside a fence, never runs it, and tells you in plain words
          whether it is safe to run.
        </p>
        <ScanForm autoFocus initialUrl={initialUrl()} />
        <p className="hero__for">
          <span className="hero__for-label">Made for</span> the take-home task a recruiter sent, the free trading bot or
          starter kit you found, and the package you have never heard of.
        </p>
      </section>

      <Samples />

      <section id="how" aria-labelledby="how-title">
        <SectionHeading id="how-title" eyebrow="How it works" title="Read, fence, verdict" />
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

      <section className="split" aria-labelledby="looks-title">
        <div>
          <SectionHeading id="looks-title" eyebrow="What it looks for" title="Where the harm usually hides" />
          <p className="split__text">
            Most harmful repositories do their damage in the first minute: when you install them or open the folder.
            The agent starts there, then follows what those files load.
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
    </div>
  );
}
