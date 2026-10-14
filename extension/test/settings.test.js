import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_API_BASE, PRODUCT_NAME, STORAGE_KEYS } from '../config.js';
import { normalizeApiBase, originPattern } from '../lib/settings.js';

describe('normalizeApiBase', () => {
  it('accepts https and local addresses, without a trailing slash', () => {
    const cases = {
      'https://airlock.example.com': 'https://airlock.example.com',
      'https://airlock.example.com/': 'https://airlock.example.com',
      'HTTPS://Airlock.Example.com//': 'https://airlock.example.com',
      'https://example.com/airlock/': 'https://example.com/airlock',
      'https://example.com:8443': 'https://example.com:8443',
      'http://localhost:8787': 'http://localhost:8787',
      'http://localhost:8787/': 'http://localhost:8787',
      'http://localhost': 'http://localhost',
      '  http://LOCALHOST:3000  ': 'http://localhost:3000',
    };
    for (const [input, value] of Object.entries(cases)) {
      assert.deepEqual(normalizeApiBase(input), { ok: true, value }, input);
    }
  });

  it('refuses plain http anywhere but localhost, and other shapes', () => {
    for (const input of [
      '',
      '   ',
      undefined,
      null,
      42,
      'airlock.example.com',
      'localhost:8787',
      'http://airlock.example.com',
      'http://127.0.0.1:8787',
      'http://localhost.evil.example',
      'ftp://example.com',
      'javascript:alert(1)',
      'https://user:pass@example.com',
      'https://example.com/?x=1',
      'https://example.com/#top',
      'https://',
    ]) {
      const result = normalizeApiBase(input);
      assert.equal(result.ok, false, String(input));
      assert.match(result.error, /\S/);
      assert.doesNotMatch(result.error, /!/);
    }
  });

  it('accepts the default', () => {
    assert.deepEqual(normalizeApiBase(DEFAULT_API_BASE), { ok: true, value: DEFAULT_API_BASE });
  });
});

describe('originPattern', () => {
  it('builds the host permission pattern for a server', () => {
    assert.equal(originPattern('https://airlock.example.com'), 'https://airlock.example.com/*');
    assert.equal(originPattern('https://example.com:8443/airlock'), 'https://example.com/*');
    assert.equal(originPattern('http://localhost:8787'), 'http://localhost/*');
  });
});

describe('config', () => {
  it('names the product once and keeps storage keys stable', () => {
    assert.equal(typeof PRODUCT_NAME, 'string');
    assert.ok(PRODUCT_NAME.length > 0);
    assert.equal(STORAGE_KEYS.apiBase, 'apiBase');
  });
});
