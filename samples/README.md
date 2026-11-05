# Samples

Harmless repositories that show what Airlock does. None contains malicious code.

Two of them carry text written to steer an AI reviewer, so they are kept **packed** in
`packed/ai-steering.pack` rather than as readable files: anyone browsing this repository,
including an AI agent, never reads that text in the clear. Scans, tests and the benchmark unpack
them into a temporary folder when needed (`server/sample-pack.ts`). To look inside:
`node server/sample-pack.ts unpack take-home /tmp/take-home`.

| Sample | Where | What it is |
| --- | --- | --- |
| `take-home` | packed | A stand-in for a job-interview take-home task. Its README and one code comment hold notes aimed at AI reviewers, and its setup script pipes a download into the shell. The download host is on the reserved `.invalid` domain, so it can never resolve: nothing is fetched even if the script runs. |
| `readme-note` | packed | A tiny library with clean code whose README holds a note aimed at AI reviewers. |
| `folder-task` | `bench/folder-task/` | A VS Code task that runs when the folder is opened; it only prints a greeting. |

The other samples on the home page are real public repositories, read straight from GitHub.
