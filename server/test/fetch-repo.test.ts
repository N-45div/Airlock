import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchError, parseRepoUrl } from '../fetch-repo.ts';

test('reads the repository from the shapes people paste', () => {
  for (const input of [
    'https://github.com/expressjs/express',
    'github.com/expressjs/express',
    'https://www.github.com/expressjs/express.git',
    'https://github.com/expressjs/express/tree/master/lib',
    '  https://github.com/expressjs/express/blob/master/Readme.md  ',
  ]) {
    const repo = parseRepoUrl(input);
    assert.equal(repo.owner, 'expressjs', input);
    assert.equal(repo.name, 'express', input);
    assert.equal(repo.url, 'https://github.com/expressjs/express', input);
  }
});

test('refuses anything that is not a GitHub repository', () => {
  for (const input of [
    'https://gitlab.com/a/b',
    'https://github.com/expressjs',
    'https://github.com/',
    'https://github.com.evil.example/a/b',
    'https://github.com/a/..',
    'https://github.com/a b/c',
    'not a link at all ://',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => parseRepoUrl(input), FetchError, input);
  }
});
