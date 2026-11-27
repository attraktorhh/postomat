import type { Consent, FactKey, PostFacts, PostType } from '../types.ts';
import { factsLineDm } from '../format.ts';
import { weekdayDe, dayMonthDe } from '../time.ts';
import {
  CONSENT_ECHO,
  CONSENT_FROM_ANSWER,
  CONSENT_QUESTION,
} from '../consent.ts';
import {
  validateAiFacts,
  type ExpectedAnswer,
  type Interpretation,
  type InterpretContext,
  type RejectReason,
} from '../interpretation.ts';

/**
 * The Matrix DM dialog as a state machine. It never looks at message text:
 * every member message arrives as an `Interpretation` from the AI
 * (`packages/ai`). Core decides deterministically what to ask next and
 * validates the AI's values.
 */

/** Where the conversation currently is. */
export type DialogStep = 'idle' | 'type' | 'collect' | 'review';

export type Expecting = FactKey | 'type' | 'photo' | 'consent' | null;

/** A destructive command waiting for "ja"/"nein". */
export type PendingConfirmation = 'cancel' | 'new';

export interface DialogState {
  step: DialogStep;
  type?: PostType;
  facts: PostFacts;
  expecting: Expecting;
  /** Optional questions that were asked (and possibly skipped). */
  asked: Array<FactKey | 'photo'>;
  photoCount: number;
  /** Photos waiting for the consent answer. */
  pendingConsentPhotoIds: number[];
  photoDeclined: boolean;
  /** The summary could not be built (AI failure); "nochmal" retries it. */
  summaryPending?: boolean;
  pendingConfirmation?: PendingConfirmation | null;
}

export const initialDialogState = (): DialogState => ({
  step: 'idle',
  facts: {},
  expecting: null,
  asked: [],
  photoCount: 0,
  pendingConsentPhotoIds: [],
  photoDeclined: false,
  summaryPending: false,
  pendingConfirmation: null,
});

export interface DialogDeps {
  now: Date;
  displayName: string;
}

export type DialogInput =
  | { kind: 'message'; interpretation: Interpretation }
  | { kind: 'photo'; photoId: number };

export type DialogEffect =
  | { kind: 'set_consent'; photoIds: number[]; consent: Consent }
  /** All facts are collected: generate texts + banner and send the summary. */
  | { kind: 'summary' }
  /** Member asked for a text change in review. */
  | { kind: 'change_request'; instruction: string }
  /** The message is a note for the Medienteam; the caller stores it verbatim. */
  | { kind: 'note' };

export interface DialogResult {
  state: DialogState;
  replies: string[];
  effects: DialogEffect[];
}

export const GREETING = (name: string) =>
  `Hi ${name}! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.`;

export const TYPE_QUESTION =
  'Was möchtest du einreichen?\n1️⃣ Event (ein Termin im Attraktor)\n2️⃣ Projekt (etwas, das du gebaut hast)';

export const NOT_UNDERSTOOD = 'Das hab ich nicht ganz verstanden.';
export const CONFIRM_SUBMIT =
  'Soll ich es so ans Medienteam schicken? Antworte „abschicken“.';
export const THANKS_REPLY =
  'Gern! Antworte „abschicken“, wenn es so ans Medienteam soll.';
export const NOTE_STORED =
  'Ich habe das als Notiz fürs Medienteam gespeichert.';
export const NOTE_STORED_REVIEW = `${NOTE_STORED} Texte ändern kannst du mit „Text ändern: …“. Antworte „abschicken“, wenn alles passt.`;
const GREETING_HINT = 'Erzähl mir erst in einem Satz, was du vorhast.';

const QUESTIONS: Partial<Record<FactKey, string>> = {
  title: 'Wie soll der Titel lauten?',
  description: 'Worum geht’s? Ein, zwei Sätze reichen.',
  date: 'An welchem Tag ist es?',
  startTime: 'Um wie viel Uhr geht’s los?',
  places: 'Wie viele Plätze gibt es? (Ist es egal, schreib „weiter“.)',
  costs: 'Kostet es etwas? Zum Beispiel „5 € Material“ oder „kostenlos“.',
  trickiest: 'Was war das Kniffligste?',
};
const PROJEKT_DESCRIPTION_QUESTION =
  'Was hast du gebaut? Ein, zwei Sätze reichen.';

