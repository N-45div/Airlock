# Airlock

**Before you run a stranger's code, let a fenced agent open it first.**

**Try it: [airlock-check.vercel.app](https://airlock-check.vercel.app)** · Chrome extension: [Chrome Web Store](https://chromewebstore.google.com/detail/bmhbejjhiimlcmpkpeglogijodbhmpgd) · How the fence uses ArmorIQ: [docs/armoriq.md](docs/armoriq.md)

## NEAR HACKATHON: private reviews on NEAR AI Cloud, verdicts on NEAR

Built for NEAR HACKATHON (Nov 1-14, 2026). Tracks: Privacy & Private AI, AI Security &
Defense, Open Innovation. Work in progress.

Airlock checks a stranger's repository before you, or your AI coding agent, runs it. For this
hackathon the review runs on a model inside a TEE on NEAR AI Cloud that reads the code
end-to-end encrypted and can't run anything, and the verdict comes with proof: a receipt anyone
can check offline, and a record on NEAR that the contract accepts only with the model's
signature.

Airlock existed before the hackathon: the
[`pre-hackathon`](https://github.com/N-45div/Airlock/tree/pre-hackathon) branch (commit
`3047c7f`, Oct 16, 2026) is the baseline. Only what comes after it is hackathon work:
[see the diff](https://github.com/N-45div/Airlock/compare/pre-hackathon...main).

What the hackathon adds:

- **A private review engine.** The code is reviewed by a model running in a TEE on NEAR AI
  Cloud. Prompts, file contents and tool calls are end-to-end encrypted to the attested model,
  and every reply is checked against the model TEE's signature before it is used. The model
  can only list, read and search files inside the repository; no tool runs code.
  (`server/private-review.ts`, `server/repo-tools.ts`)
- **Private repositories and local folders**, reviewed from your own machine, so the code
  never passes through Airlock's server. (`server/private-cli.ts`)
- **Receipts anyone can check offline.** Each private review can write a receipt: the model's
  Intel TDX quote with the Intel collateral it verifies against, every reply's TEE signature,
  and the final encrypted reply with its one-time key. `npm run verify:receipt` checks it with
  no key and no network. (`server/near-client.ts`, `server/receipt.ts`,
  `server/verify-receipt.ts`, [docs/receipts.md](docs/receipts.md),
  [THREAT_MODEL.md](THREAT_MODEL.md))
- **Verdicts on NEAR, checked by the contract.**
  [`airlock-verdicts.testnet`](https://testnet.nearblocks.io/address/airlock-verdicts.testnet)
  stores a verdict only if the NEAR AI model's Ed25519 signature over that exchange verifies
  on chain, from a model key whose Intel TDX attestation was checked before it was registered,
  sent by an allowed recorder whose key can only call `record_verdict`. Reading is free and
  needs no key. ([docs/registry.md](docs/registry.md), `contracts/verdict-registry`,
  `server/registry.ts`)
- **A benchmark with receipts.** 26 harmless repositories: 11 clean (including apps whose
  code looks risky out of context), 8 where something runs by itself, and 7 with notes aimed
  at AI agents. The default model got 26/26 with no false alarms; `glm-5.3-flash` got 24/26;
  Airlock's static inventory alone got 17/26 and caught none of the planted notes. No model
  tried to run anything. All 52 receipts verify offline and all 52 verdicts are on NEAR.
  ([METRICS.md](METRICS.md), `server/bench.ts`, `samples/`, `bench/`)
- **The web app runs reviews on NEAR AI Cloud.** With `NEARAI_API_KEY` set, hosted scans use the
  same engine: each report gets a "Verified review" panel (attestation, signed replies, the
  receipt to download, the NEAR transaction), and the verdict is recorded on NEAR when a recorder
  key is configured. A new `/near` page lists every verdict, read in the browser straight from
  NEAR RPC. The hosted site still fetches the repository, so it is not private; the command line
  is. (`server/near-engine.ts`, `web/src/near/`, `web/src/report/Proof.tsx`)
- **The Chrome extension shows verdicts from NEAR.** On a GitHub repository with a verdict on
  chain, the button reads "Looks safe · on NEAR" (or "Be careful", "Don't run it"), and the popup
  shows the model, date and findings with links to the verdict and the contract. It reads the
  registry over public RPC, with no key or wallet. ([extension/README.md](extension/README.md),
  `extension/lib/near.js`)
- **A guard for coding agents.** A Claude Code (or Codex) hook that runs before the agent's shell
  commands. When one would clone a GitHub repository, install it or pipe its script into a shell,
  it reads the verdict from NEAR: *Don't run it* is blocked, *Be careful*, a repository that changed
  since it was checked, or one never checked waits for you, and *Looks safe* goes ahead with a
  note. npm package names are matched to their repositories. ([docs/guard.md](docs/guard.md),
  `server/guard.ts`)

Not shown yet: a GitHub Action, and checking Intel quotes inside the contract. The Chrome Web Store listing
has the pre-hackathon extension until its update is approved; step 7 below loads the current one.

Try it live, with nothing to install:

- Do: open [airlock-check.vercel.app](https://airlock-check.vercel.app), paste a public GitHub
  repository link (or pick a sample) and press the button.
  See: the review as it happens, then the verdict and a "Verified review" panel: Intel TDX
  `UpToDate`, GPU evidence verified, every reply signed by the model, the receipt to download, and
  the NEAR transaction that recorded the verdict. About a minute and under a cent per review; six
  reviews per hour per visitor. A finished one:
  [sindresorhus/escape-string-regexp](https://airlock-check.vercel.app/r/5tkEtxSf).
- Do: open [airlock-check.vercel.app/near](https://airlock-check.vercel.app/near)
  See: every verdict on NEAR, newest first, read by your browser from public NEAR RPC.

Try it locally (Node 24.22.1 or later; `.nvmrc`). Steps 1 to 3 need no key:

1. Do: `npm ci && npm run judge`
   See: `receipts 64/64 verified offline` (the Intel TDX quote, the key and nonce inside it,
   every reply signature, the decrypted verdict, and the sample files), `tests … passed`
   (including tampered receipts that must fail, and the fixture hygiene check), then `PASS`.
   No key, and no network. On Windows without Developer Mode, the two tests that need a symlink
   are skipped and the judge says so.
2. Do: `npm run registry -- check fixtures/receipts/take-home.json`
   See: `ON CHAIN: #0 DANGEROUS sample:take-home …` with that receipt's hash: the testnet
   contract stored this verdict after verifying the model's reply signature. A public RPC read;
   no key. `npm run registry -- recent` lists every verdict.
3. Do: `npm run verify:receipt -- fixtures/receipts/take-home.json`
   See: each check marked `PASS`, then `VERIFIED`, for a receipt from a live review of the
   sample take-home task: `"dangerous"`, 4 findings.
4. Do: `NEARAI_API_KEY=… npm run scan:private -- take-home --receipt receipt.json`
   See: each file the model reads, any blocked attempt to run something, `verified provider_tee`
   and the running cost for every reply, the verdict, then the receipt's hash; then
   `npm run verify:receipt -- receipt.json` shows `VERIFIED`. Add `--record` with a recorder key
   to put it on NEAR (docs/registry.md). Behind a proxy that intercepts TLS, add
   `--no-tls-pinning` (all other checks still run).
5. Do: `npm run test:contract` (needs Rust; `rust-toolchain.toml` pins 1.93)
   See: 11 contract tests pass, including a real NEAR AI signature accepted and a forged one,
   a swapped response hash, an unregistered key and a stranger refused.
6. Do: `npm run build && npm start`, then open http://127.0.0.1:8787/near
   See: every verdict on NEAR, newest first, read by your browser from public NEAR RPC, each
   with its receipt to download. Without a key, `npm start` serves the pages; scanning needs
   `NEARAI_API_KEY`.
7. Do: load `extension/` unpacked in Chrome (`chrome://extensions`, Developer mode), open the
   extension's popup on https://github.com/sindresorhus/slugify
   See: "Recorded on NEAR testnet: Looks safe", with the model, date and findings. Turn on
   "Show earlier verdicts" in its Settings and the button on the page reads "Looks safe · on NEAR".
8. Do: `npm run guard -- check "git clone https://github.com/kelektiv/node.bcrypt.js"`
   See: `ASK  Airlock: "Be careful" for github.com/kelektiv/node.bcrypt.js (verdict #…` with the
   report's link, and exit code 1: as a Claude Code hook, this clone waits for you.
   `npm run guard -- check "npm install escape-string-regexp"` finds the package's repository and
   shows `ALLOW … "Looks safe"`. `npm run guard -- --config` prints the hook settings for Claude
   Code ([docs/guard.md](docs/guard.md)). Public NEAR RPC and the npm registry; no key.

Test fixtures: two samples contain text written to steer AI reviewers, which is what Airlock
detects. They are kept packed (`samples/packed/`) and unpacked only into a temporary folder
for scans, tests and the benchmark, so no readable file here addresses an AI agent, and a test
keeps it that way. Details: [THREAT_MODEL.md](THREAT_MODEL.md#test-fixtures).

Each scan has a budget, $0.05 by default (`--max-usd` to change it). When it is spent, the
model must give its verdict on the next reply. The default model, `Qwen/Qwen3.8-27B` ($0.04
per million input tokens, $1.35 per million output), averaged $0.0044 per review in the
benchmark; `--model z-ai/glm-5.3-flash` has four times the context for very large
repositories. Encrypted requests don't use NEAR AI's prompt cache, so every reply pays the
full input price.

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

On NEAR AI Cloud (the live site, and `npm run scan:private`), step 3 is the private reviewer: a
model in a TEE whose only tools list, read and search files inside the repository. Nothing it can
call runs code, so there is no fence test; a call to any other tool is refused and shown in the
report. Steps 1, 2 and 5 are the same.

## The fence

| Layer | What it does |
| --- | --- |
| **ArmorIQ** (ArmorClaude plugin, rules from ArmorTools Policy Studio) | Allows `Read`/`Grep`/`Glob`, holds `WebFetch` for the person's approval, blocks `Bash`, `Write`, `Edit`, sub-agents and web search, locks the server's home folder. The rules are in [`policy/`](policy/). Every session is visible in the ArmorIQ console. |
| **Airlock backstop** (a `PreToolUse` hook in the Agent SDK) | Refuses anything that isn't a read inside the repository, whatever the policy says. Catches shell commands Claude Code would wave through as harmless. |

Details, including how each block is credited to the layer that made it:
[docs/armoriq.md](docs/armoriq.md).

## Chrome extension

[The extension](https://chromewebstore.google.com/detail/bmhbejjhiimlcmpkpeglogijodbhmpgd) ([source](extension/)) adds a **Check before you run** button to GitHub repository pages
and npm package pages, and shows an earlier verdict as a badge. See its
[README](extension/README.md).

## Run it yourself

Node 24, git, and (optionally) [sgrep](https://github.com/context-dot-dev/sgrep) on the path.

```sh
npm install
npm run build                     # the web app
export ANTHROPIC_API_KEY=sk-ant-…  # Claude
export ARMORIQ_API_KEY=ak_live_…   # ArmorIQ; without it ArmorClaude only observes
export ARMORIQ_ENV=staging          # keys made in the ArmorTools console live on staging
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
| `NEARAI_API_KEY` | unset | Set it and reviews run on NEAR AI Cloud, privately in a TEE, with a receipt per scan (the live site does) |
| `AIRLOCK_NEAR_MODEL` | `Qwen/Qwen3.8-27B` | NEAR AI Cloud model; `npm run models` lists those that qualify |
| `AIRLOCK_NEAR_MAX_USD` | `0.05` | Budget per private review; when it is spent, the next reply must be the verdict |
| `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY` | unset | A recorder's function-call key: record every verdict on NEAR (or `NEAR_KEY_FILE`, a near-cli credentials file) |
| `AIRLOCK_ENGINE` | `near` with a NEAR AI key, else `claude` | `claude` keeps the pre-hackathon Claude reviewer even when `NEARAI_API_KEY` is set |
| `AIRLOCK_MODEL` | `claude-opus-5-5` | Claude model for the Claude reviewer (on Amazon Bedrock: `CLAUDE_CODE_USE_BEDROCK=1`) |
| `ARMORIQ_ENV` | `production` | `staging` for keys from the ArmorTools console (see docs/armoriq.md) |
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

What each way of reviewing sends, and what is kept afterwards:

| Way | Who can read the code | Kept after the review |
| --- | --- | --- |
| `npm run scan:private` on your machine | Only the model inside the attested TEE: files, prompts and tool calls are encrypted to its key before they leave your machine. No Airlock server is involved. | **Nothing**: a local folder is read in place, and a cloned repository is deleted when the review ends (`server/private-cli.ts`). Only if you ask: `--receipt` writes a file on your machine, and `--record` puts the verdict label, the number of findings and hashes on NEAR, never code or what the findings say. |
| The live site, NEAR AI engine | Airlock's server clones the public repository and sends it encrypted to the same TEE model. | The clone is deleted after the scan (`server/scans.ts`). The repository URL, the report and the receipt stay on the server so the report's link keeps working; the verdict and hashes go on NEAR. |
| Claude engine (pre-hackathon, `AIRLOCK_ENGINE=claude`) | Claude reads it; ArmorIQ receives a sanitized trace of the reviewer's tool calls. | As on the live site, without a receipt. |

What the NEAR AI Gateway still sees (request sizes, timing, the model, your account), and what
you have to trust for the TEE: [THREAT_MODEL.md](THREAT_MODEL.md). No accounts, no cookies, no
tracking.

## Built with

- [NEAR AI Cloud](https://cloud.near.ai) through `@nearai/inference-sdk` 0.2.1: models in TEEs,
  end-to-end encryption, attestation and per-reply signatures.
- `@phala/dcap-qvl` 0.7.0: Intel TDX quote verification, at scan time and offline.
- `near-sdk` 5.29.1 for the registry contract (Rust), and `near-api-js` 7.4.0 to record and read
  verdicts; `tweetnacl` for the receipt's one-time key.
- Hono (server), React 19 and Vite (web app), zod.
- From before the hackathon: the Claude Agent SDK, ArmorClaude and sgrep (the fenced Claude
  reviewer).
- Much of the code, tests and docs were written with Claude Code (Anthropic).

## License

MIT. ArmorClaude (MIT) and sgrep (MIT) are used as published.
