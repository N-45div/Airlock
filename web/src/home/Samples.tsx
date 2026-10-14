import { useEffect, useState } from 'react';
import type { Sample } from '../../../server/types.ts';
import { api, startScan } from '../api.ts';
import { CTA, PRODUCT } from '../brand.ts';
import { navigate } from '../router.tsx';
import { Icon, Spinner } from '../ui/Icon.tsx';
import { SectionHeading } from '../ui/primitives.tsx';
import { messageOf } from './ScanForm.tsx';

function repoLabel(sample: Sample): string {
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+)/.exec(sample.url);
  return github ? `${github[1]}/${github[2]}` : `${PRODUCT} sample`;
}

export function Samples() {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .samples()
      .then((list) => live && setSamples(list))
      .catch(() => live && setUnavailable(true));
    return () => {
      live = false;
    };
  }, []);

  const start = async (sample: Sample) => {
    setBusyId(sample.id);
    setError(null);
    try {
      navigate(await startScan(sample.id));
    } catch (err) {
      setError(messageOf(err));
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="samples-title">
      <SectionHeading id="samples-title" eyebrow="Try it" title="Or start with a sample" aside="One click starts a real check." />
      {unavailable ? (
        <p className="muted-note">Samples are not available right now. Paste any public GitHub link above instead.</p>
      ) : (
        <ul className="sample-grid" aria-busy={samples ? undefined : true}>
          {samples
            ? samples.map((sample) => (
                <li key={sample.id}>
                  <button
                    type="button"
                    className="sample"
                    onClick={() => void start(sample)}
                    disabled={busyId !== null}
                    aria-busy={busyId === sample.id || undefined}
                  >
                    <span className="sample__repo">{repoLabel(sample)}</span>
                    <span className="sample__title">{sample.title}</span>
                    <span className="sample__blurb">{sample.blurb}</span>
                    <span className="sample__cta">
                      {busyId === sample.id ? <Spinner size={15} /> : null}
                      <span>{CTA}</span>
                      <Icon name="arrow" size={16} />
                    </span>
                  </button>
                </li>
              ))
            : [0, 1, 2].map((n) => (
                <li key={n} className="sample sample--placeholder" aria-hidden="true">
                  <span className="placeholder-line placeholder-line--short" />
                  <span className="placeholder-line" />
                  <span className="placeholder-line" />
                  <span className="placeholder-line placeholder-line--mid" />
                </li>
              ))}
        </ul>
      )}
      {error ? (
        <p className="form-error" role="alert">
          <Icon name="info" size={17} />
          <span>{error}</span>
        </p>
      ) : null}
    </section>
  );
}
