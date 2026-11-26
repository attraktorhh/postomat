import { Chip } from '@heroui/react';
import {
  CHANNEL_STATUS_LABELS,
  MEMBER_STEPS,
  WEB_STATUS_LABELS,
  type ChannelPostStatus,
  type MemberStage,
  type PostStatus,
} from '@postomat/core';

type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * Member stepper "Eingereicht → Beim Medienteam → Geplant → Online": finished
 * steps get ✓, the step in progress is highlighted without ✓ (prototype `cur`).
 */
export function Stepper({
  stage,
}: {
  stage: Pick<MemberStage, 'done' | 'current' | 'discarded'>;
}) {
  if (stage.discarded) return <Chip color="danger">Verworfen</Chip>;
  return (
    <ol className="flex flex-wrap gap-1 text-xs" aria-label="Status">
      {MEMBER_STEPS.map((s, i) => {
        const done = i < stage.done && i !== stage.current;
        const current = i === stage.current;
        return (
          <li
            key={s}
            aria-current={current ? 'step' : undefined}
            className={`rounded-full px-2 py-0.5 ${
              current
                ? 'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]'
                : done
                  ? 'bg-[var(--success)] text-[var(--success-foreground)]'
                  : 'bg-[var(--default)] text-[var(--muted)]'
            }`}
          >
            {done ? '✓ ' : ''}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_COLOR: Record<PostStatus, ChipColor> = {
  sammeln: 'default',
  zur_freigabe: 'accent',
  aenderung_gewuenscht: 'warning',
  geplant: 'accent',
  online: 'success',
  verworfen: 'danger',
};

/** Internal post status (Redaktion view). Members see their stage instead. */
export function StatusTape({
  status,
  version,
}: {
  status: PostStatus;
  version?: number;
}) {
  return (
    <Chip color={STATUS_COLOR[status] ?? 'default'}>
      {version && version > 1 && status === 'zur_freigabe'
        ? `v${version} · `
        : ''}
      {WEB_STATUS_LABELS[status] ?? status}
    </Chip>
  );
}

/** The member's stage as one chip ("Entwurf", "Beim Medienteam", …). */
export function StageTape({ stage }: { stage: MemberStage }) {
  const color: ChipColor = stage.discarded
    ? 'danger'
    : stage.draft
      ? 'default'
      : stage.current === -1
        ? 'success'
        : 'accent';
  return <Chip color={color}>{stage.label}</Chip>;
}

const CH_COLOR: Record<ChannelPostStatus, ChipColor> = {
  entwurf: 'default',
  wartet: 'accent',
  veroeffentlicht: 'success',
  fehler: 'danger',
  kopieren: 'warning',
  erledigt: 'success',
  uebersprungen: 'default',
  aus: 'default',
};

export function ChannelStatus({
  status,
  channel,
}: {
  status: ChannelPostStatus;
  channel?: string;
}) {
  return (
    <Chip color={CH_COLOR[status] ?? 'default'}>
      {status === 'erledigt' && channel === 'meetup'
        ? 'Gefunden'
        : (CHANNEL_STATUS_LABELS[status] ?? status)}
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
