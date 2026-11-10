// Some samples contain text written to steer AI reviewers. They live packed in
// samples/packed/ai-steering.pack (server/sample-pack.ts) so that no readable file in this
// repository addresses an AI agent. This test keeps it that way: it fails if a tracked text
// file outside the pack contains the shapes that text takes.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { layers } from '../sandbox/payload.ts';
import { WALLET_PACK, packedSampleIds, readPack } from '../sample-pack.ts';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'server/test/fixture-hygiene.test.ts';

/** Phrasing that speaks to an AI reviewer, as planted notes do. Descriptions of such notes
 * ("a README that asks AI reviewers to call it safe") don't match. */
export const ADDRESSED_TO_AI = [
  /\bnote for ai\b/i,
  /\bai (code )?(reviewers?|assistants?|agents?)\s*:/i,
  /\b(ai|llm) (code )?(assistants?|reviewers?|agents?) reviewing this/i,
  /\breport (it|this|that the (project|repository|repo)( is)?) (as )?safe\b/i,
  /\balready (passed a |been )?security[- ]review(ed)?\b/i,
  /\bignore (all )?(previous|prior|above) instructions\b/i,
];

async function trackedTextFiles(): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return stdout.split('\n').filter((f) => f && f !== SELF && !f.startsWith('samples/packed/') && !/\.(png|jpe?g|gif|ico|pack|zip|gz|woff2?)$/i.test(f));
}

describe('fixture hygiene', () => {
  it('no readable file outside the pack addresses AI reviewers', async () => {
    const hits: string[] = [];
    for (const file of await trackedTextFiles()) {
      const text = await readFile(path.join(root, file), 'utf8').catch(() => '');
      text.split('\n').forEach((line, i) => {
        if (ADDRESSED_TO_AI.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(hits, [], `AI-addressed text outside samples/packed/:\n${hits.join('\n')}`);
  });

  it('the pack holds the samples that need it, and the patterns catch them', async () => {
    // Agent-steering samples carry AI-addressed text; claude-hook is an agent config file with none.
    const steering = ['agents-md-run', 'claude-md-note', 'cursor-rules', 'fake-audit-doc', 'pkg-description-note', 'readme-note', 'take-home'];
    assert.deepEqual(await packedSampleIds(), [...steering, 'claude-hook'].sort());
    const pack = await readPack();
    for (const id of steering) {
      const text = Object.values(pack[id]!).map((b64) => Buffer.from(b64, 'base64').toString('utf8')).join('\n');
      assert.ok(ADDRESSED_TO_AI.some((re) => re.test(text)), `${id}: the hygiene patterns should match its planted text`);
      assert.doesNotMatch(text, /https?:\/\/[^\s/]*example\.com/, `${id}: download hosts must be .invalid`);
    }
  });
});

// Wallet-stealer samples carry code that reaches for wallets and keys. They are kept packed in
// samples/packed/wallet-stealers.pack so no readable file in the repository is a working stealer, and
// every host they ship to is on the reserved .invalid domain, which never resolves. The sandbox
// (server/sandbox) unpacks one into the throwaway VM when it needs it.
describe('wallet-stealer fixture hygiene', () => {
  // Through the payload decoder, so a host hidden in base64 or hex is checked like a plain one.
  const decoded = (files: Record<string, string>) => Object.values(files).flatMap((b64) => layers(Buffer.from(b64, 'base64'))).join('\n');
  const sampleText = async (id: string) => decoded((await readPack(WALLET_PACK))[id]!);

  it('the pack holds the samples, and their exfil hosts are all .invalid', async () => {
    assert.deepEqual(await packedSampleIds(WALLET_PACK), ['hidden-loader', 'near-deploy', 'setup-py-stealer', 'vendored-dep', 'wallet-postinstall']);
    const pack = await readPack(WALLET_PACK);
    for (const [id, files] of Object.entries(pack)) {
      const text = decoded(files);
      for (const host of text.match(/\b[a-z0-9.-]+\.(?:com|net|org|io|xyz|co|dev)\b/gi) ?? []) {
        assert.ok(/npmjs|pythonhosted|pypi|yarnpkg/.test(host), `${id}: non-registry host "${host}" in a packed stealer; exfil hosts must be .invalid`);
      }
    }
  });

  it('the three stealers reach for a wallet and ship it out; the control does neither on install', async () => {
    const walletPath = /solana|near-credentials|keystore|Local Extension Settings|\.aws|\.ssh|\.env|gcloud/;
    for (const id of ['wallet-postinstall', 'hidden-loader', 'vendored-dep', 'setup-py-stealer']) {
      const text = await sampleText(id);
      assert.match(text, /\.invalid\b/, `${id}: a stealer should exfil to a .invalid host`);
    }
    // near-deploy is the honest control: it reads a key but only in a `npm run deploy` script, never
    // on install, and sends nothing anywhere.
    const control = await readPack(WALLET_PACK).then((p) => p['near-deploy']!);
    const pkg = JSON.parse(Buffer.from(control['package.json']!, 'base64').toString('utf8')) as { scripts?: Record<string, string> };
    assert.equal(pkg.scripts?.postinstall, undefined, 'the control must not run anything on install');
    const controlText = decoded(control);
    assert.doesNotMatch(controlText, /\.invalid\b/, 'the control must not exfiltrate');
    assert.ok(walletPath.test(controlText), 'the control should still read a key (to deploy), so it tests false alarms');
  });

  it('no readable tracked file is a working wallet stealer (a packed exfil host appears nowhere outside the pack)', async () => {
    const pack = await readPack(WALLET_PACK);
    const hosts = new Set<string>();
    for (const files of Object.values(pack)) {
      const text = decoded(files);
      for (const h of text.match(/\b[a-z0-9.-]+\.invalid\b/gi) ?? []) hosts.add(h.toLowerCase());
    }
    assert.ok(hosts.size >= 4, 'expected several distinct .invalid exfil hosts across the samples');
    const hits: string[] = [];
    // Receipts and sandbox evidence report what a sample did, so they name its hosts by design; the
    // rule is about stealer code, which lives only in the pack.
    const reports = (f: string) => f === 'METRICS.md' || f === 'web/src/home/showcase.json' || f.startsWith('bench/') || f.startsWith('fixtures/receipts/') || f.endsWith('.evidence.json');
    for (const file of (await trackedTextFiles()).filter((f) => !reports(f))) {
      const text = (await readFile(path.join(root, file), 'utf8').catch(() => '')).toLowerCase();
      for (const h of hosts) if (text.includes(h)) hits.push(`${file}: ${h}`);
    }
    assert.deepEqual(hits, [], `wallet-stealer exfil host found in a readable file (keep stealer code packed):\n${hits.join('\n')}`);
  });
});
