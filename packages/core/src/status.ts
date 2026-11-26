import type {
  ChannelPostSnapshot,
  ChannelPostStatus,
  PostStatus,
} from './types.ts';

export const STATUS_LABELS: Record<PostStatus, string> = {
  sammeln: 'Entwurf',
  zur_freigabe: 'Zur Freigabe',
  aenderung_gewuenscht: 'Änderung gewünscht',
  geplant: 'Freigegeben',
  online: 'Online',
  verworfen: 'Verworfen',
};

/**
 * Status names in the web app. Same as STATUS_LABELS, except that an approved
 * post reads "Geplant" (the card keeps "Freigegeben · @name").
 */
export const WEB_STATUS_LABELS: Record<PostStatus, string> = {
  ...STATUS_LABELS,
  geplant: 'Geplant',
};

export const CHANNEL_STATUS_LABELS: Record<ChannelPostStatus, string> = {
  entwurf: 'Entwurf',
  wartet: 'Wartet',
  veroeffentlicht: 'Online',
  fehler: 'Fehler',
  kopieren: 'Kopieren',
  erledigt: 'Erledigt',
  uebersprungen: 'Übersprungen',
  aus: 'Aus',
};

export const MEMBER_STEPS = [
  'Eingereicht',
  'Beim Medienteam',
  'Geplant',
  'Online',
] as const;

export interface MemberStage {
  /** Number of completed stepper steps (0–4). 0 means still a draft. */
  done: number;
  /** Index of the step in progress (shown highlighted, no ✓), -1 for none. */
  current: number;
  label: string;
  draft: boolean;
  discarded: boolean;
}

/**
 * Maps the internal status to the member's 4-step stepper
 * "Eingereicht → Beim Medienteam → Geplant → Online".
 */
export function memberStage(status: PostStatus): MemberStage {
  const stage = (done: number, current: number, label: string) => ({
    done,
    current,
    label,
    draft: false,
    discarded: false,
  });
  switch (status) {
    case 'sammeln':
      return { ...stage(0, -1, 'Entwurf'), draft: true };
    case 'zur_freigabe':
    case 'aenderung_gewuenscht':
      return stage(1, 1, 'Beim Medienteam');
    case 'geplant':
      return stage(2, 2, 'Geplant');
    case 'online':
      return stage(4, -1, 'Online');
    case 'verworfen':
      return { ...stage(0, -1, 'Verworfen'), discarded: true };
  }
}

const DONE_STATES: ReadonlySet<ChannelPostStatus> = new Set([
  'veroeffentlicht',
  'erledigt',
  'uebersprungen',
  'aus',
]);

/** True when a channel needs nothing more (published, linked, skipped or off). */
export function isChannelDone(c: Pick<ChannelPostSnapshot, 'status'>): boolean {
  return DONE_STATES.has(c.status);
}

/** After approval: `online` once every channel is done, otherwise `geplant`. */
export function overallStatusAfterApproval(
  channels: Pick<ChannelPostSnapshot, 'status'>[],
): 'geplant' | 'online' {
  return channels.every(isChannelDone) ? 'online' : 'geplant';
}

/** True when every auto channel has finished (published or failed for good). */
export function autoChannelsSettled(
  channels: Pick<ChannelPostSnapshot, 'mode' | 'status'>[],
): boolean {
  return channels
    .filter((c) => c.mode === 'auto')
    .every((c) => c.status !== 'wartet' && c.status !== 'entwurf');
}
