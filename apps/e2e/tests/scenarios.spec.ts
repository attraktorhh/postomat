import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { createAiService } from '@postomat/ai';
import { channelPosts, eq, history, photos, posts } from '@postomat/db';
import {
  askMember,
  editFacts,
  resubmit,
  setBannerColor,
  setChannelLink,
  setPhotoConsent,
  retryChannel,
  saveRoomSettings,
  submitPost,
} from '@postomat/workflow';
import { Harness, ROOMS, testPhoto } from '../src/harness.ts';

const LENA = '@lena:localhost';
const KAI = '@kai:localhost';
const MIRA = '@mira:localhost';
const GAST = '@gast:localhost';

/** Runs the event dialog up to the review step. */
async function collectEvent(
  h: Harness,
  opts: { consent?: string; title?: string } = {},
) {
  await h.dm(
    LENA,
    `Ich will am 11.12. einen ${opts.title ?? 'Lötkurs für Anfänger'} machen`,
  );
  await h.dm(LENA, '1');
  await h.dm(LENA, 'Wir löten Abzeichen.');
  await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
  if (opts.consent) {
    await h.photo(LENA, await testPhoto());
    await h.dm(LENA, opts.consent);
  } else {
    await h.dm(LENA, 'nein');
  }
}

async function cardOf(h: Harness): Promise<string> {
  const [p] = await h.db.db.select().from(posts);
  return p.cardEventId!;
}

