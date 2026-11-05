# Verdicts on NEAR

Airlock records private-review verdicts on a NEAR testnet contract,
[`airlock-verdicts.testnet`](https://testnet.nearblocks.io/address/airlock-verdicts.testnet)
(source: [`contracts/verdict-registry`](../contracts/verdict-registry/src/lib.rs)). Anyone can read a verdict
with no key, so a repository is reviewed once and the result is free to look up: by the Chrome
extension, a coding agent, or a person.

## Read it (no key, no NEAR tools)

```sh
npm run registry -- latest sample:take-home       # Airlock's newest verdict for a repository
npm run registry -- check fixtures/receipts/take-home.json   # is this receipt's verdict on chain?
npm run registry -- recent                         # newest verdicts
npm run registry -- config                         # owner, recorders, cap, trusted model keys
```

These are plain JSON-RPC view calls to `https://test.rpc.fastnear.com`. With near-cli-rs:
`near contract call-function as-read-only airlock-verdicts.testnet get_latest json-args '{"repo":"sample:take-home","recorder":"airlock-recorder.testnet"}' network-config testnet now`.

## What the contract checks before it stores a verdict

`record_verdict` takes the verdict and the model's signature over the exchange that carried it,
the same signature the receipt holds. The contract refuses the verdict unless:

1. **The caller is an allowed recorder**, under its cap. Writes cost the contract storage, so the
   owner lists who can write (`add_recorder`).
2. **The signing key is a registered model key** for that model. The owner registers a key with
   `npm run registry -- register-key <receipt.json>`. That command refuses unless the receipt
   verifies offline first: the Intel TDX quote is genuine, `UpToDate`, not in debug mode, and
   binds that key and a fresh nonce. The contract stores the quote's SHA-256 next to the key.
3. **The signed text is for that model**, and has the form `<model>:<request sha256>:<response sha256>`.
4. **The Ed25519 signature verifies on chain** (`env::ed25519_verify`) for that key and text.

It stores the response hash from the verified text and the receipt's hash, so anyone can fetch
the receipt and decrypt the final reply offline to see the findings (docs/receipts.md).

A forged signature sent to the live contract is refused: *"Smart contract panicked: the reply
signature does not verify"*. The contract's tests check the same with a real NEAR AI signature
(`npm run test:contract`).

## Who can write

| Account | Key | Can do |
| --- | --- | --- |
| `airlock-verdicts.testnet` | full access | Owner: add or remove recorders and model keys, set the cap, hand ownership to another account (`set_owner`) |
| `airlock-recorder.testnet` | function-call key: only `record_verdict` on `airlock-verdicts.testnet`, about 1 NEAR of gas allowance | Record verdicts. Even if this key leaks, it can do nothing else, not even move funds |

Record a verdict while scanning: `NEAR_KEY_FILE=<recorder key file> npm run scan:private -- take-home --receipt r.json --record`.

## What it proves and what it doesn't

- **Proves:** a verdict on chain was signed, in the exchange that carried it, by a model key whose
  Intel TDX attestation the owner checked, and was recorded by an allowed recorder at a block time.
- **Doesn't prove on chain:** that the verdict label matches the encrypted reply (the contract can't
  decrypt it; the receipt can, offline), the Intel attestation itself (checked off chain before a
  key is registered; checking quotes on chain is planned), or that the verdict is right.
- **Trust:** readers choose which recorder to trust by account name; Airlock's extension trusts
  `airlock-recorder.testnet`. The owner chooses trusted model keys.
