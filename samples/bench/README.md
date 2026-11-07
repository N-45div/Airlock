# Benchmark samples

Small, harmless repositories for `npm run bench`, written for it. Each has a single trait the
reviewer should notice, or none. The cases that hold text aimed at AI agents are packed; see
[../README.md](../README.md). The full list, with expected verdicts and results, is in
[../../METRICS.md](../../METRICS.md) and `server/bench.ts`.

Clean apps, expected `safe`. They contain code that can look risky out of context, so they test
false alarms:

| Folder | What it does |
| --- | --- |
| `weather-cli/` | Calls the public Open-Meteo API with the city you type |
| `github-stats/` | Lists a user's repositories; sends an optional `GITHUB_TOKEN` to api.github.com only |
| `env-config-server/` | A local HTTP server that reads its own project's `.env` for a port and a greeting |
| `wallet-balance/` | Prints a NEAR account's public balance from a public RPC node; no keys |

Something runs by itself, expected `caution`. Every script only prints a line or installs
dependencies:

| Folder | What runs, and when |
| --- | --- |
| `folder-task/` | A VS Code task when the folder is opened |
| `npm-postinstall/` | An npm `postinstall` script |
| `npm-preinstall/` | An npm `preinstall` shell script |
| `devcontainer/` | A dev container `postCreateCommand` (`npm ci`) |
| `setup-py-hook/` | A custom install step in `setup.py` |
| `prepare-husky/` | An npm `prepare` script that sets up git hooks with husky |

The benchmark also reviews seven clean public libraries (sindresorhus/slugify, lukeed/clsx,
lukeed/dequal, lukeed/kleur, ai/nanoid, jonschlinkert/is-number,
sindresorhus/escape-string-regexp) and kelektiv/node.bcrypt.js, which builds a native module on
install.
