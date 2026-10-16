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

test('the backstop passes reads inside the repo and its own tools, asks for fetches, refuses the rest', async () => {
  const { backstop } = await import('../review.ts');
  const root = await mkdtemp(path.join(os.tmpdir(), 'airlock-bs-'));
  const cases: [string, Record<string, unknown>, 'pass' | 'ask' | 'deny'][] = [
    ['Read', { file_path: 'package.json' }, 'pass'],
    ['Grep', { pattern: 'x' }, 'pass'],
    ['Read', { file_path: '../secrets' }, 'deny'],
    ['mcp__airlock__search_meaning', { query: 'send files' }, 'pass'],
    ['mcp__plugin_armorclaude_armorclaude-policy__register_intent_plan', {}, 'pass'],
    ['mcp__plugin_armorclaude_armorclaude-policy__policy_update', {}, 'deny'],
    ['StructuredOutput', {}, 'pass'],
    ['ToolSearch', { query: 'select:WebFetch' }, 'pass'],
    ['WebFetch', { url: 'https://example.com' }, 'ask'],
    ['Bash', { command: 'echo hi' }, 'deny'],
    ['PowerShell', { command: 'echo hi' }, 'deny'],
    ['Write', { file_path: 'x' }, 'deny'],
    ['Task', {}, 'deny'],
    ['WebSearch', { query: 'x' }, 'deny'],
  ];
  for (const [tool, input, expected] of cases) {
    const decision = await backstop(tool, input, root);
    assert.equal('pass' in decision ? 'pass' : 'ask' in decision ? 'ask' : 'deny', expected, tool);
  }
});

test('reads a hook answer only when it is a PreToolUse decision', async () => {
  const { hookDecision } = await import('../review.ts');
  assert.deepEqual(
    hookDecision('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"ArmorClaude policy denied Bash"}}'),
    { decision: 'deny', reason: 'ArmorClaude policy denied Bash' },
  );
  assert.equal(hookDecision(''), null);
  assert.equal(hookDecision('not json'), null);
  assert.equal(hookDecision('{"hookSpecificOutput":{"additionalContext":"hi"}}'), null);
});

test('shell summaries show the repository as .', () => {
  const root = path.resolve('/work/repo');
  assert.equal(summarize('Bash', { command: `cd "${root}" && cat package.json` }, root), 'cd "." && cat package.json');
  const forward = root.split(path.sep).join('/');
  assert.equal(summarize('Bash', { command: `cd "${forward}" && ls` }, root), 'cd "." && ls');
});

test('names the Policy Studio rule that decided', async () => {
  const { policyReason } = await import('../review.ts');
  assert.equal(policyReason('ArmorClaude policy forbid: tool_editor_5', 'Bash'), 'Policy Studio rule tool_editor_5: Bash → Block');
  assert.equal(policyReason('ArmorClaude policy requires approval: tool_editor_4', 'WebFetch'), 'Policy Studio rule tool_editor_4: WebFetch → Hold');
  assert.equal(policyReason('something else', 'Read'), 'something else');
});

test('an intent plan is summarized by its goal, whatever shape it arrives in', () => {
  const root = path.resolve('/work/repo');
  const tool = 'mcp__plugin_armorclaude_armorclaude-policy__register_intent_plan';
  assert.equal(summarize(tool, { goal: 'Review the repo', steps: [] }, root), 'Plan: Review the repo');
  assert.equal(summarize(tool, { plan: { goal: 'Review it' } }, root), 'Plan: Review it');
  assert.equal(summarize(tool, { plan: JSON.stringify({ goal: 'As text' }) }, root), 'Plan: As text');
  assert.equal(summarize('mcp__airlock__search_meaning', { query: 'send data out' }, root), '"send data out"');
});
