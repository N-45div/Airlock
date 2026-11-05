# airlock-verdicts

NEAR contract that records Airlock's private-review verdicts and verifies the model's Ed25519
reply signature on chain before storing one. Deployed on testnet as
[`airlock-verdicts.testnet`](https://testnet.nearblocks.io/address/airlock-verdicts.testnet).
What it checks and why: [../../docs/registry.md](../../docs/registry.md).

Rust 1.93.0 (pinned in `rust-toolchain.toml`), near-sdk 5.29.1, cargo-near 0.22.0.
`.cargo/config.toml` makes Cargo pick dependency versions that support Rust 1.93.

```sh
cargo test                                   # 11 unit tests, including a real NEAR AI signature
cargo near build non-reproducible-wasm       # target/near/airlock_verdicts.wasm
near contract deploy <account> use-file target/near/airlock_verdicts.wasm \
  with-init-call new json-args '{"owner":"<account>","cap":500}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

| Method | Who | What |
| --- | --- | --- |
| `record_verdict({verdict})` | allowed recorders | Store a verdict after checking the recorder, its cap, the registered model key, the signed text and the Ed25519 signature |
| `register_model_key`, `remove_model_key` | owner | Trust a model key (only `UpToDate` attestations) |
| `add_recorder`, `remove_recorder`, `set_cap`, `set_owner` | owner | Manage writers and ownership |
| `get_latest`, `get_verdict`, `get_repo`, `get_recent`, `get_record`, `count`, `get_model_key`, `list_model_keys`, `get_config` | anyone, free | Read |

Events (NEP-297, standard `airlock_verdicts` 2.0.0): `verdict_recorded`, `model_key_registered`.
