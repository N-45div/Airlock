// Reads Airlock's verdict registry on NEAR testnet over public RPC: no key, no account, and the
// request goes to a NEAR RPC node, not to Airlock's server. The registry's contract stored each
// verdict only after verifying, on chain, the signature of a NEAR AI Cloud model running in an
// attested TEE (docs/registry.md). Pure functions apart from fetchChainVerdict, so
// node --test covers them.

/** The registry contract and the recorder whose verdicts this extension trusts. */
export const REGISTRY = 'airlock-verdicts.testnet';
export const RECORDER = 'airlock-recorder.testnet';
export const NEAR_RPC = 'https://test.rpc.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io';

const LABELS = { safe: 'Looks safe', caution: 'Be careful', dangerous: "Don't run it" };
const HEX64 = /^[0-9a-f]{64}$/;

export class NearError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NearError';
  }
}

/** The registry's name for a GitHub repository: https://github.com/Owner/Name -> github.com/owner/name. */
export function registryRepoId(repoUrl) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(typeof repoUrl === 'string' ? repoUrl : '');
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : null;
}

function toBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The JSON-RPC body for a view call on the registry. */
export function viewBody(method, args) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 'airlock',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: REGISTRY,
      method_name: method,
      args_base64: toBase64(JSON.stringify(args)),
    },
  });
}

/** The value a view call returned, from the RPC's JSON answer. */
export function decodeView(body) {
  const result = body && body.result;
  if (!result || !Array.isArray(result.result)) {
    const why = (result && result.error) || (body && body.error && (body.error.message || body.error.name)) || 'no result';
    throw new NearError(`NEAR answered without a result (${String(why).slice(0, 120)}).`);
  }
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  try {
    return JSON.parse(text);
  } catch {
    throw new NearError('NEAR sent a result the extension does not understand.');
  }
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** What to show for a verdict record from the registry, or null if it isn't one. */
export function chainView(record) {
  if (!record || typeof record !== 'object') return null;
  const { verdict, repo, revision, model, findings, receipt_hash: receiptHash, recorder, recorded_at_ms: at, id } = record;
  if (!Object.hasOwn(LABELS, verdict) || typeof repo !== 'string' || !HEX64.test(receiptHash ?? '')) return null;
  if (recorder !== RECORDER) return null;
  return {
    source: 'near',
    id: Number.isInteger(id) ? id : null,
    verdict,
    label: LABELS[verdict],
    repo,
    revision: typeof revision === 'string' ? revision : '',
    model: typeof model === 'string' ? clip(model, 80) : '',
    findings: Number.isInteger(findings) ? findings : 0,
    recordedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    receiptHash,
  };
}

/** One line for a tooltip: "Recorded on NEAR: Don't run it · 4 findings · Qwen/... · Nov 6, 2026". */
export function chainSummary(view) {
  if (!view) return '';
  const date = view.recordedAt ? new Date(view.recordedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const findings = `${view.findings} finding${view.findings === 1 ? '' : 's'}`;
  return ['Recorded on NEAR', [view.label, findings, view.model, date].filter(Boolean).join(' · ')].join(': ');
}

/** Pages that show a verdict: the web app's NEAR page for the repo, and the contract on the explorer. */
export function chainLinks(apiBase, view) {
  return {
    page: `${apiBase}/near?repo=${encodeURIComponent(view.repo)}`,
    receipt: `${apiBase}/api/receipts/${view.receiptHash}`,
    contract: `${EXPLORER}/address/${REGISTRY}`,
  };
}

/** Airlock's newest on-chain verdict for a GitHub repository, as a chainView, or null. */
export async function fetchChainVerdict(repoUrl, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const repo = registryRepoId(repoUrl);
  if (!repo) return null;
  let res;
  try {
    res = await fetchImpl(NEAR_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: viewBody('get_latest', { repo, recorder: RECORDER }),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new NearError(err && err.name === 'TimeoutError' ? 'NEAR took too long to answer.' : 'Could not reach NEAR.');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // decodeView reports it.
  }
  return chainView(decodeView(body));
}
