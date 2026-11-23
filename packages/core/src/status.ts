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
  label: string;
  draft: boolean;
  discarded: boolean;
}

/** Maps the internal status to the member's 4-step stepper. */
export function memberStage(status: PostStatus): MemberStage {
  switch (status) {
    case 'sammeln':
      return { done: 0, label: 'Entwurf', draft: true, discarded: false };
    case 'zur_freigabe':
    case 'aenderung_gewuenscht':
      return {
        done: 2,
        label: 'Beim Medienteam',
        draft: false,
        discarded: false,
      };
    case 'geplant':
      return { done: 3, label: 'Geplant', draft: false, discarded: false };
    case 'online':
      return { done: 4, label: 'Online', draft: false, discarded: false };
    case 'verworfen':
      return { done: 0, label: 'Verworfen', draft: false, discarded: true };
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
