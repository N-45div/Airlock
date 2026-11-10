// Seeded 3D simplex noise (after Stefan Gustavson's public-domain implementation), and the
// curl of layered noise: a divergence-free field, so drift folds and never piles up or tears.

const GRAD3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const F3 = 1 / 3;
const G3 = 1 / 6;

export type Noise3 = (x: number, y: number, z: number) => number;

export function createNoise3(random: () => number): Noise3 {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    permMod12[i] = perm[i]! % 12;
  }

  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const corner = (gi: number, x: number, y: number, z: number) => {
      let tt = 0.6 - x * x - y * y - z * z;
      if (tt < 0) return 0;
      tt *= tt;
      const g = gi * 3;
      return tt * tt * (GRAD3[g]! * x + GRAD3[g + 1]! * y + GRAD3[g + 2]! * z);
    };
    const n0 = corner(permMod12[ii + perm[jj + perm[kk]!]!]!, x0, y0, z0);
    const n1 = corner(permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]!, x1, y1, z1);
    const n2 = corner(permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]!, x2, y2, z2);
    const n3 = corner(permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]!, x3, y3, z3);
    return 32 * (n0 + n1 + n2 + n3);
  };
}

/** Three octaves, with ratios tuned so the flow reads as weather: broad sheets, eddies within. */
export function fbm(noise: Noise3, x: number, y: number, z: number): number {
  return noise(x, y, z) + 0.5 * noise(x * 2.03 + 17.1, y * 2.03 - 9.4, z * 1.37) + 0.25 * noise(x * 4.11 - 31.7, y * 4.11 + 5.3, z * 1.91);
}

/** The curl of the noise potential at (x, y): a velocity with no divergence. */
export function curl(noise: Noise3, x: number, y: number, z: number, out: { x: number; y: number }): void {
  const e = 0.0007;
  const dpdy = (fbm(noise, x, y + e, z) - fbm(noise, x, y - e, z)) / (2 * e);
  const dpdx = (fbm(noise, x + e, y, z) - fbm(noise, x - e, y, z)) / (2 * e);
  out.x = dpdy;
  out.y = -dpdx;
}

/**
 * The radius of the closed Edwards curve x² + y² = 1 + d·x²·y² (d < 0) at angle θ: the family whose
 * twisted relative signs every Airlock verdict. d near 0 is a circle; very negative d squares it off.
 */
export function edwardsRadius(theta: number, d: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a = d * c * c * s * s;
  if (Math.abs(a) < 1e-9) return 1;
  return Math.sqrt((1 - Math.sqrt(1 - 4 * a)) / (2 * a));
}
