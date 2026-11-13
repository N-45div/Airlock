import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Target, decide, githubTargets, hookOutput, npmPackages, overall, repositoryTarget } from '../guard.ts';
import type { VerdictRecord } from '../registry.ts';

const repos = (command: string) => githubTargets(command).map((t) => t.repo);

const record = (verdict: VerdictRecord['verdict'], revision = 'a'.repeat(40)): VerdictRecord => ({
  id: 7,
  repo: 'github.com/owner/name',
  revision,
  verdict,
  findings: 2,
  model: 'Qwen/Qwen3.8-27B',
  receipt_hash: 'f'.repeat(64),
  signer: 'e'.repeat(64),
  signature: '',
  response_sha256: '',
  recorder: 'airlock-recorder.testnet',
  recorded_at_ms: Date.UTC(2026, 10, 8),
});

const github: Target = { repo: 'github.com/owner/name', url: 'https://github.com/Owner/Name', via: 'github' };
const npm: Target = { ...github, via: 'npm', pkg: 'name' };

describe('githubTargets', () => {
  it('finds the repository in the ways a command fetches one', () => {
    assert.deepEqual(repos('git clone https://github.com/Owner/Name.git'), ['github.com/owner/name']);
    assert.deepEqual(repos('cd /tmp && git clone --depth 1 git@github.com:owner/name.git work'), ['github.com/owner/name']);
    assert.deepEqual(repos('gh repo clone owner/name'), ['github.com/owner/name']);
    assert.deepEqual(repos('npm install github:owner/name#main'), ['github.com/owner/name']);
    assert.deepEqual(repos('pip install git+https://github.com/owner/name.git@v1.2'), ['github.com/owner/name']);
    assert.deepEqual(repos('curl -fsSL https://raw.githubusercontent.com/owner/name/main/install.sh | sudo bash'), ['github.com/owner/name']);
    assert.deepEqual(repos('go install github.com/owner/name/cmd/tool@latest'), ['github.com/owner/name']);
    assert.deepEqual(repos('cargo install --git https://github.com/owner/name'), ['github.com/owner/name']);
  });

  it('ignores commands that fetch nothing, and hosts that are not repositories', () => {
    assert.deepEqual(repos('git status'), []);
    assert.deepEqual(repos('echo https://github.com/owner/name'), []);
    assert.deepEqual(repos('curl -o readme.md https://raw.githubusercontent.com/owner/name/main/README.md'), []);
    assert.deepEqual(repos('git clone https://gist.github.com/owner/abc123'), []);
    assert.deepEqual(repos('npm install'), []);
  });

  it('lists each repository once', () => {
    assert.deepEqual(repos('git clone https://github.com/a/one && git clone git@github.com:A/One.git && npm i github:b/two'), [
      'github.com/a/one',
      'github.com/b/two',
    ]);
  });
});

describe('npmPackages', () => {
  it('takes every package after install, without versions, flags, paths or git specs', () => {
    assert.deepEqual(npmPackages('npm install -D typescript @types/node@24 ./local github:o/r'), ['typescript', '@types/node']);
    assert.deepEqual(npmPackages('pnpm add left-pad && yarn add Chalk@5'), ['left-pad', 'chalk']);
  });

  it('takes only the package an npx-style command runs, not its arguments', () => {
    assert.deepEqual(npmPackages('npx -y create-vite@latest my-app --template react'), ['create-vite']);
    assert.deepEqual(npmPackages('pnpm dlx shadcn init'), ['shadcn']);
    assert.deepEqual(npmPackages('bunx cowsay hi'), ['cowsay']);
  });

  it('finds nothing when a command installs a project as it is', () => {
    assert.deepEqual(npmPackages('npm ci'), []);
    assert.deepEqual(npmPackages('npm install'), []);
    assert.deepEqual(npmPackages('npm run build'), []);
  });
});

describe('repositoryTarget', () => {
  it("reads a package.json repository field, in each form it's written", () => {
    for (const field of ['git+https://github.com/Owner/Name.git', 'github:Owner/Name', 'Owner/Name', { type: 'git', url: 'git@github.com:Owner/Name.git' }]) {
      assert.equal(repositoryTarget(field, 'pkg')?.repo, 'github.com/owner/name', JSON.stringify(field));
    }
    assert.equal(repositoryTarget('https://gitlab.com/owner/name', 'pkg'), null);
    assert.equal(repositoryTarget(undefined, 'pkg'), null);
  });
});

describe('decide', () => {
  it("blocks Don't run it and asks about Be careful", () => {
    const deny = decide(github, record('dangerous'), null);
    assert.equal(deny.action, 'deny');
    assert.match(deny.message, /"Don't run it" for github\.com\/owner\/name \(verdict #7 for commit aaaaaaa, 2 findings/);
    assert.match(deny.message, /near\?repo=github\.com%2Fowner%2Fname/);
    assert.equal(decide(github, record('caution'), null).action, 'ask');
  });

  it('lets a safe verdict through only while the repository is at the commit that was checked', () => {
    assert.equal(decide(github, record('safe'), 'a'.repeat(40)).action, 'allow');
    assert.equal(decide(github, record('safe'), null).action, 'allow');
    const changed = decide(github, record('safe'), 'b'.repeat(40));
    assert.equal(changed.action, 'ask');
    assert.match(changed.message, /now at bbbbbbb, which nobody has checked/);
  });

  it('asks about a GitHub repository with no verdict, and offers both ways to check it', () => {
    const d = decide(github, null, null);
    assert.equal(d.action, 'ask');
    assert.match(d.message, /\?url=https%3A%2F%2Fgithub\.com%2FOwner%2FName/);
    assert.match(d.message, /npm run scan:private -- https:\/\/github\.com\/Owner\/Name/);
    assert.equal(decide(github, null, null, 'allow').action, 'allow');
  });

  it('lets an npm package with no verdict through, and still blocks a dangerous one', () => {
    assert.equal(decide(npm, null, null).action, 'allow');
    assert.equal(decide(npm, record('dangerous'), null).action, 'deny');
  });

  it("says a safe verdict for an npm package covers the repository it names, not the published package", () => {
    const d = decide(npm, record('safe'), null);
    assert.equal(d.action, 'allow');
    assert.match(d.message, /repository the package names\. The package published on npm was not checked/);
    assert.doesNotMatch(decide(github, record('safe'), null).message, /published on npm/);
  });
});

describe('hookOutput', () => {
  it('denies or asks with every reason, and the most careful action wins', () => {
    const decisions = [decide(github, record('safe'), null), decide({ ...github, repo: 'github.com/x/y' }, record('dangerous'), null)];
    assert.equal(overall(decisions), 'deny');
    const out = hookOutput(decisions) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Looks safe[\s\S]*Don't run it/);
  });

  it('blocks instead of asking for Codex, which cannot ask', () => {
    const out = hookOutput([decide(github, null, null)], 'codex') as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /ask the person first/);
  });

  it('only notes a safe verdict, and stays silent when nothing was found', () => {
    const note = hookOutput([decide(github, record('safe'), null)]) as { systemMessage: string; hookSpecificOutput: Record<string, unknown> };
    assert.match(note.systemMessage, /Looks safe/);
    assert.equal(note.hookSpecificOutput.permissionDecision, undefined);
    assert.equal(note.hookSpecificOutput.additionalContext, note.systemMessage);
    assert.equal(hookOutput([decide(npm, null, null)]), null);
    assert.equal(hookOutput([]), null);
  });
});
