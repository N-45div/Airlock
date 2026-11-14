import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { type Receipt, receiptHash } from '../receipt.ts';
import { Scanner } from '../scans.ts';
import type { Scan, ScanEvent, ScanProof } from '../types.ts';
import { FIXTURES } from '../verify-receipt.ts';

const PROOF: ScanProof = {
  engine: 'near-ai-tee',
  model: 'Qwen/Qwen3.8-27B',
  receiptHash: 'ab'.repeat(32),
  signer: 'cd'.repeat(32),
  tcbStatus: 'UpToDate',
  gpuEvidence: 'verified',
  replies: 2,
};

test('a review made on NEAR AI Cloud keeps its proof on the scan', async () => {
  const scanner = new Scanner(await mkdtemp(path.join(os.tmpdir(), 'airlock-proof-')), async () => ({
    verdict: 'dangerous',
    headline: 'h',
    summary: 's',
    findings: [],
    costUsd: 0.004,
    proof: PROOF,
  }));
  await scanner.load();
  const { id } = scanner.start('take-home', '9.9.9.9');
  const done = await new Promise<Scan>((resolve) => {
    const stop = scanner.subscribe(id, (e: ScanEvent) => {
      if (e.type === 'done') {
        stop();
        resolve(e.scan);
      }
    });
  });
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.proof, PROOF);
});

test('receipts are served by hash: the server\'s own and the ones shipped with Airlock', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'airlock-receipts-'));
  const scanner = new Scanner(dataDir, async () => ({ verdict: 'safe', headline: '', summary: '', findings: [], costUsd: 0 }));
  const own = `{"schema":"airlock.receipt.v2"}`;
  await mkdir(path.join(dataDir, 'receipts'));
  await writeFile(path.join(dataDir, 'receipts', `${'ef'.repeat(32)}.json`), own);
  assert.equal(await scanner.receipt('ef'.repeat(32)), own);

  const fixture = await readFile(path.join(FIXTURES, 'take-home.json'), 'utf8');
  const hash = receiptHash(JSON.parse(fixture) as Receipt);
  assert.equal(await scanner.receipt(hash), fixture);

  assert.equal(await scanner.receipt('00'.repeat(32)), null);
  assert.equal(await scanner.receipt('../../etc/passwd'), null);
});

test('a private check keeps nothing: no file on disk, no lookup, no reuse, and its receipt goes to the browser', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'airlock-private-'));
  const kept: (boolean | undefined)[] = [];
  const scanner = new Scanner(dataDir, async (opts) => {
    kept.push(opts.keep);
    const notRecorded = opts.keep === false ? { notRecorded: 'private' } : {};
    const files = opts.keep === false ? { files: { receipt: { schema: 'airlock.receipt.v2' } } } : {};
    return { verdict: 'safe', headline: 'h', summary: 's', findings: [], costUsd: 0.001, proof: { ...PROOF, ...notRecorded }, ...files };
  });
  await scanner.load();
  const finish = (id: string) =>
    new Promise<Scan>((resolve) => {
      const stop = scanner.subscribe(id, (e: ScanEvent) => {
        if (e.type === 'done') {
          stop();
          resolve(e.scan);
        }
      });
    });

  // The packed sample, so the test needs no network.
  const url = 'sample:take-home';
  const open = scanner.start('take-home', '1.1.1.1');
  await finish(open.id);
  const priv = scanner.start(url, '1.1.1.2', { private: true });
  assert.notEqual(priv.id, open.id, 'a private check never reuses a recent report');
  const done = await finish(priv.id);

  assert.equal(done.private, true);
  assert.deepEqual(kept, [true, false], 'the reviewer is told to keep nothing for the private check only');
  assert.deepEqual(done.files, { receipt: { schema: 'airlock.receipt.v2' } });
  assert.equal(scanner.get(priv.id)?.id, priv.id, 'its page can still load it for a while');
  assert.notEqual(scanner.latest(url)?.id, priv.id, 'a private check never shows up in lookups');
  const { readdir } = await import('node:fs/promises');
  const onDisk = await readdir(path.join(dataDir, 'scans'));
  assert.deepEqual(onDisk, [`${open.id}.json`], 'only the ordinary check was written to disk');
});
