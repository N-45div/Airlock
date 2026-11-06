// The hosted site's NEAR AI Cloud engine: the same review as `npm run scan:private`, plugged
// into the scan runner in place of the Claude review. Each review writes a receipt (served at
// /api/receipts/:hash) and, when a recorder key is configured, records the verdict on NEAR.
//
// The hosted site is not private: its server clones the repository. What this engine adds is
// proof of who reviewed it: a model in an attested TEE, every reply signed and verified.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RecordingClient } from './near-client.ts';
import { DEFAULT_MODEL, listPrivateModels } from './near-models.ts';
import { reviewPrivately } from './private-review.ts';
import { buildReceipt, receiptHash, treeHash } from './receipt.ts';
import { REGISTRY, loadCredentials, recordReceipt } from './registry.ts';
import type { ReviewOptions } from './review.ts';
import type { Reviewer } from './scans.ts';
import type { ScanProof } from './types.ts';

export interface NearEngineOptions {
  apiKey: string;
  receiptsDir: string;
  model?: string;
  maxUsd?: number;
  /** Off only behind a TLS-intercepting proxy; every other check still runs. */
  tlsPinning?: boolean;
  /** Record verdicts on NEAR with the recorder key in NEAR_KEY_FILE. */
  record?: boolean;
}

export function nearReviewer(engine: NearEngineOptions): Reviewer {
  const model = engine.model ?? DEFAULT_MODEL;
  return async (opts: ReviewOptions) => {
    const prices = (await listPrivateModels()).find((m) => m.id === model);
    if (!prices) throw new Error(`${model} is not an attested NEAR AI Cloud model with tool calls.`);
    const client = await RecordingClient.connect({ apiKey: engine.apiKey, model, tlsPinning: engine.tlsPinning ?? true });
    const tree = await treeHash(opts.dir);
    const result = await reviewPrivately({
      dir: opts.dir,
      repo: opts.repo,
      inventory: opts.inventory,
      client,
      model,
      prices,
      ...(engine.maxUsd ? { maxUsd: engine.maxUsd } : {}),
      hooks: { onTool: (e) => opts.hooks.onTool(e), onThought: (t) => opts.hooks.onThought(t) },
    });

    const receipt = buildReceipt({ repo: opts.repo, tree, result, attestation: client.attestation, exchanges: client.exchanges });
    const hash = receiptHash(receipt);
    await mkdir(engine.receiptsDir, { recursive: true });
    await writeFile(path.join(engine.receiptsDir, `${hash}.json`), `${JSON.stringify(receipt, null, 2)}\n`);

    const a = client.attestation;
    const proof: ScanProof = {
      engine: 'near-ai-tee',
      model,
      receiptHash: hash,
      signer: a.signer,
      tcbStatus: a.tcbStatus,
      gpuEvidence: a.gpuEvidence,
      replies: result.turns.length,
    };
    if (engine.record) {
      try {
        const creds = await loadCredentials();
        const tx = await recordReceipt(receipt, creds);
        proof.onchain = { registry: REGISTRY, recorder: creds.accountId, tx };
      } catch (error) {
        // A verdict that can't be recorded is still a verdict; the receipt has the proof.
        console.error(`not recorded on NEAR: ${(error as Error).message}`);
      }
    }
    return { verdict: result.verdict, headline: result.headline, summary: result.summary, findings: result.findings, costUsd: result.costUsd, proof };
  };
}