/** Said when the answer to the asked question contained nothing usable. */
const RETRY_HINTS: Partial<Record<FactKey, string>> = {
  date: 'Ich habe kein Datum erkannt. Schreib es zum Beispiel so: „11.12.“ oder „nächsten Freitag“.',
  startTime:
    'Ich habe keine Uhrzeit erkannt. Schreib sie zum Beispiel so: „18 Uhr“ oder „18–21 Uhr“.',
  places: 'Wie viele Plätze? Eine Zahl reicht, oder „weiter“.',
  costs: 'Kostet es etwas? Zum Beispiel „5 €“, „kostenlos“ oder „weiter“.',
};

const FIELD_LABELS: Partial<Record<FactKey, string>> = {
  title: 'Titel',
  description: 'Beschreibung',
  costs: 'Kostenhinweis',
  audience: 'Zielgruppe',
  trickiest: 'Kniffligste',
};

const REJECT_HINTS: Record<RejectReason, (key: FactKey) => string> = {
  invalid_date: () => 'Das Datum konnte ich nicht zuordnen.',
  past_date: () => 'Das Datum liegt in der Vergangenheit.',
  invalid_time: () => 'Die Uhrzeit konnte ich nicht zuordnen.',
  end_before_start: () =>
    'Das Ende liegt vor dem Beginn, deshalb habe ich nur die Startzeit übernommen.',
  invalid_places: () => 'Die Anzahl der Plätze konnte ich nicht übernehmen.',
  too_long: (key) =>
    `Das ist mir für ${FIELD_LABELS[key] ? `„${FIELD_LABELS[key]}“` : 'diese Angabe'} zu lang, bitte kürzer.`,
};

export const PHOTO_QUESTION_EVENT =
  'Hast du ein Foto dazu? Schick es einfach hier rein.';
export const PHOTO_QUESTION_PROJEKT =
  'Schick mir bitte ein Foto davon. Für Projekte brauche ich mindestens eins.';

const ORDER: Record<PostType, Array<FactKey | 'photo'>> = {
  event: [
    'title',
    'description',
    'date',
    'startTime',
    'places',
    'costs',
    'photo',
  ],
  projekt: ['title', 'description', 'trickiest', 'photo'],
};
const REQUIRED: Record<PostType, Array<FactKey | 'photo'>> = {
  event: ['title', 'description', 'date', 'startTime'],
  projekt: ['title', 'description', 'trickiest', 'photo'],
};

function hasFact(state: DialogState, key: FactKey | 'photo'): boolean {
  if (key === 'photo') return state.photoCount > 0;
  const v = state.facts[key];
  return v !== undefined && v !== '';
}

const isRequired = (state: DialogState, key: FactKey | 'photo') =>
  !!state.type && REQUIRED[state.type].includes(key);

/** The next thing to ask, or null when everything is collected. */
export function nextQuestion(state: DialogState): FactKey | 'photo' | null {
  if (!state.type) return null;
  for (const key of ORDER[state.type]) {
    if (hasFact(state, key)) continue;
    const required = isRequired(state, key);
    if (key === 'photo' && state.photoDeclined && !required) continue;
    if (!required && state.asked.includes(key)) continue;
    return key;
  }
  return null;
}

function questionText(state: DialogState, key: FactKey | 'photo'): string {
  if (key === 'photo')
    return state.type === 'projekt'
      ? PHOTO_QUESTION_PROJEKT
      : PHOTO_QUESTION_EVENT;
  if (key === 'description' && state.type === 'projekt')
    return PROJEKT_DESCRIPTION_QUESTION;
  return QUESTIONS[key] ?? `${key}?`;
}

/** The question the member still has to answer, if any. */
export function openQuestion(state: DialogState): string | undefined {
  if (state.expecting === 'consent') return CONSENT_QUESTION;
  if (state.expecting === 'type') return TYPE_QUESTION;
  if (state.expecting) return questionText(state, state.expecting);
  if (state.step === 'idle') return GREETING_HINT;
  if (state.step === 'review') return CONFIRM_SUBMIT;
  return undefined;
}

/** What the bot waits for, as context for the AI. */
export function expectedAnswer(state: DialogState): ExpectedAnswer {
  if (state.pendingConfirmation) return 'confirmation';
  if (state.summaryPending) return 'retry';
  if (state.expecting) return state.expecting;
  if (state.step === 'review') return 'submit';
  return null;
}

