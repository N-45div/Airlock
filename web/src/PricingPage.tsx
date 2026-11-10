import { useEffect } from 'react';
import { PRODUCT } from './brand.ts';
import { Card } from './ui/primitives.tsx';

interface Tier {
  name: string;
  price: string;
  per?: string;
  who: string;
  includes: string[];
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    who: 'Everyone',
    includes: ['Unlimited verdict lookups: the agent guard, the Chrome extension and the NEAR page', '20 public checks a month', 'Every verdict recorded on NEAR, free to read forever'],
  },
  {
    name: 'Pro',
    price: '$12',
    per: 'a month',
    who: 'Developers who get sent code',
    includes: ['Private folders and repositories', 'The sandbox with red-handed capture on every check', 'An agent guard that checks unknown repositories before your agent runs them'],
  },
  {
    name: 'Team',
    price: '$25',
    per: 'per developer a month',
    who: 'Web3 teams',
    includes: ['A GitHub App that checks every new dependency and install script on each pull request', 'Rules for your org: block or ask', 'Alerts, and private receipts'],
  },
  {
    name: 'Platform',
    price: '$0.25–0.50',
    per: 'per check',
    who: 'Hiring, hackathon, bounty and AI-agent platforms',
    includes: ['An API and webhooks for every submission or take-home', 'A “Checked by Airlock” badge', 'AI agents can pay per check themselves, in USDC or NEAR through NEAR Intents'],
  },
];

export function PricingPage() {
  useEffect(() => {
    document.title = `Pricing · ${PRODUCT}`;
  }, []);

  return (
    <div className="page page--doc">
      <header className="doc-head">
        <p className="eyebrow">Pricing</p>
        <h1 className="doc-head__title">Lookups are free. Checks cost a few cents.</h1>
        <p className="doc-head__lede">
          A verdict that is already on NEAR costs nothing to read, for anyone. A new check runs the code in a throwaway VM
          and has a model in a TEE judge it, which costs {PRODUCT} a few cents. These are our plans: everything is free while
          {` ${PRODUCT}`} is in development.
        </p>
      </header>

      <div className="pricing">
        {TIERS.map((t) => (
          <Card key={t.name} pad="lg" className="pricing__tier">
            <p className="eyebrow">{t.who}</p>
            <h2 className="pricing__name">{t.name}</h2>
            <p className="pricing__price">
              <strong>{t.price}</strong>
              {t.per ? <span> {t.per}</span> : null}
            </p>
            <ul className="pricing__list">
              {t.includes.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card pad="lg" className="pricing__intel">
        <h2 className="pricing__name">Exchanges, wallets and security teams</h2>
        <p className="doc-head__lede">
          A live feed of the malicious packages and repositories the sandbox catches, with what each one tried to take.
          Annual plans; talk to us.
        </p>
      </Card>
    </div>
  );
}
