import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SandboxEvidence } from '../sandbox/chamber.ts';
import { outcomeOf, pickCandidates } from '../wild-bench.ts';

const blob = (c: string) => c.repeat(40);
const line = (b: string, file: string) => `100644 blob ${b}\t${file}`;

describe('real-malware benchmark', () => {
  it('picks the newest package of each name, skips Windows and macOS binaries, and names scoped packages the npm way', () => {
    const listing = [
      line(blob('a'), 'samples/npm/malicious_intent/old-thing/1.0.0/2026-01-02-old-thing-v1.0.0.zip'),
      line(blob('b'), 'samples/npm/malicious_intent/@evil@utils/9.9.9/2026-10-01-%40evil_utils-v9.9.9.zip'),
      line(blob('c'), 'samples/npm/malicious_intent/fast-win32-x64/1.0.0/2026-10-05-fast-win32-x64-v1.0.0.zip'),
      line(blob('d'), 'samples/npm/malicious_intent/old-thing/2.0.0/2026-09-01-old-thing-v2.0.0.zip'),
      line(blob('e'), 'samples/npm/compromised_lib/real-lib/1.2.3/2026-10-09-real-lib-v1.2.3.zip'),
      'not a listing line',
    ].join('\n');
    const picked = pickCandidates(listing, 10);
    assert.deepEqual(picked.map((c) => `${c.name}@${c.version}`), ['@evil/utils@9.9.9', 'old-thing@2.0.0']);
    assert.equal(picked[0]!.blob, blob('b'));
    assert.match(picked[0]!.url, /^https:\/\/raw\.githubusercontent\.com\/DataDog\/malicious-software-packages-dataset\/main\/samples\/npm\/malicious_intent\/%40evil%40utils\//);
    assert.equal(pickCandidates(listing, 1).length, 1);
  });

  it('tells phoning home apart from downloading a prebuilt binary', () => {
    const base = { exfil: [], contacts: [], refused: [] } as unknown as SandboxEvidence;
    const req = (x: { host: string; path?: string; bytes?: number; method?: string; decoys?: string[] }) =>
      ({ ...base, exfil: [{ method: 'GET', path: '/', bytes: 0, decoys: [], ...x }] }) as unknown as SandboxEvidence;
    const lookup = (host: string) => ({ ...base, contacts: [{ host }] }) as unknown as SandboxEvidence;
    assert.equal(outcomeOf(req({ host: 'collector.example', decoys: ['SSH key'] })), 'caught');
    assert.equal(outcomeOf(req({ host: 'collector.example', method: 'POST', bytes: 90 })), 'phoned', 'a body is data sent out');
    assert.equal(outcomeOf(req({ host: 'eo1abc.m.pipedream.net' })), 'phoned', 'a collector service');
    assert.equal(outcomeOf(req({ host: 'webhook.site', path: '/abc/host-1/dev' })), 'phoned', "the user's name in the path");
    assert.equal(outcomeOf(lookup('bx.dev.fc07f9deb39.project.1794602034.oob.example.xyz')), 'phoned', "the user's name in a DNS name");
    assert.equal(outcomeOf(lookup('65373233626439362d6632627c6465767c313031.x.example')), 'phoned', 'hex-encoded data in a DNS name');
    assert.equal(outcomeOf(req({ host: 'github.com', path: '/TryGhost/node-sqlite3/releases/download/v6.0.1/sqlite3.tar.gz' })), 'fetched', 'a prebuilt binary');
    assert.equal(outcomeOf(lookup('download.cypress.io')), 'fetched');
    assert.equal(outcomeOf(base), 'quiet');
  });
});