describe('scenarios', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().start();
  }, 30000);
  // Tests that provoke failures on purpose list them in h.allowedErrors.
  afterEach(async () => {
    try {
      h.assertNoErrors(h.allowedErrors);
    } finally {
      await h.stop();
    }
  });

  it('supports hilfe, status, neu and abbrechen', async () => {
    expect((await h.dm(LENA, 'hilfe'))[0]).toContain(
      '• neu – neuen Beitrag starten',
    );
    expect(await h.dm(LENA, 'status')).toEqual([
      'Du hast noch keine Beiträge. Erzähl einfach, was du vorhast!',
    ]);
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    expect((await h.dm(LENA, 'neu'))[0]).toContain(
      'Du hast schon einen Entwurf „Lötkurs“',
    );
    expect((await h.dm(LENA, 'status'))[0]).toBe(
      'Deine Beiträge:\n• Lötkurs: Entwurf – http://postomat.test/b/1',
    );
    expect(await h.dm(LENA, 'abschicken')).toEqual([
      'Mir fehlt noch etwas, bevor ich es abschicken kann.\nWas möchtest du einreichen?\n1️⃣ Event (ein Termin im Attraktor)\n2️⃣ Projekt (etwas, das du gebaut hast)',
    ]);
    expect(await h.dm(LENA, 'abbrechen')).toEqual([
      'Okay, den Entwurf habe ich verworfen. Schreib einfach, wenn du etwas Neues hast.',
    ]);
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('verworfen');
    expect(await h.dm(LENA, 'neu')).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
  });

  it('runs the Projekt flow, requires a photo and rejects unsupported images', async () => {
    await h.dm(LENA, 'Ich habe eine Nixie-Uhr gebaut');
    await h.dm(LENA, '2');
    await h.dm(LENA, 'Eine Uhr mit alten Röhren.');
    expect(await h.dm(LENA, 'Die Hochspannung.')).toEqual([
      'Schick mir bitte ein Foto davon. Für Projekte brauche ich mindestens eins.',
    ]);
    expect(await h.dm(LENA, 'nein')).toEqual([
      'Schick mir bitte ein Foto davon. Für Projekte brauche ich mindestens eins.',
    ]);
    expect(await h.photo(LENA, Buffer.from('GIF89a........'))).toEqual([
      'Das Format kenne ich leider nicht. Schick das Foto bitte als JPEG, PNG oder WebP.',
    ]);
    // a PDF arrives as m.file and gets the same answer instead of silence
    const before = h.matrix.sent.length;
    await h.bot.handle({
      kind: 'message',
      roomId: ROOMS.dmLena,
      eventId: '$pdf',
      sender: LENA,
      msgtype: 'm.file',
      body: 'flyer.pdf',
      content: {
        msgtype: 'm.file',
        body: 'flyer.pdf',
        info: { mimetype: 'application/pdf' },
      },
    });
    expect(h.matrix.sent.slice(before).map((m) => m.body)).toEqual([
      'Das Format kenne ich leider nicht. Schick das Foto bitte als JPEG, PNG oder WebP.',
    ]);
    await h.photo(LENA, await testPhoto());
    const summary = await h.dm(LENA, '2');
    expect(summary[0]).toContain('Instagram · Facebook · DE + EN');
    const [photo] = await h.db.db
      .select()
      .from(photos)
      .where(eq(photos.kind, 'photo'));
    expect(photo.consent).toBe('einwilligung_fehlt');
    const channels = await h.db.db.select().from(channelPosts);
    expect(
      channels
        .filter((c) => c.mode !== 'off')
        .map((c) => c.channel)
        .sort(),
    ).toEqual(['facebook', 'instagram']);
  });

  it('blocks approval with the reason in the thread', async () => {
    await collectEvent(h, { consent: '2' });
    await h.dm(LENA, 'abschicken');
    const card = await cardOf(h);
    await h.react(MIRA, card, '👍');
    expect(h.matrix.messages(ROOMS.medienteam, card).at(-1)?.body).toBe(
      'Freigabe nicht möglich: Foto: Einwilligung fehlt',
    );
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('zur_freigabe');
  });

  it('validates Redaktion inputs and locks the banner after approval', async () => {
    await collectEvent(h, { consent: '1' });
    await h.dm(LENA, 'abschicken');
    const [photo] = await h.db.db.select().from(photos);
    await expect(
      setPhotoConsent(h.deps, 1, photo.id, 'hacked' as never, 'mira'),
    ).rejects.toThrow('Unbekannte Einwilligung');
    await expect(
      setBannerColor(h.deps, 1, 'lila' as never, 'mira'),
    ).rejects.toThrow('Unbekannte Banner-Farbe');
    await expect(
      editFacts(h.deps, 1, { endTime: '99:99' }, 'mira'),
    ).rejects.toThrow('Endzeit bitte als HH:MM');
    await h.react(MIRA, await cardOf(h), '👍');
    await expect(setBannerColor(h.deps, 1, 'rot', 'mira')).rejects.toThrow(
      'kann nicht mehr bearbeitet werden',
    );
    const [p] = await h.db.db.select().from(posts);
    expect(p.bannerColor).toBe('mint');
  });

  it('accepts only Meetup event links for the Meetup channel', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    await h.react(MIRA, await cardOf(h), '👍');
    await expect(
      setChannelLink(h.deps, 1, 'meetup', 'https://example.com/x', 'mira'),
    ).rejects.toThrow('Link zum Meetup-Event');
    await setChannelLink(
      h.deps,
      1,
      'meetup',
      'https://www.meetup.com/attraktor/events/999/',
      'mira',
    );
    const rows = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'meetup'));
    expect(rows[0]).toMatchObject({ status: 'erledigt', remoteId: '999' });
  });

  it('changes membership through the room picker without a restart (≤ 5 min cache)', async () => {
    expect((await h.dm(GAST, 'Hallo', ROOMS.dmGast))[0]).toContain(
      'nur für Attraktor-Mitglieder',
    );
    h.matrix.addRoom('!gaeste:localhost', ['@postomat:localhost', GAST], {
      alias: '#gaeste:localhost',
    });
    await saveRoomSettings(
      h.deps,
      {
        memberRooms: ['#mitglieder:localhost', '#gaeste:localhost'],
        medienteamRoom: '#medienteam:localhost',
      },
      'admin',
    );
    expect((await h.dm(GAST, 'Hallo', ROOMS.dmGast))[0]).toContain(
      'nur für Attraktor-Mitglieder',
    ); // still cached
    h.clock = new Date(h.clock.getTime() + 301_000);
    expect((await h.dm(GAST, 'Hallo', ROOMS.dmGast))[0]).toBe(
      'Hi Gast! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    );
  });

  it('marks failed channels as fehler and retries idempotently', async () => {
    h.wordpress.failNextCreates = 10;
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    await h.react(MIRA, await cardOf(h), '👍');
    const [wp] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wordpress'));
    expect(wp.status).toBe('fehler');
    expect(wp.error).toContain('HTTP 500');
    const summary = h.matrix
      .messages(ROOMS.medienteam)
      .filter((m) => !m.opts.threadRoot && !m.opts.replaces)
      .at(-1)!.body;
    expect(summary).toContain('Wiki ist online.');
    expect(summary).toContain('⚠️ Website: Fehler');
    h.wordpress.failNextCreates = 0;
    await retryChannel(h.deps, 1, 'wordpress', 'mira');
    await h.queue.drain();
    await retryChannel(h.deps, 1, 'wordpress', 'mira').catch(() => undefined); // not in fehler anymore
    await h.queue.drain();
    expect(h.wordpress.posts).toHaveLength(1);
    expect(h.wordpress.media).toHaveLength(1); // banner uploaded once across retries
    const [after] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wordpress'));
    expect(after.status).toBe('veroeffentlicht');
    // the member hears about the late website link, the wiki page gets it too
    expect(h.matrix.messages(ROOMS.dmLena).at(-1)?.body).toContain(after.url!);
    expect(
      h.wiki.pages.get('Termin:Lötkurs für Anfänger 2026-12-11'),
    ).toContain(`|url=${after.url}`);
  });

  it('never overwrites an existing wiki page', async () => {
    h.wiki.pages.set('Termin:Lötkurs für Anfänger 2026-12-11', 'fremde Seite');
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    await h.react(MIRA, await cardOf(h), '👍');
    const [wiki] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wiki'));
    expect(wiki.status).toBe('fehler');
    expect(wiki.error).toContain('gibt es schon');
    expect(h.wiki.pages.get('Termin:Lötkurs für Anfänger 2026-12-11')).toBe(
      'fremde Seite',
    );
  });

  it('never takes over the WordPress post of an earlier post with the same title and date', async () => {
    h.wordpress.posts.push({
      id: 500,
      title: 'Lötkurs für Anfänger',
      content: '<p>fremder Beitrag</p>',
      status: 'publish',
      slug: 'loetkurs-fuer-anfaenger-2026-12-11',
      categories: [],
      featured_media: 0,
      link: `${h.wordpress.url}/loetkurs-fuer-anfaenger-2026-12-11/`,
    });
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    await h.react(MIRA, await cardOf(h), '👍');
    const [wp] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'wordpress'));
    expect(wp.status).toBe('veroeffentlicht');
    expect(wp.remoteId).not.toBe('500');
    expect(wp.url).toContain('loetkurs-fuer-anfaenger-2026-12-11-2');
    expect(h.wordpress.posts.find((p) => p.id === 500)?.content).toBe(
      '<p>fremder Beitrag</p>',
    );
  });

  it('asks in the thread when the Meetup feed is ambiguous; a number links (no change request)', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    const card = await cardOf(h);
    await h.react(KAI, card, '👍');
    h.meetup.events.push(
      { id: '1001', title: 'Lötkurs', start: '2026-12-11T18:00' },
      { id: '1002', title: 'Basteldonnerstag', start: '2026-12-11T19:00' },
    );
    await h.runMeetupPoll();
    await h.runMeetupPoll(); // asks only once
    const questions = h.matrix
      .messages(ROOMS.medienteam, card)
      .filter((m) => m.body.startsWith('Ist eins davon'));
    expect(questions).toHaveLength(1);
    expect(questions[0].body).toContain('1️⃣ Lötkurs (Fr 11.12. 18:00)');
    await h.threadReply(MIRA, card, '1');
    const [meetup] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'meetup'));
    expect(meetup.status).toBe('erledigt');
    expect(meetup.url).toBe('https://www.meetup.com/attraktor/events/1001/');
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('geplant');
  });

  it('submits from the web with a note and relays a Rückfrage', async () => {
    await collectEvent(h);
    await submitPost(
      h.deps,
      1,
      'lena',
      'Lötstationen sind da, niemand muss etwas mitbringen.',
    );
    await h.queue.drain();
    const card = await cardOf(h);
    expect(h.card(card)).toContain(
      'Notiz von @lena: „Lötstationen sind da, niemand muss etwas mitbringen.“',
    );
    await askMember(h.deps, 1, 'Gibt es eine Altersgrenze?', 'mira');
    await h.queue.drain();
    expect(h.matrix.messages(ROOMS.dmLena).at(-1)?.body).toContain(
      'Gibt es eine Altersgrenze?',
    );
    expect(await h.dm(LENA, 'Ab 12 Jahren')).toEqual([
      'Danke, ich gebe das ans Medienteam weiter.',
    ]);
    const log = await h.db.db
      .select()
      .from(history)
      .where(eq(history.postId, 1));
    expect(log.map((e) => e.message)).toContain('Antwort: „Ab 12 Jahren“');
    expect(h.matrix.messages(ROOMS.medienteam, card).at(-1)?.body).toBe(
      'Antwort von @lena: „Ab 12 Jahren“',
    );
  });

  it('✏️ requests a change and resubmit posts the v2 banner in the thread', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    const card = await cardOf(h);
    await h.react(KAI, card, '✏️');
    expect(h.card(card)).toContain('Änderung gewünscht');
    await resubmit(h.deps, 1, 'kai');
    await h.queue.drain();
    const thread = h.matrix.messages(ROOMS.medienteam, card);
    expect(thread.filter((m) => m.kind === 'image')).toHaveLength(2);
    expect(thread.some((m) => m.body === 'Neue Version v2 zur Freigabe.')).toBe(
      true,
    );
  });

  it('uses the AI (mocked) for extraction and texts', async () => {
    const reply = (obj: unknown) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    });
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        const prompt = JSON.stringify(opts.prompt);
        if (prompt.includes('Extrahiere')) {
          return reply({
            type: 'event',
            title: 'Lötkurs für Anfänger',
            description: 'An einem Abend lernst du löten.',
            date: '2026-11-27',
            startTime: null,
            endTime: null,
            places: null,
            costs: null,
            audience: null,
            trickiest: null,
            isWorkshop: true,
          }) as never;
        }
        return reply({
          hookDe: 'Du wolltest schon immer mal löten? 🔥',
          bodyDe: 'KI-Text.',
          titleEn: 'Soldering for beginners',
          bodyEn: 'AI text.',
          shortEn: 'Learn to solder.',
        }) as never;
      },
    });
    h.deps.ai = createAiService(model, { timeoutMs: 2000 });
    const replies = await h.dm(
      LENA,
      'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
    );
    expect(replies[0]).toBe(
      'Cool, ein Workshop! Ich habe verstanden:\n• Lötkurs für Anfänger\n• Freitag, 27.11.\n\nUm wie viel Uhr geht’s los?',
    );
    const sent = JSON.stringify(model.doGenerateCalls.map((c) => c.prompt));
    expect(sent).not.toContain('@lena');
  });
});
