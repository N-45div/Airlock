// Samples whose files contain text written to steer AI reviewers are kept packed, not as
// readable files in the repository: anyone (or any AI agent) browsing the tree never meets
// that text in the clear, and scans, tests and the benchmark unpack a sample into a temporary
// folder when they need it. The pack is gzipped JSON: { "<sample id>": { "<path>": base64 } }.
//   node server/sample-pack.ts list
//   node server/sample-pack.ts unpack <id> <folder>        to read or edit a sample
//   node server/sample-pack.ts pack <id>=<folder> [...]    to add or replace samples

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACK = path.join(here, '..', 'samples', 'packed', 'ai-steering.pack');

type Pack = Record<string, Record<string, string>>;

export async function readPack(file = PACK): Promise<Pack> {
  return JSON.parse(gunzipSync(await readFile(file)).toString('utf8')) as Pack;
}

export async function packedSampleIds(file = PACK): Promise<string[]> {
  return Object.keys(await readPack(file)).sort();
}

/** Writes one packed sample's files into `dest` (created; must not exist or be empty). */
export async function unpackSample(id: string, dest: string, file = PACK): Promise<void> {
  const files = (await readPack(file))[id];
  if (!files) throw new Error(`No packed sample called ${id}.`);
  for (const [rel, b64] of Object.entries(files)) {
    const target = path.resolve(dest, rel);
    if (path.relative(dest, target).startsWith('..')) throw new Error(`Packed path ${rel} leaves the sample folder.`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(b64, 'base64'));
  }
}

const unpacked = new Map<string, Promise<string>>();

/** A folder holding the packed sample, unpacked once per process into the temp directory. */
export function packedSampleDir(id: string, file = PACK): Promise<string> {
  let dir = unpacked.get(id);
  if (!dir) {
    dir = (async () => {
      const digest = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 12);
      const target = path.join(os.tmpdir(), 'airlock-samples', `${id}-${digest}`);
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      await unpackSample(id, target, file);
      return target;
    })();
    unpacked.set(id, dir);
  }
  return dir;
}

async function readFolder(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out[path.relative(dir, full).split(path.sep).join('/')] = (await readFile(full)).toString('base64');
    }
  };
  await walk(dir);
  return out;
}

/** Adds or replaces samples in the pack. Output is deterministic for the same files. */
export async function packSamples(entries: Record<string, string>, file = PACK): Promise<void> {
  const pack: Pack = await stat(file).then(() => readPack(file), () => ({}));
  for (const [id, dir] of Object.entries(entries)) pack[id] = await readFolder(dir);
  const sorted = Object.fromEntries(Object.keys(pack).sort().map((k) => [k, pack[k]!]));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 }));
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const id of await packedSampleIds()) console.log(id);
  } else if (cmd === 'unpack' && rest.length === 2) {
    await unpackSample(rest[0]!, path.resolve(rest[1]!));
    console.log(`unpacked ${rest[0]} into ${rest[1]}`);
  } else if (cmd === 'pack' && rest.length > 0) {
    await packSamples(Object.fromEntries(rest.map((r) => r.split('=') as [string, string])));
    console.log(`packed ${rest.map((r) => r.split('=')[0]).join(', ')} into ${path.relative(process.cwd(), PACK)}`);
  } else {
    console.error('usage: node server/sample-pack.ts list | unpack <id> <folder> | pack <id>=<folder> ...');
    process.exit(2);
  }
}
