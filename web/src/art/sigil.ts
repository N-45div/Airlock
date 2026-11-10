// A verdict's sigil (docs/art.md): drawn only from its seed, so it is the same everywhere it appears.
// The outer ring is the seed's 256 bits, one tick each: two sigils match exactly when their receipt
// hashes do. The seal is an Edwards curve whose softness and attitude come from the hash's first
// bytes; streamlines traced through the seed's own current settle inside it in the verdict's color;
// each held light is a wallet or key the sandbox caught leaving.

import { createNoise3, curl, edwardsRadius } from './noise.ts';
import { Rng, seedBits, seedBytes } from './random.ts';
import type { Rgb } from './heldBreath.ts';

export interface SigilColors {
  ink: Rgb;
  faint: Rgb;
  verdict: Rgb;
  held: Rgb;
}

export interface SigilOptions {
  seed: string;
  colors: SigilColors;
  /** Wallets or keys caught leaving in the sandbox: one held light each (up to 16). */
  held?: number;
}

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;

/** Draws the sigil into a square of `size` CSS pixels at the context's current transform. */
export function drawSigil(ctx: CanvasRenderingContext2D, size: number, opts: SigilOptions): void {
  const { colors } = opts;
  const rng = new Rng(`sigil:${opts.seed}`);
  const noise = createNoise3(() => rng.next());
  const bytes = seedBytes(opts.seed, 4);
  const bits = seedBits(opts.seed);
  const c = size / 2;
  const R = size * 0.33;
  const d = -1.2 - (bytes[0]! / 255) * 11;
  const rot = (bytes[1]! / 255) * Math.PI * 0.5;
  const z = bytes[2]! / 25.5;
  const seal = (th: number, k = 1) => edwardsRadius(th - rot, d) * R * k;
  const hair = Math.max(0.6, size / 220);

  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The bit ring: the seed itself, one tick per bit, read clockwise from the top.
  const r0 = size * 0.445;
  ctx.lineWidth = Math.max(0.75, size / 260);
  ctx.beginPath();
  bits.forEach((bit, i) => {
    const th = (i / bits.length) * Math.PI * 2 - Math.PI / 2;
    const len = bit ? size * 0.034 : size * 0.012;
    ctx.moveTo(c + Math.cos(th) * r0, c + Math.sin(th) * r0);
    ctx.lineTo(c + Math.cos(th) * (r0 + len), c + Math.sin(th) * (r0 + len));
  });
  ctx.strokeStyle = rgba(colors.ink, 0.62);
  ctx.stroke();

  // Streamlines through the seed's current, kept inside the seal.
  const lines = 46 + Math.floor(rng.next() * 22);
  const scale = 1 / (size * 0.42);
  const v = { x: 0, y: 0 };
  ctx.lineWidth = hair * 1.1;
  for (let l = 0; l < lines; l++) {
    const th0 = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.next()) * 0.92;
    let x = c + Math.cos(th0) * seal(th0) * rr;
    let y = c + Math.sin(th0) * seal(th0) * rr;
    const steps = 30 + Math.floor(rng.next() * 50);
    const stepLen = size * 0.0065;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      curl(noise, x * scale, y * scale, z, v);
      const m = Math.hypot(v.x, v.y) || 1;
      x += (v.x / m) * stepLen;
      y += (v.y / m) * stepLen;
      const th = Math.atan2(y - c, x - c);
      if (Math.hypot(x - c, y - c) > seal(th, 0.97)) break;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(colors.verdict, 0.16 + rng.next() * 0.3);
    ctx.stroke();
  }

  // The seal: three nested Edwards curves, the outer one firm.
  for (const [k, a, w] of [
    [1, 0.85, 1.5],
    [0.93, 0.35, 1],
    [0.86, 0.18, 1],
  ] as const) {
    ctx.beginPath();
    for (let s = 0; s <= 240; s++) {
      const th = (s / 240) * Math.PI * 2;
      const r = seal(th, k);
      if (s === 0) ctx.moveTo(c + Math.cos(th) * r, c + Math.sin(th) * r);
      else ctx.lineTo(c + Math.cos(th) * r, c + Math.sin(th) * r);
    }
    ctx.lineWidth = hair * w;
    ctx.strokeStyle = rgba(k === 1 ? colors.verdict : colors.faint, a);
    ctx.stroke();
  }

  // Held lights on the seal, one per wallet or key caught leaving.
  const held = Math.min(16, Math.max(0, Math.round(opts.held ?? 0)));
  for (let h = 0; h < held; h++) {
    const th = rng.range(0, Math.PI * 2);
    const r = seal(th);
    const x = c + Math.cos(th) * r;
    const y = c + Math.sin(th) * r;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 0.07);
    glow.addColorStop(0, rgba(colors.held, 0.55));
    glow.addColorStop(1, rgba(colors.held, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(colors.held, 1);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.2, size * 0.014), 0, Math.PI * 2);
    ctx.fill();
  }

  // The centre: a single point, where the decision is made.
  ctx.fillStyle = rgba(colors.ink, 0.8);
  ctx.beginPath();
  ctx.arc(c, c, Math.max(1, size * 0.01), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
