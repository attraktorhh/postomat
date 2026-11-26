import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approvals,
  channelPosts,
  eq,
  and,
  photos,
  posts,
  processedEvents,
  sessions,
  sql,
} from '@postomat/db';
import {
  approvePost,
  cleanupOldRows,
  retryChannel,
  setChannelLink,
  setMeetupCategory,
  setPhotoConsent,
  skipChannel,
  sweepStrandedChannels,
} from '@postomat/workflow';
import { Harness, testPhoto } from '../src/harness.ts';

const LENA = '@lena:localhost';
const MIRA = '@mira:localhost';

/** Event dialog up to "abschicken" (submitted, card posted). */
async function submittedEvent(h: Harness, title = 'Lötkurs für Anfänger') {
  await h.dm(LENA, `Ich will am 11.12. einen ${title} machen`);
  await h.dm(LENA, '1');
  await h.dm(LENA, 'Wir löten Abzeichen.');
  await h.dm(LENA, '18 Uhr, 8 Plätze, kostenlos');
  await h.photo(LENA, await testPhoto());
  await h.dm(LENA, '1');
  await h.dm(LENA, 'abschicken');
}

async function channel(h: Harness, postId: number, ch: string) {
  const [row] = await h.db.db
    .select()
    .from(channelPosts)
    .where(and(eq(channelPosts.postId, postId), eq(channelPosts.channel, ch)));
  return row;
}

async function approve(h: Harness, postId = 1, approver = 'mira') {
  const [p] = await h.db.db.select().from(posts).where(eq(posts.id, postId));
  return approvePost(h.deps, {
    postId,
    approverUsername: approver,
    approverIsMedienteam: true,
    version: p.version,
    via: 'web',
  });
}

