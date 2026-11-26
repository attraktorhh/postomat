import { describe, expect, it } from 'vitest';
import {
  advanceDialog,
  initialDialogState,
  openQuestion,
  type DialogDeps,
  type DialogState,
  type DialogInput,
} from '../src/dialog/dialog.ts';
import { CONSENT_QUESTION } from '../src/consent.ts';

const NOW = new Date('2026-11-23T13:02:00Z');
const noAi: DialogDeps = { now: NOW, displayName: 'Lena' };

async function run(inputs: Array<string | number>, deps: DialogDeps = noAi) {
  let state: DialogState = initialDialogState();
  const transcript: string[] = [];
  const effects: string[] = [];
  for (const i of inputs) {
    const input: DialogInput =
      typeof i === 'number'
        ? { kind: 'photo', photoId: i }
        : { kind: 'text', text: i };
    const r = await advanceDialog(state, input, deps);
    state = r.state;
    transcript.push(...r.replies);
    effects.push(...r.effects.map((e) => e.kind));
  }
  return { state, transcript, effects };
}

describe('dialog without AI', () => {
  it('greets on hello', async () => {
    const { transcript } = await run(['Hallo']);
    expect(transcript).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
  });

  it('runs the event flow with the type menu and skips answered questions', async () => {
    const { transcript, state, effects } = await run([
      'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      '1',
      'An einem Abend lötest du dein eigenes blinkendes Abzeichen.',
      'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
      101,
      '1',
    ]);
    expect(transcript[0]).toBe(
      'Ich habe verstanden:\n• Lötkurs für Anfänger\n• Freitag, 27.11.\n\nWas möchtest du einreichen?\n1️⃣ Event (ein Termin im Attraktor)\n2️⃣ Projekt (etwas, das du gebaut hast)',
    );
    // title and date are known → next is the description
    expect(transcript[1]).toBe('Worum geht’s? Ein, zwei Sätze reichen.');
    expect(transcript[2]).toBe('Um wie viel Uhr geht’s los?');
    expect(transcript[3]).toBe(
      'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nHast du ein Foto dazu? Schick es einfach hier rein.',
    );
    expect(transcript[4]).toBe(CONSENT_QUESTION);
    expect(effects).toEqual(['set_consent', 'summary']);
    expect(state.step).toBe('review');
    expect(state.facts).toMatchObject({
      title: 'Lötkurs für Anfänger',
      date: '2026-12-11',
      startTime: '18:00',
      places: 8,
      costs: '5 € Material',
      isWorkshop: true,
    });
  });

  it('asks every fixed question when answers are short and allows skipping optional ones', async () => {
    const { transcript, effects } = await run([
      'Hallo',
      'Ich mach was',
      '1',
      'Repair Café',
      'Wir reparieren.',
      '12.12.',
      '15',
      'weiter',
      '-',
      'nö',
    ]);
    expect(transcript.slice(2)).toEqual([
      'Wie soll der Titel lauten?',
      'Worum geht’s? Ein, zwei Sätze reichen.',
      'An welchem Tag ist es?',
      'Alles klar, Samstag 12.12.\nUm wie viel Uhr geht’s los?',
      'Alles klar, 15:00.\nWie viele Plätze gibt es? (Ist es egal, schreib „weiter“.)',
      'Kostet es etwas? Zum Beispiel „5 € Material“ oder „kostenlos“.',
      'Hast du ein Foto dazu? Schick es einfach hier rein.',
      'Kein Problem, dann ohne Foto.',
    ]);
    expect(effects).toEqual(['summary']);
  });

  it('re-asks when the answer has no usable date', async () => {
    const { transcript } = await run([
      'Ich mach was',
      '1',
      'Repair Café',
      'Wir reparieren.',
      'weiß noch nicht so genau',
    ]);
    expect(transcript.at(-1)).toContain('Ich habe kein Datum erkannt');
  });

  it('runs the Projekt flow and requires a photo', async () => {
    const { transcript, effects, state } = await run([
      'Ich habe eine Nixie-Uhr gebaut',
      '2',
      'Eine Uhr mit alten Röhren.',
      'Die Hochspannung.',
      'nein',
      7,
      '2',
    ]);
    expect(transcript).toContain('Was war das Kniffligste?');
    expect(
      transcript.filter((t) =>
        t.includes('Für Projekte brauche ich mindestens eins'),
      ).length,
    ).toBe(2);
    expect(effects).toEqual(['set_consent', 'summary']);
    expect(state.type).toBe('projekt');
  });

  it('takes a bare "1" right after the greeting as the type choice', async () => {
    const { transcript, state } = await run(['hi', '1']);
    expect(state.type).toBe('event');
    expect(state.facts.title).toBeUndefined();
    expect(transcript.at(-1)).toBe('Wie soll der Titel lauten?');
  });

  it('keeps facts sent instead of a type answer', async () => {
    const { transcript, state } = await run([
      'Ich will einen Lötkurs machen',
      'am 11.12. um 18 Uhr',
    ]);
    expect(state.facts).toMatchObject({
      date: '2026-12-11',
      startTime: '18:00',
    });
    expect(transcript.at(-1)).toContain('Antworte bitte mit 1 oder 2.');
    expect(transcript.at(-1)).toContain('Freitag 11.12. · 18:00');
  });

  it('does not take a fact correction as the description', async () => {
    const { transcript, state } = await run([
      'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      '1',
      'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
    ]);
    expect(state.facts.description).toBeUndefined();
    expect(state.facts).toMatchObject({ date: '2026-12-11', places: 8 });
    expect(transcript.at(-1)).toBe(
      'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nWorum geht’s? Ein, zwei Sätze reichen.',
    );
  });

  it('asks the photo question again after a title correction', async () => {
    const { transcript, state, effects } = await run([
      'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      '1',
      'Wir löten Abzeichen.',
      '11.12. 18 Uhr',
      'weiter',
      '-',
      'Titel: Lötkurs für Einsteiger',
    ]);
    expect(state.facts.title).toBe('Lötkurs für Einsteiger');
    expect(state.expecting).toBe('photo');
    expect(effects).not.toContain('summary');
    expect(transcript.at(-1)).toBe(
      'Alles klar: Lötkurs für Einsteiger.\nHast du ein Foto dazu? Schick es einfach hier rein.',
    );
  });

  it('does not store a "Titel:" correction as the description', async () => {
    const { transcript, state } = await run([
      'hi',
      '1',
      'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      'Titel: Lötkurs für Einsteiger',
      'Wir löten Abzeichen.',
    ]);
    expect(state.facts.title).toBe('Lötkurs für Einsteiger');
    expect(state.facts.description).toBe('Wir löten Abzeichen.');
    expect(transcript[2]).toBe(
      'Alles klar, Lötkurs für Anfänger · Freitag 27.11.\nWorum geht’s? Ein, zwei Sätze reichen.',
    );
    expect(transcript[3]).toBe(
      'Alles klar: Lötkurs für Einsteiger.\nWorum geht’s? Ein, zwei Sätze reichen.',
    );
  });

  it('names the open question (for "abschicken" too early)', async () => {
    const { state } = await run(['hi', '1', 'Repair Café', 'Wir reparieren.']);
    expect(openQuestion(state)).toBe('An welchem Tag ist es?');
    expect(openQuestion(initialDialogState())).toContain('Erzähl mir erst');
  });

  it('turns free text in review into a change request without AI', async () => {
    const { effects } = await run([
      'Ich habe eine Nixie-Uhr gebaut',
      '2',
      'Uhr.',
      'Röhren.',
      7,
      '3',
      'Text ändern: bitte lustiger',
    ]);
    expect(effects).toEqual(['set_consent', 'summary', 'change_request']);
  });
});

