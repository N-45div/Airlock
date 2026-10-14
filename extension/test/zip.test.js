import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { EXTENSION_DIR, readManifest, referencedFiles, runtimeFiles } from '../scripts/files.mjs';
import { buildZip, zipName } from '../scripts/zip.mjs';

/** Reads a zip back through its central directory, the way unzip tools do. */
function readZip(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, 'end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, 'central header');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50, `local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, `crc for ${name}`);
    entries.set(name, data);
    at += 46 + nameLength;
  }
  return entries;
}

describe('zip', () => {
  const files = runtimeFiles();
  const zip = buildZip(files.map((name) => ({ name, data: readFileSync(path.join(EXTENSION_DIR, name)) })));
  const entries = readZip(zip);

  it('round-trips every runtime file byte for byte', () => {
    assert.deepEqual([...entries.keys()], files);
    for (const name of files) assert.ok(entries.get(name).equals(readFileSync(path.join(EXTENSION_DIR, name))), name);
  });

  it('puts manifest.json at the root and everything it points at inside', () => {
    assert.ok(entries.has('manifest.json'));
    for (const file of referencedFiles(readManifest())) assert.ok(entries.has(file), file);
  });

  it('leaves out tests, scripts, docs and package files', () => {
    for (const name of entries.keys()) {
      assert.doesNotMatch(name, /^(?:test|scripts)\/|\.md$|\.zip$|^package\.json$|^\./, name);
    }
  });

  it('is the same bytes every time', () => {
    const again = buildZip(files.map((name) => ({ name, data: readFileSync(path.join(EXTENSION_DIR, name)) })));
    assert.ok(again.equals(zip));
  });

  it('is named after the product', () => {
    assert.equal(zipName(), `${readManifest().name.toLowerCase()}-extension.zip`);
  });
});
