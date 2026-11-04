// A NEAR AI Cloud chat client that keeps the evidence a receipt needs. It follows the SDK's
// documented manual flow (verification-guide.md, "Verify Gateway requests manually"):
//   1. verify the Gateway's and the model's TEE attestations (fresh nonce) before any chat;
//   2. encrypt each request to the attested model key with prepareE2eeChatRequest, and keep
//      the exact encrypted bytes sent and received;
//   3. fetch each reply's signature and verify it against those bytes and the attested signer.
// On top of that it keeps what an offline check needs: the model's TDX quote with the Intel
// collateral used to verify it, the hashes of every exchange, and the final reply's bytes
// with the seed of its one-time client key.

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import * as dcap from '@phala/dcap-qvl';
import { AttestationClient as UnpinnedAttestationClient } from '@nearai/inference-sdk';
import {
  AttestationClient,
  DEFAULT_NEAR_AI_CLOUD_BASE_URL,
  createPinnedTlsFetch,
  findModelAttestationForSignature,
  getSdkError,
  prepareE2eeChatRequest,
  verifyGatewayAttestation,
  verifyGatewayResponse,
  verifyModelAttestation,
  verifyModelResponse,
} from '@nearai/inference-sdk/node';
import type { CompletionSignature, VerifiedGatewayAttestation, VerifiedModelAttestation } from '@nearai/inference-sdk/node';
import { publicKeyOfSeed, withSeedCapture } from './nacl-rng.ts';
import type { ChatCompletion, ChatRequest, PrivateChatClient } from './private-review.ts';

/** Where the SDK's Node quote verifier gets Intel collateral. */
export const INTEL_PCS_URL = 'https://api.trustedservices.intel.com';

/** The model's attestation as checked at scan time, with what an offline check needs. */
export interface AttestationRecord {
  model: string;
  /** Unix time in milliseconds when the attestation was verified. */
  verifiedAt: number;
  signingAlgo: 'ed25519';
  /** The model TEE's signing key (hex). Every reply must be signed by it. */
  signer: string;
  /** The key requests were encrypted to (hex). For Ed25519 it is the signing key. */
  e2eePublicKey: string;
  /** The fresh nonce this scan sent, which the quote's report data must contain (hex). */
  nonce: string;
  tcbStatus: string;
  advisoryIds: string[];
  gpuEvidence: string;
  /** Measurements of the model deployment, as the SDK verified them. */
  deployment: unknown;
  /** The model TEE's Intel TDX quote (hex). */
  quote: string;
  /** Intel collateral (certificates, CRLs, TCB info) the quote verifies against. */
  collateral: dcap.Collateral;
  gateway: { signer: string; tcbStatus: string; tlsBinding: 'attested' | 'none' };
}

/** One encrypted exchange: what was sent and received, as the signature covers it. */
export interface ExchangeRecord {
  completionId: string;
  requestSha256: string;
  responseSha256: string;
  /** The encrypted reply exactly as received. */
  responseBody: string;
  /** Seed of this request's one-time client key; opens this one reply and nothing else. */
  clientSeed: string;
}

export interface RecordingClientOptions {
  apiKey: string;
  model: string;
  /** Pin chat requests to the Gateway's attested TLS key. Off behind TLS-intercepting proxies. */
  tlsPinning: boolean;
  baseUrl?: string;
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export class RecordingClient implements PrivateChatClient {
  readonly attestation: AttestationRecord;
  readonly exchanges = new Map<string, ExchangeRecord>();
  #options: Required<RecordingClientOptions>;
  #attestations: VerifiedModelAttestation[];
  #gateway: VerifiedGatewayAttestation;
  #fetch: typeof fetch;
  #api: Pick<AttestationClient, 'fetchCompletionSignature'>;
  #bodies = new Map<string, { request: Uint8Array; response: Uint8Array }>();

  private constructor(
    options: Required<RecordingClientOptions>,
    attestation: AttestationRecord,
    verified: VerifiedModelAttestation[],
    gateway: VerifiedGatewayAttestation,
    chatFetch: typeof fetch,
    api: Pick<AttestationClient, 'fetchCompletionSignature'>,
  ) {
    this.#options = options;
    this.attestation = attestation;
    this.#attestations = verified;
    this.#gateway = gateway;
    this.#fetch = chatFetch;
    this.#api = api;
  }

  /** Verifies the Gateway and the model before anything is sent. Throws if either fails. */
  static async connect(opts: RecordingClientOptions): Promise<RecordingClient> {
    const options = { baseUrl: DEFAULT_NEAR_AI_CLOUD_BASE_URL, ...opts };
    const api = options.tlsPinning
      ? new AttestationClient({ apiKey: options.apiKey, baseUrl: options.baseUrl })
      : new UnpinnedAttestationClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });

    const fetchedGateway = await api.fetchGatewayAttestation({ signingAlgo: 'ed25519' });
    const gateway = await verifyGatewayAttestation({ attestation: fetchedGateway.attestation, clientBinding: fetchedGateway.clientBinding });
    let chatFetch: typeof fetch = fetch;
    if (options.tlsPinning) {
      if (gateway.tlsBinding.kind !== 'attested') throw new Error('The Gateway attestation is not bound to its TLS key, so requests cannot be pinned.');
      chatFetch = createPinnedTlsFetch(gateway.tlsBinding.spkiFingerprint);
    }

    const fetchedModels = await api.fetchModelAttestations({ model: options.model, signingAlgo: 'ed25519' });
    if (fetchedModels.attestations.length === 0) throw new Error(`NEAR AI Cloud returned no TEE attestation for ${options.model}.`);
    const verified = await Promise.all(
      fetchedModels.attestations.map((attestation) => verifyModelAttestation({ attestation, clientBinding: fetchedModels.clientBinding })),
    );
    const chosen = verified.find((v) => v.signingPublicKey !== undefined);
    if (!chosen?.signingPublicKey) throw new Error(`No verified encryption key for ${options.model}.`);

