// Seeded randomness for the art: a string (a receipt hash, a scan id) becomes a deterministic
// stream, so the same seed always draws the same picture.

/** cyrb128: a fast 128-bit string hash, good for seeding. */
export function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: a small, fast PRNG with a 128-bit state. Returns floats in [0, 1). */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  readonly next: () => number;

  constructor(seed: string | number) {
    const [a, b, c, d] = hash128(String(seed));
    this.next = sfc32(a, b, c, d);
    // Discard the first outputs, which correlate with the seed.
    for (let i = 0; i < 12; i++) this.next();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Normal distribution, mean 0, sd 1 (Box-Muller). */
  gauss(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** 256 bits for a seed: the hash's own bits when it is 64 hex characters, else bits derived from it. */
export function seedBits(seed: string): number[] {
  const hex = /^[0-9a-f]{64}$/i.test(seed) ? seed.toLowerCase() : Array.from({ length: 8 }, (_, i) => hash128(`${seed}:${i}`)[0]!.toString(16).padStart(8, '0')).join('');
  const bits: number[] = [];
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    for (let b = 3; b >= 0; b--) bits.push((n >> b) & 1);
  }
  return bits;
}

/** The first bytes of a seed's bits, for parameters that should follow the hash itself. */
export function seedBytes(seed: string, count = 8): number[] {
  const bits = seedBits(seed);
  return Array.from({ length: count }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((acc, b) => (acc << 1) | b, 0));
}
