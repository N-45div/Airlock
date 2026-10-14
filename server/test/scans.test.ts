import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ReviewOptions, ReviewResult } from '../review.ts';
import { ScanError, Scanner } from '../scans.ts';
import type { Scan, ScanEvent } from '../types.ts';

/** A stand-in review that asks the person one question, then reports their answer. */
function askingReview(seen: string[]) {
  return async (opts: ReviewOptions): Promise<ReviewResult> => {
    const answer = await opts.hooks.askPerson({ tool: 'WebFetch', summary: 'https://example.com/a.sh', reason: 'held' });
    seen.push(answer);
    return { verdict: 'caution', headline: `answer was ${answer}`, summary: '', findings: [], costUsd: 0 };
  };
}

async function untilDone(scanner: Scanner, id: string): Promise<Scan> {
  return new Promise((resolve) => {
    const stop = scanner.subscribe(id, (e: ScanEvent) => {
      if (e.type === 'done') {
        stop();
        resolve(e.scan);
      }
    });
  });
}

async function untilQuestion(scanner: Scanner, id: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const open = scanner.get(id)?.approvals.find((a) => a.status === 'pending');
    if (open) return open.id;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no question was asked');
}

test('only the key holder can answer, and the answer reaches the review', async () => {
  const seen: string[] = [];
  const scanner = new Scanner(await mkdtemp(path.join(os.tmpdir(), 'airlock-scans-')), askingReview(seen));
  await scanner.load();
  const { id, key } = scanner.start('take-home', '1.1.1.1');
  const done = untilDone(scanner, id);
  const q = await untilQuestion(scanner, id);

  const approval = scanner.get(id)!.approvals[0]!;
  assert.ok(Date.parse(approval.expiresAt) > Date.parse(approval.askedAt));
  assert.throws(() => scanner.answer(id, q, 'wrong-key', true), (e: unknown) => e instanceof ScanError && e.status === 403);
  assert.equal(scanner.answer(id, q, key, true).status, 'approved');
  assert.throws(() => scanner.answer(id, q, key, false), (e: unknown) => e instanceof ScanError && e.status === 409);

  const scan = await done;
  assert.deepEqual(seen, ['yes']);
  assert.equal(scan.status, 'done');
  assert.equal(scan.headline, 'answer was yes');
  assert.ok(scanner.get(id), 'the finished report is still readable');
});

test('a declined question is a no, and each address has an hourly limit', async () => {
  const seen: string[] = [];
  const scanner = new Scanner(await mkdtemp(path.join(os.tmpdir(), 'airlock-scans-')), askingReview(seen));
  await scanner.load();
  const { id, key } = scanner.start('take-home', '2.2.2.2');
  const done = untilDone(scanner, id);
  scanner.answer(id, await untilQuestion(scanner, id), key, false);
  await done;
  assert.deepEqual(seen, ['no']);

  for (let i = 0; i < 6; i++) scanner.start('take-home', '3.3.3.3');
  assert.throws(() => scanner.start('take-home', '3.3.3.3'), (e: unknown) => e instanceof ScanError && e.status === 429);
});
