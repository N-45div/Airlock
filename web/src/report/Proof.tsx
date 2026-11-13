// For reviews made on NEAR AI Cloud: what was checked about the model that reviewed the code, and
// how anyone can check it again. The server stops a scan when any of these checks fails
// (server/near-client.ts), so a report with a proof passed all of them.

import type { ReactNode } from 'react';
import type { Scan } from '../../../server/types.ts';
import { receiptUrl, registryIdOf, txUrl } from '../near.ts';
import { Icon } from '../ui/Icon.tsx';
import { Card } from '../ui/primitives.tsx';

function Check({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <li className={ok ? 'proof__check' : 'proof__check proof__check--none'}>
      <Icon name={ok ? 'check' : 'info'} className="proof__mark" />
      <span>
        <strong>{title}.</strong> {children}
      </span>
    </li>
  );
}

export function ProofPanel({ scan }: { scan: Scan }) {
  const proof = scan.proof;
  if (!proof) return null;
  const repoId = scan.repo.host === 'github' ? registryIdOf(scan.repo.url) : scan.repo.url.startsWith('sample:') ? scan.repo.url : null;
  return (
    <Card as="section" pad="lg" className="proof" aria-labelledby="proof-title">
      <div className="proof__head">
        <p className="eyebrow">Verified review</p>
        <h2 id="proof-title" className="proof__title">
          Reviewed by a model in an attested TEE on NEAR AI Cloud
        </h2>
      </div>
      <ul className="proof__checks" aria-label="What was checked">
        <Check ok title="Fresh attestation">
          Before any code was sent, the model's attestation was fetched with a new random nonce, and the quote
          contains that nonce, so it was made for this review.
        </Check>
        <Check ok={proof.tcbStatus === 'UpToDate'} title="Intel TDX quote">
          Signed through Intel's attestation chain; TCB status <code>{proof.tcbStatus}</code>.
        </Check>
        <Check ok={proof.gpuEvidence === 'verified'} title="NVIDIA GPU evidence">
          {proof.gpuEvidence === 'verified' ? 'Verified with NVIDIA’s attestation service.' : 'Not provided by this deployment.'}
        </Check>
        <Check ok title="Key bound to the TEE">
          The model's signing key <code title={proof.signer}>{proof.signer.slice(0, 16)}…</code> is inside the quote.
        </Check>
        <Check ok title="End-to-end encrypted">
          The code, prompts and tool calls were encrypted to that key, so only the model inside the TEE could read
          them. Model <code>{proof.model}</code>.
        </Check>
        <Check ok title="Every reply signed">
          {proof.replies} {proof.replies === 1 ? 'reply' : 'replies'}, each signed by that key over the exact request
          and response, and checked before it was used.
        </Check>
        <Check ok={!!proof.onchain} title="Recorded on NEAR">
          {proof.onchain ? (
            <>
              The <code>{proof.onchain.registry}</code> contract verified the model's signature itself before storing
              this verdict:{' '}
              <a href={txUrl(proof.onchain.tx)} target="_blank" rel="noopener noreferrer">
                the transaction
              </a>
              {repoId ? (
                <>
                  , and <a href={`/near?repo=${encodeURIComponent(repoId)}`}>every verdict for this repository</a>
                </>
              ) : null}
              .
            </>
          ) : proof.notRecorded ? (
            `Not recorded: ${proof.notRecorded} The receipt below still proves the review.`
          ) : (
            'Not recorded: this server has no recorder key.'
          )}
        </Check>
      </ul>
      <p className="proof__receipt">
        <a href={receiptUrl(proof.receiptHash)} download={`airlock-receipt-${proof.receiptHash.slice(0, 12)}.json`}>
          Download the receipt
        </a>{' '}
        and check the quote, the key, the signatures and the verdict yourself with{' '}
        <code>npm run verify:receipt -- receipt.json</code>: no key, no network. Receipt{' '}
        <code title={proof.receiptHash}>{proof.receiptHash.slice(0, 16)}…</code>
      </p>
      <p className="proof__note">
        Airlock's server fetched the repository to send it to the model. To review code that must stay on your own
        machine, use the command line: <code>npm run scan:private -- ./your-folder</code>.
      </p>
    </Card>
  );
}