describe('publishing', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().start();
  }, 30000);
  afterEach(async () => h.stop());

  it('a simultaneous double approval approves once and enqueues one publish job per channel', async () => {
    await submittedEvent(h);
    const sentBefore = h.queue.sent.length;
    const results = await Promise.all([
      approve(h, 1, 'mira'),
      approve(h, 1, 'kai'),
    ]);
    expect(results.filter((r) => r.kind === 'approve')).toHaveLength(1);
    const rows = await h.db.db
      .select()
      .from(approvals)
      .where(eq(approvals.result, 'approved'));
    expect(rows).toHaveLength(1);
    const publishJobs = h.queue.sent
      .slice(sentBefore)
      .filter((j) => j.name === 'publish.channel');
    expect(publishJobs.map((j) => j.data)).toEqual([
      { postId: 1, channel: 'wordpress' },
      { postId: 1, channel: 'wiki' },
    ]);
  });

  it('publishes once even when the same publish job runs twice', async () => {
    await submittedEvent(h);
    await approve(h);
    await h.queue.send('publish.channel', { postId: 1, channel: 'wordpress' });
    await h.queue.send('publish.channel', { postId: 1, channel: 'wiki' });
    await h.queue.drain();
    expect(h.wordpress.posts).toHaveLength(1);
    expect(h.wiki.pages.size).toBe(1);
    expect(h.queue.failures).toEqual([]);
  });

  it('adopts its own WordPress post after a crash between create and answer', async () => {
    await submittedEvent(h);
    h.wordpress.failAfterNextCreates = 1;
    await approve(h);
    await h.queue.drain();
    expect(h.wordpress.posts).toHaveLength(1);
    expect(h.wordpress.media).toHaveLength(1);
    const wp = await channel(h, 1, 'wordpress');
    expect(wp.status).toBe('veroeffentlicht');
    expect(wp.remoteId).toBe(String(h.wordpress.posts[0].id));
  });

  it('adopts its own wiki page after a crash between edit and answer', async () => {
    await submittedEvent(h);
    h.wiki.failAfterNextEdits = 1;
    await approve(h);
    await h.queue.drain();
    expect(h.wiki.pages.size).toBe(1);
    const wiki = await channel(h, 1, 'wiki');
    expect(wiki.status).toBe('veroeffentlicht');
    expect(wiki.error).toBeNull();
  });

  it('adds the website link to the wiki page when WordPress finishes after the wiki', async () => {
    await submittedEvent(h);
    h.wordpress.failNextCreates = 1; // first WordPress attempt fails, the wiki goes first
    await approve(h);
    await h.queue.drain();
    const wp = await channel(h, 1, 'wordpress');
    expect(wp.status).toBe('veroeffentlicht');
    const [text] = [...h.wiki.pages.values()];
    expect(text).toContain(`|url=${wp.url}`);
  });

  it('logs in to the wiki again after its session expired', async () => {
    await submittedEvent(h);
    await approve(h);
    await h.queue.drain();
    h.wiki.expireSessions();
    await setChannelLink(
      h.deps,
      1,
      'meetup',
      'https://www.meetup.com/attraktor/events/4242/',
      'mira',
    );
    await h.queue.drain();
    const [text] = [...h.wiki.pages.values()];
    expect(text).toContain('|meetupid=4242');
    expect(h.queue.failures).toEqual([]);
  });

  it('re-sends publish jobs that got lost after the approval', async () => {
    await submittedEvent(h);
    await approve(h);
    // Lost jobs: e.g. the process died right after the commit.
    h.queue.pending.splice(0, h.queue.pending.length);
    expect(await sweepStrandedChannels(h.deps)).toBe(0); // not stale yet
    await expect(retryChannel(h.deps, 1, 'wordpress', 'mira')).rejects.toThrow(
      'Nur fehlgeschlagene Kanäle',
    );
    await h.db.db.execute(
      sql`update channel_posts set updated_at = now() - interval '11 minutes' where post_id = 1`,
    );
    expect(await sweepStrandedChannels(h.deps)).toBe(2);
    await h.queue.drain();
    expect((await channel(h, 1, 'wordpress')).status).toBe('veroeffentlicht');
    expect((await channel(h, 1, 'wiki')).status).toBe('veroeffentlicht');
  });

  it('lets "Erneut versuchen" restart a channel stuck in wartet', async () => {
    await submittedEvent(h);
    await approve(h);
    h.queue.pending.splice(0, h.queue.pending.length);
    await h.db.db.execute(
      sql`update channel_posts set updated_at = now() - interval '11 minutes' where post_id = 1 and channel = 'wordpress'`,
    );
    await retryChannel(h.deps, 1, 'wordpress', 'mira');
    await h.queue.drain();
    expect((await channel(h, 1, 'wordpress')).status).toBe('veroeffentlicht');
  });

  it('allows links and skips only for copy channels of approved posts', async () => {
    await submittedEvent(h);
    await expect(skipChannel(h.deps, 1, 'instagram', 'mira')).rejects.toThrow(
      'erst, wenn der Beitrag freigegeben ist',
    );
    await expect(
      setChannelLink(
        h.deps,
        1,
        'meetup',
        'https://www.meetup.com/attraktor/events/77/',
        'mira',
      ),
    ).rejects.toThrow('erst nach der Freigabe');
    await approve(h);
    await h.queue.drain();
    await expect(skipChannel(h.deps, 1, 'wordpress', 'mira')).rejects.toThrow(
      'wird automatisch veröffentlicht',
    );
    await setChannelLink(
      h.deps,
      1,
      'instagram',
      'https://instagram.com/p/abc',
      'mira',
    );
    await expect(skipChannel(h.deps, 1, 'instagram', 'mira')).rejects.toThrow(
      'schon erledigt',
    );
    await skipChannel(h.deps, 1, 'facebook', 'mira');
    expect((await channel(h, 1, 'facebook')).status).toBe('uebersprungen');
  });

  it('re-links a wrongly matched Meetup event and never links one event twice', async () => {
    await submittedEvent(h);
    await approve(h);
    await h.queue.drain();
    await setChannelLink(
      h.deps,
      1,
      'meetup',
      'https://www.meetup.com/attraktor/events/111/',
      'mira',
    );
    await setChannelLink(
      h.deps,
      1,
      'meetup',
      'https://www.meetup.com/attraktor/events/222/',
      'mira',
    );
    await h.queue.drain();
    const m = await channel(h, 1, 'meetup');
    expect(m.remoteId).toBe('222');
    expect([...h.wiki.pages.values()][0]).toContain('|meetupid=222');

    // A second post on another day may not take the same Meetup event.
    await h.db.db
      .update(posts)
      .set({ status: 'online' })
      .where(eq(posts.id, 1));
    h.clock = new Date('2026-11-24T10:00:00Z');
    await submittedEvent(h, 'Nähkurs');
    await approve(h, 2);
    await expect(
      setChannelLink(
        h.deps,
        2,
        'meetup',
        'https://www.meetup.com/attraktor/events/222/',
        'mira',
      ),
    ).rejects.toThrow('schon mit „Lötkurs für Anfänger“ verlinkt');
  });

  it('answers a Meetup thread pick that was taken meanwhile instead of claiming success', async () => {
    await submittedEvent(h);
    await approve(h);
    await h.queue.drain();
    h.meetup.events.push(
      { id: '1001', title: 'Lötkurs', start: '2026-12-11T18:00' },
      { id: '1002', title: 'Basteldonnerstag', start: '2026-12-11T19:00' },
    );
    await h.runMeetupPoll();
    const [p] = await h.db.db.select().from(posts);
    // Meanwhile event 1001 got linked to another (fake) post.
    const [other] = await h.db.db
      .insert(posts)
      .values({
        type: 'event',
        status: 'online',
        authorMatrixId: '@kai:localhost',
        authorUsername: 'kai',
        facts: { title: 'Anderer Kurs' },
      })
      .returning();
    await h.db.db.insert(channelPosts).values({
      postId: other.id,
      channel: 'meetup',
      mode: 'copy',
      status: 'erledigt',
      remoteId: '1001',
    });
    await h.threadReply(MIRA, p.cardEventId!, '1');
    const last = h.matrix.messages(p.cardRoomId!, p.cardEventId!).at(-1)!.body;
    expect(last).toContain('Das hat nicht geklappt');
    expect((await channel(h, 1, 'meetup')).status).toBe('kopieren');
  });

  it('fixes photo consent after approval; the Meetup category stays editable until linked', async () => {
    await submittedEvent(h);
    await approve(h);
    await h.queue.drain();
    const [photo] = await h.db.db
      .select()
      .from(photos)
      .where(eq(photos.kind, 'photo'));
    await expect(
      setPhotoConsent(h.deps, 1, photo.id, 'einwilligung_fehlt', 'mira'),
    ).rejects.toThrow('nicht mehr geändert');
    await setMeetupCategory(h.deps, 1, 'Technik', 'mira');
    await setChannelLink(
      h.deps,
      1,
      'meetup',
      'https://www.meetup.com/attraktor/events/333/',
      'mira',
    );
    await expect(setMeetupCategory(h.deps, 1, 'Kunst', 'mira')).rejects.toThrow(
      'nicht mehr geändert',
    );
  });

  it('cleans up old processed events and expired sessions', async () => {
    await h.db.db
      .insert(processedEvents)
      .values([
        { eventId: '$old', createdAt: new Date(Date.now() - 8 * 86400_000) },
        { eventId: '$new' },
      ]);
    const id = `test-${Date.now()}`;
    await h.db.db.insert(sessions).values([
      { id: `${id}-old`, data: {}, expiresAt: new Date(Date.now() - 1000) },
      { id: `${id}-new`, data: {}, expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    const r = await cleanupOldRows(h.deps);
    expect(r.events).toBe(1);
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    const left = await h.db.db.select().from(processedEvents);
    expect(left.map((e) => e.eventId)).toEqual(['$new']);
    const kept = await h.db.db.select({ id: sessions.id }).from(sessions);
    expect(kept.map((s) => s.id)).toContain(`${id}-new`);
    expect(kept.map((s) => s.id)).not.toContain(`${id}-old`);
    await h.db.db.delete(sessions).where(eq(sessions.id, `${id}-new`));
  });
});
