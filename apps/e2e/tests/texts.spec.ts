import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelPosts, eq, history, posts } from '@postomat/db';
import {
  approvePost,
  discardPost,
  editChannelText,
  editFacts,
  getChannels,
  getPost,
  resolveSuggestedFacts,
  reviewStamp,
  submitPost,
  TEXTS_CHANGED,
  updatePost,
} from '@postomat/workflow';
import { Harness, ROOMS } from '../src/harness.ts';

const LENA = '@lena:localhost';
const MIRA = '@mira:localhost';

/** Event dialog up to the summary, then "abschicken" (post 1, zur_freigabe). */
async function submitted(h: Harness) {
  await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs für Anfänger machen');
  await h.dm(LENA, '1');
  await h.dm(LENA, 'Wir löten Abzeichen.');
  await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
  await h.dm(LENA, 'nein');
  await h.dm(LENA, 'abschicken');
}

const post1 = async (h: Harness) => getPost(h.deps.db, 1);
const stampOf = async (h: Harness) =>
  reviewStamp(await post1(h), await getChannels(h.deps.db, 1));
const cardOf = async (h: Harness) => (await post1(h)).cardEventId!;
const textJobs = (h: Harness) =>
  h.ai.calls.filter((c) => c.kind === 'texts').length;
const approveWeb = (h: Harness, stamp?: string) =>
  approvePost(h.deps, {
    postId: 1,
    approverUsername: 'mira',
    approverIsMedienteam: true,
    version: 1,
    via: 'web',
    reviewStamp: stamp,
  });

