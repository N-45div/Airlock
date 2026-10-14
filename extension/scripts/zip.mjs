// Packs the runtime files into extension/<name>-extension.zip for the Chrome
// Web Store. No dependencies: a minimal ZIP writer on node:zlib.
// Run: node extension/scripts/zip.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { PRODUCT_NAME } from '../config.js';
import { EXTENSION_DIR, readManifest, referencedFiles, runtimeFiles } from './files.mjs';

/** Every entry gets the same timestamp (2026-01-01 00:00), so the same files
 * always make the same zip. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;

/** entries: [{ name: 'dir/file.js', data: Buffer }] -> the bytes of a .zip */
export function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0; // deflate, or store when it doesn't help (PNGs)
    const body = method === 8 ? deflated : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    parts.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    // extra length, comment length, disk number, internal and external attributes: all 0
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export function zipName() {
  return `${PRODUCT_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-extension.zip`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = runtimeFiles();
  const missing = referencedFiles(readManifest()).filter((file) => !files.includes(file));
  if (missing.length) {
    console.error(`manifest.json points at files that would not be packed: ${missing.join(', ')}`);
    process.exit(1);
  }
  const zip = buildZip(files.map((name) => ({ name, data: readFileSync(path.join(EXTENSION_DIR, name)) })));
  const out = path.join(EXTENSION_DIR, zipName());
  writeFileSync(out, zip);
  console.log(`wrote extension/${zipName()}: ${files.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
  for (const file of files) console.log(`  ${file}`);
}
