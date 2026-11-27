import { describe, expect, it } from 'vitest';
import {
  advanceDialog,
  expectedAnswer,
  initialDialogState,
  interpretContext,
  openQuestion,
  NOT_UNDERSTOOD,
  type DialogDeps,
  type DialogState,
} from '../src/dialog/dialog.ts';
import { CONSENT_QUESTION } from '../src/consent.ts';
import {
  emptyAiFacts,
  type AiFacts,
  type Interpretation,
} from '../src/interpretation.ts';

const NOW = new Date('2026-11-23T13:02:00Z'); // Monday
const deps: DialogDeps = { now: NOW, displayName: 'Lena' };

type Step =
  | number
  | (Partial<Omit<Interpretation, 'facts'>> & { facts?: Partial<AiFacts> });

const interp = (s: Exclude<Step, number>): Interpretation => ({
  intent: s.intent ?? 'provide_info',
  type: s.type ?? null,
  facts: { ...emptyAiFacts(), ...(s.facts ?? {}) },
  consent: s.consent ?? null,
  instruction: s.instruction ?? null,
  text: s.text ?? null,
});

function run(steps: Step[], start: DialogState = initialDialogState()) {
  let state = start;
  const replies: string[][] = [];
  const effects: string[] = [];
  for (const s of steps) {
    const r = advanceDialog(
      state,
      typeof s === 'number'
        ? { kind: 'photo', photoId: s }
        : { kind: 'message', interpretation: interp(s) },
      deps,
    );
    state = r.state;
    replies.push(r.replies);
    effects.push(...r.effects.map((e) => e.kind));
  }
  return { state, replies, last: replies.at(-1) ?? [], effects };
}

const walkthrough: Step[] = [
  {
    type: 'event',
    facts: {
      title: 'Lötkurs für Anfänger',
      description: 'An einem Abend lötest du dein eigenes Abzeichen.',
      date: '2026-11-27',
      isWorkshop: true,
    },
  },
  {
    facts: {
      date: '2026-12-11',
      startTime: '18:00',
      places: 8,
      costs: '5 € Material',
    },
  },
];

