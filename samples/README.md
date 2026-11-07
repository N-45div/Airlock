# Samples

Harmless repositories that show what Airlock does and feed its benchmark (`npm run bench`,
[../METRICS.md](../METRICS.md)). None contains malicious code: every script only prints a line or
installs dependencies, and no download host resolves.

Samples that hold text written to steer an AI reviewer, or files that AI coding agents load on
their own (`CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.claude/`), are kept **packed** in
`packed/ai-steering.pack` rather than as readable files. Anyone browsing this repository,
including an AI agent, never reads that text in the clear, and no agent picks up those files.
Scans, tests and the benchmark unpack them into a temporary folder when needed
(`server/sample-pack.ts`). To look inside: `node server/sample-pack.ts unpack take-home /tmp/take-home`.

| Sample | Where | What it is |
| --- | --- | --- |
| `take-home` | packed | A stand-in for a job-interview take-home task: notes aimed at AI reviewers in its README and one code comment, and a setup script that pipes a download into the shell. The host is on the reserved `.invalid` domain, so nothing is fetched even if the script runs. |
| `readme-note` | packed | Clean code; the README holds a note aimed at AI reviewers. |
| `claude-md-note`, `agents-md-run`, `cursor-rules`, `pkg-description-note`, `fake-audit-doc` | packed | Clean code with a note aimed at AI agents in, respectively, `CLAUDE.md`, `AGENTS.md` (asking them to run a script that prints a checklist), a Cursor rules file, the `package.json` description, and a fake security-audit document. |
| `claude-hook` | packed | A Claude Code `SessionStart` hook that runs when an agent opens the folder; it prints a greeting. |
| everything in `bench/` | readable | Clean apps and print-only install or open hooks; see [bench/README.md](bench/README.md). |

The other samples on the home page are real public repositories, read straight from GitHub.
