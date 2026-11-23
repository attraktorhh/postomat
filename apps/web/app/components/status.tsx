import { Chip } from '@heroui/react';
import { MEMBER_STEPS } from '@postomat/core';

export function Stepper({
  done,
  discarded,
}: {
  done: number;
  discarded?: boolean;
}) {
  if (discarded) return <Chip color="danger">Verworfen</Chip>;
  return (
    <ol className="flex flex-wrap gap-1 text-xs" aria-label="Status">
      {MEMBER_STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === done - 1 ? 'step' : undefined}
          className={`rounded-full px-2 py-0.5 ${i < done ? 'bg-[var(--success)] text-[var(--success-foreground)]' : 'bg-[var(--default)] text-[var(--muted)]'}`}
        >
          {i < done ? '✓ ' : ''}
          {s}
        </li>
      ))}
    </ol>
  );
}

const STATUS_COLOR: Record<
  string,
  'default' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  sammeln: 'default',
  zur_freigabe: 'accent',
  aenderung_gewuenscht: 'warning',
  geplant: 'accent',
  online: 'success',
  verworfen: 'danger',
};
const STATUS_TEXT: Record<string, string> = {
  sammeln: 'Entwurf',
  zur_freigabe: 'Zur Freigabe',
  aenderung_gewuenscht: 'Änderung gewünscht',
  geplant: 'Geplant',
  online: 'Online',
  verworfen: 'Verworfen',
};

export function StatusTape({
  status,
  version,
}: {
  status: string;
  version?: number;
}) {
  return (
    <Chip color={STATUS_COLOR[status] ?? 'default'}>
      {version && version > 1 && status === 'zur_freigabe'
        ? `v${version} · `
        : ''}
      {STATUS_TEXT[status] ?? status}
    </Chip>
  );
}

const CH_TEXT: Record<
  string,
  [string, 'default' | 'accent' | 'success' | 'warning' | 'danger']
> = {
  entwurf: ['Entwurf', 'default'],
  wartet: ['Wartet', 'accent'],
  veroeffentlicht: ['Online', 'success'],
  fehler: ['Fehler', 'danger'],
  kopieren: ['Kopieren', 'warning'],
  erledigt: ['Erledigt', 'success'],
  uebersprungen: ['Übersprungen', 'default'],
  aus: ['Aus', 'default'],
};

export function ChannelStatus({
  status,
  channel,
}: {
  status: string;
  channel?: string;
}) {
  const [text, color] = CH_TEXT[status] ?? [status, 'default'];
  return (
    <Chip color={color}>
      {status === 'erledigt' && channel === 'meetup' ? 'Gefunden' : text}
    </Chip>
  );
}

export function ModeTape({ mode }: { mode: string }) {
  return (
    <span className="rounded bg-[var(--default)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
      {mode === 'auto' ? 'auto' : mode === 'copy' ? 'kopieren' : 'aus'}
    </span>
  );
}
