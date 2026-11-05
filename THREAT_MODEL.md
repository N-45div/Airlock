# Threat model: private reviews

Airlock's private review (`npm run scan:private`) reads a repository with a model running in a
TEE on NEAR AI Cloud. This page says what stays private, from whom, what the person scanning
has to trust, and where the limits are. The receipt format is in
[docs/receipts.md](docs/receipts.md).

## Who is involved

| Party | Role | What they can see |
| --- | --- | --- |
| You | Run the CLI on your machine, with your NEAR AI key | Everything |
| The repository's author | Assumed hostile: the code, README and comments are attacker-written | Nothing new |
| Airlock (the hosted service) | Not involved: private reviews run on your machine | Nothing |
| NEAR AI Cloud Gateway | Routes the request to the model | Encrypted fields as ciphertext; metadata (see below) |
| Model host and cloud operator | Run the TEE | Nothing inside the TEE, if Intel TDX and NVIDIA confidential computing hold |
| Intel, NVIDIA | Roots of trust for the TEE's attestation | Nothing |

## What stays private

These are encrypted to the attested model key before they leave your machine (NEAR AI E2EE,
`X-Encrypt-All-Fields`):

- file contents the model reads, and every other message
- tool definitions and tool calls
- the model's replies, encrypted back to a one-time key held by your client

What the Gateway still sees: that you made requests, when, how big they were, which model,
your NEAR AI account (the API key), and fields outside the encryption scope such as
`temperature`, `max_tokens` and `tool_choice`. Reviewing a GitHub repository also means your
machine clones it, so GitHub sees that clone.

## What you have to trust

- **Intel TDX and NVIDIA GPU confidential computing**, that a valid quote means the code runs
  isolated. That holds against the cloud operator's software, not against someone with physical
  access to the server: research such as TEE.fail (Oct 2025) extracted TDX attestation keys with
  physical access to the memory bus. An attacker who can do that could forge quotes.
- **The measured deployment.** The quote proves what runs: the receipt includes the compose
  file and measurements. Neither Airlock nor NEAR AI's SDK compares them to an allowlist by
  default, so you trust NEAR AI's published deployment.
- **NEAR AI's SDK** (`@nearai/inference-sdk` 0.2.1) for encryption and online verification.
  Airlock follows its documented manual flow (`server/near-client.ts`).
- **The registry's owner and recorders**, for verdicts read from NEAR. The owner decides which
  model keys and recorders the contract accepts; a reader decides which recorder to believe.
  See [docs/registry.md](docs/registry.md).

## Checks made on every scan

Before anything is sent, Airlock verifies the Gateway's and the model's attestations with a
fresh nonce. That covers the Intel TDX quote, the GPU evidence, the nonce and the key binding.
It then encrypts to the attested key. After every reply it fetches the signature and checks
it against the exact request and response bytes and the attested signer. **The scan stops if
any check fails, or if a reply is signed only by the Gateway**, since a Gateway signature
doesn't prove which model produced the reply.

## Attacks and what stops them

| Attack | Result |
| --- | --- |
| The repository tells the AI to run a setup script, fetch a URL, or call it safe | The model has three tools: list, read and search files inside the repository. Nothing can run code, write files or reach the network. Unknown tool calls are refused and shown. At worst a steered model gives a wrong verdict, which is a quality risk, measured in [METRICS.md](METRICS.md). |
| A symlink in the repository points at your SSH keys | Paths are resolved and must stay inside the repository; symlinks are never followed. |
| A server pretends to be NEAR AI's model | Its quote won't verify, or won't contain the nonce and key, and the scan stops. |
| Someone edits a receipt to flip the verdict | The final reply no longer decrypts to that verdict; `verify:receipt` fails. |
| Someone replays an old attestation | The quote must contain this scan's fresh nonce. |
| A proxy intercepts TLS (`--no-tls-pinning`) | It sees your API key and the metadata above, but not the encrypted fields. Signatures still protect integrity. With pinning on (the default), the scan refuses such a network. |
| Someone records a fake verdict on NEAR | Only allowed recorders can write, each under a cap. The contract checks the model's Ed25519 signature on chain and refuses keys the owner didn't register after checking their attestation. A forged signature sent to the live contract is refused. |
| The recorder's key leaks (for example from CI) | It is a function-call key: it can only call `record_verdict` on the registry, with about 1 NEAR of gas allowance, and can't move funds. The owner removes the recorder. |

## Known limits

- **Receipts don't prove what was sent.** Requests are encrypted, so the tree hash in a
  receipt is the scanner's statement of what it reviewed. See docs/receipts.md.
- **GPU evidence is checked online at scan time only.** The receipt records the result.
- **The one-time key in a receipt opens the final reply.** For a private repository its
  findings can quote code: share such a receipt only if you'd share its findings.
- **Encrypted requests don't hit NEAR AI's prompt cache.** In live runs, 0 input tokens came
  from cache, so every reply pays the full input price. Scans have a budget (default $0.05).
- **Dependencies.** `npm audit` reports a low-severity advisory in `elliptic`, used by
  `@phala/dcap-qvl` through the SDK, with no fix available.
- **On chain, the verdict label is the recorder's statement.** The contract verifies the model's
  signature over the exchange, but can't decrypt the reply to see the verdict inside it. The
  receipt, found by its hash, settles that offline. The contract doesn't check Intel quotes yet:
  the owner checks them before registering a key.
- **The registry is on testnet**, owned by an account created for the hackathon.

## Test fixtures

Two samples (`take-home`, `readme-note`) contain text written to steer AI reviewers. They are
kept packed in `samples/packed/ai-steering.pack` and unpacked only into a temporary folder for
scans, tests and the benchmark, so no readable file in this repository addresses an AI agent;
a test (`server/test/fixture-hygiene.test.ts`) keeps it that way. Their download host is on the
reserved `.invalid` domain, which never resolves. Receipts keep only the verdict label in the
clear; the findings, which can quote that text, stay inside the encrypted final reply.
