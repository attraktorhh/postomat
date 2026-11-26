import type { FactKey, PostFacts, PostType } from '../types.ts';
import { extractFacts, guessTitle, guessType } from '../extract.ts';
import { factsLineDm } from '../format.ts';
import { weekdayDe, dayMonthDe } from '../time.ts';
import { CONSENT_QUESTION, parseConsentAnswer } from '../consent.ts';
import type { Consent } from '../types.ts';

/** Where the conversation currently is. */
export type DialogStep = 'idle' | 'type' | 'collect' | 'review';

export type Expecting = FactKey | 'type' | 'photo' | 'consent' | null;

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
  /** Raw member texts, used for AI generation and as context. */
  transcript: string[];
}

export const initialDialogState = (): DialogState => ({
  step: 'idle',
  facts: {},
  expecting: null,
  asked: [],
  photoCount: 0,
  pendingConsentPhotoIds: [],
  photoDeclined: false,
  transcript: [],
});

/** Result of an AI extraction (optional dependency). */
export interface AiExtraction {
  type?: PostType;
  facts: PostFacts;
}

export interface DialogDeps {
  now: Date;
  displayName: string;
  /** Optional AI extractor. Returns null on error/timeout → fallback parser. */
  aiExtract?: (input: {
    text: string;
    state: DialogState;
  }) => Promise<AiExtraction | null>;
}

export type DialogInput =
  { kind: 'text'; text: string } | { kind: 'photo'; photoId: number };

export type DialogEffect =
  | { kind: 'set_consent'; photoIds: number[]; consent: Consent }
  /** All facts are collected: generate texts + banner and send the summary. */
  | { kind: 'summary' }
  /** Member asked for a text change in review. */
  | { kind: 'change_request'; instruction: string };

export interface DialogResult {
  state: DialogState;
  replies: string[];
  effects: DialogEffect[];
}

export const GREETING = (name: string) =>
  `Hi ${name}! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.`;

export const TYPE_QUESTION =
  'Was möchtest du einreichen?\n1️⃣ Event (ein Termin im Attraktor)\n2️⃣ Projekt (etwas, das du gebaut hast)';

const QUESTIONS: Partial<Record<FactKey, string>> = {
  title: 'Wie soll der Titel lauten?',
  description: 'Worum geht’s? Ein, zwei Sätze reichen.',
  date: 'An welchem Tag ist es?',
  startTime: 'Um wie viel Uhr geht’s los?',
  places: 'Wie viele Plätze gibt es? (Ist es egal, schreib „weiter“.)',
  costs: 'Kostet es etwas? Zum Beispiel „5 € Material“ oder „kostenlos“.',
  trickiest: 'Was war das Kniffligste?',
};

