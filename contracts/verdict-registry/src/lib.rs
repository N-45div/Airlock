//! Airlock verdict registry.
//!
//! Records which verdict a repository got at an exact revision, from which recorder, and with
//! which proof. A verdict is accepted only if it carries a reply signature, made by a model key
//! the owner registered after checking that key's TEE attestation, and the contract verifies
//! that Ed25519 signature itself. The signature covers "<model>:<request sha256>:<response
//! sha256>", the exact encrypted exchange in which the model gave its verdict; the full receipt,
//! found by `receipt_hash`, lets anyone decrypt that reply and check it offline
//! (docs/receipts.md).
//!
//! Writes cost the contract storage, so only recorders the owner adds can write, each up to a
//! cap. Reading is free and needs no key: the Chrome extension reads verdicts over public RPC.

use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

/// Newest verdicts kept per repository in `get_repo`; older ones stay readable by id.
const REPO_INDEX_LIMIT: usize = 50;
const MAX_LIST: u32 = 100;

#[near(serializers = [borsh, json])]
#[serde(rename_all = "lowercase")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Safe,
    Caution,
    Dangerous,
}

/// The model's signature over the exchange that carried the verdict.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ReplyProof {
    /// The model TEE's Ed25519 signing key, 32 bytes hex.
    pub signer: String,
    /// Ed25519 signature, 64 bytes hex.
    pub signature: String,
    /// "<model>:<sha256 of request bytes>:<sha256 of response bytes>".
    pub signed_text: String,
}

/// What a recorder sends.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct NewVerdict {
    /// "github.com/owner/name", "sample:<id>", or "private:<64 hex>" (a salted commitment).
    pub repo: String,
    /// The git commit (40 or 64 hex), or the reviewed tree's SHA-256 when there is no commit.
    pub revision: String,
    pub verdict: Verdict,
    pub findings: u32,
    pub model: String,
    /// SHA-256 of the receipt's canonical JSON, hex.
    pub receipt_hash: String,
    pub proof: ReplyProof,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VerdictRecord {
    pub id: u32,
    pub repo: String,
    pub revision: String,
    pub verdict: Verdict,
    pub findings: u32,
    pub model: String,
    pub receipt_hash: String,
    pub signer: String,
    pub signature: String,
    /// The response hash taken from the verified signed text.
    pub response_sha256: String,
    pub recorder: AccountId,
    /// Block time in milliseconds.
    pub recorded_at_ms: u64,
}