/** Builds the AI context for the next message (no IDs, no names). */
export function interpretContext(
  state: DialogState,
  extra: {
    openRueckfrage?: string | null;
    pendingConfirmation?: string | null;
  },
): InterpretContext {
  return {
    expecting: expectedAnswer(state),
    // While a yes/no confirmation is open, that is the question being answered.
    question: extra.pendingConfirmation ?? openQuestion(state),
    type: state.type ?? null,
    facts: state.facts,
    hasPhoto: state.photoCount > 0,
    openRueckfrage: extra.openRueckfrage ?? null,
    pendingConfirmation: extra.pendingConfirmation ?? null,
  };
}

/** Merges new facts; later answers override earlier ones. */
function mergeFacts(
  old: PostFacts,
  add: PostFacts,
): { facts: PostFacts; changed: FactKey[] } {
  const facts: PostFacts = { ...old };
  const changed: FactKey[] = [];
  for (const [k, v] of Object.entries(add) as Array<
    [FactKey, PostFacts[FactKey]]
  >) {
    if (v === undefined || v === '') continue;
    if (facts[k] !== v) changed.push(k);
    (facts as Record<string, unknown>)[k] = v;
  }
  // A new start time can invalidate an older end time.
  if (facts.endTime && facts.startTime && facts.endTime <= facts.startTime) {
    delete facts.endTime;
    if (!changed.includes('startTime')) changed.push('startTime');
  }
  return { facts, changed };
}

/** "Alles klar, Freitag 11.12. · 18:00 …" – the weekday is computed here, not by the AI. */
function understood(
  facts: PostFacts,
  changed: FactKey[],
  withTitle: boolean,
): string {
  const shown = changed.filter(
    (k) => !['isWorkshop', 'description', 'trickiest', 'audience'].includes(k),
  );
  if (!shown.length) return '';
  if (withTitle && changed.includes('title')) {
    const lines: string[] = [`• ${facts.title}`];
    if (changed.includes('date') && facts.date)
      lines.push(`• ${weekdayDe(facts.date)}, ${dayMonthDe(facts.date)}`);
    const rest = factsLineDm({
      startTime: changed.includes('startTime') ? facts.startTime : undefined,
      endTime: changed.includes('startTime') ? facts.endTime : undefined,
      places: changed.includes('places') ? facts.places : undefined,
      costs: changed.includes('costs') ? facts.costs : undefined,
    });
    if (rest) lines.push(`• ${rest}`);
    return `Ich habe verstanden:\n${lines.join('\n')}`;
  }
  const subset: PostFacts = {};
  for (const k of ['date', 'startTime', 'places', 'costs'] as const) {
    if (
      changed.includes(k) ||
      (k === 'startTime' && changed.includes('endTime'))
    ) {
      (subset as Record<string, unknown>)[k] = facts[k];
      if (k === 'startTime') subset.endTime = facts.endTime;
    }
  }
  const line = factsLineDm(subset);
  const end = (s: string) => (s.endsWith('.') ? s : `${s}.`);
  if (changed.includes('title') && !withTitle)
    return line
      ? end(`Alles klar, ${facts.title} · ${line}`)
      : end(`Alles klar: ${facts.title}`);
  return line ? end(`Alles klar, ${line}`) : '';
}

const join = (...parts: string[]) => parts.filter(Boolean).join('\n');

function askNextOrSummarize(state: DialogState, prefix: string): DialogResult {
  const next = nextQuestion(state);
  if (next === null) {
    return {
      state: { ...state, step: 'review', expecting: null },
      replies: prefix ? [prefix] : [],
      effects: [{ kind: 'summary' }],
    };
  }
  const asked = isRequired(state, next) ? state.asked : [...state.asked, next];
  return {
    state: {
      ...state,
      step: 'collect',
      expecting: next,
      asked: Array.from(new Set(asked)),
    },
    replies: [join(prefix, questionText(state, next))],
    effects: [],
  };
}

/** Repeats the open question, optionally with a prefix. */
function reask(state: DialogState, prefix = ''): DialogResult {
  return {
    state,
    replies: [join(prefix, openQuestion(state) ?? '')],
    effects: [],
  };
}

interface Absorbed {
  state: DialogState;
  changed: FactKey[];
  hints: string[];
  rejected: FactKey[];
}

