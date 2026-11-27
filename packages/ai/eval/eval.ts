/**
 * Live evaluation of the configured LLM (not part of CI):
 *   pnpm nx run ai:eval        (uses the AI_* settings from .env)
 *
 * Runs the walkthrough plus tricky German inputs through the real AiService
 * and prints the accuracy per field. Use it to choose a model before the pilot.
 */
import {
  emptyAiFacts,
  loadEnv,
  type InterpretContext,
  type Interpretation,
} from '@postomat/core';
import { createAiFromEnv, isAiError } from '../src/index.ts';

type Expected = Partial<
  Pick<Interpretation, 'intent' | 'type' | 'consent'> &
    Record<keyof ReturnType<typeof emptyAiFacts>, unknown>
>;

interface Case {
  name: string;
  text: string;
  now: string;
  context?: Partial<InterpretContext>;
  expect: Expected;
}

const MON = '2026-11-23T13:02:00Z'; // Monday 14:02 Berlin
const FRI = '2026-11-27T10:00:00Z'; // Friday
const MON_30 = '2026-11-30T09:00:00Z'; // Monday, last day of November

const base: InterpretContext = {
  expecting: null,
  type: null,
  facts: {},
  hasPhoto: false,
  openRueckfrage: null,
  pendingConfirmation: null,
};

const CASES: Case[] = [
  // --- walkthrough
  {
    name: 'walkthrough 1: first sentence',
    text: 'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
    now: MON,
    expect: {
      intent: 'provide_info',
      type: 'event',
      date: '2026-11-27',
      isWorkshop: true,
    },
  },
  {
    name: 'walkthrough 2: correction with several facts',
    text: 'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
    now: MON,
    context: {
      expecting: 'startTime',
      type: 'event',
      facts: { title: 'Lötkurs für Anfänger', date: '2026-11-27' },
    },
    expect: { date: '2026-12-11', startTime: '18:00', places: 8 },
  },
  {
    name: 'walkthrough 3: consent "1"',
    text: '1',
    now: MON,
    context: { expecting: 'consent', type: 'event', hasPhoto: true },
    expect: { intent: 'answer_consent', consent: 'alle_einverstanden' },
  },
  {
    name: 'walkthrough 4: abschicken',
    text: 'abschicken',
    now: MON,
    context: { expecting: 'submit', type: 'event' },
    expect: { intent: 'confirm_submit' },
  },
  // --- dates
  {
    name: 'relative weekday across a month boundary',
    text: 'Nächsten Dienstag um 19 Uhr',
    now: FRI,
    context: { expecting: 'date', type: 'event' },
    expect: { date: '2026-12-01', startTime: '19:00' },
  },
  {
    name: '"morgen" on the last day of the month',
    text: 'morgen ab 18 Uhr',
    now: MON_30,
    context: { expecting: 'date', type: 'event' },
    expect: { date: '2026-12-01', startTime: '18:00' },
  },
  {
    name: '"den Freitag danach" relative to the known date',
    text: 'Ach nee, doch den Freitag danach',
    now: MON,
    context: {
      expecting: 'places',
      type: 'event',
      facts: { date: '2026-12-11' },
    },
    expect: { intent: 'provide_info', date: '2026-12-18' },
  },
  {
    name: 'first Saturday of next month',
    text: 'Am ersten Samstag im Dezember',
    now: MON,
    context: { expecting: 'date', type: 'event' },
    expect: { date: '2026-12-05' },
  },
  // --- times, places, costs
  {
    name: 'time range "18–21 Uhr"',
    text: '18–21 Uhr',
    now: MON,
    context: { expecting: 'startTime', type: 'event' },
    expect: { startTime: '18:00', endTime: '21:00' },
  },
  {
    name: '"umsonst" for the costs question',
    text: 'umsonst',
    now: MON,
    context: { expecting: 'costs', type: 'event' },
    expect: { costs: 'kostenlos' },
  },
  {
    name: 'skip an optional question in free wording',
    text: 'weiß ich noch nicht',
    now: MON,
    context: { expecting: 'places', type: 'event' },
    expect: { intent: 'skip_optional' },
  },
  // --- consent
  {
    name: 'consent: everybody agreed, free wording',
    text: 'alle haben ja gesagt',
    now: MON,
    context: { expecting: 'consent', hasPhoto: true },
    expect: { intent: 'answer_consent', consent: 'alle_einverstanden' },
  },
  {
    name: 'consent: no people',
    text: 'nee, keiner drauf',
    now: MON,
    context: { expecting: 'consent', hasPhoto: true },
    expect: { intent: 'answer_consent', consent: 'keine_personen' },
  },
  {
    name: 'consent: people, not asked',
    text: 'da sind ein paar Leute drauf, hab aber nicht gefragt',
    now: MON,
    context: { expecting: 'consent', hasPhoto: true },
    expect: { intent: 'answer_consent', consent: 'nicht_gefragt' },
  },
  // --- type, photo
  {
    name: 'type in free wording',
    text: 'hab was gebaut',
    now: MON,
    context: { expecting: 'type' },
    expect: { intent: 'choose_type', type: 'projekt' },
  },
  {
    name: 'decline the photo',
    text: 'hab keins',
    now: MON,
    context: { expecting: 'photo', type: 'event' },
    expect: { intent: 'decline_photo' },
  },
  // --- commands in free wording
  {
    name: 'help in free wording',
    text: 'Was kannst du eigentlich?',
    now: MON,
    expect: { intent: 'cmd_help' },
  },
  {
    name: 'status in free wording',
    text: 'zeig mal meine Beiträge',
    now: MON,
    expect: { intent: 'cmd_status' },
  },
  {
    name: 'cancel in free wording',
    text: 'vergiss es, lösch den Entwurf',
    now: MON,
    context: { expecting: 'date', type: 'event', facts: { title: 'Lötkurs' } },
    expect: { intent: 'cmd_cancel' },
  },
  {
    name: 'new post in free wording',
    text: 'ich will was ganz Neues anfangen',
    now: MON,
    expect: { intent: 'cmd_new' },
  },
  {
    name: 'submit in free wording',
    text: 'passt so, schick’s ab',
    now: MON,
    context: { expecting: 'submit', type: 'event' },
    expect: { intent: 'confirm_submit' },
  },
  {
    name: 'yes to a pending confirmation',
    text: 'jo, weg damit',
    now: MON,
    context: {
      expecting: 'confirmation',
      pendingConfirmation: 'Deinen Entwurf „Lötkurs“ verwerfen? (ja/nein)',
    },
    expect: { intent: 'confirm_yes' },
  },
  {
    name: 'text change wish',
    text: 'Mach den Text bitte etwas lockerer',
    now: MON,
    context: { expecting: 'submit', type: 'event' },
    expect: { intent: 'request_text_change' },
  },
  {
    name: 'answer to a Rückfrage',
    text: 'Ab 12 Jahren',
    now: MON,
    context: { openRueckfrage: 'Gibt es eine Altersgrenze?' },
    expect: { intent: 'answer_rueckfrage' },
  },
];

