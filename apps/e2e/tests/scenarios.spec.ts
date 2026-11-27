import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  channelPosts,
  conversations,
  eq,
  history,
  photos,
  posts,
} from '@postomat/db';
import {
  askMember,
  editChannelText,
  editFacts,
  resolveSuggestedFacts,
  resubmit,
  retryTexts,
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
      'Deinen Entwurf „Lötkurs“ verwerfen? (ja/nein)',
    ]);
    expect(await h.dm(LENA, 'ja')).toEqual([
      'Okay, den Entwurf habe ich verworfen. Schreib einfach, wenn du etwas Neues hast.',
    ]);
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('verworfen');
    expect(await h.dm(LENA, 'neu')).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
  });

  it('runs the Projekt flow, requires a photo and rejects unsupported images', async () => {
    expect((await h.dm(LENA, 'Ich habe eine Nixie-Uhr gebaut'))[0]).toBe(
      'Cool, ein Projekt! Ich habe verstanden:\n• Nixie-Uhr\n\nWas hast du gebaut? Ein, zwei Sätze reichen.',
    );
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
    expect(summary[0]).toContain('aber nicht gefragt');
    expect(summary[1]).toContain('Instagram · Facebook · DE + EN');
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
    expect(wp.error).toBe(
      'Website nicht erreichbar – später „Erneut versuchen“.',
    );
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
    // the AI read a fact from the answer: offered, not applied
    const [p] = await h.db.db.select().from(posts);
    expect(p.suggestedFacts).toEqual({ audience: 'ab 12 Jahren' });
    expect(p.facts.audience).toBeUndefined();
    await resolveSuggestedFacts(h.deps, 1, true, 'mira');
    const [applied] = await h.db.db.select().from(posts);
    expect(applied.facts.audience).toBe('ab 12 Jahren');
    expect(applied.suggestedFacts).toBeNull();
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

  it.each([
    ['http', 1],
    ['timeout', 1],
    ['schema', 2], // the AiService retries a schema mismatch once
  ] as const)(
    'AI %s failure in the DM: retry message, nothing changes, resending continues',
    async (mode, times) => {
      await h.dm(
        LENA,
        'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      );
      const [convBefore] = await h.db.db.select().from(conversations);
      const [postBefore] = await h.db.db.select().from(posts);
      const historyBefore = await h.db.db.select().from(history);
      const msg =
        'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material';
      h.ai.failNext(mode, times);
      expect(await h.dm(LENA, msg)).toEqual([
        'Ich kann deine Nachricht gerade nicht verarbeiten. Bitte versuch es in ein paar Minuten noch mal.',
      ]);
      const [convAfter] = await h.db.db.select().from(conversations);
      const [postAfter] = await h.db.db.select().from(posts);
      expect(convAfter.state).toEqual(convBefore.state);
      expect(postAfter.facts).toEqual(postBefore.facts);
      expect(await h.db.db.select().from(history)).toHaveLength(
        historyBefore.length,
      );
      expect(h.ai.status().lastError).toBe(`interpret: ${mode}`);
      // typing was shown while the AI worked, and switched off again
      expect(h.matrix.typing.at(-1)).toEqual({
        roomId: ROOMS.dmLena,
        typing: false,
      });
      expect(await h.dm(LENA, msg)).toEqual([
        'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nHast du ein Foto dazu? Schick es einfach hier rein.',
      ]);
    },
  );

  it('drops AI values that fail validation and asks for the field again', async () => {
    h.ai.addRules({
      match: 'am 30. Februar',
      result: { facts: { date: '2026-02-30' } },
    });
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    await h.dm(LENA, '1');
    await h.dm(LENA, 'Wir löten Abzeichen.');
    expect(await h.dm(LENA, 'am 30. Februar')).toEqual([
      'Das Datum konnte ich nicht zuordnen.\nUm wie viel Uhr geht’s los?',
    ]);
    h.ai.addRules({
      match: 'um 25 Uhr',
      result: { facts: { startTime: '25:00' } },
    });
    expect(await h.dm(LENA, 'um 25 Uhr')).toEqual([
      'Die Uhrzeit konnte ich nicht zuordnen.\nUm wie viel Uhr geht’s los?',
    ]);
    const [p] = await h.db.db.select().from(posts);
    expect(p.facts.date).toBe('2026-12-11');
    expect(p.facts.startTime).toBeUndefined();
  });

  it('a failed text generation keeps the draft; "nochmal" builds the summary', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    await h.dm(LENA, '1');
    await h.dm(LENA, 'Wir löten Abzeichen.');
    await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
    h.ai.failNext('http', 1, 'texts');
    expect(await h.dm(LENA, 'nein')).toEqual([
      'Kein Problem, dann ohne Foto.',
      'Ich kann deine Nachricht gerade nicht verarbeiten. Bitte versuch es in ein paar Minuten noch mal.',
    ]);
    // no template-only texts were stored
    expect(await h.db.db.select().from(channelPosts)).toHaveLength(0);
    const summary = await h.dm(LENA, 'nochmal');
    expect(summary[0]).toContain('Super, so schicke ich es ans Medienteam:');
    expect(await h.dm(LENA, 'passt, schick’s ab')).toEqual([
      'Ist beim Medienteam 🙌 Ich melde mich, sobald es online ist.',
    ]);
  });

  it('understands commands in free wording and confirms destructive ones', async () => {
    expect((await h.dm(LENA, 'Was kannst du eigentlich?'))[0]).toContain(
      'So funktioniert’s',
    );
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    expect(await h.dm(LENA, 'Lass das, ich will das doch nicht mehr')).toEqual([
      'Deinen Entwurf „Lötkurs“ verwerfen? (ja/nein)',
    ]);
    expect(await h.dm(LENA, 'nein')).toEqual([
      'Okay, dann machen wir weiter.\nWas möchtest du einreichen?\n1️⃣ Event (ein Termin im Attraktor)\n2️⃣ Projekt (etwas, das du gebaut hast)',
    ]);
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('sammeln');
    expect((await h.dm(LENA, 'neu'))[0]).toBe(
      'Du hast schon einen Entwurf „Lötkurs“. Verwerfen und neu anfangen? (ja/nein)',
    );
    expect(await h.dm(LENA, 'ja')).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
    const [after] = await h.db.db.select().from(posts);
    expect(after.status).toBe('verworfen');
  });

  it('takes a repeated cancel command as the yes to "verwerfen?"', async () => {
    await h.dm(LENA, 'Ich will am 11.12. einen Lötkurs machen');
    expect(await h.dm(LENA, 'abbrechen')).toEqual([
      'Deinen Entwurf „Lötkurs“ verwerfen? (ja/nein)',
    ]);
    expect(await h.dm(LENA, 'weg damit')).toEqual([
      'Okay, den Entwurf habe ich verworfen. Schreib einfach, wenn du etwas Neues hast.',
    ]);
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('verworfen');
  });

  it('applies a title change even when the AI files it as a text change', async () => {
    await collectEvent(h);
    const r = await h.dm(LENA, 'Der Titel soll lieber „Lötabend“ heißen');
    expect(r[0]).toBe('Alles klar: Lötabend.');
    expect(r[1]).toContain(
      'Super, so schicke ich es ans Medienteam:\n\nLötabend',
    );
    const [p] = await h.db.db.select().from(posts);
    expect(p.facts.title).toBe('Lötabend');
  });

  it('turns a text change wish and a note in review into the right actions', async () => {
    await collectEvent(h);
    const before = h.ai.calls.filter((c) => c.kind === 'texts').length;
    const r = await h.dm(LENA, 'Mach den Text bitte etwas lustiger');
    expect(r.at(-1)).toBe(
      'Ich habe die Texte angepasst. Antworte „abschicken“ oder ergänze im Browser eine Notiz.',
    );
    const texts = h.ai.calls.filter((c) => c.kind === 'texts');
    expect(texts).toHaveLength(before + 1);
    expect(texts.at(-1)!.input['aenderungswunsch']).toBe('etwas lustiger');
    await h.dm(LENA, 'Bitte nicht vor Montag posten');
    const [p] = await h.db.db.select().from(posts);
    // stored verbatim, not the AI's paraphrase
    expect(p.note).toBe('Bitte nicht vor Montag posten');
  });

  describe('Meetup candidate question (AI reads the reply)', () => {
    async function ask(): Promise<string> {
      await collectEvent(h);
      await h.dm(LENA, 'abschicken');
      const card = await cardOf(h);
      await h.react(KAI, card, '👍');
      h.meetup.events.push(
        { id: '1001', title: 'Lötkurs', start: '2026-12-11T18:00' },
        { id: '1002', title: 'Löten für Kids', start: '2026-12-11T18:30' },
      );
      await h.runMeetupPoll();
      return card;
    }
    const meetupRow = async () =>
      (
        await h.db.db
          .select()
          .from(channelPosts)
          .where(eq(channelPosts.channel, 'meetup'))
      )[0];

    it('"das zweite" links the second candidate', async () => {
      const card = await ask();
      await h.threadReply(MIRA, card, 'das zweite');
      expect((await meetupRow()).url).toBe(
        'https://www.meetup.com/attraktor/events/1002/',
      );
      const reply = h.ai.calls.filter((c) => c.kind === 'candidate').at(-1)!;
      expect(reply.input['antwort']).toBe('das zweite');
      expect(JSON.stringify(reply.input['kandidaten'])).toContain(
        'Löten für Kids',
      );
      expect(reply.prompt).not.toMatch(/@\w+:localhost|uid|1002/);
    });

    it('"keins" closes the question; an unrelated reply is a normal thread reply', async () => {
      const card = await ask();
      await h.threadReply(MIRA, card, 'Ist der Raum schon gebucht?');
      expect((await meetupRow()).status).toBe('kopieren');
      const log = await h.db.db.select().from(history);
      expect(log.map((e) => e.message)).toContain(
        'Kommentar: „Ist der Raum schon gebucht?“',
      );
      await h.threadReply(MIRA, card, 'keins');
      expect(h.matrix.messages(ROOMS.medienteam, card).at(-1)?.body).toBe(
        'Okay, ich suche weiter im Feed. Den Link kannst du auch im Browser eintragen.',
      );
      // the question is closed: the next reply is not sent to the AI
      const calls = h.ai.calls.length;
      await h.threadReply(MIRA, card, '1');
      expect(h.ai.calls.length).toBe(calls);
      expect((await meetupRow()).status).toBe('kopieren');
    });

    it('an AI failure answers in the thread and changes nothing', async () => {
      const card = await ask();
      h.ai.failNext('http', 1, 'candidate');
      await h.threadReply(MIRA, card, '1');
      expect(h.matrix.messages(ROOMS.medienteam, card).at(-1)?.body).toBe(
        'Ich kann deine Nachricht gerade nicht verarbeiten. Bitte versuch es in ein paar Minuten noch mal.',
      );
      expect((await meetupRow()).status).toBe('kopieren');
      await h.threadReply(MIRA, card, '1');
      expect((await meetupRow()).url).toBe(
        'https://www.meetup.com/attraktor/events/1001/',
      );
      // every Medienteam reply to the open question went through the AI
      const replies = h.sentTexts.filter((m) => m.thread).map((m) => m.text);
      expect(
        h.ai.calls
          .filter((c) => c.kind === 'candidate')
          .map((c) => c.input['antwort']),
      ).toEqual(replies);
    });
  });

  it('"Erneut zur Freigabe" with changed facts rewrites the texts in the worker, keeping hand edits', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    const card = await cardOf(h);
    await h.react(KAI, card, '✏️');
    await editChannelText(
      h.deps,
      1,
      'instagram',
      { textDe: 'Von Hand geschrieben' },
      'kai',
    );
    await editFacts(h.deps, 1, { startTime: '19:00' }, 'kai');
    const before = h.ai.calls.filter((c) => c.kind === 'texts').length;
    await resubmit(h.deps, 1, 'kai');
    await h.queue.drain();
    expect(h.ai.calls.filter((c) => c.kind === 'texts')).toHaveLength(
      before + 1,
    );
    const rows = await h.db.db.select().from(channelPosts);
    expect(rows.find((c) => c.channel === 'instagram')!.textDe).toBe(
      'Von Hand geschrieben',
    );
    expect(rows.find((c) => c.channel === 'meetup')!.textDe).toContain(
      'Wir löten Abzeichen.',
    );
    // unchanged facts: no new texts
    await h.react(KAI, card, '✏️');
    await resubmit(h.deps, 1, 'kai');
    await h.queue.drain();
    expect(h.ai.calls.filter((c) => c.kind === 'texts')).toHaveLength(
      before + 1,
    );
  });

  it('shows "Texte konnten nicht erstellt werden" after the last retry and tells the author', async () => {
    await collectEvent(h);
    await h.dm(LENA, 'abschicken');
    const card = await cardOf(h);
    await h.react(KAI, card, '✏️');
    await editFacts(h.deps, 1, { startTime: '19:00' }, 'kai');
    h.ai.failNext('http', 3, 'texts'); // in-memory queue: 1 + 2 retries
    await resubmit(h.deps, 1, 'kai');
    await h.queue.drain();
    const [p] = await h.db.db.select().from(posts);
    expect(p.textsError).toBe('http');
    expect(h.matrix.messages(ROOMS.dmLena).at(-1)?.body).toBe(
      'Die Texte für „Lötkurs für Anfänger“ konnten gerade nicht neu erstellt werden. Das Medienteam versucht es später noch einmal.',
    );
    await retryTexts(h.deps, 1, 'mira');
    await h.queue.drain();
    const [fixed] = await h.db.db.select().from(posts);
    expect(fixed.textsError).toBeNull();
    expect(fixed.textsFacts?.startTime).toBe('19:00');
  });
});
