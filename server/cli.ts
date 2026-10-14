// Scan one repository from the terminal and print what happened:
//   npm run scan -- https://github.com/owner/name
//   npm run scan -- take-home
// Approvals are answered from AIRLOCK_CLI_APPROVE (yes|no, default no).

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchRepo, fetchSample, parseRepoUrl } from './fetch-repo.ts';
import { takeInventory } from './inventory.ts';
import { review } from './review.ts';
import { SAMPLES, sampleRepo } from './samples.ts';

const input = process.argv[2];
if (!input) {
  console.error('usage: npm run scan -- <github url | sample id>');
  process.exit(2);
}
const sample = SAMPLES.find((s) => s.id === input);
const work = await mkdtemp(path.join(os.tmpdir(), 'airlock-cli-'));
const dir = path.join(work, 'repo');
try {
  const repo = sample?.dir
    ? await fetchSample(sampleRepo(sample), sample.dir, dir)
    : await fetchRepo(sample ? sampleRepo(sample) : parseRepoUrl(input), dir);
  const inventory = await takeInventory(dir);
  console.log(`${repo.url} @ ${repo.commit}: ${repo.files} files, ${inventory.findings.length} static findings`);
  const result = await review({
    dir,
    fenceTest: process.env.AIRLOCK_FENCE_TEST === '1',
    repo,
    inventory,
    hooks: {
      onTool: (e) => console.log(`  ${e.decision.padEnd(8)} ${e.by.padEnd(7)} ${e.tool} ${e.summary}${e.reason ? `  (${e.reason})` : ''}`),
      onThought: (t) => console.log(`  … ${t.split('\n')[0]}`),
      askPerson: async (q) => {
        const yes = process.env.AIRLOCK_CLI_APPROVE === 'yes';
        console.log(`  ASKED   ${q.tool} ${q.summary} -> ${yes ? 'yes' : 'no'}`);
        return yes;
      },
    },
  });
  console.log(`\n${result.verdict.toUpperCase()}: ${result.headline}\n${result.summary}`);
  for (const f of [...inventory.findings, ...result.findings]) {
    console.log(`- [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`);
  }
  console.log(`cost $${result.costUsd.toFixed(3)}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
