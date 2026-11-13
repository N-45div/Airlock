// The repositories offered on the home page, so anyone can see a scan in one click.

import { WALLET_PACK, packedSampleDir } from './sample-pack.ts';
import type { RepoInfo, Sample } from './types.ts';

interface SampleDef extends Sample {
  /** Set for samples that ship inside Airlock instead of living on GitHub: the id of a sample
   * in samples/packed/ai-steering.pack (see server/sample-pack.ts). */
  pack?: string;
  /** The pack file, when it isn't ai-steering.pack: wallet stealers live in wallet-stealers.pack. */
  packFile?: string;
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'hidden-loader',
    title: 'A take-home that steals wallets',
    blurb: 'Its install script hides wallet paths and its server in base64. Airlock runs it against decoy wallets and shows the request that carries them out. Harmless: it can only send to a host that doesn’t exist.',
    url: 'sample:hidden-loader',
    pack: 'hidden-loader',
    packFile: WALLET_PACK,
  },
  {
    id: 'slugify',
    title: 'A small, well-known library',
    blurb: 'sindresorhus/slugify. Nothing runs on install. What a clean result looks like.',
    url: 'https://github.com/sindresorhus/slugify',
  },
  {
    id: 'bcrypt',
    title: 'A library that builds on install',
    blurb: 'kelektiv/node.bcrypt.js. Runs a native build step when installed, the ordinary kind. Airlock should say so and explain it.',
    url: 'https://github.com/kelektiv/node.bcrypt.js',
  },
  {
    id: 'take-home',
    title: 'A take-home task with notes for AI',
    blurb: 'Shaped like a job-interview task: notes planted to steer an AI reviewer, and a setup script that downloads more code. Watch the fence hold.',
    url: 'sample:take-home',
    pack: 'take-home',
  },
];

export function sampleRepo(sample: SampleDef): RepoInfo {
  if (sample.url.startsWith('https://github.com/')) {
    const [owner = '', name = ''] = sample.url.slice('https://github.com/'.length).split('/');
    return { url: sample.url, host: 'github', owner, name };
  }
  return { url: sample.url, host: 'sample', owner: 'airlock', name: sample.id };
}

/** The folder to copy a sample from, for samples that ship inside Airlock; undefined for GitHub ones. */
export async function sampleSource(sample: SampleDef | undefined): Promise<string | undefined> {
  return sample?.pack ? packedSampleDir(sample.pack, sample.packFile) : undefined;
}

export function publicSamples(): Sample[] {
  return SAMPLES.map(({ id, title, blurb, url }) => ({ id, title, blurb, url }));
}