/** Applies the AI's (validated) facts to the state. */
function absorb(
  state: DialogState,
  interp: Interpretation,
  deps: DialogDeps,
): Absorbed {
  const type = state.type ?? interp.type ?? undefined;
  const v = validateAiFacts(interp.facts, {
    now: deps.now,
    type,
    known: state.facts,
  });
  const { facts, changed } = mergeFacts(state.facts, v.facts);
  const rejected = v.rejected.map((r) => r.key);
  // A rejected optional answer is asked again.
  const asked = state.asked.filter((k) => !rejected.includes(k as FactKey));
  return {
    state: { ...state, facts, asked },
    changed,
    hints: v.rejected.map((r) => REJECT_HINTS[r.reason](r.key)),
    rejected,
  };
}

const typeIntro = (type: PostType, facts: PostFacts) =>
  type === 'projekt'
    ? 'Cool, ein Projekt!'
    : facts.isWorkshop
      ? 'Cool, ein Workshop!'
      : 'Cool, ein Event!';

/**
 * Advances the DM dialog by one interpreted member message or one photo.
 * Pure: storage, Matrix, AI calls and text generation are done by the caller.
 * Commands, submit, Rückfrage answers and confirmations are routed by the
 * caller before this is called.
 */
export function advanceDialog(
  state: DialogState,
  input: DialogInput,
  deps: DialogDeps,
): DialogResult {
  if (input.kind === 'photo') return handlePhoto(state, input.photoId);
  const interp = input.interpretation;
  const intent = interp.intent;

  if (state.expecting === 'consent') {
    if (intent === 'answer_consent' && interp.consent) {
      const effects: DialogEffect[] = [
        {
          kind: 'set_consent',
          photoIds: state.pendingConsentPhotoIds,
          consent: CONSENT_FROM_ANSWER[interp.consent],
        },
      ];
      const next = askNextOrSummarize(
        { ...state, pendingConsentPhotoIds: [], expecting: null },
        CONSENT_ECHO[interp.consent],
      );
      return { ...next, effects: [...effects, ...next.effects] };
    }
    if (intent === 'provide_info') {
      const a = absorb(state, interp, deps);
      return reask(
        a.state,
        join(understood(a.state.facts, a.changed, false), ...a.hints),
      );
    }
    return reask(state, NOT_UNDERSTOOD);
  }

  // A changed fact is a fact change, even when the AI files it as a text change.
  if (intent === 'request_text_change' && hasAnyFact(interp))
    return absorbAndContinue(state, interp, deps);

  switch (intent) {
    case 'smalltalk_or_thanks':
      if (state.step === 'idle')
        return {
          state: { ...state, expecting: null },
          replies: [GREETING(deps.displayName)],
          effects: [],
        };
      if (state.step === 'review')
        return { state, replies: [THANKS_REPLY], effects: [] };
      return reask(state);
    case 'retry':
      if (state.summaryPending)
        return { state, replies: [], effects: [{ kind: 'summary' }] };
      return reask(state);
    case 'note_for_team':
      if (state.step === 'idle') break;
      return {
        state,
        replies: [
          state.step === 'review'
            ? NOTE_STORED_REVIEW
            : join(NOTE_STORED, openQuestion(state) ?? ''),
        ],
        effects: [{ kind: 'note' }],
      };
    case 'request_text_change':
      if (state.step !== 'review') return reask(state, NOT_UNDERSTOOD);
      return {
        state,
        replies: [],
        effects: [
          {
            kind: 'change_request',
            instruction: interp.instruction?.trim() || '',
          },
        ],
      };
    case 'decline_photo':
    case 'skip_optional':
    case 'confirm_no':
      return skipOrDecline(state, intent);
    case 'confirm_yes':
      if (state.expecting === 'photo') return reask(state, 'Super!');
      if (state.step === 'review')
        return { state, replies: [CONFIRM_SUBMIT], effects: [] };
      return reask(state, NOT_UNDERSTOOD);
    case 'provide_info':
    case 'choose_type':
    case 'answer_rueckfrage':
      return absorbAndContinue(state, interp, deps);
    default:
      break;
  }
  if (state.step === 'idle')
    return reask(state, `${NOT_UNDERSTOOD} ${GREETING_HINT}`);
  return reask(state, NOT_UNDERSTOOD);
}

function hasAnyFact(interp: Interpretation): boolean {
  // isWorkshop alone is a tone hint ("sag, dass es ein Workshop ist").
  return Object.entries(interp.facts ?? {}).some(
    ([k, v]) => k !== 'isWorkshop' && v !== null && v !== undefined && v !== '',
  );
}

