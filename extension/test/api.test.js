import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ApiError,
  createScan,
  errorText,
  isScanId,
  lookupEndpoint,
  lookupScan,
  reportUrl,
  scansEndpoint,
  VERDICTS,
  verdictView,
} from '../lib/api.js';

const BASE = 'http://localhost:8787';
const REPO = 'https://github.com/expressjs/express';

const done = (over = {}) => ({
  id: 'abc_123-XYZ',
  repo: { url: REPO, host: 'github', owner: 'expressjs', name: 'express' },
  status: 'done',
  verdict: 'caution',
  headline: 'It runs a script when you install it.',
  findings: [],
  events: [],
  approvals: [],
  startedAt: '2026-10-14T10:00:00Z',
  finishedAt: '2026-10-14T10:02:00Z',
  ...over,
});

describe('endpoints', () => {
  it('builds the contract routes', () => {
    assert.equal(lookupEndpoint(BASE, REPO), `${BASE}/api/lookup?url=https%3A%2F%2Fgithub.com%2Fexpressjs%2Fexpress`);
    assert.equal(scansEndpoint(BASE), `${BASE}/api/scans`);
    assert.equal(lookupEndpoint('https://x.example/airlock', REPO).startsWith('https://x.example/airlock/api/lookup?url='), true);
  });

  it('puts the approval key in the fragment, never the path or query', () => {
    assert.equal(reportUrl(BASE, 'abc_123', 'k/ey+=='), `${BASE}/r/abc_123#key=k%2Fey%2B%3D%3D`);
    assert.equal(reportUrl(BASE, 'abc_123'), `${BASE}/r/abc_123`);
    assert.equal(reportUrl(BASE, 'abc_123', ''), `${BASE}/r/abc_123`);
  });

  it('refuses ids that could change the path', () => {
    for (const id of ['../admin', 'a/b', 'a?b', 'a#b', '', ' ', 'x'.repeat(129), 42, null, undefined]) {
      assert.equal(isScanId(id), false, String(id));
      assert.throws(() => reportUrl(BASE, id, 'k'), ApiError);
    }
  });
});

describe('verdictView', () => {
  it('turns each verdict into its plain label', () => {
    assert.deepEqual(VERDICTS.safe.label, 'Looks safe');
    assert.deepEqual(VERDICTS.caution.label, 'Be careful');
    assert.deepEqual(VERDICTS.dangerous.label, "Don't run it");
    for (const verdict of ['safe', 'caution', 'dangerous']) {
      const view = verdictView(done({ verdict }));
      assert.equal(view.verdict, verdict);
      assert.equal(view.label, VERDICTS[verdict].label);
      assert.equal(view.id, 'abc_123-XYZ');
    }
  });

  it('carries the headline and finish time', () => {
    const view = verdictView(done());
    assert.equal(view.headline, 'It runs a script when you install it.');
    assert.equal(view.finishedAt, '2026-10-14T10:02:00Z');
    assert.equal(verdictView(done({ headline: undefined })).headline, '');
    assert.equal(verdictView(done({ headline: 'x'.repeat(1000) })).headline.length, 280);
  });

  it('shows nothing for unfinished, failed, unknown or malformed scans', () => {
    for (const scan of [
      null,
      undefined,
      'scan',
      done({ status: 'reviewing' }),
      done({ status: 'failed', verdict: undefined }),
      done({ verdict: undefined }),
      done({ verdict: 'toString' }),
      done({ verdict: 'unknown' }),
      done({ id: '../x' }),
    ]) {
      assert.equal(verdictView(scan), null, JSON.stringify(scan));
    }
  });
});

describe('errorText', () => {
  it('passes on the server\'s own words', () => {
    assert.equal(errorText(400, { error: 'That repository is private.' }), 'That repository is private.');
    assert.equal(errorText(400, { error: `  ${'x'.repeat(500)} ` }).length, 300);
  });

  it('falls back to a plain sentence', () => {
    for (const [status, body] of [[400, null], [404, {}], [429, { error: 42 }], [500, null], [503, 'oops']]) {
      const text = errorText(status, body);
      assert.match(text, /\w/);
      assert.doesNotMatch(text, /!/);
    }
    assert.match(errorText(429, null), /few minutes/);
    assert.match(errorText(502, null), /problem/);
  });
});

describe('network failures (real sockets, nothing listening)', () => {
  // Port 9 (discard) has no listener on a normal machine, so these exercise
  // the real connection-refused path.
  const CLOSED = 'http://localhost:9';

  it('lookup explains it could not reach the server', async () => {
    await assert.rejects(lookupScan(CLOSED, REPO), (err) => err instanceof ApiError && /Could not reach/.test(err.message));
  });

  it('create explains it could not reach the server', async () => {
    await assert.rejects(createScan(CLOSED, REPO), (err) => err instanceof ApiError && /Could not reach/.test(err.message));
  });
});
