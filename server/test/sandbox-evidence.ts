// A sandbox run's evidence as runChamber returns it, for tests: an npm install whose postinstall
// opened a decoy Solana key and Phantom's store and tried to reach a collector.

import type { SandboxEvidence } from '../sandbox/chamber.ts';

export function stealerEvidence(): SandboxEvidence {
  const by = 'node scripts/postinstall.js (sol-sniper@0.3.1 postinstall script)';
  return {
    provider: 'vercel-sandbox',
    sandboxId: 'sbx_test',
    marker: 'AIRLOCK-DECOY-0123456789abcdef01234567',
    allowedHosts: ['registry.npmjs.org'],
    steps: [
      {
        label: 'npm install',
        command: 'npm install --foreground-scripts --no-audit --no-fund --loglevel=error',
        why: 'Installing runs the install scripts of the project and of every package it depends on.',
        exitCode: 0,
        timedOut: false,
        seconds: 6,
        scripts: { 'node scripts/postinstall.js': 'sol-sniper@0.3.1 postinstall script' },
        trace: { wallets: [], contacts: [], programs: [] },
      },
    ],
    wallets: [
      { decoy: 'Solana CLI keypair', kind: 'cli-wallet', path: '~/.config/solana/id.json', action: 'opened', by, step: 'npm install' },
      { decoy: 'Phantom (Chrome)', kind: 'browser-wallet', path: '~/.config/google-chrome/Default/Local Extension Settings/bfnaelmomeimhlpmgjnjophhpkkoljpa', action: 'opened', by, step: 'npm install' },
    ],
    contacts: [{ host: 'collector.test-only.invalid', by, step: 'npm install' }],
    programs: [{ command: 'node scripts/postinstall.js', step: 'npm install' }],
    capture: { on: true },
    exfil: [
      {
        host: 'collector.test-only.invalid',
        method: 'POST',
        path: '/v1/register',
        tls: true,
        bytes: 2140,
        contentType: 'application/json',
        decoys: ['Phantom (Chrome)', 'Solana CLI keypair'],
        by,
        step: 'npm install',
        sha256: 'a'.repeat(64),
        sample: Buffer.from('[{"p":"id.json","d":"..."}]').toString('base64'),
      },
    ],
    refused: [],
  };
}
