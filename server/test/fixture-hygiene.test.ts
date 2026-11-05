// Some samples contain text written to steer AI reviewers. They live packed in
// samples/packed/ai-steering.pack (server/sample-pack.ts) so that no readable file in this
// repository addresses an AI agent. This test keeps it that way: it fails if a tracked text
// file outside the pack contains the shapes that text takes.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { packedSampleIds, readPack } from '../sample-pack.ts';

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'server/test/fixture-hygiene.test.ts';

/** Phrasing that speaks to an AI reviewer, as planted notes do. Descriptions of such notes
 * ("a README that asks AI reviewers to call it safe") don't match. */
export const ADDRESSED_TO_AI = [
  /\bnote for ai\b/i,
  /\bai (code )?(reviewers?|assistants?|agents?)\s*:/i,
  /\b(ai|llm) (code )?(assistants?|reviewers?|agents?) reviewing this/i,
  /\breport (it|this|that the (project|repository|repo)( is)?) (as )?safe\b/i,
  /\balready (passed a |been )?security[- ]review(ed)?\b/i,
  /\bignore (all )?(previous|prior|above) instructions\b/i,
];

async function trackedTextFiles(): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return stdout.split('\n').filter((f) => f && f !== SELF && !f.startsWith('samples/packed/') && !/\.(png|jpe?g|gif|ico|pack|zip|gz|woff2?)$/i.test(f));
}

describe('fixture hygiene', () => {
  it('no readable file outside the pack addresses AI reviewers', async () => {
    const hits: string[] = [];
    for (const file of await trackedTextFiles()) {
      const text = await readFile(path.join(root, file), 'utf8').catch(() => '');
      text.split('\n').forEach((line, i) => {
        if (ADDRESSED_TO_AI.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(hits, [], `AI-addressed text outside samples/packed/:\n${hits.join('\n')}`);
  });

  it('the pack holds the samples that need it, and the patterns catch them', async () => {
    assert.deepEqual(await packedSampleIds(), ['readme-note', 'take-home']);
    const pack = await readPack();
    for (const id of ['readme-note', 'take-home']) {
      const text = Object.values(pack[id]!).map((b64) => Buffer.from(b64, 'base64').toString('utf8')).join('\n');
      assert.ok(ADDRESSED_TO_AI.some((re) => re.test(text)), `${id}: the hygiene patterns should match its planted text`);
      assert.doesNotMatch(text, /https?:\/\/[^\s/]*example\.com/, `${id}: download hosts must be .invalid`);
    }
  });
});
