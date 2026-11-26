import { Button } from '@heroui/react';
import { useState } from 'react';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http (no clipboard API) and older mobile browsers.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Copy button. `field` names what is copied ("Titel kopieren") for screen
 * readers; the result is announced in a polite live region.
 */
export function CopyButton({
  text,
  label = 'Kopieren',
  field,
}: {
  text: string;
  label?: string;
  field?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <span className="inline-flex">
      <Button
        size="sm"
        variant="secondary"
        isDisabled={!text}
        aria-label={field ? `${field} kopieren` : undefined}
        onPress={async () => {
          setState((await copy(text)) ? 'ok' : 'fail');
          setTimeout(() => setState('idle'), 1500);
        }}
      >
        {state === 'ok' ? 'Kopiert ✓' : state === 'fail' ? 'Fehler' : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'ok'
          ? `${field ?? 'Text'} kopiert`
          : state === 'fail'
            ? 'Kopieren hat nicht geklappt'
            : ''}
      </span>
    </span>
  );
}

/** One row per copy field with its own copy button. */
export function CopyFields({
  fields,
}: {
  fields: Array<{ key: string; label: string; value: string }>;
}) {
  return (
    <div className="grid gap-2">
      {fields.map((f) => (
        <div
          key={f.key}
          className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 rounded-md border border-[var(--border)] p-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
        >
          <b className="text-sm">{f.label}</b>
          <span
            className="pm-pre min-w-0 text-sm"
            data-testid={`copy-${f.key}`}
          >
            {f.value || <i className="text-[var(--muted)]">leer</i>}
          </span>
          <CopyButton text={f.value} field={f.label} />
        </div>
      ))}
    </div>
  );
}