const CANDIDATES = [
  { title: 'Lötkurs', date: '2026-12-11', time: '18:00' },
  { title: 'Löten für Kids', date: '2026-12-11', time: '18:30' },
];
const CANDIDATE_CASES: Array<{
  text: string;
  expect: number | 'none' | 'unrelated';
}> = [
  { text: '2', expect: 2 },
  { text: 'das zweite', expect: 2 },
  { text: 'das mit den Kids', expect: 2 },
  { text: 'keins davon', expect: 'none' },
  { text: 'Bitte den Titel noch kürzen', expect: 'unrelated' },
];

const env = loadEnv();
const ai = createAiFromEnv(env);
console.log(
  `AI eval: ${env.AI_PROVIDER} ${env.AI_BASE_URL ?? '(default URL)'} ${env.AI_MODEL} reasoning=${env.AI_REASONING ?? 'provider default'}\n`,
);

const fields = new Map<string, { ok: number; total: number }>();
const count = (field: string, ok: boolean) => {
  const f = fields.get(field) ?? { ok: 0, total: 0 };
  f.total++;
  if (ok) f.ok++;
  fields.set(field, f);
};
const norm = (v: unknown) =>
  typeof v === 'string' ? v.trim().toLowerCase() : v;

let failedCalls = 0;
for (const c of CASES) {
  let r: Interpretation;
  try {
    r = await ai.interpret({
      text: c.text,
      context: { ...base, ...c.context },
      now: new Date(c.now),
    });
  } catch (e) {
    failedCalls++;
    console.log(`✗ ${c.name}: ${isAiError(e) ? e.kind : String(e)}`);
    for (const k of Object.keys(c.expect)) count(k, false);
    continue;
  }
  const got: Record<string, unknown> = {
    intent: r.intent,
    type: r.type,
    consent: r.consent,
    ...r.facts,
  };
  const wrong = Object.entries(c.expect).filter(([k, v]) => {
    const ok =
      k === 'costs'
        ? String(norm(got[k]) ?? '').includes(String(norm(v)))
        : norm(got[k]) === norm(v);
    count(k, ok);
    return !ok;
  });
  console.log(
    `${wrong.length ? '✗' : '✓'} ${c.name}${
      wrong.length
        ? `  (${wrong.map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`).join('; ')})`
        : ''
    }`,
  );
}

for (const c of CANDIDATE_CASES) {
  let choice: unknown;
  try {
    choice = (
      await ai.interpretCandidateReply({ text: c.text, candidates: CANDIDATES })
    ).choice;
  } catch (e) {
    failedCalls++;
    choice = isAiError(e) ? `error:${e.kind}` : 'error';
  }
  const ok = choice === c.expect;
  count('meetupChoice', ok);
  console.log(
    `${ok ? '✓' : '✗'} Meetup reply "${c.text}"${ok ? '' : ` (expected ${c.expect}, got ${String(choice)})`}`,
  );
}

console.log('\nAccuracy per field');
let ok = 0;
let total = 0;
for (const [field, f] of [...fields].sort(([a], [b]) => a.localeCompare(b))) {
  ok += f.ok;
  total += f.total;
  console.log(
    `  ${field.padEnd(14)} ${f.ok}/${f.total}  ${Math.round((100 * f.ok) / f.total)} %`,
  );
}
console.log(
  `  ${'overall'.padEnd(14)} ${ok}/${total}  ${Math.round((100 * ok) / total)} %`,
);
if (failedCalls)
  console.log(`\n${failedCalls} call(s) failed (timeout, HTTP or schema).`);
