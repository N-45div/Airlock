// The NEAR AI SDK makes a fresh client key pair for every encrypted request with tweetnacl
// (nacl.sign.keyPair(), whose 32-byte seed is the first thing it draws from tweetnacl's random
// source). The model encrypts its reply to that key. Keeping the seed of the final request
// lets anyone decrypt that one reply later and check it says what the receipt says; it opens
// nothing else, because every request has its own key.
//
// This module installs tweetnacl's random source once, backed by node:crypto as before, and
// can watch it (to keep a seed) or replay a seed (to rebuild that key pair offline).

import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';

type Mode = { kind: 'normal' } | { kind: 'capture'; seen: Buffer[] } | { kind: 'replay'; seed: Buffer; used: boolean };

let mode: Mode = { kind: 'normal' };

nacl.setPRNG((x: Uint8Array, n: number) => {
  if (mode.kind === 'replay' && !mode.used && n === 32) {
    x.set(mode.seed);
    mode.used = true;
    return;
  }
  const bytes = randomBytes(n);
  x.set(bytes);
  if (mode.kind === 'capture') mode.seen.push(Buffer.from(bytes));
  bytes.fill(0);
});

/** Runs `fn` (one synchronous-start SDK call) and returns its result with the first 32-byte draw. */
export async function withSeedCapture<T>(fn: () => Promise<T>): Promise<{ result: T; seed: Buffer | undefined }> {
  if (mode.kind !== 'normal') throw new Error('Key capture is already running; requests must go one at a time.');
  const seen: Buffer[] = [];
  mode = { kind: 'capture', seen };
  try {
    const result = await fn();
    return { result, seed: seen.find((b) => b.length === 32) };
  } finally {
    mode = { kind: 'normal' };
  }
}

/** Runs `fn` with the first 32-byte draw replaced by `seed`. */
export async function withSeedReplay<T>(seed: Buffer, fn: () => Promise<T>): Promise<T> {
  if (seed.length !== 32) throw new Error('A key seed is 32 bytes.');
  if (mode.kind !== 'normal') throw new Error('Key replay is already running.');
  mode = { kind: 'replay', seed, used: false };
  try {
    return await fn();
  } finally {
    mode = { kind: 'normal' };
  }
}

/** The Ed25519 public key (hex) a seed produces: the client key the request announced. */
export function publicKeyOfSeed(seed: Buffer): string {
  return Buffer.from(nacl.sign.keyPair.fromSeed(seed).publicKey).toString('hex');
}