describe('AI-driven dialog', () => {
  it('greets on smalltalk', () => {
    const { last, state } = run([{ intent: 'smalltalk_or_thanks' }]);
    expect(last).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
    expect(state.step).toBe('idle');
  });

  it('runs the walkthrough: multi-fact answers skip questions, corrections overwrite', () => {
    const { replies, state } = run(walkthrough);
    expect(replies[0]).toEqual([
      'Cool, ein Workshop! Ich habe verstanden:\n• Lötkurs für Anfänger\n• Freitag, 27.11.\n\nUm wie viel Uhr geht’s los?',
    ]);
    expect(replies[1]).toEqual([
      'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nHast du ein Foto dazu? Schick es einfach hier rein.',
    ]);
    expect(state.facts).toMatchObject({
      date: '2026-12-11',
      startTime: '18:00',
      places: 8,
      costs: '5 € Material',
      isWorkshop: true,
    });
    expect(state.expecting).toBe('photo');
  });

  it('asks the consent question for a photo and maps the AI consent answer', () => {
    const { replies, effects, state } = run([
      ...walkthrough,
      101,
      { intent: 'answer_consent', consent: 'alle_einverstanden' },
    ]);
    expect(replies[2]).toEqual([CONSENT_QUESTION]);
    expect(replies[3]).toEqual([
      'Alles klar: Personen drauf, alle waren einverstanden.',
    ]);
    expect(effects).toEqual(['set_consent', 'summary']);
    expect(state.step).toBe('review');
  });

  it.each([
    ['alle_einverstanden', 'frei'],
    ['nicht_gefragt', 'einwilligung_fehlt'],
    ['keine_personen', 'frei'],
  ] as const)('consent %s → %s', (answer, consent) => {
    const r = advanceDialog(
      {
        ...run(walkthrough).state,
        expecting: 'consent',
        pendingConsentPhotoIds: [7],
        photoCount: 1,
      },
      {
        kind: 'message',
        interpretation: interp({ intent: 'answer_consent', consent: answer }),
      },
      deps,
    );
    expect(r.effects[0]).toEqual({
      kind: 'set_consent',
      photoIds: [7],
      consent,
    });
  });

  it('re-asks the consent question when the answer is unclear', () => {
    const { last, effects, state } = run([
      ...walkthrough,
      101,
      { intent: 'unclear' },
    ]);
    expect(last).toEqual([`${NOT_UNDERSTOOD}\n${CONSENT_QUESTION}`]);
    expect(effects).toEqual([]);
    expect(state.expecting).toBe('consent');
  });

  it('asks the type when the AI cannot tell, then takes the choice', () => {
    const r = run([{ facts: {} }]);
    expect(r.last[0]).toContain('Was möchtest du einreichen?');
    expect(r.state.expecting).toBe('type');
    const r2 = run([{ intent: 'choose_type', type: 'event' }], r.state);
    expect(r2.last).toEqual(['Wie soll der Titel lauten?']);
  });

  it('asks every question with short answers and skips optional ones in free wording', () => {
    const { replies, effects } = run([
      { intent: 'choose_type', type: 'event' },
      { facts: { title: 'Repair Café' } },
      { facts: { description: 'Wir reparieren.' } },
      { facts: { date: '2026-12-12' } },
      { facts: { startTime: '15:00' } },
      { intent: 'skip_optional' },
      { intent: 'skip_optional' },
      { intent: 'decline_photo' },
    ]);
    expect(replies.map((r) => r[0])).toEqual([
      'Cool, ein Event!\nWie soll der Titel lauten?',
      'Alles klar: Repair Café.\nWorum geht’s? Ein, zwei Sätze reichen.',
      'An welchem Tag ist es?',
      'Alles klar, Samstag 12.12.\nUm wie viel Uhr geht’s los?',
      'Alles klar, 15:00.\nWie viele Plätze gibt es? (Ist es egal, schreib „weiter“.)',
      'Kostet es etwas? Zum Beispiel „5 € Material“ oder „kostenlos“.',
      'Hast du ein Foto dazu? Schick es einfach hier rein.',
      'Kein Problem, dann ohne Foto.',
    ]);
    expect(effects).toEqual(['summary']);
  });

  it('refuses to skip a required question', () => {
    const { last } = run([
      { intent: 'choose_type', type: 'event' },
      { intent: 'skip_optional' },
    ]);
    expect(last).toEqual([
      'Das brauche ich leider noch.\nWie soll der Titel lauten?',
    ]);
    expect(run([{ intent: 'choose_type', type: 'event' }]).last).toEqual([
      'Cool, ein Event!\nWie soll der Titel lauten?',
    ]);
  });

  it('re-asks with a hint when the answer has no usable value', () => {
    const { last } = run([
      {
        type: 'event',
        facts: { title: 'Repair Café', description: 'Wir reparieren.' },
      },
      { facts: {} },
    ]);
    expect(last[0]).toContain('Ich habe kein Datum erkannt');
  });

  it.each([
    [{ date: '2026-02-30' }, 'Das Datum konnte ich nicht zuordnen.'],
    [{ date: '2026-11-20' }, 'Das Datum liegt in der Vergangenheit.'],
    [
      { date: '2026-12-11', startTime: '25:00' },
      'Die Uhrzeit konnte ich nicht zuordnen.',
    ],
  ] as const)('drops invalid AI values %j and asks again', (facts, hint) => {
    const { last, state } = run([
      {
        type: 'event',
        facts: { title: 'Repair Café', description: 'Wir reparieren.' },
      },
      { facts },
    ]);
    expect(last[0]).toContain(hint);
    expect(state.facts.startTime).toBeUndefined();
    if (facts.date !== '2026-12-11') expect(state.facts.date).toBeUndefined();
    expect(last[0]).toMatch(
      /An welchem Tag ist es\?|Um wie viel Uhr geht’s los\?/,
    );
  });

  it('drops an end time before the start time', () => {
    const { state, last } = run([
      {
        type: 'event',
        facts: { title: 'X', description: 'Y.', date: '2026-12-11' },
      },
      { facts: { startTime: '18:00', endTime: '17:00' } },
    ]);
    expect(state.facts.startTime).toBe('18:00');
    expect(state.facts.endTime).toBeUndefined();
    expect(last[0]).toContain('Das Ende liegt vor dem Beginn');
  });

  it('runs the Projekt flow and requires a photo', () => {
    const { replies, effects } = run([
      { type: 'projekt', facts: { title: 'Nixie-Uhr' } },
      { facts: { description: 'Eine Uhr mit alten Röhren.' } },
      { facts: { trickiest: 'Die Hochspannung.' } },
      { intent: 'decline_photo' },
      7,
      { intent: 'answer_consent', consent: 'nicht_gefragt' },
    ]);
    expect(replies[0][0]).toContain('Cool, ein Projekt!');
    expect(replies[0][0]).toContain('Was hast du gebaut?');
    expect(replies[1][0]).toBe('Was war das Kniffligste?');
    expect(replies[3]).toEqual([
      'Schick mir bitte ein Foto davon. Für Projekte brauche ich mindestens eins.',
    ]);
    expect(effects).toEqual(['set_consent', 'summary']);
  });

  it('applies facts the AI filed as a text change (collect and review)', () => {
    const collect = run(walkthrough.slice(0, 2));
    expect(collect.state.step).toBe('collect');
    const c = advanceDialog(
      collect.state,
      {
        kind: 'message',
        interpretation: interp({
          intent: 'request_text_change',
          instruction: 'Titel ändern',
          facts: { title: 'Lötabend' },
        }),
      },
      deps,
    );
    expect(c.state.facts.title).toBe('Lötabend');
    expect(c.replies.join('\n')).not.toContain(NOT_UNDERSTOOD);

    const review = run([...walkthrough, { intent: 'decline_photo' }]).state;
    const r = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({
          intent: 'request_text_change',
          instruction: 'Titel ändern',
          facts: { title: 'Lötabend' },
        }),
      },
      deps,
    );
    expect(r.state.facts.title).toBe('Lötabend');
    expect(r.effects).toEqual([{ kind: 'summary' }]);

    // isWorkshop alone stays a text change wish
    const w = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({
          intent: 'request_text_change',
          instruction: 'sag, dass es ein Workshop ist',
          facts: { isWorkshop: true },
        }),
      },
      deps,
    );
    expect(w.effects[0]).toMatchObject({ kind: 'change_request' });
  });

  it('gives the AI the open confirmation as the question', () => {
    const review = run([...walkthrough, { intent: 'decline_photo' }]).state;
    const ctx = interpretContext(
      { ...review, pendingConfirmation: 'cancel' },
      { pendingConfirmation: 'Deinen Entwurf „X“ verwerfen? (ja/nein)' },
    );
    expect(ctx.expecting).toBe('confirmation');
    expect(ctx.question).toBe('Deinen Entwurf „X“ verwerfen? (ja/nein)');
  });

  it('turns change wishes and notes in review into effects', () => {
    const review = run([...walkthrough, { intent: 'decline_photo' }]).state;
    expect(review.step).toBe('review');
    const change = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({
          intent: 'request_text_change',
          instruction: 'lustiger',
        }),
      },
      deps,
    );
    expect(change.effects).toEqual([
      { kind: 'change_request', instruction: 'lustiger' },
    ]);
    const note = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({
          intent: 'note_for_team',
          text: 'bitte erst ab Montag',
        }),
      },
      deps,
    );
    expect(note.effects).toEqual([{ kind: 'note' }]);
    expect(note.replies[0]).toContain('Notiz fürs Medienteam');
    const thanks = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({ intent: 'smalltalk_or_thanks' }),
      },
      deps,
    );
    expect(thanks.effects).toEqual([]);
  });

  it('re-sends the summary when facts change in review', () => {
    const review = run([...walkthrough, { intent: 'decline_photo' }]).state;
    const r = advanceDialog(
      review,
      {
        kind: 'message',
        interpretation: interp({ facts: { startTime: '19:00' } }),
      },
      deps,
    );
    expect(r.replies).toEqual(['Alles klar, 19:00.']);
    expect(r.effects).toEqual([{ kind: 'summary' }]);
  });

  it('retries a failed summary on "nochmal"', () => {
    const review = {
      ...run([...walkthrough, { intent: 'decline_photo' }]).state,
      summaryPending: true,
    };
    expect(expectedAnswer(review)).toBe('retry');
    const r = advanceDialog(
      review,
      { kind: 'message', interpretation: interp({ intent: 'retry' }) },
      deps,
    );
    expect(r.effects).toEqual([{ kind: 'summary' }]);
  });

  it('says it did not understand and repeats the open question', () => {
    const { last } = run([
      { type: 'event', facts: { title: 'X', description: 'Y.' } },
      { intent: 'unclear' },
    ]);
    expect(last).toEqual([`${NOT_UNDERSTOOD}\nAn welchem Tag ist es?`]);
  });

  it('builds the AI context without names', () => {
    const s = run(walkthrough).state;
    const ctx = interpretContext(s, { openRueckfrage: null });
    expect(ctx).toMatchObject({
      expecting: 'photo',
      question: 'Hast du ein Foto dazu? Schick es einfach hier rein.',
      type: 'event',
      hasPhoto: false,
    });
    expect(JSON.stringify(ctx)).not.toContain('Lena');
    expect(openQuestion(initialDialogState())).toContain('Erzähl mir');
  });
});
