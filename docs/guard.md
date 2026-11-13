# The guard: coding agents check NEAR before they fetch code

Coding agents clone repositories, install packages and pipe install scripts into a shell on their
own. The guard is a hook that runs before each shell command the agent makes. When the command
would fetch a GitHub repository, it reads Airlock's verdict for that repository from NEAR and acts
on it. Source: [`server/guard.ts`](../server/guard.ts).

| Verdict on NEAR | What happens to the command |
| --- | --- |
| *Don't run it* | Blocked. The agent is told why and given the report's link. |
| *Be careful* | You are asked, with the verdict and the report's link. |
| *Looks safe*, for the commit the repository is at now | It runs as usual, with a note to you and the agent. |
| *Looks safe*, for an older commit | You are asked: the new commit hasn't been checked. |
| None, for a GitHub repository | You are asked, with links to check it on the site or privately on your machine. `AIRLOCK_GUARD_UNKNOWN=allow` lets these through. |
| None, for an npm package | It runs as usual. Most packages never get a verdict. |
| *Looks safe*, for an npm package's repository | It runs as usual, and the note says the verdict covers the repository the package names, not the package published on npm: a package names its own repository, and any package can name any repository. |

Reading a verdict is a free view call to public NEAR RPC: no key, no wallet, and nothing is sent to
Airlock. The guard trusts verdicts from `airlock-recorder.testnet`, the recorder whose key can only
call `record_verdict` (see [registry.md](registry.md)); `AIRLOCK_RECORDER` picks another.

## What it recognizes

- `git clone`, `gh repo clone`, and installs that name a GitHub repository: `npm`/`pnpm`/`yarn`/`bun`
  with `github:owner/name` or a GitHub URL, `pip install git+https://github.com/…`, `uv`, `pipx`,
  `cargo install --git`, `go install|run|get github.com/…`
- `curl` or `wget` from `github.com` or `raw.githubusercontent.com` piped into a shell or interpreter
- npm package names after `npm install`, `npx`, `pnpm add|dlx`, `yarn add|dlx`, `bun add`, `bunx`:
  each name is matched to its GitHub repository through the npm registry (up to five per command)

Anything else runs untouched, after about a third of a second of Node starting up.

## Set it up

Claude Code: print the settings, then paste them into `~/.claude/settings.json` (every project) or
a project's `.claude/settings.json`:

```sh
npm run guard -- --config
```

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node --no-warnings \"/path/to/Airlock/server/guard.ts\"", "timeout": 30 }] }
    ]
  }
}
```

OpenAI Codex: `npm run guard -- --config --codex` prints the same for `~/.codex/hooks.json`. Codex
hooks can block but can't ask yet, so with `--codex` every "you are asked" above blocks instead,
and the agent is told to ask you.

Try the rules without an agent; the exit code is 2 for blocked, 1 for asked, 0 for goes ahead:

```sh
npm run guard -- check "git clone https://github.com/kelektiv/node.bcrypt.js"   # ASK: Be careful
npm run guard -- check "npm install escape-string-regexp"                         # ALLOW: Looks safe
npm run guard -- check https://github.com/owner/name                              # a bare link works too
```

## Limits

- It reads the command's text. Code fetched in ways it doesn't recognize, or by a script the agent
  wrote first, gets through. It is a seatbelt for an agent that is being talked into running
  something, not a sandbox.
- If the guard itself fails or times out, the command goes ahead and Claude Code's own permissions
  decide, so a broken guard can't stop the agent working. If NEAR can't be reached, it asks for
  GitHub repositories and lets npm packages through.
- A verdict is for a repository at one commit. For a GitHub repository the guard compares it with
  the current commit (`git ls-remote`). For an npm package it can't: the published package may not
  match any commit.
- A verdict says what a model found when it read the code, not a guarantee. See
  [THREAT_MODEL.md](../THREAT_MODEL.md).
