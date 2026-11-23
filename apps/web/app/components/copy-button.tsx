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

export function CopyButton({
  text,
  label = 'Kopieren',
}: {
  text: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      size="sm"
      variant="secondary"
      isDisabled={!text}
      onPress={async () => {
        setState((await copy(text)) ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'ok' ? 'Kopiert ✓' : state === 'fail' ? 'Fehler' : label}
    </Button>
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
          className="grid grid-cols-1 items-start gap-2 rounded-md border border-[var(--border)] p-2 sm:grid-cols-[8rem_1fr_auto]"
        >
          <b className="text-sm">{f.label}</b>
          <span
            className="pm-pre min-w-0 text-sm"
            data-testid={`copy-${f.key}`}
          >
            {f.value || <i className="text-[var(--muted)]">leer</i>}
          </span>
          <CopyButton text={f.value} />
        </div>
      ))}
    </div>
  );
}
