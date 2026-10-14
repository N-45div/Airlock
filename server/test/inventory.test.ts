import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { takeInventory } from '../inventory.ts';

async function repo(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airlock-inv-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  return root;
}

test('lists commands that run on install, on folder open and in dev containers', async () => {
  const root = await repo({
    'package.json': JSON.stringify({ scripts: { postinstall: 'node scripts/setup.js', test: 'node --test' } }),
    '.vscode/tasks.json': '{ // tasks\n "tasks": [{ "label": "dev", "command": "echo hi", "runOptions": { "runOn": "folderOpen" } }] }',
    '.devcontainer/devcontainer.json': '{ "initializeCommand": "echo host" }',
    'setup.py': 'from setuptools import setup\nsetup()',
  });
  const inv = await takeInventory(root);
  assert.deepEqual(
    inv.autoRuns.map((r) => r.trigger),
    [
      'opening in a dev container (initializeCommand)',
      'opening the folder in VS Code',
      'npm install (postinstall)',
      'pip install',
    ],
  );
  const titles = inv.findings.map((f) => `${f.severity}:${f.category}`);
  assert.ok(titles.includes('high:runs-on-open'));
  assert.ok(titles.includes('medium:runs-on-install'));
  assert.ok(!inv.findings.some((f) => f.snippet?.includes('node --test')), 'ordinary scripts are not findings');
});

test('notices shipped programs and code packed onto one line, but not minified builds', async () => {
  const root = await repo({
    'bin/tool': Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]),
    'src/config.js': `module.exports = {};\nconst x = ${JSON.stringify('a'.repeat(5000))};\n`,
    'dist/bundle.js': `var y = ${JSON.stringify('b'.repeat(5000))};`,
    'README.md': 'hello',
  });
  const inv = await takeInventory(root);
  const byFile = Object.fromEntries(inv.findings.map((f) => [f.file, f]));
  assert.equal(byFile['bin/tool']?.category, 'binary');
  assert.equal(byFile['src/config.js']?.category, 'obfuscation');
  assert.equal(byFile['src/config.js']?.line, 2);
  assert.equal(byFile['dist/bundle.js'], undefined);
  assert.equal(inv.files.length, 4);
});

test('a clean project has no findings', async () => {
  const root = await repo({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }), 'index.js': 'export {}' });
  assert.deepEqual((await takeInventory(root)).findings, []);
});