    // The same collateral the SDK's verifier fetches, kept so the quote can be checked offline.
    const quoteBytes = Buffer.from(chosen.report.intelQuote, 'hex');
    const collateral = await dcap.getCollateral(INTEL_PCS_URL, quoteBytes);

    const record: AttestationRecord = {
      model: options.model,
      verifiedAt: Date.now(),
      signingAlgo: 'ed25519',
      signer: chosen.signer.signingAddress,
      e2eePublicKey: chosen.signingPublicKey,
      nonce: fetchedModels.clientBinding.nonce,
      tcbStatus: chosen.tcbStatus,
      advisoryIds: [...chosen.advisoryIds],
      gpuEvidence: chosen.gpuEvidence,
      deployment: jsonSafe(chosen.deployment),
      quote: chosen.report.intelQuote,
      collateral: jsonSafe(collateral) as dcap.Collateral,
      gateway: { signer: gateway.signer.signingAddress, tcbStatus: gateway.tcbStatus, tlsBinding: gateway.tlsBinding.kind },
    };
    return new RecordingClient(options, record, verified, gateway, chatFetch, api);
  }

  readonly chat = {
    completions: {
      create: async (body: ChatRequest): Promise<ChatCompletion> => {
        const { model, publicKey } = { model: this.#options.model, publicKey: this.attestation.e2eePublicKey };
        if (body.model !== model) throw new Error(`This client was attested for ${model}, not ${body.model}.`);
        const request = new Request(`${this.#options.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.#options.apiKey}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
          body: JSON.stringify(body),
        });
        const { result: prepared, seed } = await withSeedCapture(() => prepareE2eeChatRequest({ request, modelKey: { signingAlgo: 'ed25519', publicKey } }));
        const announced = prepared.request.headers.get('x-client-pub-key');
        if (!seed || !announced || publicKeyOfSeed(seed) !== announced.toLowerCase()) {
          throw new Error('Could not keep the one-time client key for this request, so its receipt could not be checked later.');
        }
        const requestBytes = new Uint8Array(await prepared.request.clone().arrayBuffer());
        const encrypted = await this.#fetch(prepared.request);
        const responseBytes = new Uint8Array(await encrypted.clone().arrayBuffer());
        if (!encrypted.ok) {
          throw new Error(`NEAR AI Cloud answered ${encrypted.status}: ${Buffer.from(responseBytes).toString('utf8').slice(0, 300)}`);
        }
        const completion = (await (await prepared.decryptResponse(encrypted)).json()) as ChatCompletion;
        this.#bodies.set(completion.id, { request: requestBytes, response: responseBytes });
        this.exchanges.set(completion.id, {
          completionId: completion.id,
          requestSha256: sha256(requestBytes),
          responseSha256: sha256(responseBytes),
          responseBody: Buffer.from(responseBytes).toString('utf8'),
          clientSeed: seed.toString('hex'),
        });
        seed.fill(0);
        return completion;
      },
    },
  };

  async verifyResponse(id: string): ReturnType<PrivateChatClient['verifyResponse']> {
    const bodies = this.#bodies.get(id);
    if (!bodies) throw new Error(`No recorded exchange for completion ${id}.`);
    const signature = await this.#fetchSignature(id);
    if (signature.kind === 'provider_tee') {
      const attestation = findModelAttestationForSignature({ attestations: this.#attestations, signature });
      verifyModelResponse({ requestBody: bodies.request, responseBody: bodies.response, signature, attestation });
      return { id, signatureKind: 'provider_tee', signature, attestation: { tcbStatus: attestation.tcbStatus } };
    }
    // A Gateway signature only proves the Gateway saw these bytes, not which model produced
    // them; it is checked here, and the reviewer refuses it unless told otherwise.
    verifyGatewayResponse({ requestBody: bodies.request, responseBody: bodies.response, signature, attestation: this.#gateway });
    return { id, signatureKind: 'gateway', signature, attestation: { tcbStatus: this.#gateway.tcbStatus } };
  }

  /** A reply's signature can appear a few seconds after the reply: some models answer 404 at
   * first (seen with Qwen/Qwen3.8-27B). Waits up to about 30 seconds in all. */
  async #fetchSignature(id: string): Promise<CompletionSignature> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#api.fetchCompletionSignature({ completionId: id, signingAlgo: 'ed25519' });
      } catch (error) {
        if (attempt >= 6 || !signatureMayStillCome(error)) throw error;
        await sleep(Math.min(500 * 2 ** attempt, 8000));
      }
    }
  }
}

/** True for signature lookups worth retrying: retryable errors, "not available yet", and 404. */
export function signatureMayStillCome(error: unknown): boolean {
  // The SDK's browser and Node bundles each have their own ApiError class, so look at the
  // error's shape along the cause chain rather than trusting instanceof.
  for (let e: unknown = getSdkError(error) ?? error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const failure = (e as { failure?: { code?: string; details?: { status?: number } } }).failure;
    if (!failure?.code) continue;
    if ((e as { retryable?: boolean }).retryable || failure.code === 'api.completion_signature_unavailable') return true;
    return failure.code === 'api.http_status' && failure.details?.status === 404;
  }
  return false;
}

/** Uint8Arrays to hex and bigints to strings, so evidence survives JSON. */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && (v as { type?: string }).type === 'Buffer' && Array.isArray((v as { data?: unknown }).data)) {
      return Buffer.from((v as { data: number[] }).data).toString('hex');
    }
    return v;
  }));
}