const RETRY_HINTS: Partial<Record<FactKey, string>> = {
  date: 'Ich habe kein Datum erkannt. Schreib es zum Beispiel so: „11.12.“ oder „nächsten Freitag“.',
  startTime:
    'Ich habe keine Uhrzeit erkannt. Schreib sie zum Beispiel so: „18 Uhr“ oder „18–21 Uhr“.',
  places: 'Wie viele Plätze? Eine Zahl reicht, oder „weiter“.',
  costs: 'Kostet es etwas? Zum Beispiel „5 €“, „kostenlos“ oder „weiter“.',
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

const SKIP_RE =
  /^\s*(weiter|-|–|skip|überspringen|egal|weiß nicht|keine ahnung)\s*[.!]?\s*$/i;
const NO_RE =
  /^\s*(nein|nö|noe|ne|nee|kein foto|keins|hab keins|habe keins|weiter|-|–)\s*[.!]?\s*$/i;
const GREETING_RE =
  /^\s*(hi|hallo|hey|moin|servus|huhu|guten (morgen|tag|abend)|na|neu|start)\s*[!.]?\s*$/i;

const BARE_TYPE_RE = /^\s*(1|2|1️⃣|2️⃣|event|projekt)\s*[.!]?\s*$/iu;
/** A correction of earlier facts, not an answer to a free-text question. */
const CORRECTION_RE =
  /^\s*(nee|nein|ne|doch|korrektur|sorry|ach|äh|oh|moment)\b/i;
const STRUCTURED: FactKey[] = ['date', 'startTime', 'places', 'costs'];

function hasFact(state: DialogState, key: FactKey | 'photo'): boolean {
  if (key === 'photo') return state.photoCount > 0;
  const v = state.facts[key];
  return v !== undefined && v !== '';
}

/** The next thing to ask, or null when everything is collected. */
export function nextQuestion(state: DialogState): FactKey | 'photo' | null {
  if (!state.type) return null;
  for (const key of ORDER[state.type]) {
    if (hasFact(state, key)) continue;
    const required = REQUIRED[state.type].includes(key);
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
  return QUESTIONS[key] ?? `${key}?`;
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
  return { facts, changed };
}

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

async function absorbText(
  state: DialogState,
  text: string,
  deps: DialogDeps,
): Promise<{
  state: DialogState;
  changed: FactKey[];
  typeDetected?: PostType;
}> {
  const expecting =
    state.expecting &&
    state.expecting !== 'type' &&
    state.expecting !== 'photo' &&
    state.expecting !== 'consent'
      ? state.expecting
      : undefined;
  let extracted: PostFacts = extractFacts(text, { now: deps.now, expecting });
  let typeDetected: PostType | undefined;
  if (deps.aiExtract) {
    const ai = await deps.aiExtract({ text, state });
    if (ai) {
      // Deterministic values win for the field that was explicitly asked.
      const aiFacts = Object.fromEntries(
        Object.entries(ai.facts).filter(
          ([, v]) => v !== undefined && v !== null && v !== '',
        ),
      ) as PostFacts;
      extracted = {
        ...extracted,
        ...aiFacts,
        ...(expecting ? pick(extracted, expecting) : {}),
      };
      typeDetected = ai.type;
    }
  }
  if (!state.facts.title && !extracted.title && state.step === 'idle') {
    const t = guessTitle(text);
    if (t) extracted.title = t;
  }
  const { facts, changed } = mergeFacts(state.facts, extracted);
  return {
    state: { ...state, facts, transcript: [...state.transcript, text] },
    changed,
    typeDetected,
  };
}

function pick(f: PostFacts, key: FactKey): PostFacts {
  const out: PostFacts = {};
  if (f[key] !== undefined) (out as Record<string, unknown>)[key] = f[key];
  if (key === 'startTime' && f.endTime) out.endTime = f.endTime;
  return out;
}

function askNextOrSummarize(state: DialogState, prefix: string): DialogResult {
  const next = nextQuestion(state);
  if (next === null) {
    return {
      state: { ...state, step: 'review', expecting: null },
      replies: prefix ? [prefix] : [],
      effects: [{ kind: 'summary' }],
    };
  }
  const asked =
    next !== 'photo' && REQUIRED[state.type!].includes(next)
      ? state.asked
      : [...state.asked, next];
  const q = questionText(state, next);
  return {
    state: {
      ...state,
      step: 'collect',
      expecting: next,
      asked: Array.from(new Set(asked)),
    },
    replies: [prefix ? `${prefix}\n${q}` : q],
    effects: [],
  };
}

/** The question the member still has to answer (for "abschicken" too early). */
export function openQuestion(state: DialogState): string | undefined {
  if (state.expecting === 'consent') return CONSENT_QUESTION;
  if (state.expecting === 'type') return TYPE_QUESTION;
  if (state.expecting) return questionText(state, state.expecting);
  if (state.step === 'idle') return GREETING_HINT;
  return undefined;
}

const GREETING_HINT = 'Erzähl mir erst in einem Satz, was du vorhast.';

function parseTypeAnswer(text: string): PostType | undefined {
  const t = text.trim().toLowerCase();
  if (
    /^(1|1️⃣|eins|event|termin|veranstaltung)\b/u.test(t) ||
    t.startsWith('1️⃣')
  )
    return 'event';
  if (/^(2|2️⃣|zwei|projekt)\b/u.test(t) || t.startsWith('2️⃣')) return 'projekt';
  return undefined;
}

/**
 * Advances the DM dialog by one member message. Pure apart from the optional
 * AI call: storage, Matrix and text generation are done by the caller.
 */
export async function advanceDialog(
  state: DialogState,
  input: DialogInput,
  deps: DialogDeps,
): Promise<DialogResult> {
  if (input.kind === 'photo') return handlePhoto(state, input.photoId);
  const text = input.text.trim();

  if (state.expecting === 'consent') {
    const consent = parseConsentAnswer(text);
    if (!consent)
      return {
        state,
        replies: [
          'Antworte bitte mit 1, 2 oder 3.\n' +
            CONSENT_QUESTION.split('\n').slice(1).join('\n'),
        ],
        effects: [],
      };
    const effects: DialogEffect[] = [
      { kind: 'set_consent', photoIds: state.pendingConsentPhotoIds, consent },
    ];
    const next = askNextOrSummarize(
      { ...state, pendingConsentPhotoIds: [], expecting: null },
      '',
    );
    return { ...next, effects: [...effects, ...next.effects] };
  }

  if (state.step === 'idle') {
    if (BARE_TYPE_RE.test(text)) {
      // "1"/"2" straight away (e.g. the member knows the menu already).
      return askNextOrSummarize(
        { ...state, type: parseTypeAnswer(text), expecting: null },
        '',
      );
    }
    if (GREETING_RE.test(text)) {
      return {
        state: { ...state, expecting: null },
        replies: [GREETING(deps.displayName)],
        effects: [],
      };
    }
    const absorbed = await absorbText(state, text, deps);
    let s = absorbed.state;
    const type =
      absorbed.typeDetected ??
      (deps.aiExtract ? guessType(text, deps.now) : undefined);
    const got = understood(s.facts, absorbed.changed, true);
    if (!type) {
      s = { ...s, step: 'type', expecting: 'type' };
      return {
        state: s,
        replies: [got ? `${got}\n\n${TYPE_QUESTION}` : TYPE_QUESTION],
        effects: [],
      };
    }
    s = { ...s, type };
    const intro =
      type === 'event'
        ? s.facts.isWorkshop
          ? 'Cool, ein Workshop!'
          : 'Cool, ein Event!'
        : 'Cool, ein Projekt!';
    return askNextOrSummarize(s, got ? `${intro} ${got}\n` : `${intro}`);
  }

  if (state.step === 'type') {
    const type = parseTypeAnswer(text);
    if (!type) {
      // Keep facts the member added instead of choosing (e.g. a corrected date).
      const absorbed = await absorbText(state, text, deps);
      const got = understood(absorbed.state.facts, absorbed.changed, false);
      return {
        state: absorbed.state,
        replies: [
          `${got ? `${got}\n` : ''}Antworte bitte mit 1 oder 2.\n${TYPE_QUESTION}`,
        ],
        effects: [],
      };
    }
    return askNextOrSummarize({ ...state, type, expecting: null }, '');
  }

  if (state.step === 'review') {
    const absorbed = await absorbText(
      { ...state, expecting: null },
      text,
      deps,
    );
    const factChanges = absorbed.changed.filter((k) => k !== 'isWorkshop');
    if (factChanges.length) {
      const got = understood(absorbed.state.facts, factChanges, false);
      return {
        state: { ...absorbed.state, step: 'review' },
        replies: got ? [got] : [],
        effects: [{ kind: 'summary' }],
      };
    }
    const instruction = text.replace(/^text\s+ändern\s*:?\s*/i, '').trim();
    return {
      state: absorbed.state,
      replies: [],
      effects: [{ kind: 'change_request', instruction }],
    };
  }

  // step === 'collect'
  const expecting = state.expecting;
  if (expecting === 'photo') {
    if (NO_RE.test(text)) {
      if (state.type === 'projekt')
        return { state, replies: [PHOTO_QUESTION_PROJEKT], effects: [] };
      return askNextOrSummarize(
        { ...state, photoDeclined: true, expecting: null },
        'Kein Problem, dann ohne Foto.',
      );
    }
  } else if (expecting && expecting !== 'type' && SKIP_RE.test(text)) {
    if (REQUIRED[state.type!].includes(expecting)) {
      return {
        state,
        replies: [
          `Das brauche ich leider noch. ${questionText(state, expecting)}`,
        ],
        effects: [],
      };
    }
    return askNextOrSummarize({ ...state, expecting: null }, '');
  }

  const freeText =
    expecting === 'description' ||
    expecting === 'trickiest' ||
    expecting === 'audience';
  const absorbed = await absorbText(state, text, deps);
  let s = absorbed.state;
  if (freeText && expecting && state.facts[expecting] === undefined) {
    const structured = absorbed.changed.filter((k) => STRUCTURED.includes(k));
    if (
      structured.length > 0 &&
      (CORRECTION_RE.test(text) || structured.length >= 3)
    ) {
      // Facts only ("Nee, den 11.12.! 18 Uhr, 8 Leute") – not the description.
      const facts = { ...s.facts };
      delete facts[expecting];
      s = { ...s, facts };
      absorbed.changed = absorbed.changed.filter((k) => k !== expecting);
    }
  }
  if (
    expecting &&
    expecting !== 'photo' &&
    expecting !== 'type' &&
    !hasFact(s, expecting) &&
    absorbed.changed.length === 0
  ) {
    return {
      state: s,
      replies: [RETRY_HINTS[expecting] ?? questionText(s, expecting)],
      effects: [],
    };
  }
  // Don't echo a free-text answer back; repeat only the parsed facts.
  // A title taken from a longer sentence is repeated, a plain answer is not.
  const changed = absorbed.changed.filter(
    (k) =>
      !(
        k === 'title' &&
        expecting === 'title' &&
        s.facts.title === text.replace(/[.!]+$/, '')
      ),
  );
  const got = understood(s.facts, changed, false);
  // An optional question that was interrupted by other facts is asked again.
  // (consent was handled above; type is not a collect step)
  const stillOpen = expecting && expecting !== 'type' && !hasFact(s, expecting);
  const asked = stillOpen ? s.asked.filter((k) => k !== expecting) : s.asked;
  return askNextOrSummarize({ ...s, asked, expecting: null }, got);
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