function skipOrDecline(
  state: DialogState,
  intent: 'decline_photo' | 'skip_optional' | 'confirm_no',
): DialogResult {
  const expecting = state.expecting;
  if (expecting === 'photo' || intent === 'decline_photo') {
    if (state.step === 'idle') return reask(state, NOT_UNDERSTOOD);
    if (state.type === 'projekt' && state.photoCount === 0)
      return { state, replies: [PHOTO_QUESTION_PROJEKT], effects: [] };
    if (expecting !== 'photo')
      // Declined early: don't ask for a photo later, keep the open question.
      return reask({ ...state, photoDeclined: true }, 'Okay, dann ohne Foto.');
    return askNextOrSummarize(
      { ...state, photoDeclined: true, expecting: null },
      'Kein Problem, dann ohne Foto.',
    );
  }
  if (expecting && expecting !== 'type' && expecting !== 'consent') {
    if (isRequired(state, expecting))
      return reask(state, 'Das brauche ich leider noch.');
    return askNextOrSummarize({ ...state, expecting: null }, '');
  }
  return reask(state, NOT_UNDERSTOOD);
}

function absorbAndContinue(
  state: DialogState,
  interp: Interpretation,
  deps: DialogDeps,
): DialogResult {
  const canChooseType =
    state.step === 'idle' ||
    state.step === 'type' ||
    interp.intent === 'choose_type';
  const type =
    canChooseType && interp.type ? interp.type : (state.type ?? undefined);
  const a = absorb({ ...state, type }, interp, deps);
  let s = a.state;
  const hints = a.hints;

  if (state.step === 'idle' || state.step === 'type') {
    const got = understood(s.facts, a.changed, true);
    if (!type) {
      s = { ...s, step: 'type', expecting: 'type' };
      const prefix = join(got, ...hints);
      return {
        state: s,
        replies: [prefix ? `${prefix}\n\n${TYPE_QUESTION}` : TYPE_QUESTION],
        effects: [],
      };
    }
    const intro =
      state.step === 'idle' && interp.type ? typeIntro(type, s.facts) : '';
    const head = [intro, got].filter(Boolean).join(' ');
    return askNextOrSummarize(
      { ...s, expecting: null },
      join(head ? (got ? `${head}\n` : head) : '', ...hints),
    );
  }

  if (state.step === 'review') {
    const factChanges = a.changed.filter((k) => k !== 'isWorkshop');
    const typeChanged = type !== state.type;
    if (factChanges.length || typeChanged) {
      const got = understood(s.facts, factChanges, false);
      // A changed type may need more answers (e.g. a Projekt needs a photo).
      const next = nextQuestion({ ...s, expecting: null });
      if (next !== null)
        return askNextOrSummarize(
          { ...s, expecting: null },
          join(got, ...hints),
        );
      return {
        state: { ...s, step: 'review', expecting: null },
        replies: got || hints.length ? [join(got, ...hints)] : [],
        effects: [{ kind: 'summary' }],
      };
    }
    return reask(s, hints.length ? join(...hints) : NOT_UNDERSTOOD);
  }

  // step === 'collect' (consent was handled before)
  const expecting = state.expecting === 'consent' ? null : state.expecting;
  if (
    expecting &&
    expecting !== 'photo' &&
    expecting !== 'type' &&
    !hasFact(s, expecting) &&
    a.changed.length === 0
  ) {
    const hint = hints.length
      ? join(...hints, questionText(s, expecting))
      : (RETRY_HINTS[expecting] ?? questionText(s, expecting));
    return { state: s, replies: [hint], effects: [] };
  }
  const got = understood(s.facts, a.changed, false);
  // An optional question that was interrupted by other facts is asked again.
  const stillOpen = expecting && expecting !== 'type' && !hasFact(s, expecting);
  const asked = stillOpen ? s.asked.filter((k) => k !== expecting) : s.asked;
  return askNextOrSummarize(
    { ...s, asked, expecting: null },
    join(got, ...hints),
  );
}

function handlePhoto(state: DialogState, photoId: number): DialogResult {
  const s: DialogState = {
    ...state,
    photoCount: state.photoCount + 1,
    photoDeclined: false,
    pendingConsentPhotoIds: [...state.pendingConsentPhotoIds, photoId],
    expecting: 'consent',
    step: state.step === 'idle' ? 'collect' : state.step,
  };
  if (state.expecting === 'consent') {
    // Several photos in a row: one consent answer covers all of them.
    return { state: s, replies: [], effects: [] };
  }
  return { state: s, replies: [CONSENT_QUESTION], effects: [] };
}
