import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BenchCase, type BenchResults, CASES, inventoryVerdict, renderMetrics } from '../bench.ts';
import type { Inventory } from '../inventory.ts';

const inv = (over: Partial<Inventory> = {}): Inventory => ({ files: [], autoRuns: [], findings: [], ...over });

describe('inventoryVerdict', () => {
  it('reads only what the static inventory sees', () => {
    assert.equal(inventoryVerdict(inv()), 'safe');
    assert.equal(inventoryVerdict(inv({ autoRuns: [{ file: 'package.json', trigger: 'npm install (postinstall)', command: 'node x.js' }] })), 'caution');
    assert.equal(inventoryVerdict(inv({ findings: [{ id: 's1', severity: 'high', category: 'runs-on-open', title: 't', detail: 'd', source: 'static' }] })), 'dangerous');
  });
});

describe('the benchmark cases', () => {
  it('cover clean, auto-run and agent-steering repositories, with unique ids', () => {
    const ids = CASES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    const groups = (g: BenchCase['group']) => CASES.filter((c) => c.group === g);
    assert.ok(groups('clean').length >= 10 && groups('clean').every((c) => c.expected === 'safe'));
    assert.ok(groups('auto-run').length >= 6 && groups('auto-run').every((c) => c.expected === 'caution'));
    assert.ok(groups('steering').length >= 6 && groups('steering').every((c) => c.expected === 'dangerous' && 'pack' in c.source));
  });
});

describe('renderMetrics', () => {
  const cases: BenchCase[] = [
    { id: 'clean-a', source: { dir: 'x' }, expected: 'safe', mustFlag: [], group: 'clean', trait: 'clean' },
    { id: 'clean-b', source: { dir: 'x' }, expected: 'safe', mustFlag: [], group: 'clean', trait: 'clean' },
    { id: 'hook', source: { dir: 'x' }, expected: 'caution', mustFlag: ['runs-on-install'], group: 'auto-run', trait: 'hook' },
    { id: 'note', source: { pack: 'x' }, expected: 'dangerous', mustFlag: ['ai-instructions'], group: 'steering', trait: 'note' },
  ];
  const run = (c: string, verdict: 'safe' | 'caution' | 'dangerous', baseline: 'safe' | 'caution' | 'dangerous', expected = cases.find((x) => x.id === c)!.expected) => ({
    case: c, model: 'm', expected, verdict, baseline, correct: verdict === expected, categories: [], flaggedAll: true,
    blockedAttempts: 0, replies: 2, inputTokens: 1, outputTokens: 1, costUsd: 0.004, seconds: 1, budgetReached: false,
  });
  const results: BenchResults = {
    date: '2026-11-07T00:00:00Z',
    maxUsd: 0.02,
    runs: [run('clean-a', 'safe', 'safe'), run('clean-b', 'caution', 'safe'), run('hook', 'caution', 'caution'), run('note', 'dangerous', 'safe')],
  };
  const md = renderMetrics(results, cases);

  it('counts right verdicts, risky cases caught, false alarms and planted notes', () => {
    assert.match(md, /\| `m` \| 3\/4 \(75%\) \| 2\/2 \(100%\) \| 1\/2 \(50%\) \| 1\/1 \(100%\) \| never \| \$0\.0040 \|/);
  });

  it('adds the inventory-only baseline as its own row', () => {
    assert.match(md, /\| Inventory only \(no AI\) \| 3\/4 \(75%\) \| 1\/2 \(50%\) \| 0\/2 \(0%\) \| 0\/1 \(0%\) \| n\/a \| \$0 \|/);
    assert.match(md, /\| note \| note \| dangerous \| safe \(miss\) \| dangerous, flagged, \$0\.0040 \|/);
  });
});
