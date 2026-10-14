import { useId, useRef, useState, type SubmitEvent } from 'react';
import { ApiError, startScan } from '../api.ts';
import { CTA } from '../brand.ts';
import { navigate } from '../router.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Button } from '../ui/primitives.tsx';

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again in a moment.';
}

/** The one form that starts a check: a GitHub link and the call to action. */
export function ScanForm({ autoFocus = false, initialUrl = '' }: { autoFocus?: boolean; initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) {
      setError('Paste a GitHub repository link first, like https://github.com/owner/name.');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      navigate(await startScan(value));
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <form className="scan-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="visually-hidden">
        GitHub repository link
      </label>
      <div className="scan-form__row">
        <div className="scan-form__field">
          <Icon name="file" size={18} className="scan-form__icon" />
          <input
            ref={input}
            id={inputId}
            className="input"
            type="text"
            inputMode="url"
            name="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" busy={busy} iconAfter="arrow" className="scan-form__submit">
          {CTA}
        </Button>
      </div>
      <p id={hintId} className="scan-form__hint">
        Public GitHub repositories. Nothing from the repository runs, on your computer or ours.
      </p>
      {error ? (
        <p id={errorId} className="form-error" role="alert">
          <Icon name="info" size={17} />
          <span>{error}</span>
        </p>
      ) : null}
    </form>
  );
}