describe('channel texts and approval', () => {
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

  it('blocks web and 👍 approval while the texts are being rewritten', async () => {
    await submitted(h);
    await editFacts(h.deps, 1, { endTime: '20:30' }, 'kai');
    const web = await approveWeb(h, await stampOf(h));
    expect(web.kind).toBe('blocked');
    expect(web.kind === 'blocked' && web.failures.map((f) => f.id)).toContain(
      'texts_current',
    );
    // h.react handles the 👍 first, then runs the queued rewrite.
    await h.react(MIRA, await cardOf(h), '👍');
    expect((await post1(h)).status).toBe('zur_freigabe');
    expect((await post1(h)).textsFacts?.endTime).toBe('20:30');
  });

  it('refuses a web approval of texts the reviewer has not seen', async () => {
    await submitted(h);
    const seen = await stampOf(h);
    await editFacts(h.deps, 1, { endTime: '20:30' }, 'kai');
    await h.queue.drain();
    await expect(approveWeb(h, seen)).rejects.toThrow(TEXTS_CHANGED);
    expect((await approveWeb(h, await stampOf(h))).kind).toBe('approve');
  });

  it('runs one rewrite for several quick fact edits', async () => {
    await submitted(h);
    const before = textJobs(h);
    await editFacts(h.deps, 1, { endTime: '20:30' }, 'kai');
    await editFacts(h.deps, 1, { endTime: '21:00' }, 'kai');
    await editFacts(h.deps, 1, { isWorkshop: true }, 'kai');
    await h.queue.drain();
    expect(textJobs(h)).toBe(before + 1);
    expect((await post1(h)).textsFacts?.endTime).toBe('21:00');
  });

  it('ignores an unchanged form (workshop box unticked, flag never set)', async () => {
    await submitted(h);
    const rows = async () =>
      (await h.db.db.select().from(history).where(eq(history.postId, 1)))
        .length;
    const n = await rows();
    await editFacts(h.deps, 1, { isWorkshop: false }, 'kai');
    expect(await rows()).toBe(n);
    expect(
      h.queue.pending.filter((j) => j.name === 'texts.generate'),
    ).toHaveLength(0);
  });

  it('queues a rewrite when a post with outdated texts is submitted', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs für Anfänger machen');
    await h.dm(LENA, '1');
    await h.dm(LENA, 'Wir löten Abzeichen.');
    await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
    await h.dm(LENA, 'nein');
    // E.g. a fact the dialog stored without writing the texts again.
    const p = await post1(h);
    await updatePost(h.deps.db, 1, { facts: { ...p.facts, isWorkshop: true } });
    await submitPost(h.deps, 1, 'lena', undefined);
    expect(h.queue.pending.some((j) => j.name === 'texts.generate')).toBe(true);
    await h.queue.drain();
    expect((await approveWeb(h, await stampOf(h))).kind).toBe('approve');
  });

  it('a rewrite job that runs after the approval changes nothing', async () => {
    await submitted(h);
    await h.react(MIRA, await cardOf(h), '👍');
    const before = await getChannels(h.deps.db, 1);
    expect(before.find((c) => c.channel === 'wordpress')?.status).not.toBe(
      'entwurf',
    );
    const calls = textJobs(h);
    await h.deps.queue.send('texts.generate', {
      postId: 1,
      actor: 'kai',
      force: true,
    });
    await h.queue.drain();
    expect(textJobs(h)).toBe(calls);
    const after = await getChannels(h.deps.db, 1);
    expect(after.map((c) => [c.channel, c.status, c.textDe])).toEqual(
      before.map((c) => [c.channel, c.status, c.textDe]),
    );
  });

  it('does not tell the author about failed texts of a discarded post', async () => {
    await submitted(h);
    await editFacts(h.deps, 1, { endTime: '20:30' }, 'kai');
    h.ai.failNext('http', 3, 'texts');
    await discardPost(h.deps, 1, 'kai');
    const dms = h.matrix.messages(ROOMS.dmLena).length;
    await h.queue.drain();
    expect(h.matrix.messages(ROOMS.dmLena)).toHaveLength(dms);
    expect((await post1(h)).textsError).toBeNull();
  });

  it('flags a hand-edited text after a fact change until it is checked', async () => {
    await submitted(h);
    const wp = (await getChannels(h.deps.db, 1)).find(
      (c) => c.channel === 'wordpress',
    )!;
    await editChannelText(
      h.deps,
      1,
      'wordpress',
      { textDe: `${wp.textDe}\nVon Hand ergänzt.` },
      'kai',
    );
    await editFacts(h.deps, 1, { endTime: '20:30' }, 'kai');
    await h.queue.drain();
    const [row] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wordpress'));
    expect(row.textDe).toContain('Von Hand ergänzt.');
    expect(row.factsStale).toBe(true);
    const blocked = await approveWeb(h, await stampOf(h));
    expect(
      blocked.kind === 'blocked' && blocked.failures.map((f) => f.label),
    ).toEqual([
      'Von Hand bearbeitete Texte prüfen, die Angaben wurden danach geändert: Website',
    ]);
    // A second fact change still keeps the hand-edited text.
    await editFacts(h.deps, 1, { endTime: '21:00' }, 'kai');
    await h.queue.drain();
    const [again] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wordpress'));
    expect(again.textDe).toContain('Von Hand ergänzt.');
    // Saving it unchanged confirms it.
    await editChannelText(h.deps, 1, 'wordpress', {}, 'kai');
    expect((await approveWeb(h, await stampOf(h))).kind).toBe('approve');
  });

  it('gives the AI the current texts for a "Text ändern" wish', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs für Anfänger machen');
    await h.dm(LENA, '1');
    await h.dm(LENA, 'Wir löten Abzeichen.');
    await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
    await h.dm(LENA, 'nein');
    const stored = (await post1(h)).aiTexts;
    expect(stored?.bodyDe).toBeTruthy();
    await h.dm(LENA, 'Mach den Text bitte etwas lustiger');
    const last = h.ai.calls.filter((c) => c.kind === 'texts').at(-1)!;
    expect(last.prompt).toContain(JSON.stringify(stored!.bodyDe));
    expect(last.prompt).toContain('etwas lustiger');
  });

  it('validates Redaktion fact edits and suggested facts', async () => {
    await submitted(h);
    await editFacts(h.deps, 1, { endTime: '21:00' }, 'kai');
    await expect(
      editFacts(h.deps, 1, { endTime: '17:00' }, 'kai'),
    ).rejects.toThrow('Das Ende muss nach dem Beginn liegen.');
    // A suggested start after the stored end drops the end (as in the DM).
    await h.db.db
      .update(posts)
      .set({ suggestedFacts: { startTime: '22:00' } })
      .where(eq(posts.id, 1));
    await resolveSuggestedFacts(h.deps, 1, true, 'kai');
    const p = await post1(h);
    expect(p.facts.startTime).toBe('22:00');
    expect(p.facts.endTime).toBeUndefined();
    await h.db.db
      .update(posts)
      .set({ suggestedFacts: { places: 0 } })
      .where(eq(posts.id, 1));
    await expect(resolveSuggestedFacts(h.deps, 1, true, 'kai')).rejects.toThrow(
      'größer als 0',
    );
  });
});
