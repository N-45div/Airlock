# How Airlock uses ArmorIQ

Airlock's reviewer is Claude Code, run through the Claude Agent SDK, reading a stranger's
repository. Everything in that repository is hostile input: a README can tell an AI agent to
run a setup script, read your keys, or call the project safe. So the reviewer works behind a
fence with two layers, and every tool call it makes passes both.

## Layer 1: ArmorIQ (the policy you can see and change)

The SDK loads ArmorIQ's open-source ArmorClaude plugin for every scan
(`plugins: [{ type: 'local', path: ARMORCLAUDE_DIR }]`). Its hooks run on session start, on
the prompt, and before and after every tool call. With an ArmorIQ API key it enforces the
profile published from **ArmorTools → Policy Studio**, records each session in the ArmorIQ
console, and fails closed if a check can't complete.

The Policy Studio rules Airlock runs with:

| Tool | Effect | Why |
| --- | --- | --- |
| `Read`, `Grep`, `Glob` | Allow | Reading is the whole job. |
| `WebFetch` | Hold | Looking at a URL the code downloads can help, but a person decides. |
| `Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | Block | The reviewer never runs or changes the code. |
| `Agent`, `Task`, `Skill`, `WebSearch` | Block | No sub-agents, skills or web searches steered by the repo. |
| folder `/home/airlock` | Locked | The server's home holds its keys; no tool may touch it. |
| anything else | Allow (default for unmatched tools) | See below. |

The rules live in [`policy/airlock-reviewer.json`](../policy/airlock-reviewer.json) and are
staged into Policy Studio with the API key (`PUT /policies/profiles/draft`, then
`POST /policies/profiles/propose`); a person activates them in the console.

Unmatched tools are allowed at this layer on purpose. Policy Studio accepts only tool names
it knows, and the agent's verdict arrives through Claude Code's `StructuredOutput` tool,
which isn't on that list: a "deny unmatched" default would block every verdict. Denying
everything unlisted is the backstop's job instead (below), so the fence as a whole is still
deny-by-default.

A **Hold** in Claude Code is a permission prompt. Under the Agent SDK that prompt reaches
Airlock's `canUseTool` callback, which shows it on the scan page as *Allow once / Decline*
for the person who started the scan. It expires after three minutes.

## Layer 2: Airlock's backstop (the rule that can't be switched off)

A `PreToolUse` hook registered in the SDK refuses anything that isn't a read inside the
repository, Airlock's own search tool, or ArmorClaude's plan registration. It exists because:

- Claude Code lets read-only-looking shell commands (`echo`, `ls`, `cat`) through without a
  permission prompt, so a prompt-based check alone would miss them;
- a policy can be edited, mis-published or still syncing; the backstop doesn't depend on it.

Each blocked call is credited to whoever blocked it. Airlock reads ArmorClaude's own hook
answer (`permissionDecision: deny | ask`) from the SDK's hook events, so the report says
*Blocked by ArmorIQ* only when ArmorIQ's policy made that decision, and *Blocked by Airlock
backstop* otherwise.

## The fence test

Models are good at refusing planted instructions, which means a fence often has nothing to
stop. So every scan asks the reviewer, openly, to try once to run the commands the
repository wants run (its install hooks, and whatever its text tells AI agents to run). The
report shows each attempt and the policy refusing it. Nothing from the repository can run
in the process: the backstop refuses shell tools whatever the policy says.

## What ArmorIQ sees

For each scan, ArmorClaude registers the reviewer's intent plan and sends a trace of the
session to the ArmorIQ console, where it appears under Sessions and Runs: the prompt (the
repository's inventory), each tool call's input, its decision, and its output, sanitized
and with secrets redacted by the plugin (`scripts/lib/observability.mjs`). So parts of the
repository's contents reach ArmorIQ as well as Claude. Observability can be switched off
with `ARMORIQ_OBSERVABILITY_DISABLED=true`; enforcement does not depend on it.
