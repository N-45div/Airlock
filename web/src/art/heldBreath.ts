// Held Breath (docs/art.md): drift crosses a chamber shaped like an Edwards curve. Ordinary particles
// pass and leave faintly lit; the few that carry a key meet a tangential force at the seal and orbit
// it, brightening while they are held, so the ring of held light emerges from one rule.

import { curl, createNoise3, edwardsRadius, type Noise3 } from './noise.ts';
import { Rng } from './random.ts';

export type Rgb = [number, number, number];

export interface StagePalette {
  bg: Rgb;
  drift: Rgb;
  cleared: Rgb;
  held: Rgb;
  seal: Rgb;
}

export interface HeldBreathOptions {
  seed: string;
  palette: StagePalette;
  /** The chamber's centre and size, as fractions of the canvas (r of the shorter side). */
  chamber?: { x: number; y: number; r: number };
  /** Particles per 10,000 px². */
  density?: number;
  /** Share of particles that carry a key. */
  keyRate?: number;
  /** 1 is the tuned speed. */
  speed?: number;
  /** Draw one settled frame and stop: for prefers-reduced-motion. */
  still?: boolean;
}

const DRIFT = 0;
const CLEARED = 1;
const HELD = 2;
const GONE = 3;

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;

export function startHeldBreath(canvas: HTMLCanvasElement, opts: HeldBreathOptions): () => void {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};
  const rng = new Rng(opts.seed);
  const noise: Noise3 = createNoise3(() => rng.next());
  const pal = opts.palette;
  const speed = opts.speed ?? 1;
  const keyRate = opts.keyRate ?? 0.1;
  const chamber = opts.chamber ?? { x: 0.68, y: 0.5, r: 0.36 };
  // The seal's shape and attitude come from the seed: d between a soft circle and a near square.
  const d = -1.4 - rng.next() * 9.5;
  const rot = rng.next() * Math.PI * 0.5;
  const fieldZ = rng.range(0, 100);

  let W = 0;
  let H = 0;
  let dpr = 1;
  let n = 0;
  let X = new Float32Array(0);
  let Y = new Float32Array(0);
  let PX = new Float32Array(0);
  let PY = new Float32Array(0);
  let STATE = new Uint8Array(0);
  let KEYED = new Uint8Array(0);
  let THETA = new Float32Array(0);
  let OMEGA = new Float32Array(0);
  let HOLD = new Float32Array(0);
  let HELD_AGE = new Float32Array(0);
  let JITTER = new Float32Array(0);
  let cx = 0;
  let cy = 0;
  let R = 0;
  let scale = 1;
  let t = 0;
  let frame = 0;
  const v = { x: 0, y: 0 };

  const spawn = (i: number, anywhere: boolean) => {
    X[i] = anywhere ? rng.range(-20, W) : rng.range(-40, -2);
    Y[i] = rng.range(-10, H + 10);
    PX[i] = X[i]!;
    PY[i] = Y[i]!;
    STATE[i] = DRIFT;
    KEYED[i] = rng.chance(keyRate) ? 1 : 0;
    HELD_AGE[i] = 0;
    JITTER[i] = rng.gauss() * 0.022;
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W * chamber.x;
    cy = H * chamber.y;
    R = Math.min(W, H) * chamber.r;
    scale = 1 / (Math.min(W, H) * 0.62);
    n = Math.round(Math.min(2600, Math.max(380, ((W * H) / 10_000) * (opts.density ?? 6.5))));
    X = new Float32Array(n);
    Y = new Float32Array(n);
    PX = new Float32Array(n);
    PY = new Float32Array(n);
    STATE = new Uint8Array(n);
    KEYED = new Uint8Array(n);
    THETA = new Float32Array(n);
    OMEGA = new Float32Array(n);
    HOLD = new Float32Array(n);
    HELD_AGE = new Float32Array(n);
    JITTER = new Float32Array(n);
    for (let i = 0; i < n; i++) spawn(i, true);
    ctx.fillStyle = rgba(pal.bg, 1);
    ctx.fillRect(0, 0, W, H);
  };

  const sealRadius = (theta: number, breath: number) => edwardsRadius(theta - rot, d) * R * breath;

  const step = () => {
    t += 0.0011 * speed;
    frame += 1;
    // The held breath: the seal swells and settles over about nine seconds.
    const breath = 1 + 0.014 * Math.sin((frame / 540) * Math.PI * 2);
    const base = 0.62 * speed;
    const flow = 0.42 * speed;
    for (let i = 0; i < n; i++) {
      PX[i] = X[i]!;
      PY[i] = Y[i]!;
      if (STATE[i] === HELD) {
        THETA[i] = THETA[i]! + OMEGA[i]!;
        HELD_AGE[i] = HELD_AGE[i]! + 1;
        const wobble = noise(Math.cos(THETA[i]!) * 1.7, Math.sin(THETA[i]!) * 1.7, t * 3 + i * 0.01) * 0.035;
        const r = sealRadius(THETA[i]!, breath) * (1 + JITTER[i]! + wobble);
        const tx = cx + Math.cos(THETA[i]!) * r;
        const ty = cy + Math.sin(THETA[i]!) * r;
        X[i] = X[i]! + (tx - X[i]!) * 0.09;
        Y[i] = Y[i]! + (ty - Y[i]!) * 0.09;
        HOLD[i] = HOLD[i]! - 1;
        if (HOLD[i]! <= 0) STATE[i] = GONE;
        continue;
      }
      if (STATE[i] === GONE) {
        spawn(i, false);
        continue;
      }
      const dx = X[i]! - cx;
      const dy = Y[i]! - cy;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const edge = sealRadius(ang, breath);
      const inside = dist < edge;
      curl(noise, X[i]! * scale, Y[i]! * scale, fieldZ + t, v);
      const calm = inside ? 0.32 : 1;
      X[i] = X[i]! + base * (inside ? 0.7 : 1) + v.x * flow * calm;
      Y[i] = Y[i]! + v.y * flow * calm;
      if (STATE[i] === DRIFT && dist < edge * 1.02) {
        if (KEYED[i]) {
          // The chamber knows: a keyed particle falls into the seal and orbits it.
          STATE[i] = HELD;
          THETA[i] = ang;
          OMEGA[i] = (rng.chance(0.5) ? 1 : -1) * rng.range(0.0035, 0.0085) * speed;
          HOLD[i] = rng.range(800, 2100);
          HELD_AGE[i] = 0;
        } else STATE[i] = CLEARED;
      }
      if (X[i]! > W + 30 || Y[i]! < -60 || Y[i]! > H + 60) spawn(i, false);
    }
  };

  const draw = () => {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(pal.bg, 0.05);
    ctx.fillRect(0, 0, W, H);

    // The seal, faint: drawn every frame, so the fade settles it to a steady glow.
    const breath = 1 + 0.014 * Math.sin((frame / 540) * Math.PI * 2);
    ctx.lineWidth = 1;
    for (const [k, a] of [
      [1, 0.03],
      [0.88, 0.012],
    ] as const) {
      ctx.beginPath();
      for (let s = 0; s <= 180; s++) {
        const th = (s / 180) * Math.PI * 2;
        const r = sealRadius(th, breath) * k;
        const px = cx + Math.cos(th) * r;
        const py = cy + Math.sin(th) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(pal.seal, a);
      ctx.stroke();
    }

    const segments = (state: number, test?: (i: number) => boolean) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (STATE[i] !== state || (test && !test(i))) continue;
        ctx.moveTo(PX[i]!, PY[i]!);
        ctx.lineTo(X[i]!, Y[i]!);
      }
    };
    ctx.lineWidth = 1.15;
    segments(DRIFT);
    ctx.strokeStyle = rgba(pal.drift, 0.62);
    ctx.stroke();
    segments(CLEARED);
    ctx.strokeStyle = rgba(pal.cleared, 0.66);
    ctx.stroke();

    // Held light brightens the longer it is held; three buckets keep it to three strokes.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    for (const [lo, hi, a] of [
      [0, 60, 0.35],
      [60, 220, 0.62],
      [220, Infinity, 0.92],
    ] as const) {
      const bucket = (i: number) => HELD_AGE[i]! >= lo && HELD_AGE[i]! < hi && HOLD[i]! > 40;
      segments(HELD, bucket);
      ctx.strokeStyle = rgba(pal.held, a);
      ctx.stroke();
      // Each held particle is a bead of light on the seal: the ring is drawn by what it refused.
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (STATE[i] !== HELD || !bucket(i)) continue;
        ctx.moveTo(X[i]! + 1.5, Y[i]!);
        ctx.arc(X[i]!, Y[i]!, 1.5, 0, Math.PI * 2);
      }
      ctx.fillStyle = rgba(pal.held, a * 0.55);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  resize();

  if (opts.still) {
    for (let i = 0; i < 420; i++) {
      step();
      draw();
    }
    return () => {};
  }

  let raf = 0;
  let running = false;
  const loop = () => {
    step();
    draw();
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(loop);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  // Warm start: the first visible frame already shows drift and a few held lights.
  for (let i = 0; i < 260; i++) {
    step();
    draw();
  }

  let visible = true;
  const update = () => (visible && !document.hidden ? play() : pause());
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    update();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', update);
  let lastW = W;
  let lastH = H;
  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - lastW) < 2 && Math.abs(rect.height - lastH) < 2) return;
    resize();
    lastW = W;
    lastH = H;
  });
  ro.observe(canvas);
  update();

  return () => {
    pause();
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', update);
  };
}
