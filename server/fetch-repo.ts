// Gets a stranger's repository onto disk without running any of it.
//
// A clone is shallow, has no submodules, no LFS, no tags and no symlinks
// (core.symlinks=false writes a link as a small text file holding its target,
// so a planted link can't point the reviewing agent at files outside the repo).

import { execFile } from 'node:child_process';
import { cp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RepoInfo } from './types.ts';

const run = promisify(execFile);

export const LIMITS = {
  /** GitHub reports the packed size of the whole history in KB. A shallow clone
   * downloads far less, so this only turns away the very largest; the working
   * tree is capped below. */
  maxRepoKb: 1024 * 1024,
  maxFiles: 15_000,
  maxBytes: 200 * 1024 * 1024,
  cloneTimeoutMs: 90_000,
};

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export class FetchError extends Error {}

/** Accepts github.com/owner/repo in the shapes people paste: with or without
 * https://, a trailing .git, or a deeper /tree/... or /blob/... path. */
export function parseRepoUrl(input: string): RepoInfo {
  let text = input.trim();
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FetchError('That is not a link. Paste a GitHub repository address.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') {
    throw new FetchError('Airlock reads GitHub repositories for now. Paste a github.com link.');
  }
  const [owner, rawName] = url.pathname.split('/').filter(Boolean);
  const name = rawName?.replace(/\.git$/, '');
  if (!owner || !name || !NAME.test(owner) || !NAME.test(name) || name === '.' || name === '..') {
    throw new FetchError('That link does not name a repository (github.com/owner/name).');
  }
  return { url: `https://github.com/${owner}/${name}`, host: 'github', owner, name };
}

interface GitHubRepo {
  size: number;
  private: boolean;
  default_branch: string;
}

/** Asks GitHub whether the repo exists, is public and isn't enormous, so those
 * answers come in a second. When GitHub's API is rate-limiting us, the clone
 * itself is the check (it fails for private and missing repos too). */
async function checkWithGitHub(repo: RepoInfo): Promise<GitHubRepo | null> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'airlock-scanner',
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new FetchError('GitHub says that repository does not exist or is private.');
  if (res.status === 403 || res.status === 429) return null;
  if (!res.ok) throw new FetchError(`GitHub answered ${res.status} for that repository.`);
  const body = (await res.json()) as GitHubRepo;
  if (body.private) throw new FetchError('That repository is private. Airlock reads public repositories.');
  if (body.size > LIMITS.maxRepoKb) {
    throw new FetchError(
      `That repository is ${Math.round(body.size / 1024)} MB; Airlock reads up to ${Math.round(LIMITS.maxRepoKb / 1024)} MB.`,
    );
  }
  return body;
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ASKPASS: 'echo',
};

const GIT_SAFE = [
  '-c', 'core.symlinks=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'protocol.file.allow=never',
  '-c', 'submodule.recurse=false',
  '-c', 'filter.lfs.smudge=',
  '-c', 'filter.lfs.process=',
  '-c', 'filter.lfs.required=false',
];

/** Clones `repo` into `dest` and fills in commit, file count and size. */
export async function fetchRepo(repo: RepoInfo, dest: string): Promise<RepoInfo> {
  await checkWithGitHub(repo);
  try {
    await run(
      'git',
      [...GIT_SAFE, 'clone', '--depth', '1', '--single-branch', '--no-tags', '--no-recurse-submodules', '--quiet', `${repo.url}.git`, dest],
      { env: GIT_ENV, timeout: LIMITS.cloneTimeoutMs, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    const killed = (error as { killed?: boolean }).killed;
    throw new FetchError(killed ? 'Downloading that repository took too long.' : 'Could not download that repository. Check that it exists and is public.');
  }
  const { stdout } = await run('git', ['-C', dest, 'rev-parse', 'HEAD'], { env: GIT_ENV });
  // The reviewer reads the working tree only; git's own files are noise.
  await rm(path.join(dest, '.git'), { recursive: true, force: true });
  const { files, bytes } = await measure(dest);
  return { ...repo, commit: stdout.trim(), files, bytes };
}

/** Copies one of Airlock's own sample folders, standing in for a clone. */
export async function fetchSample(repo: RepoInfo, from: string, dest: string): Promise<RepoInfo> {
  await cp(from, dest, { recursive: true, verbatimSymlinks: true });
  const { files, bytes } = await measure(dest);
  return { ...repo, commit: 'sample', files, bytes };
}

async function measure(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(full)).size;
        if (files > LIMITS.maxFiles) throw new FetchError(`That repository has more than ${LIMITS.maxFiles} files.`);
        if (bytes > LIMITS.maxBytes) throw new FetchError('That repository is too large to read.');
      }
    }
  };
  await walk(root);
  return { files, bytes };
}
