// Draws the toolbar and store icons: a rounded square with a closed
// two-panel airlock door and a small status light. Uses only node:zlib, so
// it runs anywhere Node does. Run: node extension/scripts/make-icons.mjs

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const COLORS = {
  body: [21, 72, 112], // deep blue
  door: [232, 240, 247], // off-white panels
  light: [242, 169, 59], // amber status light
};

/** Pixel geometry per size. Small sizes are snapped to whole pixels by hand
 * so the gap between the door panels stays crisp. */
const LAYOUTS = {
  16: { margin: 0, radius: 3.5, doors: [[3, 3, 7, 13], [9, 3, 13, 13]], doorRadius: 1, light: null },
  32: { margin: 1, radius: 7, doors: [[7, 8, 15, 26], [17, 8, 25, 26]], doorRadius: 2, light: [16, 5, 1.6] },
  48: { margin: 3, radius: 10, doors: [[13, 15, 23, 38], [25, 15, 35, 38]], doorRadius: 2.5, light: [24, 10, 2.2] },
  128: { margin: 16, radius: 22, doors: [[37, 41, 61, 98], [67, 41, 91, 98]], doorRadius: 5, light: [64, 29, 5] },
};

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}

/** Returns RGBA bytes for one icon, anti-aliased with 8x8 samples per pixel. */
export function renderIcon(size) {
  const layout = LAYOUTS[size];
  if (!layout) throw new Error(`No layout for ${size}px`);
  const { margin, radius, doors, doorRadius, light } = layout;
  const samples = 8;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          let color = null;
          if (inRoundedRect(x, y, margin, margin, size - margin, size - margin, radius)) {
            color = COLORS.body;
            if (doors.some(([x0, y0, x1, y1]) => inRoundedRect(x, y, x0, y0, x1, y1, doorRadius))) {
              color = COLORS.door;
            } else if (light && (x - light[0]) ** 2 + (y - light[1]) ** 2 <= light[2] ** 2) {
              color = COLORS.light;
            }
          }
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((a / (samples * samples)) * 255);
      }
    }
  }
  return rgba;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes straight-alpha RGBA bytes as a PNG (colour type 6, 8 bits). */
export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const SIZES = Object.keys(LAYOUTS).map(Number);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const size of SIZES) {
    const file = new URL(`../icons/icon-${size}.png`, import.meta.url);
    writeFileSync(file, encodePng(size, renderIcon(size)));
    console.log(`wrote icons/icon-${size}.png`);
  }
}
