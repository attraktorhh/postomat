/** Post types supported in Stage 1. */
export const POST_TYPES = ['event', 'projekt'] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = [
  'sammeln',
  'zur_freigabe',
  'aenderung_gewuenscht',
  'geplant',
  'online',
  'verworfen',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const CHANNELS = [
  'wordpress',
  'wiki',
  'meetup',
  'instagram',
  'facebook',
] as const;
export type ChannelId = (typeof CHANNELS)[number];

export const CHANNEL_MODES = ['auto', 'copy', 'off'] as const;
export type ChannelMode = (typeof CHANNEL_MODES)[number];

export const CHANNEL_POST_STATUSES = [
  'entwurf',
  'wartet',
  'veroeffentlicht',
  'fehler',
  'kopieren',
  'erledigt',
  'uebersprungen',
  'aus',
] as const;
export type ChannelPostStatus = (typeof CHANNEL_POST_STATUSES)[number];

export const CONSENTS = ['frei', 'einwilligung_fehlt', 'nur_intern'] as const;
export type Consent = (typeof CONSENTS)[number];

export const BANNER_COLORS = ['mint', 'blau', 'rot', 'hellblau'] as const;
export type BannerColor = (typeof BANNER_COLORS)[number];

/** Facts collected for a post. Every field is optional while collecting. */
export interface PostFacts {
  title?: string;
  /** Short description (1–2 sentences). For Projekt: what was built. */
  description?: string;
  /** Local date in Europe/Berlin, `YYYY-MM-DD`. */
  date?: string;
  /** Local start time `HH:MM`. */
  startTime?: string;
  /** Local end time `HH:MM`. */
  endTime?: string;
  places?: number;
  /** Free text such as "5 € Material" or "kostenlos". */
  costs?: string;
  audience?: string;
  location?: string;
  /** Projekt only: "Was war das Kniffligste?" */
  trickiest?: string;
  /** True when the event is a workshop (AI flag or keyword). */
  isWorkshop?: boolean;
}

export type FactKey = keyof PostFacts;

/** Minimal view of a post that the pure domain logic needs. */
export interface PostSnapshot {
  id: number;
  type: PostType;
  status: PostStatus;
  version: number;
  facts: PostFacts;
  authorMatrixId: string;
  authorUsername: string;
  /**
   * False while the AI texts don't match the facts (being rewritten, or the
   * rewrite failed). Undefined when unknown; then no check is shown.
   */
  textsCurrent?: boolean;
  /** The last rewrite failed after all retries (Redaktion: "Erneut versuchen"). */
  textsFailed?: boolean;
}

export interface PhotoSnapshot {
  id: number;
  consent: Consent;
  kind: 'photo' | 'banner';
}

export interface ChannelPostSnapshot {
  channel: ChannelId;
  mode: ChannelMode;
  status: ChannelPostStatus;
  textDe: string;
  textEn: string;
  fields: Record<string, string>;
  url?: string | null;
  /** Edited by hand, then the facts changed: the text may show old facts. */
  factsStale?: boolean;
}
