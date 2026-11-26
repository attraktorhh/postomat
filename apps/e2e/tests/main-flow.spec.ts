import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, photos, posts, channelPosts } from '@postomat/db';
import { resubmit, setChannelLink, skipChannel } from '@postomat/workflow';
import { Harness, ROOMS, testPhoto } from '../src/harness.ts';

const LENA = '@lena:localhost';
const KAI = '@kai:localhost';
const MIRA = '@mira:localhost';
const GAST = '@gast:localhost';

describe('main flow: DM → approval → publish → Meetup → online', () => {
  const h = new Harness();
  let cardId = '';

  beforeAll(async () => {
    await h.start();
  }, 30000);
  afterAll(async () => {
    try {
      h.assertNoErrors();
    } finally {
      await h.stop();
    }
  });

  it('refuses non-members', async () => {
    const replies = await h.dm(
      GAST,
      'Ich will einen Workshop machen',
      ROOMS.dmGast,
    );
    expect(replies).toEqual([
      'Postomat ist nur für Attraktor-Mitglieder. Frag gern ein Mitglied, ob es deinen Beitrag einreicht.',
    ]);
    expect(await h.db.db.select().from(posts)).toHaveLength(0);
  });

  it('collects the event in the DM, every message interpreted by the AI', async () => {
    expect(await h.dm(LENA, 'Hallo')).toEqual([
      'Hi Lena! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.',
    ]);
    expect(
      await h.dm(
        LENA,
        'Ich will nächsten Freitag einen Lötkurs für Anfänger machen',
      ),
    ).toEqual([
      'Cool, ein Workshop! Ich habe verstanden:\n• Lötkurs für Anfänger\n• Freitag, 27.11.\n\nUm wie viel Uhr geht’s los?',
    ]);
    expect(
      await h.dm(
        LENA,
        'Nee, den Freitag danach, also 11.12.! 18 Uhr, max. 8 Leute, 5 € fürs Material',
      ),
    ).toEqual([
      'Alles klar, Freitag 11.12. · 18:00 · 8 Plätze · 5 € Material.\nHast du ein Foto dazu? Schick es einfach hier rein.',
    ]);
    // The AI got "now" and the open question as context, never names or IDs.
    const last = h.ai.calls.filter((c) => c.kind === 'interpret').at(-1)!;
    expect(last.prompt).toContain('Montag, 2026-11-23, 14:02 Uhr');
    expect(last.prompt).toContain('Europe/Berlin');
    expect(last.input['kontext']).toMatchObject({
      erwartet: 'startTime',
      bekannteAngaben: { date: '2026-11-27' },
    });
    for (const c of h.ai.calls) {
      expect(c.prompt).not.toMatch(/@\w+:localhost|Lena|lena/);
    }
  });

  it('stores the photo in Nextcloud and asks for consent', async () => {
    const replies = await h.photo(LENA, await testPhoto());
    expect(replies[0]).toContain('Sind auf dem Foto Personen erkennbar?');
    const [photo] = await h.db.db
      .select()
      .from(photos)
      .where(eq(photos.kind, 'photo'));
    expect(photo.path).toBe(
      '/Postomat-Fotos/2026/2026-12-11-loetkurs-fuer-anfaenger-1/1.jpg',
    );
    expect(photo.width).toBe(1200);
    expect(photo.sha256).toHaveLength(64);
    expect(h.webdav.files.has(photo.path)).toBe(true);

    const summary = await h.dm(LENA, '1');
    expect(summary[0]).toBe(
      'Alles klar: Personen drauf, alle waren einverstanden.',
    );
    expect(summary[1]).toContain('Super, so schicke ich es ans Medienteam:');
    expect(summary[1]).toContain(
      'Website · Wiki · Meetup · Instagram · Facebook · DE + EN',
    );
    expect(summary[1]).toContain('http://postomat.test/b/1');
    expect(summary[2]).toMatch(/banner-1\.png/);
    expect(summary[3]).toBe(
      'Antworte „abschicken“ oder ergänze im Browser eine Notiz.',
    );
    const [updated] = await h.db.db
      .select()
      .from(photos)
      .where(eq(photos.id, photo.id));
    expect(updated.consent).toBe('frei');
  });

  it('submits via "abschicken" and posts one card', async () => {
    expect(await h.dm(LENA, 'abschicken')).toEqual([
      'Ist beim Medienteam 🙌 Ich melde mich, sobald es online ist.',
    ]);
    const cards = h.matrix
      .messages(ROOMS.medienteam)
      .filter((m) => !m.opts.threadRoot && !m.opts.replaces);
    expect(cards).toHaveLength(1);
    cardId = cards[0].eventId;
    expect(h.card(cardId)).toContain(
      'Lötkurs für Anfänger · von @lena · v1 · Zur Freigabe',
    );
    expect(h.card(cardId)).toContain(
      'Event · Fr 11.12. · 18:00 · 8 Plätze · 5 €',
    );
    expect(h.card(cardId)).toContain(
      'Website + Wiki: sofort · Meetup: Kopierhilfe · IG: Kopiervorlage · FB: Kopiervorlage',
    );
    // banner in the card's thread
    expect(
      h.matrix
        .messages(ROOMS.medienteam, cardId)
        .some((m) => m.kind === 'image'),
    ).toBe(true);
  });

  it('refuses self-approval and ignores non-Medienteam reactions', async () => {
    await h.react(LENA, cardId, '👍');
    await h.react(GAST, cardId, '👍');
    expect(h.matrix.messages(ROOMS.medienteam, cardId).at(-1)?.body).toBe(
      'Eigene Beiträge kann man nicht selbst freigeben 🙂',
    );
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('zur_freigabe');
  });

  it('a thread reply requests a change; resubmit makes v2', async () => {
    await h.threadReply(
      KAI,
      cardId,
      'Bitte noch erwähnen, dass Lötstationen da sind',
    );
    expect(h.card(cardId)).toContain('Änderung gewünscht');
    await h.react(MIRA, cardId, '👍🏽');
    expect(h.matrix.messages(ROOMS.medienteam, cardId).at(-1)?.body).toBe(
      'Bitte erst die neue Version zur Freigabe stellen.',
    );
    await resubmit(h.deps, 1, 'kai');
    await h.queue.drain();
    expect(h.card(cardId)).toContain('v2 · Zur Freigabe');
    const cards = h.matrix
      .messages(ROOMS.medienteam)
      .filter((m) => !m.opts.threadRoot && !m.opts.replaces);
    expect(cards).toHaveLength(1); // edited in place, never a new card
  });

  it('approves with 👍 by another member and publishes WordPress + wiki once', async () => {
    await h.react(MIRA, cardId, '👍🏽');
    await h.react(KAI, cardId, '👍'); // double 👍 must not publish twice
    expect(h.wordpress.posts).toHaveLength(1);
    const wp = h.wordpress.posts[0];
    expect(wp.status).toBe('publish');
    expect([...wp.categories].sort((a, b) => a - b)).toEqual([6, 102]);
    expect(wp.featured_media).toBeGreaterThan(0);
    expect(wp.content).toContain('<strong>Wo:</strong>');
    expect(wp.content).toContain(
      '<strong>Wann:</strong> Freitag, den 11.12.26 | 18 – 21 Uhr',
    );
    expect(wp.content).toContain('<h3>English</h3>');
    expect(h.wiki.pages.has('Termin:Lötkurs für Anfänger 2026-12-11')).toBe(
      true,
    );
    const wikiText = h.wiki.pages.get(
      'Termin:Lötkurs für Anfänger 2026-12-11',
    )!;
    expect(wikiText).toContain(
      '{{Termin\n|date=2026/12/11 06:00:00 PM\n|enddate=2026/12/11 09:00:00 PM',
    );
    expect(wikiText).toContain(`|url=${wp.link}`);

    const top = h.matrix
      .messages(ROOMS.medienteam)
      .filter((m) => !m.opts.threadRoot && !m.opts.replaces);
    expect(top.at(-1)?.body).toContain(
      'Freigegeben von @mira. Website und Wiki sind online.',
    );
    expect(top.at(-1)?.body).toContain(
      '@mira: Meetup, Instagram und Facebook brauchen dich kurz 👉 Kopierhilfe öffnen',
    );
    expect(h.card(cardId)).toContain('Freigegeben · @mira');

    const dm = h.matrix.messages(ROOMS.dmLena).at(-1)!.body;
    expect(dm).toContain('✅ Dein Lötkurs für Anfänger ist online!');
    expect(dm).toContain(`• Website: ${wp.link}`);
    expect(dm).toContain(
      '• Wiki: http://wiki.test/index.php/Termin:L%C3%B6tkurs_f%C3%BCr_Anf%C3%A4nger_2026-12-11',
    );
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('geplant');
  });

  it('detects the Meetup event in the iCal feed and links it everywhere', async () => {
    await h.runMeetupPoll(); // nothing in the feed yet
    h.meetup.events.push({
      id: '312070001',
      title: 'Lötkurs für Anfänger / Soldering for beginners',
      start: '2026-12-11T18:00',
      end: '2026-12-11T21:00',
    });
    await h.runMeetupPoll();
    const [meetup] = await h.db.db
      .select()
      .from(channelPosts)
      .where(eq(channelPosts.channel, 'meetup'));
    expect(meetup.status).toBe('erledigt');
    expect(meetup.url).toBe(
      'https://www.meetup.com/attraktor/events/312070001/',
    );
    expect(h.wordpress.posts[0].content).toContain(
      'https://www.meetup.com/attraktor/events/312070001/',
    );
    expect(
      h.wiki.pages.get('Termin:Lötkurs für Anfänger 2026-12-11'),
    ).toContain('|meetupid=312070001');
    expect(h.matrix.messages(ROOMS.dmLena).at(-1)?.body).toBe(
      '🔗 Meetup zu „Lötkurs für Anfänger“ ist da: https://www.meetup.com/attraktor/events/312070001/',
    );
    expect(h.card(cardId)).toContain(
      'Meetup: Gefunden – https://www.meetup.com/attraktor/events/312070001/',
    );
  });

  it('goes online after Instagram is linked and Facebook skipped', async () => {
    await setChannelLink(
      h.deps,
      1,
      'instagram',
      'https://www.instagram.com/p/abc/',
      'mira',
    );
    await skipChannel(h.deps, 1, 'facebook', 'mira');
    await h.queue.drain();
    const [p] = await h.db.db.select().from(posts);
    expect(p.status).toBe('online');
    expect(h.card(cardId)).toContain('· Online');
    expect(h.matrix.messages(ROOMS.dmLena).at(-1)?.body).toContain(
      'Instagram zu „Lötkurs für Anfänger“ ist da',
    );
    expect(h.wordpress.posts).toHaveLength(1);
    expect(h.queue.failures).toEqual([]);
  });

  it('sent every member DM text through the AI', () => {
    const memberTexts = h.sentTexts
      .filter((m) => !m.thread && m.user === LENA)
      .map((m) => m.text);
    expect(memberTexts.length).toBeGreaterThan(4);
    expect(h.ai.interpretedTexts()).toEqual(memberTexts);
    // Texts were written by the AI too (summary).
    expect(h.ai.calls.some((c) => c.kind === 'texts')).toBe(true);
  });
});
