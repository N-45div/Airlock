import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '@nearai/inference-sdk';
import { ApiError as NodeApiError } from '@nearai/inference-sdk/node';
import { jsonSafe, signatureMayStillCome } from '../near-client.ts';

describe('signatureMayStillCome', () => {
  for (const [name, E] of [['browser bundle', ApiError], ['Node bundle', NodeApiError]] as const) {
    it(`retries a signature that isn't there yet (${name})`, () => {
      const status = (s: number) => new E({ code: 'api.http_status', details: { resource: 'completion_signature', status: s }, retryable: false });
      assert.equal(signatureMayStillCome(status(404)), true);
      assert.equal(signatureMayStillCome(new E({ code: 'api.completion_signature_unavailable', details: { providerErrorCode: 'not_ready', providerMessage: 'not ready' } })), true);
      assert.equal(signatureMayStillCome(new Error('Connection error.', { cause: status(404) })), true);
      assert.equal(signatureMayStillCome(status(401)), false);
    });
  }

  it('does not retry unrelated errors', () => {
    assert.equal(signatureMayStillCome(new Error('boom')), false);
    assert.equal(signatureMayStillCome(undefined), false);
  });
});

describe('jsonSafe', () => {
  it('turns bytes into hex so evidence survives JSON', () => {
    assert.deepEqual(jsonSafe({ a: new Uint8Array([1, 255]), b: Buffer.from([16]), n: 5n }), { a: '01ff', b: '10', n: '5' });
  });
});
