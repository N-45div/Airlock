import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { publicKeyOfSeed, withSeedCapture, withSeedReplay } from '../nacl-rng.ts';
import { type Receipt, canonicalJson, receiptHash, repoIdentity, treeHash } from '../receipt.ts';
import { FIXTURES, type Check, sampleDir, verifyReceipt } from '../verify-receipt.ts';
import nacl from 'tweetnacl';

let fixture: Receipt;
let base: string;
const realFetch = globalThis.fetch;

before(async () => {
  fixture = JSON.parse(await readFile(path.join(FIXTURES, 'take-home.json'), 'utf8')) as Receipt;
  base = await mkdtemp(path.join(os.tmpdir(), 'receipt-test-'));
  // Offline means offline: any network call during verification fails the test.
  globalThis.fetch = (() => {
    throw new Error('network used during offline verification');
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await rm(base, { recursive: true, force: true });
});

const tamper = (edit: (r: Receipt) => void): Receipt => {
  const copy = structuredClone(fixture);
  edit(copy);
  return copy;
};
const failed = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.name);
const flipHex = (hex: string, at: number) => hex.slice(0, at) + (hex[at] === '0' ? '1' : '0') + hex.slice(at + 1);

describe('verifyReceipt on the recorded take-home receipt', () => {
  it('passes every check offline, including the sample files', async () => {
    const checks = await verifyReceipt(fixture, { repoDir: sampleDir(fixture)! });
    assert.deepEqual(failed(checks), [], JSON.stringify(checks, null, 2));
    assert.equal(checks.length, 6);
  });

  it('catches a changed verdict', async () => {
    const r = tamper((x) => ((x.verdict as { verdict: string }).verdict = 'safe'));
    assert.deepEqual(failed(await verifyReceipt(r)), ['final reply contains the verdict']);
  });

  it('catches a forged signature', async () => {
    const r = tamper((x) => (x.turns[0]!.signature = flipHex(x.turns[0]!.signature, 10)));
    assert.deepEqual(failed(await verifyReceipt(r)), ['every reply signed by the attested key']);
  });

  it('catches swapped reply bytes', async () => {
    const r = tamper((x) => (x.final.responseBody = x.final.responseBody.replace('"id"', '"id" ')));
    assert.deepEqual(failed(await verifyReceipt(r)), ['final reply contains the verdict']);
  });

  it('catches a wrong one-time key', async () => {
    const r = tamper((x) => (x.final.clientSeed = flipHex(x.final.clientSeed, 0)));
    assert.deepEqual(failed(await verifyReceipt(r)), ['final reply contains the verdict']);
  });

  it('catches a quote that does not hold this scan\'s nonce', async () => {
    const r = tamper((x) => (x.attestation.nonce = flipHex(x.attestation.nonce, 0)));
    assert.deepEqual(failed(await verifyReceipt(r)), ['quote binds key and nonce']);
  });

  it('catches another signing key', async () => {
    const other = Buffer.from(nacl.sign.keyPair().publicKey).toString('hex');
    const r = tamper((x) => {
      x.attestation.signer = other;
      x.attestation.e2eePublicKey = other;
    });
    const names = failed(await verifyReceipt(r));
    assert.ok(names.includes('quote binds key and nonce'));
    assert.ok(names.includes('every reply signed by the attested key'));
  });

  it('catches an altered quote', async () => {
    // Byte 600 sits in the TD report body, which Intel's chain signs.
    const r = tamper((x) => (x.attestation.quote = flipHex(x.attestation.quote, 1200)));
    assert.ok(failed(await verifyReceipt(r)).includes('Intel TDX quote'));
  });

  it('catches altered Intel collateral', async () => {
    const r = tamper((x) => (x.attestation.collateral.tcb_info = x.attestation.collateral.tcb_info.replace('"version"', '"versiom"')));
    assert.ok(failed(await verifyReceipt(r)).includes('Intel TDX quote'));
  });

  it('catches files that are not the reviewed ones', async () => {
    const dir = path.join(base, 'other');
    await mkdir(dir);
    await writeFile(path.join(dir, 'README.md'), 'something else\n');
    assert.deepEqual(failed(await verifyReceipt(fixture, { repoDir: dir })), ['repository files']);
  });

  it('gives the receipt a stable hash', () => {
    assert.equal(receiptHash(fixture), receiptHash(structuredClone(fixture)));
    assert.notEqual(receiptHash(fixture), receiptHash(tamper((x) => (x.costUsd += 1))));
  });
});

describe('receipt building blocks', () => {
  it('canonical JSON sorts keys at every level and drops undefined', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } }), '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}');
  });

  it('hashes the readable tree, ignoring .git, node_modules and symlinks', async () => {
    const dir = path.join(base, 'tree');
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'a.js'), 'a\n');
    const first = await treeHash(dir);
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), 'x');
    await mkdir(path.join(dir, 'node_modules'));
    await writeFile(path.join(dir, 'node_modules', 'x.js'), 'x');
    await symlink(path.join(dir, 'src', 'a.js'), path.join(dir, 'link.js'));
    assert.deepEqual(await treeHash(dir), first);
    await writeFile(path.join(dir, 'src', 'a.js'), 'b\n');
    assert.notEqual((await treeHash(dir)).sha256, first.sha256);
    assert.equal(first.files, 1);
  });

  it('names repositories without leaking local folder names', () => {
    assert.deepEqual(repoIdentity({ url: 'https://github.com/Owner/Repo', host: 'github', owner: 'Owner', name: 'Repo' }), {
      id: 'github.com/owner/repo',
      url: 'https://github.com/Owner/Repo',
    });
    assert.deepEqual(repoIdentity({ url: 'sample:take-home', host: 'sample', owner: 'airlock', name: 'take-home' }), { id: 'sample:take-home' });
    const local = repoIdentity({ url: 'local:secret-project', host: 'sample', owner: 'local', name: 'secret-project' });
    assert.match(local.id, /^private:[0-9a-f]{64}$/);
    assert.match(local.salt ?? '', /^[0-9a-f]{32}$/);
    assert.doesNotMatch(JSON.stringify(local), /secret-project/);
  });

  it('captures and replays the one-time key seed', async () => {
    const { result: original, seed } = await withSeedCapture(async () => nacl.sign.keyPair());
    assert.ok(seed);
    assert.equal(publicKeyOfSeed(seed), Buffer.from(original.publicKey).toString('hex'));
    const replayed = await withSeedReplay(seed, async () => nacl.sign.keyPair());
    assert.deepEqual(replayed.publicKey, original.publicKey);
    const fresh = nacl.sign.keyPair();
    assert.notDeepEqual(fresh.publicKey, original.publicKey, 'normal randomness again afterwards');
  });
});
