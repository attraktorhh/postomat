import type {
  InterpretRule,
  ScriptedContext,
  ScriptedInterpretation,
} from '@postomat/testing';

/**
 * How the scripted stub model "understands" the messages used in the e2e
 * tests. This stands in for the LLM: matching message text here is test
 * fixture data, not product code (the product never matches text).
 */

const CONSENT = {
  '1': 'alle_einverstanden',
  '2': 'nicht_gefragt',
  '3': 'keine_personen',
} as const;

/** Short answers whose meaning depends on what the bot asked. */
function shortAnswer(
  text: string,
  ctx: ScriptedContext,
): ScriptedInterpretation {
  const t = text.trim().toLowerCase();
  if (ctx.erwartet === 'consent') {
    if (t in CONSENT)
      return { intent: 'answer_consent', consent: CONSENT[t as '1'] };
    if (t === 'nein')
      return { intent: 'answer_consent', consent: 'keine_personen' };
  }
  if (ctx.erwartet === 'type' && (t === '1' || t === '2'))
    return { intent: 'choose_type', type: t === '1' ? 'event' : 'projekt' };
  if (t === 'ja') return { intent: 'confirm_yes' };
  if (t === 'nein') {
    if (ctx.erwartet === 'photo') return { intent: 'decline_photo' };
    return { intent: 'confirm_no' };
  }
  return { intent: 'unclear' };
}

const FREE_TEXT = ['title', 'description', 'trickiest', 'audience'];

export const E2E_RULES: InterpretRule[] = [
  { match: 'Hallo', result: { intent: 'smalltalk_or_thanks' } },
  { match: 'Danke!', result: { intent: 'smalltalk_or_thanks' } },
  { match: 'hilfe', result: { intent: 'cmd_help' } },
  { match: 'Was kannst du eigentlich?', result: { intent: 'cmd_help' } },
  { match: 'status', result: { intent: 'cmd_status' } },
  { match: 'neu', result: { intent: 'cmd_new' } },
  { match: 'abbrechen', result: { intent: 'cmd_cancel' } },
  {
    match: 'Lass das, ich will das doch nicht mehr',
    result: { intent: 'cmd_cancel' },
  },
  // A real model sometimes repeats the command instead of saying yes.
  { match: 'weg damit', result: { intent: 'cmd_cancel' } },
  {
    match: 'Der Titel soll lieber „Lötabend“ heißen',
    result: {
      intent: 'request_text_change',
      instruction: 'Titel ändern in „Lötabend“',
      facts: { title: 'Lötabend' },
    },
  },
  { match: 'abschicken', result: { intent: 'confirm_submit' } },
  { match: 'passt, schick’s ab', result: { intent: 'confirm_submit' } },
  { match: 'nochmal', result: { intent: 'retry' } },
  {
    match: 'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
    result: {
      intent: 'provide_info',
      type: 'event',
      facts: {
        title: 'Lötkurs für Anfänger',
        description: 'An einem Abend lernst du löten, ganz ohne Vorkenntnisse.',
        date: '2026-11-27',
        isWorkshop: true,
      },
    },
  },
  {
    match:
      'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
    result: {
      intent: 'provide_info',
      facts: {
        date: '2026-12-11',
        startTime: '18:00',
        places: 8,
        costs: '5 € Material',
      },
    },
  },
  {
    // "Ich will am 11.12. einen <Titel> machen" – the type stays open.
    match: /^Ich will am 11\.12\. einen (.+) machen$/,
    result: (text) => ({
      intent: 'provide_info',
      facts: {
        title: /^Ich will am 11\.12\. einen (.+) machen$/.exec(text)![1],
        date: '2026-12-11',
      },
    }),
  },
  {
    match: '18 Uhr, 8 Plätze, kostenlos',
    result: {
      facts: { startTime: '18:00', places: 8, costs: 'kostenlos' },
    },
  },
  {
    match: 'Ich habe eine Nixie-Uhr gebaut',
    result: {
      intent: 'provide_info',
      type: 'projekt',
      facts: { title: 'Nixie-Uhr' },
    },
  },
  {
    match: 'Ab 12 Jahren',
    result: {
      intent: 'answer_rueckfrage',
      facts: { audience: 'ab 12 Jahren' },
    },
  },
  {
    match: 'Mach den Text bitte etwas lustiger',
    result: { intent: 'request_text_change', instruction: 'etwas lustiger' },
  },
  {
    match: 'Bitte nicht vor Montag posten',
    result: { intent: 'note_for_team', text: 'nicht vor Montag posten' },
  },
  // Answers to a free-text question go into the asked field.
  {
    match: (_t, ctx) => FREE_TEXT.includes(String(ctx.erwartet)),
    result: (text, ctx) => ({
      intent: 'provide_info',
      facts: { [String(ctx.erwartet)]: text },
    }),
  },
  { match: () => true, result: shortAnswer },
];

/** Medienteam replies to the Meetup candidate question. */
export function e2eCandidate(text: string): number | 'none' | 'unrelated' {
  const t = text.trim().toLowerCase();
  if (/^[1-9]$/.test(t)) return Number(t);
  if (t === 'das zweite') return 2;
  if (t === 'keins' || t === 'nein') return 'none';
  return 'unrelated';
}
