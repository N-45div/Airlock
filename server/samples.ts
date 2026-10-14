// The repositories offered on the home page, so anyone can see a scan in one click.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepoInfo, Sample } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

interface SampleDef extends Sample {
  /** Set for samples that ship inside Airlock instead of living on GitHub. */
  dir: string;
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'slugify',
    title: 'A small, well-known library',
    blurb: 'sindresorhus/slugify. Nothing runs on install. What a clean result looks like.',
    url: 'https://github.com/sindresorhus/slugify',
    dir: '',
  },
  {
    id: 'bcrypt',
    title: 'A library that builds on install',
    blurb: 'kelektiv/node.bcrypt.js. Runs a native build step when installed, the ordinary kind. Airlock should say so and explain it.',
    url: 'https://github.com/kelektiv/node.bcrypt.js',
    dir: '',
  },
  {
    id: 'take-home',
    title: 'A take-home task with notes for AI',
    blurb: 'A small app shaped like a job-interview task, with text planted to steer an AI reviewer. Watch the fence hold.',
    url: 'sample:take-home',
    dir: path.join(here, '..', 'samples', 'take-home'),
  },
];

export function sampleRepo(sample: SampleDef): RepoInfo {
  if (sample.url.startsWith('https://github.com/')) {
    const [owner = '', name = ''] = sample.url.slice('https://github.com/'.length).split('/');
    return { url: sample.url, host: 'github', owner, name };
  }
  return { url: sample.url, host: 'sample', owner: 'airlock', name: sample.id };
}

export function publicSamples(): Sample[] {
  return SAMPLES.map(({ id, title, blurb, url }) => ({ id, title, blurb, url }));
}
