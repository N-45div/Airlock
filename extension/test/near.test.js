import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chainLinks,
  chainSummary,
  chainView,
  decodeView,
  fetchChainVerdict,
  NEAR_RPC,
  NearError,
  RECORDER,
  REGISTRY,
  registryRepoId,
  viewBody,
} from '../lib/near.js';

const HASH = 'ab'.repeat(32);
const record = (over = {}) => ({
  id: 7,
  repo: 'github.com/sindresorhus/slugify',
  revision: '6df9e8fb3397'.padEnd(40, '0'),
  verdict: 'safe',
  findings: 2,
  model: 'Qwen/Qwen3.8-27B',
  receipt_hash: HASH,
  signer: 'cd'.repeat(32),
  signature: 'ef'.repeat(64),
  response_sha256: '12'.repeat(32),
  recorder: RECORDER,
  recorded_at_ms: Date.UTC(2026, 10, 5, 20, 30),
  ...over,
});
const rpcAnswer = (value) => ({ jsonrpc: '2.0', id: 'airlock', result: { result: [...new TextEncoder().encode(JSON.stringify(value))], logs: [] } });

describe('registryRepoId', () => {
  it('names GitHub repositories the way the registry does', () => {
    assert.equal(registryRepoId('https://github.com/Sindresorhus/Slugify'), 'github.com/sindresorhus/slugify');
    assert.equal(registryRepoId('https://github.com/kelektiv/node.bcrypt.js'), 'github.com/kelektiv/node.bcrypt.js');
  });
  it('refuses anything else', () => {
    for (const bad of ['https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/tree/main', 'github.com/a/b', null]) {
      assert.equal(registryRepoId(bad), null, String(bad));
    }
  });
});

describe('viewBody and decodeView', () => {
  it('builds a call_function query on the registry', () => {
    const body = JSON.parse(viewBody('get_latest', { repo: 'github.com/a/b', recorder: RECORDER }));
    assert.equal(body.method, 'query');
    assert.equal(body.params.account_id, REGISTRY);
    assert.equal(body.params.method_name, 'get_latest');
    assert.deepEqual(JSON.parse(Buffer.from(body.params.args_base64, 'base64').toString('utf8')), { repo: 'github.com/a/b', recorder: RECORDER });
  });
  it('decodes the bytes NEAR returns', () => {
    assert.deepEqual(decodeView(rpcAnswer({ a: 1 })), { a: 1 });
    assert.equal(decodeView(rpcAnswer(null)), null);
  });
  it('turns RPC errors into a NearError', () => {
    assert.throws(() => decodeView({ result: { error: 'wasm execution failed' } }), NearError);
    assert.throws(() => decodeView({ error: { message: 'boom' } }), /boom/);
    assert.throws(() => decodeView(null), NearError);
  });
});

describe('chainView', () => {
  it('keeps what the badge and popup show', () => {
    const view = chainView(record());
    assert.equal(view.source, 'near');
    assert.equal(view.label, 'Looks safe');
    assert.equal(view.findings, 2);
    assert.equal(view.receiptHash, HASH);
    assert.equal(view.recordedAt, '2026-11-05T20:30:00.000Z');
  });
  it('ignores verdicts from other recorders and malformed records', () => {
    assert.equal(chainView(record({ recorder: 'someone-else.testnet' })), null);
    assert.equal(chainView(record({ verdict: 'fine' })), null);
    assert.equal(chainView(record({ receipt_hash: 'nope' })), null);
    assert.equal(chainView(null), null);
  });
  it('summarizes and links a verdict', () => {
    const view = chainView(record({ verdict: 'dangerous', findings: 1 }));
    assert.match(chainSummary(view), /^Recorded on NEAR: Don't run it · 1 finding · Qwen\/Qwen3\.8-27B · /);
    const links = chainLinks('https://airlock-check.vercel.app', view);
    assert.equal(links.page, 'https://airlock-check.vercel.app/near?repo=github.com%2Fsindresorhus%2Fslugify');
    assert.equal(links.receipt, `https://airlock-check.vercel.app/api/receipts/${HASH}`);
    assert.match(links.contract, new RegExp(`${REGISTRY}$`));
  });
});

describe('fetchChainVerdict', () => {
  it('asks the registry for the recorder\'s latest verdict on that repository', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { json: async () => rpcAnswer(record()) };
    };
    const view = await fetchChainVerdict('https://github.com/sindresorhus/slugify', { fetchImpl });
    assert.equal(seen.url, NEAR_RPC);
    assert.equal(seen.init.credentials, 'omit');
    const args = JSON.parse(Buffer.from(JSON.parse(seen.init.body).params.args_base64, 'base64').toString('utf8'));
    assert.deepEqual(args, { repo: 'github.com/sindresorhus/slugify', recorder: RECORDER });
    assert.equal(view.verdict, 'safe');
  });
  it('returns null when there is no verdict, and does not ask for non-GitHub pages', async () => {
    assert.equal(await fetchChainVerdict('https://github.com/a/b', { fetchImpl: async () => ({ json: async () => rpcAnswer(null) }) }), null);
    assert.equal(await fetchChainVerdict('https://gitlab.com/a/b', { fetchImpl: async () => assert.fail('should not fetch') }), null);
  });
  it('reports network trouble as a NearError', async () => {
    await assert.rejects(fetchChainVerdict('https://github.com/a/b', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), NearError);
  });
});
