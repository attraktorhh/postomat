import type { FactKey, PostFacts, PostType } from './types.ts';
import { isValidDate, localDateOf } from './time.ts';

/**
 * What the AI made of one chat message. `packages/ai` produces it with a
 * schema-validated structured output; nothing else interprets member text.
 */
export const INTENTS = [
  /** Facts or a correction of facts. */
  'provide_info',
  /** Picks Event or Projekt. */
  'choose_type',
  /** Answers the photo consent question. */
  'answer_consent',
  /** Has no photo / does not want to send one. */
  'decline_photo',
  /** Skips the current optional question. */
  'skip_optional',
  /** Wants the summary sent to the Medienteam. */
  'confirm_submit',
  /** Yes / no to a pending confirmation question. */
  'confirm_yes',
  'confirm_no',
  /** Wants the generated texts changed (`instruction`). */
  'request_text_change',
  /** A note for the Medienteam (`text`). */
  'note_for_team',
  /** Answers the Medienteam's open Rückfrage. */
  'answer_rueckfrage',
  'smalltalk_or_thanks',
  'cmd_help',
  'cmd_status',
  'cmd_new',
  'cmd_cancel',
  /** "Nochmal": retry what failed before (e.g. writing the texts). */
  'retry',
  'unclear',
] as const;
export type Intent = (typeof INTENTS)[number];

/** The three answers to the consent question. */
export const CONSENT_ANSWERS = [
  'alle_einverstanden',
  'nicht_gefragt',
  'keine_personen',
] as const;
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number];

/** Facts as the AI returns them: null = not mentioned in this message. */
export interface AiFacts {
  title: string | null;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  places: number | null;
  costs: string | null;
  audience: string | null;
  trickiest: string | null;
  isWorkshop: boolean | null;
}

export const AI_FACT_KEYS = [
  'title',
  'description',
  'date',
  'startTime',
  'endTime',
  'places',
  'costs',
  'audience',
  'trickiest',
  'isWorkshop',
] as const satisfies readonly (keyof AiFacts & FactKey)[];

export const emptyAiFacts = (): AiFacts => ({
  title: null,
  description: null,
  date: null,
  startTime: null,
  endTime: null,
  places: null,
  costs: null,
  audience: null,
  trickiest: null,
  isWorkshop: null,
});

export interface Interpretation {
  intent: Intent;
  type: PostType | null;
  facts: AiFacts;
  consent: ConsentAnswer | null;
  /** request_text_change: what should change. */
  instruction: string | null;
  /** note_for_team: the note. */
  text: string | null;
}

/** What the bot last asked, so the AI knows what an answer refers to. */
export type ExpectedAnswer =
  | FactKey
  | 'type'
  | 'photo'
  | 'consent'
  | 'submit'
  | 'confirmation'
  | 'retry'
  | null;

/** Dialog context sent to the AI with every message (never IDs or names). */
export interface InterpretContext {
  expecting: ExpectedAnswer;
  /** The literal question the bot asked last, if any. */
  question?: string;
  type: PostType | null;
  facts: PostFacts;
  hasPhoto: boolean;
  /** Open "Rückfrage" from the Medienteam (question text). */
  openRueckfrage: string | null;
  /** Open yes/no confirmation (question text). */
  pendingConfirmation: string | null;
}

/** Medienteam answer to "Ist eins davon das Meetup-Event …?". */
export type CandidateChoice =
  { choice: number } | { choice: 'none' } | { choice: 'unrelated' };

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Length limits for AI-provided strings (characters). */
export const FACT_LIMITS: Partial<Record<FactKey, number>> = {
  title: 120,
  description: 800,
  costs: 80,
  audience: 200,
  trickiest: 800,
};

export type RejectReason =
  | 'invalid_date'
  | 'past_date'
  | 'invalid_time'
  | 'end_before_start'
  | 'invalid_places'
  | 'too_long';

export interface ValidatedFacts {
  /** Only the valid values the message stated. */
  facts: PostFacts;
  rejected: Array<{ key: FactKey; reason: RejectReason }>;
}

/**
 * Deterministic checks of AI output. This is validation, not interpretation:
 * values that are not real dates/times/numbers are dropped so the bot can ask
 * again. `known` provides the start time an end time is compared with.
 */
export function validateAiFacts(
  ai: Partial<AiFacts>,
  opts: { now: Date; type?: PostType | null; known?: PostFacts },
): ValidatedFacts {
  const facts: PostFacts = {};
  const rejected: ValidatedFacts['rejected'] = [];
  const reject = (key: FactKey, reason: RejectReason) =>
    rejected.push({ key, reason });

  for (const key of [
    'title',
    'description',
    'costs',
    'audience',
    'trickiest',
  ] as const) {
    const v = ai[key];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    if (t.length > (FACT_LIMITS[key] ?? 500)) reject(key, 'too_long');
    else facts[key] = t;
  }
  if (typeof ai.isWorkshop === 'boolean') facts.isWorkshop = ai.isWorkshop;

  if (typeof ai.date === 'string' && ai.date) {
    if (!isValidDate(ai.date)) reject('date', 'invalid_date');
    else if (opts.type !== 'projekt' && ai.date < localDateOf(opts.now))
      reject('date', 'past_date');
    else facts.date = ai.date;
  }
  if (typeof ai.startTime === 'string' && ai.startTime) {
    if (HH_MM.test(ai.startTime)) facts.startTime = ai.startTime;
    else reject('startTime', 'invalid_time');
  }
  if (typeof ai.endTime === 'string' && ai.endTime) {
    const start = facts.startTime ?? opts.known?.startTime;
    if (!HH_MM.test(ai.endTime)) reject('endTime', 'invalid_time');
    else if (start && ai.endTime <= start)
      reject('endTime', 'end_before_start');
    else facts.endTime = ai.endTime;
  }
  if (ai.places !== null && ai.places !== undefined) {
    if (Number.isInteger(ai.places) && ai.places > 0 && ai.places <= 10000)
      facts.places = ai.places;
    else reject('places', 'invalid_places');
  }
  return { facts, rejected };
}
