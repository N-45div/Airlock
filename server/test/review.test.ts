import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { staysInside, summarize } from '../review.ts';

test('reads stay inside the repository, whatever shape the path takes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'airlock-rev-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'a.js'), '');
  const inside = [
    ['Read', { file_path: 'src/a.js' }],
    ['Read', { file_path: path.join(root, 'src', 'a.js') }],
    ['Grep', { pattern: 'x', path: 'src' }],
    ['Grep', { pattern: 'x' }],
    ['Glob', { pattern: '**/*.js', path: root }],
  ] as const;
  for (const [tool, input] of inside) assert.equal(await staysInside(tool, { ...input }, root), true, JSON.stringify(input));
  const outside = [
    ['Read', { file_path: '../../etc/passwd' }],
    ['Read', { file_path: os.homedir() }],
    ['Read', { file_path: '/proc/self/environ' }],
    ['Read', {}],
    ['Grep', { pattern: 'x', path: '..' }],
    ['Glob', { pattern: '*', path: path.dirname(root) }],
    ['Read', { file_path: 42 }],
  ] as const;
  for (const [tool, input] of outside) assert.equal(await staysInside(tool, { ...input }, root), false, JSON.stringify(input));
});

test('summaries name what a call touches, relative to the repository', () => {
  const root = path.resolve('/work/repo');
  assert.equal(summarize('Read', { file_path: path.join(root, 'package.json') }, root), 'package.json');
  assert.equal(summarize('Grep', { pattern: 'fetch(', path: 'src' }, root), '"fetch(" in src');
  assert.equal(summarize('Bash', { command: 'npm install' }, root), 'npm install');
  assert.equal(summarize('WebFetch', { url: 'https://example.com/a.sh' }, root), 'https://example.com/a.sh');
  assert.ok(summarize('mcp__airlock__search_meaning', { query: 'x'.repeat(400) }, root).endsWith('…'));
});