describe('dialog with AI', () => {
  it('uses the AI extraction and skips the type menu (walkthrough)', async () => {
    const deps: DialogDeps = {
      ...noAi,
      aiExtract: async ({ text }) =>
        text.startsWith('Ich will')
          ? {
              type: 'event',
              facts: {
                title: 'Lötkurs für Anfänger',
                date: '2026-11-27',
                isWorkshop: true,
                description: 'An einem Abend lernst du löten.',
              },
            }
          : { facts: {} },
    };
    const { transcript } = await run(
      [
        'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
        'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
      ],
      deps,
    );
    expect(transcript[0]).toBe(
      'Cool, ein Workshop! Ich habe verstanden:\n• Lötkurs für Anfänger\n• Freitag, 27.11.\n\nUm wie viel Uhr geht’s los?',
    );
    expect(transcript[1]).toBe(
      'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nHast du ein Foto dazu? Schick es einfach hier rein.',
    );
  });

  it('falls back to the parser when the AI returns null', async () => {
    const deps: DialogDeps = { ...noAi, aiExtract: async () => null };
    const { transcript } = await run(
      ['Ich will nächsten Freitag einen Lötkurs für Anfänger machen'],
      deps,
    );
    expect(transcript[0]).toContain('• Lötkurs für Anfänger');
    expect(transcript[0]).toContain('Worum geht’s?');
  });
});
