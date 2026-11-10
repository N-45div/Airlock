// The art in React: the living Held Breath stage, and a verdict's sigil.

import { useEffect, useRef, useState } from 'react';
import { type Rgb, type StagePalette, startHeldBreath } from './heldBreath.ts';
import { drawSigil } from './sigil.ts';

/** The stage is always night: the drift and held light read best on near-black, in either theme. */
export const STAGE: StagePalette = {
  bg: [7, 8, 12],
  drift: [138, 150, 255],
  cleared: [99, 209, 149],
  held: [255, 150, 120],
  seal: [196, 203, 255],
};

function parseColor(value: string): Rgb | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function cssColor(name: string, fallback: Rgb): Rgb {
  return parseColor(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? fallback;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Re-renders when the color scheme changes, so canvas art follows the theme. */
function useScheme(): string {
  const [scheme, setScheme] = useState(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setScheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return scheme;
}

export function HeldBreathCanvas({ seed, chamber, className }: { seed: string; chamber?: { x: number; y: number; r: number }; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startHeldBreath(ref.current, { seed, palette: STAGE, ...(chamber ? { chamber } : {}), still: prefersReducedMotion() });
  }, [seed, chamber?.x, chamber?.y, chamber?.r]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

export type SigilVerdict = 'safe' | 'caution' | 'dangerous' | undefined;

const VERDICT_VAR: Record<string, string> = { safe: '--safe', caution: '--caution', dangerous: '--danger' };

export function Sigil({ seed, verdict, held = 0, size = 96, label, className }: { seed: string; verdict?: SigilVerdict; held?: number; size?: number; label?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scheme = useScheme();
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSigil(ctx, size, {
      seed,
      held,
      colors: {
        ink: cssColor('--text', [22, 23, 26]),
        faint: cssColor('--text-3', [111, 112, 118]),
        verdict: cssColor(verdict ? VERDICT_VAR[verdict]! : '--accent', [63, 79, 208]),
        held: cssColor('--danger', [179, 38, 30]),
      },
    });
  }, [seed, verdict, held, size, scheme]);
  return (
    <canvas
      ref={ref}
      className={className ? `sigil ${className}` : 'sigil'}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `Sigil drawn from ${seed.slice(0, 12)}…: the same seed always draws the same sigil`}
    />
  );
}
