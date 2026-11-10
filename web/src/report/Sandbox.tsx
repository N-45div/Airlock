// What a repository's code did when Airlock ran its install and setup steps in a throwaway VM whose
// home folder held decoy wallets and keys (server/sandbox). Red-handed captures lead: a request that
// carried a decoy away is the clearest thing a report can show.

import type { SandboxReport } from '../../../server/types.ts';
import { receiptUrl } from '../near.ts';
import { Icon } from '../ui/Icon.tsx';
import { Card } from '../ui/primitives.tsx';

const kb = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`);

/** `receiptHash` is set when the model in the TEE saw this run and a receipt binds it. */
export function SandboxPanel({ sandbox: sb, receiptHash }: { sandbox: SandboxReport; receiptHash?: string }) {
  const caught = sb.sent.filter((s) => s.decoys.length > 0);
  const otherSent = sb.sent.filter((s) => s.decoys.length === 0);
  const quiet = sb.wallets.length === 0 && sb.contacts.length === 0 && sb.sent.length === 0;

  return (
    <Card as="section" pad="lg" className={caught.length ? 'sandbox sandbox--caught' : 'sandbox'} aria-labelledby="sandbox-title">
      <p className="eyebrow">What it did</p>
      <h2 id="sandbox-title" className="sandbox__title">
        {caught.length
          ? 'Caught red-handed: it tried to send your wallets away'
          : quiet
            ? 'Nothing it ran touched a wallet or the network'
            : 'We ran it against decoy wallets'}
      </h2>
      <p className="sandbox__lede">
        Airlock ran its install and setup steps in a throwaway VM whose home folder held decoy wallets and keys, with the
        internet cut to package registries. {sb.capture ? 'Every other host was answered from inside the VM, so what the code sent was kept.' : 'This run saw which hosts the code looked up, not what it sent.'}{' '}
        Nothing left the VM.
      </p>

      {caught.length > 0 && (
        <ul className="sandbox__caught">
          {caught.map((s, i) => (
            <li key={`c${i}`} className="sandbox__catch">
              <Icon name="stop" className="sandbox__mark" />
              <div>
                <code className="sandbox__url">
                  {s.method} {s.url}
                </code>{' '}
                <span className="sandbox__size">{kb(s.bytes)}</span>
                <p className="sandbox__inside">
                  Inside it:{' '}
                  {s.decoys.map((d) => (
                    <span key={d} className="sandbox__decoy">
                      {d}
                    </span>
                  ))}
                </p>
                <p className="sandbox__by">
                  Sent by <code>{s.by}</code> during <code>{s.step}</code>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sb.wallets.length > 0 && (
        <div className="sandbox__group">
          <h3 className="sandbox__subhead">Decoy wallets and keys it opened ({sb.wallets.length})</h3>
          <ul className="sandbox__list">
            {sb.wallets.map((w, i) => (
              <li key={`w${i}`}>
                <Icon name={w.action === 'opened' ? 'close' : 'info'} className="sandbox__x" />
                <span>
                  <strong>{w.decoy}</strong> {w.action} <code>{w.path}</code>, by <code>{w.by}</code>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(sb.contacts.length > 0 || otherSent.length > 0) && (
        <div className="sandbox__group">
          <h3 className="sandbox__subhead">Hosts it tried to reach ({sb.contacts.length})</h3>
          <ul className="sandbox__list">
            {sb.contacts.map((c, i) => (
              <li key={`h${i}`}>
                <Icon name="send" className="sandbox__x" />
                <span>
                  <code>{c.host}</code>, by <code>{c.by}</code>
                </span>
              </li>
            ))}
            {otherSent.map((s, i) => (
              <li key={`s${i}`}>
                <Icon name="send" className="sandbox__x" />
                <span>
                  Sent <code>{s.method} {s.url}</code> ({kb(s.bytes)}), no decoy inside
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sandbox__group">
        <h3 className="sandbox__subhead">Steps it ran</h3>
        <ul className="sandbox__steps">
          {sb.steps.length === 0 && <li>None: nothing in this repository installs or runs by itself.</li>}
          {sb.steps.map((s, i) => (
            <li key={`t${i}`}>
              <code>{s.label}</code> <span className="sandbox__status">{s.status}, {s.seconds}s</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="sandbox__note">
        {quiet && 'A quiet run is not proof of safety: code can wait, look for a sandbox, or act only on some machines. The review above also read the code. '}
        {receiptHash ? (
          <>
            The model in the TEE saw this evidence before giving its verdict, and the receipt binds it by SHA-256{' '}
            <code title={sb.evidenceSha256}>{sb.evidenceSha256.slice(0, 16)}…</code>.{' '}
            <a href={`${receiptUrl(receiptHash)}/evidence`} download={`airlock-evidence-${receiptHash.slice(0, 12)}.json`}>
              Download the evidence
            </a>
            .
          </>
        ) : null}
      </p>
    </Card>
  );
}
