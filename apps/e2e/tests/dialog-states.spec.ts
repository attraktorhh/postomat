import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelPosts, conversations, eq, history, posts } from '@postomat/db';
import { askMember } from '@postomat/workflow';
import { Harness, ROOMS, testPhoto } from '../src/harness.ts';

/** DM states and failure paths that the main scenarios don't cover. */

const LENA = '@lena:localhost';
const AI_DOWN =
  'Ich kann deine Nachricht gerade nicht verarbeiten. Bitte versuch es in ein paar Minuten noch mal.';
const TEXTS_PENDING =
  'Die Texte fehlen noch. Schreib „nochmal“, dann versuche ich es erneut.';

async function collectEvent(h: Harness) {
  await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
  await h.dm(LENA, '1');
  await h.dm(LENA, 'Wir löten Abzeichen.');
  await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
  await h.dm(LENA, 'nein');
}

describe('DM states', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().start();
  }, 30000);
  afterEach(async () => {
    try {
      h.assertNoErrors(h.allowedErrors);
    } finally {
      await h.stop();
    }
  });

  const conv = async () =>
    (
      await h.db.db
        .select()
        .from(conversations)
        .where(eq(conversations.matrixUserId, LENA))
    )[0];
  const post = async () => (await h.db.db.select().from(posts))[0];

  it('an AI failure while "verwerfen?" is open keeps the question; "ja" then discards', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    await h.dm(LENA, 'abbrechen');
    h.ai.failNext('http', 1, 'interpret');
    expect(await h.dm(LENA, 'ja')).toEqual([AI_DOWN]);
    expect((await conv()).state?.pendingConfirmation).toBe('cancel');
    // neither yes nor no: asked again, the draft stays
    expect(await h.dm(LENA, 'hmm')).toEqual([
      'Das hab ich nicht ganz verstanden. Deinen Entwurf „Lötkurs“ verwerfen? (ja/nein)',
    ]);
    expect((await conv()).state?.pendingConfirmation).toBe('cancel');
    expect(await h.dm(LENA, 'ja')).toEqual([
      'Okay, den Entwurf habe ich verworfen. Schreib einfach, wenn du etwas Neues hast.',
    ]);
    expect((await post()).status).toBe('verworfen');
  });

  it('a photo instead of the answer to "verwerfen?" closes the question; the consent answer keeps the draft', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    await h.dm(LENA, 'abbrechen');
    await h.photo(LENA, await testPhoto());
    await h.dm(LENA, '1');
    expect((await post()).status).toBe('sammeln');
    expect((await conv()).state?.pendingConfirmation).toBeNull();
  });

  it('takes a repeated "neu" as the yes to "verwerfen und neu anfangen?"', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    expect((await h.dm(LENA, 'neu'))[0]).toContain(
      'Verwerfen und neu anfangen?',
    );
    const r = await h.dm(LENA, 'neu');
    expect(r[0]).toMatch(/^Hi /);
    expect((await post()).status).toBe('verworfen');
  });

  it('an AI failure while a Rückfrage is open keeps it; the resent answer is relayed', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    await askMember(h.deps, 1, 'Gibt es eine Altersgrenze?', 'mira');
    await h.queue.drain();
    h.ai.failNext('timeout', 1, 'interpret');
    expect(await h.dm(LENA, 'Ab 12 Jahren')).toEqual([AI_DOWN]);
    expect((await conv()).questionPostId).toBe(1);
    expect(await h.dm(LENA, 'Ab 12 Jahren')).toEqual([
      'Danke, ich gebe das ans Medienteam weiter.',
    ]);
    const log = await h.db.db.select().from(history);
    expect(log.map((e) => e.message)).toContain('Antwort: „Ab 12 Jahren“');
  });

  it('a failed "Text ändern" changes nothing and says so', async () => {
    await collectEvent(h);
    const texts = await h.db.db.select().from(channelPosts);
    h.ai.failNext('http', 1, 'texts');
    expect(await h.dm(LENA, 'Mach den Text bitte etwas lustiger')).toEqual([
      AI_DOWN,
    ]);
    expect(await h.db.db.select().from(channelPosts)).toEqual(texts);
    const log = await h.db.db.select().from(history);
    expect(log.some((e) => e.message.startsWith('Text ändern'))).toBe(false);
  });

  it('a failed text wish that also changed a fact blocks "abschicken" until the texts exist', async () => {
    h.ai.addRules({
      match: 'Doch 20 Uhr und lustiger bitte',
      result: {
        intent: 'request_text_change',
        instruction: 'lustiger',
        facts: { startTime: '20:00' },
      },
    });
    await collectEvent(h);
    h.ai.failNext('http', 1, 'texts');
    expect(await h.dm(LENA, 'Doch 20 Uhr und lustiger bitte')).toEqual([
      'Alles klar, 20:00.',
      AI_DOWN,
    ]);
    expect((await conv()).state?.summaryPending).toBe(true);
    expect((await h.dm(LENA, 'abschicken'))[0]).toContain(
      'Super, so schicke ich es ans Medienteam:',
    );
    expect((await post()).status).toBe('sammeln');
  });

  it('"abschicken" while the summary is missing builds it instead of submitting', async () => {
    h.ai.failNext('http', 2, 'texts');
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    await h.dm(LENA, '1');
    await h.dm(LENA, 'Wir löten Abzeichen.');
    await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
    expect((await h.dm(LENA, 'nein')).at(-1)).toBe(TEXTS_PENDING);
    expect(await h.dm(LENA, 'abschicken')).toEqual([TEXTS_PENDING]);
    expect((await post()).status).toBe('sammeln');
    expect(h.matrix.messages(ROOMS.medienteam)).toHaveLength(0);
    const r = await h.dm(LENA, 'abschicken');
    expect(r[0]).toContain('Super, so schicke ich es ans Medienteam:');
    expect((await post()).status).toBe('sammeln');
    // "ja" to the summary is "abschicken"
    expect(await h.dm(LENA, 'ja')).toEqual([
      'Ist beim Medienteam 🙌 Ich melde mich, sobald es online ist.',
    ]);
    expect((await post()).status).toBe('zur_freigabe');
  });

  it('a photo while the type question is open never skips to the summary', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    expect((await h.photo(LENA, await testPhoto()))[0]).toContain(
      'Danke! Sind auf dem Foto Personen erkennbar?',
    );
    const r = await h.dm(LENA, '3');
    expect(r.join('\n')).toContain('Was möchtest du einreichen?');
    expect(r.join('\n')).not.toContain('Super, so schicke ich es');
    expect(h.ai.calls.filter((c) => c.kind === 'texts')).toHaveLength(0);
    expect((await h.dm(LENA, 'abschicken'))[0]).toContain(
      'Mir fehlt noch etwas',
    );
    expect((await post()).status).toBe('sammeln');
  });

  it('"Text ändern" without a wish asks what should change, then uses the answer', async () => {
    h.ai.addRules(
      { match: 'Text ändern', result: { intent: 'request_text_change' } },
      { match: 'Lötkolben sind da', result: { intent: 'unclear' } },
    );
    await collectEvent(h);
    const r = await h.dm(LENA, 'Text ändern');
    expect(r).toEqual([
      'Was soll anders sein? Schreib es einfach, z. B. „bitte erwähnen, dass Lötkolben da sind“. Oder bearbeite es im Browser ↗ http://postomat.test/b/1',
    ]);
    const before = h.ai.calls.filter((c) => c.kind === 'texts').length;
    const r2 = await h.dm(LENA, 'Lötkolben sind da');
    expect(r2.at(-1)).toContain('Ich habe die Texte angepasst.');
    const call = h.ai.calls.filter((c) => c.kind === 'texts')[before];
    expect(call.input['aenderungswunsch']).toBe('Lötkolben sind da');
  });

  it('does not send very long messages to the AI', async () => {
    const before = h.ai.calls.length;
    expect(await h.dm(LENA, 'x'.repeat(4001))).toEqual([
      'Deine Nachricht ist sehr lang – fass sie bitte kürzer zusammen.',
    ]);
    expect(h.ai.calls.length).toBe(before);
  });
});
