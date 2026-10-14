# Airlock

**Before you run a stranger's code, let a fenced agent open it first.**

A recruiter sends you a take-home task. A GitHub repo promises a free crypto trading bot. A
starter kit has 2,000 stars and an install script you haven't read. Running any of them hands
a stranger your SSH keys, your `.env` files and your wallets.

Paste the repository link into Airlock, or click the button the Chrome extension adds to
GitHub. An AI agent reads the code, never runs it, and tells you in plain words whether it's
safe to run, with every finding pinned to a file and line, and a link you can share.

The agent reads hostile input by design, so it works behind a fence: **ArmorIQ's policy
decides every tool call it makes** (reads allowed, commands blocked, web fetches wait for
you), with Airlock's own backstop behind it. Every scan includes a fence test: the agent
tries to run what the repository wants run, and the report shows the policy refusing it.

## What a scan does

1. **Fetch.** A shallow clone with no submodules, no LFS, no tags and no symlinks. Private
   repos and repos over 60 MB are refused before downloading.
2. **Inventory.** Plain facts about what runs by itself: npm install hooks, `setup.py`,
   VS Code tasks that run when the folder opens, dev container commands, shipped programs,
   code packed onto one line.
3. **Review.** Claude Code, through the Claude Agent SDK, reads the code from the inventory
   outward, with [sgrep](https://github.com/context-dot-dev/sgrep) to search by meaning
   ("send file contents to a server"). It looks for code that reads secrets or wallets,
   rewrites the clipboard, downloads and runs more code, sends data to bots, webhooks or bare
   IPs, hides a payload, or plants instructions for AI agents.
4. **Fence test.** The agent tries once to run the install commands and anything the repo
   asks AI agents to run. The policy refuses; the report shows it.
5. **Verdict.** *Looks safe*, *Be careful* or *Don't run it*, a one-sentence answer, a short
   summary, and each finding with file, line and snippet.

## The fence

| Layer | What it does |
| --- | --- |
| **ArmorIQ** (ArmorClaude plugin, rules from ArmorTools Policy Studio) | Allows `Read`/`Grep`/`Glob`, holds `WebFetch` for the person's approval, blocks `Bash`, `Write`, `Edit`, sub-agents and web search, denies anything unlisted, locks the server's home folder. Every session is visible in the ArmorIQ console. |
| **Airlock backstop** (a `PreToolUse` hook in the Agent SDK) | Refuses anything that isn't a read inside the repository, whatever the policy says. Catches shell commands Claude Code would wave through as harmless. |

Details, including how each block is credited to the layer that made it:
[docs/armoriq.md](docs/armoriq.md).

## Chrome extension

[`extension/`](extension/) adds a **Check before you run** button to GitHub repository pages
and npm package pages, and shows an earlier verdict as a badge. See its
[README](extension/README.md).

## Run it yourself

Node 24, git, and (optionally) [sgrep](https://github.com/context-dot-dev/sgrep) on the path.

```sh
npm install
npm run build                     # the web app
export ANTHROPIC_API_KEY=sk-ant-…  # Claude
export ARMORIQ_API_KEY=ak_live_…   # ArmorIQ; without it ArmorClaude only observes
export ARMORCLAUDE_DIR=/path/to/armorClaude   # git clone https://github.com/armoriq/armorClaude
npm start                         # http://127.0.0.1:8787
npm run scan -- https://github.com/owner/name   # one scan in the terminal
```

Or the image, which bundles ArmorClaude and sgrep:

```sh
docker build -t airlock .
docker run -p 8787:8787 -v airlock-data:/data \
  -e ANTHROPIC_API_KEY -e ARMORIQ_API_KEY airlock
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `AIRLOCK_MODEL` | `claude-opus-5-5` | Claude model for the reviewer |
| `AIRLOCK_MAX_USD_PER_SCAN` | `1.5` | Stop a review that costs more |
| `AIRLOCK_DAILY_USD` | `25` | Stop starting scans after this much per UTC day |
| `AIRLOCK_PER_IP_HOUR` | `6` | Scans one address may start per hour |
| `AIRLOCK_CONCURRENT` | `2` | Scans running at once |
| `AIRLOCK_TRUST_PROXY` | unset | Read the client address from `X-Forwarded-For` |
| `GITHUB_TOKEN` | unset | Raises GitHub's API limit for the size check |

## Limits

- Airlock reads code; it doesn't run it. *Looks safe* means the reviewer found nothing
  dangerous in what it read, not a guarantee. Dependencies are not followed into their own
  repositories.
- A repository can change after a scan. Every report names the commit it read.
- GitHub only for now, public repositories up to 60 MB.

## Privacy

Airlock keeps the repository URL and the scan report so its link keeps working. The code is
deleted after the scan. Claude reads it, and ArmorIQ receives a sanitized trace of the
reviewer's tool calls. No accounts, no cookies, no tracking.

## License

MIT. ArmorClaude (MIT) and sgrep (MIT) are used as published.