/// A model key the owner registered after checking its attestation off chain.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ModelKey {
    pub model: String,
    /// TCB status of the Intel TDX quote that bound this key, e.g. "UpToDate".
    pub tcb_status: String,
    /// SHA-256 of that quote, hex, so anyone can match it to a receipt's attestation.
    pub quote_sha256: String,
    /// When the attestation was verified, Unix milliseconds.
    pub verified_at_ms: u64,
    pub registered_at_ms: u64,
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Records,
    Latest,
    ByRevision,
    RepoIndex,
    Recorders,
    RecorderCounts,
    ModelKeys,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    /// Records each recorder may write.
    cap: u32,
    recorders: IterableSet<AccountId>,
    recorder_counts: LookupMap<AccountId, u32>,
    model_keys: IterableMap<String, ModelKey>,
    records: Vector<VerdictRecord>,
    /// "repo|recorder" -> id of that recorder's newest verdict.
    latest: LookupMap<String, u32>,
    /// "repo|revision|recorder" -> id.
    by_revision: LookupMap<String, u32>,
    /// repo -> ids of its newest verdicts from any recorder, oldest first.
    repo_index: LookupMap<String, Vec<u32>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, cap: u32) -> Self {
        Self {
            owner,
            cap,
            recorders: IterableSet::new(Key::Recorders),
            recorder_counts: LookupMap::new(Key::RecorderCounts),
            model_keys: IterableMap::new(Key::ModelKeys),
            records: Vector::new(Key::Records),
            latest: LookupMap::new(Key::Latest),
            by_revision: LookupMap::new(Key::ByRevision),
            repo_index: LookupMap::new(Key::RepoIndex),
        }
    }

    // --- owner ---

    pub fn add_recorder(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.recorders.insert(account_id);
    }

    pub fn remove_recorder(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.recorders.remove(&account_id);
    }

    pub fn set_cap(&mut self, cap: u32) {
        self.assert_owner();
        self.cap = cap;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    /// Registers a model TEE's signing key. The owner does this after verifying the key's
    /// Intel TDX attestation (`npm run verify:receipt` on a receipt that carries it).
    pub fn register_model_key(&mut self, key: String, model: String, tcb_status: String, quote_sha256: String, verified_at_ms: u64) {
        self.assert_owner();
        require!(key.len() == 64 && is_hex(&key), "key must be 32 bytes of lowercase hex");
        require!(!model.is_empty() && model.len() <= 100, "model must be 1 to 100 bytes");
        require!(tcb_status == "UpToDate", "only UpToDate attestations are accepted");
        require!(quote_sha256.len() == 64 && is_hex(&quote_sha256), "quote_sha256 must be a SHA-256 in lowercase hex");
        let entry = ModelKey { model, tcb_status, quote_sha256, verified_at_ms, registered_at_ms: env::block_timestamp_ms() };
        env::log_str(&event("model_key_registered", near_sdk::serde_json::json!([{ "key": key, "model": entry.model, "quote_sha256": entry.quote_sha256 }])));
        self.model_keys.insert(key, entry);
    }

    pub fn remove_model_key(&mut self, key: String) {
        self.assert_owner();
        self.model_keys.remove(&key);
    }

    // --- recording ---

    /// Records a verdict and returns its id. Needs no deposit, so a function-call access key
    /// limited to this method can call it.
    pub fn record_verdict(&mut self, verdict: NewVerdict) -> u32 {
        let recorder = env::predecessor_account_id();
        require!(self.recorders.contains(&recorder), "not an allowed recorder");
        let used = self.recorder_counts.get(&recorder).copied().unwrap_or(0);
        require!(used < self.cap, "this recorder has used its cap");
        validate(&verdict);

        let key = self.model_keys.get(&verdict.proof.signer).unwrap_or_else(|| env::panic_str("the signing key is not a registered model key"));
        require!(key.model == verdict.model, "the signing key is registered for another model");
        let response_sha256 = verify_proof(&verdict.proof, &verdict.model);

        let id = self.records.len();
        let record = VerdictRecord {
            id,
            repo: verdict.repo,
            revision: verdict.revision,
            verdict: verdict.verdict,
            findings: verdict.findings,
            model: verdict.model,
            receipt_hash: verdict.receipt_hash,
            signer: verdict.proof.signer,
            signature: verdict.proof.signature,
            response_sha256,
            recorder: recorder.clone(),
            recorded_at_ms: env::block_timestamp_ms(),
        };
        self.latest.insert(format!("{}|{}", record.repo, recorder), id);
        self.by_revision.insert(format!("{}|{}|{}", record.repo, record.revision, recorder), id);
        let mut index = self.repo_index.get(&record.repo).cloned().unwrap_or_default();
        index.push(id);
        if index.len() > REPO_INDEX_LIMIT {
            index.drain(..index.len() - REPO_INDEX_LIMIT);
        }
        self.repo_index.insert(record.repo.clone(), index);
        self.recorder_counts.insert(recorder, used + 1);
        env::log_str(&event(
            "verdict_recorded",
            near_sdk::serde_json::json!([{
                "id": record.id, "repo": record.repo, "revision": record.revision, "verdict": record.verdict,
                "recorder": record.recorder, "receipt_hash": record.receipt_hash, "signer": record.signer,
            }]),
        ));
        self.records.push(record);
        id
    }

    // --- views (free, no key) ---

    /// A recorder's newest verdict for a repository.
    pub fn get_latest(&self, repo: String, recorder: AccountId) -> Option<VerdictRecord> {
        self.latest.get(&format!("{repo}|{recorder}")).and_then(|id| self.records.get(*id)).cloned()
    }

    /// A recorder's verdict for one revision of a repository.
    pub fn get_verdict(&self, repo: String, revision: String, recorder: AccountId) -> Option<VerdictRecord> {
        self.by_revision.get(&format!("{repo}|{revision}|{recorder}")).and_then(|id| self.records.get(*id)).cloned()
    }

    /// The newest verdicts for a repository from any recorder, newest first.
    pub fn get_repo(&self, repo: String, limit: Option<u32>) -> Vec<VerdictRecord> {
        let limit = limit.unwrap_or(20).min(MAX_LIST) as usize;
        self.repo_index
            .get(&repo)
            .map(|ids| ids.iter().rev().take(limit).filter_map(|id| self.records.get(*id).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_record(&self, id: u32) -> Option<VerdictRecord> {
        self.records.get(id).cloned()
    }

    /// The newest verdicts across the registry, newest first, `before` an id to page back.
    pub fn get_recent(&self, limit: Option<u32>, before: Option<u32>) -> Vec<VerdictRecord> {
        let limit = limit.unwrap_or(20).min(MAX_LIST);
        let end = before.unwrap_or(self.records.len()).min(self.records.len());
        (end.saturating_sub(limit)..end).rev().filter_map(|id| self.records.get(id).cloned()).collect()
    }

    pub fn count(&self) -> u32 {
        self.records.len()
    }

    pub fn get_model_key(&self, key: String) -> Option<ModelKey> {
        self.model_keys.get(&key).cloned()
    }

    pub fn list_model_keys(&self) -> Vec<(String, ModelKey)> {
        self.model_keys.iter().take(MAX_LIST as usize).map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        let recorders: Vec<String> = self.recorders.iter().take(MAX_LIST as usize).map(|r| r.to_string()).collect();
        near_sdk::serde_json::json!({ "owner": self.owner, "cap": self.cap, "recorders": recorders, "model_keys": self.model_keys.len() })
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can do this");
    }
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn hex_bytes<const N: usize>(s: &str, what: &str) -> [u8; N] {
    require!(s.len() == N * 2 && is_hex(s), format!("{what} must be {N} bytes of lowercase hex"));
    let mut out = [0u8; N];
    for (i, chunk) in s.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap(), 16).unwrap();
    }
    out
}

/// Checks the model's signature on chain and returns the response hash it covers.
fn verify_proof(proof: &ReplyProof, model: &str) -> String {
    let rest = proof
        .signed_text
        .strip_prefix(model)
        .and_then(|r| r.strip_prefix(':'))
        .unwrap_or_else(|| env::panic_str("the signed text is not for this model"));
    let (request, response) = rest.split_once(':').unwrap_or_else(|| env::panic_str("the signed text is not <model>:<request hash>:<response hash>"));
    require!(request.len() == 64 && is_hex(request) && response.len() == 64 && is_hex(response), "the signed text must hold two SHA-256 hashes");
    let key: [u8; 32] = hex_bytes(&proof.signer, "signer");
    let signature: [u8; 64] = hex_bytes(&proof.signature, "signature");
    require!(env::ed25519_verify(&signature, proof.signed_text.as_bytes(), &key), "the reply signature does not verify");
    response.to_string()
}

fn validate(v: &NewVerdict) {
    let repo_ok = if let Some(hash) = v.repo.strip_prefix("private:") {
        hash.len() == 64 && is_hex(hash)
    } else if let Some(id) = v.repo.strip_prefix("sample:") {
        !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    } else {
        let parts: Vec<&str> = v.repo.split('/').collect();
        parts.len() == 3
            && parts[0] == "github.com"
            && parts[1..].iter().all(|p| !p.is_empty() && p.len() <= 100 && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_.".contains(&b)))
    };
    require!(repo_ok, "repo must be github.com/owner/name in lowercase, sample:<id>, or private:<64 lowercase hex>");
    require!((v.revision.len() == 40 || v.revision.len() == 64) && is_hex(&v.revision), "revision must be a git commit or a SHA-256 in lowercase hex");
    require!(!v.model.is_empty() && v.model.len() <= 100, "model must be 1 to 100 bytes");
    require!(v.receipt_hash.len() == 64 && is_hex(&v.receipt_hash), "receipt_hash must be a SHA-256 in lowercase hex");
    require!(v.findings <= 1000, "findings must be at most 1000");
}

/// A NEP-297 event, so indexers can follow the registry.
fn event(name: &str, data: near_sdk::serde_json::Value) -> String {
    format!(r#"EVENT_JSON:{{"standard":"airlock_verdicts","version":"2.0.0","event":"{name}","data":{data}}}"#)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    // A real reply signature from NEAR AI Cloud: the final turn of fixtures/receipts/take-home.json.
    const MODEL: &str = "Qwen/Qwen3.8-27B";
    const SIGNER: &str = "89154a43a47684742c3d1753252bb6f49f61da9d8c84fc9b1def2df130cb2d93";
    const SIGNATURE: &str = "6fb3df91b4a0ffbee2ae9bcab2516b9c7744a99f5070893820ed786df4e7f346a577a0648df8f94f51cd62292f48641908be5c9db8f136f514976993d7ad970c";
    const SIGNED_TEXT: &str = "Qwen/Qwen3.8-27B:7eeb12b0bf6341ba7670d64c78f05da19bbd74f4d8bc09775cd4bb35db3b0f27:18b62f6c4db5b2946d1b2830fb84d55738f013ddf4ed5216ad8d202e7db61128";
    const TREE: &str = "8571e55a2ec487d94e29aef019474e9ddcd6c8196b9e6914bd5eb247913c1f3e";
    const QUOTE_HASH: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn as_account(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).block_timestamp(1_762_300_000_000_000_000).build());
    }

    fn sample() -> NewVerdict {
        NewVerdict {
            repo: "sample:take-home".into(),
            revision: TREE.into(),
            verdict: Verdict::Dangerous,
            findings: 4,
            model: MODEL.into(),
            receipt_hash: QUOTE_HASH.into(),
            proof: ReplyProof { signer: SIGNER.into(), signature: SIGNATURE.into(), signed_text: SIGNED_TEXT.into() },
        }
    }

    /// A registry owned by owner.testnet, with recorder.testnet allowed and the fixture's key registered.
    fn ready() -> Contract {
        as_account("owner.testnet");
        let mut c = Contract::new("owner.testnet".parse().unwrap(), 3);
        c.add_recorder("recorder.testnet".parse().unwrap());
        c.register_model_key(SIGNER.into(), MODEL.into(), "UpToDate".into(), QUOTE_HASH.into(), 1_762_300_000_000);
        as_account("recorder.testnet");
        c
    }

    #[test]
    fn records_a_verdict_with_a_real_tee_signature() {
        let mut c = ready();
        let id = c.record_verdict(sample());
        assert_eq!(id, 0);
        let latest = c.get_latest("sample:take-home".into(), "recorder.testnet".parse().unwrap()).unwrap();
        assert_eq!(latest.verdict, Verdict::Dangerous);
        assert_eq!(latest.response_sha256, "18b62f6c4db5b2946d1b2830fb84d55738f013ddf4ed5216ad8d202e7db61128");
        assert_eq!(latest.recorded_at_ms, 1_762_300_000_000);
        assert_eq!(c.get_verdict("sample:take-home".into(), TREE.into(), "recorder.testnet".parse().unwrap()), Some(latest));
        assert!(get_logs().iter().any(|l| l.contains(r#""event":"verdict_recorded""#) && l.contains(r#""verdict":"dangerous""#)));
    }

    #[test]
    #[should_panic(expected = "the reply signature does not verify")]
    fn rejects_a_forged_signature() {
        let mut c = ready();
        let mut v = sample();
        v.proof.signature = format!("00{}", &SIGNATURE[2..]);
        c.record_verdict(v);
    }

    #[test]
    #[should_panic(expected = "the reply signature does not verify")]
    fn rejects_a_swapped_response_hash() {
        let mut c = ready();
        let mut v = sample();
        v.proof.signed_text = format!("{MODEL}:7eeb12b0bf6341ba7670d64c78f05da19bbd74f4d8bc09775cd4bb35db3b0f27:{}", "0".repeat(64));
        c.record_verdict(v);
    }

    #[test]
    #[should_panic(expected = "the signing key is not a registered model key")]
    fn rejects_an_unregistered_key() {
        as_account("owner.testnet");
        let mut c = Contract::new("owner.testnet".parse().unwrap(), 3);
        c.add_recorder("recorder.testnet".parse().unwrap());
        as_account("recorder.testnet");
        c.record_verdict(sample());
    }

    #[test]
    #[should_panic(expected = "the signed text is not for this model")]
    fn rejects_a_proof_for_another_model() {
        let mut c = ready();
        let mut v = sample();
        v.model = "z-ai/glm-5.3-flash".into();
        as_account("owner.testnet");
        c.register_model_key("ab".repeat(32), "z-ai/glm-5.3-flash".into(), "UpToDate".into(), QUOTE_HASH.into(), 1);
        v.proof.signer = "ab".repeat(32);
        as_account("recorder.testnet");
        c.record_verdict(v);
    }

    #[test]
    #[should_panic(expected = "not an allowed recorder")]
    fn only_allowed_recorders_write() {
        let mut c = ready();
        as_account("stranger.testnet");
        c.record_verdict(sample());
    }

    #[test]
    #[should_panic(expected = "this recorder has used its cap")]
    fn recorders_have_a_cap() {
        let mut c = ready();
        for _ in 0..4 {
            c.record_verdict(sample());
        }
    }

    #[test]
    #[should_panic(expected = "only the owner can do this")]
    fn only_the_owner_registers_keys() {
        let mut c = ready();
        c.register_model_key("cd".repeat(32), MODEL.into(), "UpToDate".into(), QUOTE_HASH.into(), 1);
    }

    #[test]
    #[should_panic(expected = "only UpToDate attestations are accepted")]
    fn keys_need_an_up_to_date_attestation() {
        as_account("owner.testnet");
        let mut c = Contract::new("owner.testnet".parse().unwrap(), 3);
        c.register_model_key(SIGNER.into(), MODEL.into(), "OutOfDate".into(), QUOTE_HASH.into(), 1);
    }

    #[test]
    fn lists_newest_first_and_pages() {
        let mut c = ready();
        as_account("owner.testnet");
        c.set_cap(10);
        as_account("recorder.testnet");
        for _ in 0..3 {
            c.record_verdict(sample());
        }
        let ids = |v: Vec<VerdictRecord>| v.iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids(c.get_recent(Some(2), None)), vec![2, 1]);
        assert_eq!(ids(c.get_recent(Some(2), Some(1))), vec![0]);
        assert_eq!(ids(c.get_repo("sample:take-home".into(), None)), vec![2, 1, 0]);
        assert_eq!(c.count(), 3);
    }

    #[test]
    fn rejects_bad_input() {
        let cases: Vec<(&str, Box<dyn Fn(&mut NewVerdict)>)> = vec![
            ("repo must be", Box::new(|v| v.repo = "https://github.com/Owner/Repo".into())),
            ("repo must be", Box::new(|v| v.repo = "private:xyz".into())),
            ("repo must be", Box::new(|v| v.repo = "sample:Take Home".into())),
            ("revision must be", Box::new(|v| v.revision = "main".into())),
            ("receipt_hash must be", Box::new(|v| v.receipt_hash = "abc".into())),
            ("model must be", Box::new(|v| v.model = String::new())),
        ];
        for (expected, edit) in cases {
            let mut v = sample();
            edit(&mut v);
            let err = std::panic::catch_unwind(move || validate(&v)).expect_err(expected);
            let message = err.downcast_ref::<String>().cloned().unwrap_or_default();
            assert!(message.contains(expected), "{expected}: got {message}");
        }
    }
}
