# Receipts for private reviews

A private review (`npm run scan:private`) runs on a model inside a TEE on NEAR AI Cloud. With
`--receipt <file>` it also writes a receipt: the evidence that the verdict came from that
model, which anyone can check later with no API key and no network.

```sh
npm run scan:private -- take-home --receipt receipt.json      # needs NEARAI_API_KEY
npm run verify:receipt -- receipt.json --repo-dir samples/take-home
npm run verify:offline                                        # every receipt in fixtures/receipts
```

With `--detonate`, the repository's install and setup steps first run in Airlock's sandbox (a throwaway
VM with decoy wallets and keys, network cut to package registries), and the model is shown what they did.
The receipt then binds a hash of that evidence, and the evidence is saved next to it:

```sh
npm run scan:private -- wallet:hidden-loader --detonate --receipt r.json   # writes r.json and r.evidence.json
npm run verify:receipt -- r.json                                           # finds r.evidence.json and checks it
```

`fixtures/receipts/take-home.json` is a real receipt from a live review of Airlock's sample
take-home task (Nov 5, 2026; 2 replies; $0.0029).

## What the offline check proves

| Check | What it means |
| --- | --- |
| Intel TDX quote | The model's quote is signed through Intel's attestation chain. It's checked against the Intel collateral saved at scan time (certificates, CRLs, TCB info), at the scan's time. The TD is not in debug mode, and its TCB status is `UpToDate`. |
| Quote binds key and nonce | The quote's report data holds the model's signing key (bytes 0-31) and this scan's fresh random nonce (bytes 32-63). So that key lives in that TEE, and the quote was made for this scan rather than replayed. Requests were encrypted to that same key. |
| Every reply signed by the attested key | Each reply has an Ed25519 signature by that key over `<model>:<sha256 of the request bytes>:<sha256 of the response bytes>`. The model TEE signed exactly these exchanges, not the Gateway. |
| Final reply contains the verdict | The final reply's encrypted bytes hash to what was signed. They decrypt with the one-time key the receipt discloses and contain exactly the receipt's verdict, so no one changed the verdict after the model gave it. |
| Repository files (with `--repo-dir`) | The folder's files hash to the tree the receipt names. Every file the reviewer could read, as a sorted `sha256  path` manifest, with no `.git`, `node_modules` or symlinks. |

The receipt's own hash, `sha256` of its canonical JSON (keys sorted, no whitespace), is what
gets recorded on NEAR.

## What it doesn't prove

- **That the request contained those files.** Requests are encrypted, so an offline checker
  can't see what was sent. The tree hash is the scanner's statement of what it reviewed.
- **GPU evidence.** The SDK checks NVIDIA's GPU attestation online, through NRAS, at scan
  time. The receipt records the result (`gpuEvidence`) but it can't be re-checked offline.
- **Which deployment is acceptable.** The quote proves *what* runs. The receipt includes the
  measured compose file and measurements (`attestation.deployment`), but nothing compares
  them to an allowlist. NEAR AI's SDK doesn't either, by default.
- **That the sandbox evidence is what ran.** Like the tree hash, `sandbox.sha256` is the scanner's
  statement of what it showed the model. The check proves the evidence file is the one the receipt
  names, not that the sandbox recorded it honestly.
- **That the verdict is right.** A receipt proves who produced the verdict, not that the
  model judged well. How well it judges is measured in [METRICS.md](../METRICS.md).

## The one-time key

NEAR AI encrypts each reply to a key pair the client makes for that request alone. The
receipt keeps the seed of the final request's key pair (`final.clientSeed`), so the final
reply can be decrypted and compared. That key opens that one reply and nothing else: earlier
replies, and every request, used other keys. The final reply is the verdict, which the
receipt states anyway, plus any short reasoning the model wrote with it.

For a private repository, the receipt's findings can quote its code. Share a private
repository's receipt only if you'd share its findings; on chain, only the hash goes.

## Format (`airlock.receipt.v2`)

| Field | Contents |
| --- | --- |
| `repo` | `id` (`github.com/owner/name`, `sample:<id>`, or `private:<sha256 of salt and folder name>`), `commit`, `tree` |
| `verdict` | The `submit_verdict` arguments as the model sent them |
| `attestation` | Model, time, signing key, nonce, TCB status, GPU evidence result, measured deployment, TDX quote, Intel collateral, Gateway summary |
| `turns` | Per reply: completion ID, signature kind, signer, signature, signed text, request and response hashes |
| `final` | The final reply's encrypted bytes and its one-time key seed |
| `usage`, `costUsd` | Tokens and dollars |
| `sandbox` | Only for `--detonate`: provider, counts of steps run, decoys touched and hosts contacted, and the SHA-256 of the full evidence file. The evidence's strings come from the repository, so they stay out of the receipt, like the findings |
