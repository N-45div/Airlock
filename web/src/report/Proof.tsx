// For reviews made on NEAR AI Cloud: who reviewed the code and how anyone can check it.

import type { Scan } from '../../../server/types.ts';
import { receiptUrl, registryIdOf, txUrl } from '../near.ts';
import { Card, Chip } from '../ui/primitives.tsx';

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
      <ul className="proof__facts">
        <li>
          <Chip tone="safe" icon="shield">
            Intel TDX {proof.tcbStatus}
          </Chip>{' '}
          <Chip tone={proof.gpuEvidence === 'verified' ? 'safe' : 'quiet'} icon="check">
            GPU evidence {proof.gpuEvidence.replace('_', ' ')}
          </Chip>{' '}
          <Chip tone="accent" icon="key">
            {proof.replies} {proof.replies === 1 ? 'reply' : 'replies'} signed and verified
          </Chip>
        </li>
        <li>
          Model <code>{proof.model}</code>, signing key <code title={proof.signer}>{proof.signer.slice(0, 16)}…</code>. Before
          the code was sent, its attestation was checked with a fresh nonce; the code and every message went
          end-to-end encrypted to that key, and each reply's signature was checked before it was used.
        </li>
        {proof.onchain ? (
          <li>
            Recorded on NEAR:{' '}
            <a href={txUrl(proof.onchain.tx)} target="_blank" rel="noopener noreferrer">
              the transaction
            </a>{' '}
            by <code>{proof.onchain.recorder}</code>. The <code>{proof.onchain.registry}</code> contract stored this verdict
            only after verifying the model's signature itself.
            {repoId ? (
              <>
                {' '}
                <a href={`/near?repo=${encodeURIComponent(repoId)}`}>All verdicts for this repository</a>.
              </>
            ) : null}
          </li>
        ) : null}
        <li>
          <a href={receiptUrl(proof.receiptHash)} download={`airlock-receipt-${proof.receiptHash.slice(0, 12)}.json`}>
            Download the receipt
          </a>{' '}
          and check it with <code>npm run verify:receipt -- receipt.json</code>: no key, no network. Receipt{' '}
          <code title={proof.receiptHash}>{proof.receiptHash.slice(0, 16)}…</code>
        </li>
      </ul>
      <p className="proof__note">
        Airlock's server fetched the repository to send it to the model. To review code that must stay on your own
        machine, use the command line: <code>npm run scan:private -- ./your-folder</code>.
      </p>
    </Card>
  );
}
