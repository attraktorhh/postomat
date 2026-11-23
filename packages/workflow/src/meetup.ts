import { localDateOf, shortWeekdayDateDe, localTimeOf } from '@postomat/core';
import { and, channelPosts, eq, gte, meetupQuestions, posts, sql } from '@postomat/db';
import { fetchFeed, matchMeetupEvent, type FeedEvent } from '@postomat/channel-meetup';
import { THREAD } from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';
import { addHistory, getChannel, getPost, updateChannel } from './repo.ts';
import { notifyMemberLink, recomputeOverall } from './posts.ts';

export interface MeetupLink {
  meetupId: string;
  url: string;
  via: 'ical' | 'manual' | 'thread';
}

/** Links a Meetup event: channel erledigt, WordPress + wiki updated, card, member. */
export async function linkMeetup(deps: WorkflowDeps, postId: number, link: MeetupLink, actor: string): Promise<boolean> {
  const done = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, postId, true);
    const c = await getChannel(tx, postId, 'meetup');
    if (!c || c.mode === 'off') return false;
    if (c.status === 'erledigt' && c.remoteId === link.meetupId) return false;
    if (post.status !== 'geplant' && post.status !== 'online') return false;
    await updateChannel(tx, postId, 'meetup', {
      status: 'erledigt',
      url: link.url,
      remoteId: link.meetupId,
      publishedAt: deps.now(),
      fields: { ...c.fields, linkedVia: link.via, linkedAt: deps.now().toISOString() },
    });
    await tx.update(meetupQuestions).set({ resolved: true }).where(eq(meetupQuestions.postId, postId));
    const how = link.via === 'ical' ? 'im iCal-Feed erkannt' : link.via === 'thread' ? 'im Thread bestätigt' : 'von Hand eingetragen';
    await addHistory(tx, postId, actor, 'linked', `Meetup verlinkt (${how})`, { url: link.url });
    return true;
  });
  if (!done) return false;
  await deps.queue.send('publish.update', { postId, channel: 'wordpress' });
  await deps.queue.send('publish.update', { postId, channel: 'wiki' });
  await notifyMemberLink(deps, postId, 'meetup', link.url);
  await recomputeOverall(deps, postId);
  await deps.queue.send('bot.card', { postId });
  return true;
}

/** Approved future events whose Meetup channel still waits for a link. */
export async function meetupCandidates(deps: WorkflowDeps) {
  const today = localDateOf(deps.now());
  return deps.db
    .select({ post: posts })
    .from(posts)
    .innerJoin(channelPosts, and(eq(channelPosts.postId, posts.id), eq(channelPosts.channel, 'meetup')))
    .where(
      and(
        eq(posts.type, 'event'),
        sql`${posts.status} in ('geplant','online')`,
        eq(channelPosts.status, 'kopieren'),
        gte(sql`${posts.facts}->>'date'`, today),
      ),
    );
}

async function linkedMeetupIds(deps: WorkflowDeps): Promise<Set<string>> {
  const rows = await deps.db
    .select({ id: channelPosts.remoteId })
    .from(channelPosts)
    .where(and(eq(channelPosts.channel, 'meetup'), eq(channelPosts.status, 'erledigt')));
  return new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
}

const describe = (e: FeedEvent) => ({ title: e.summary, when: `${shortWeekdayDateDe(localDateOf(e.start))} ${localTimeOf(e.start)}` });

/** Worker job: read the Meetup iCal feed and link or ask. */
export async function pollMeetup(deps: WorkflowDeps): Promise<{ checked: number; linked: number; asked: number }> {
  const candidates = await meetupCandidates(deps);
  if (!candidates.length) return { checked: 0, linked: 0, asked: 0 };
  const events = await fetchFeed(deps.env.MEETUP_ICAL_URL, deps.fetch);
  let linked = 0;
  let asked = 0;
  for (const { post } of candidates) {
    if (!post.facts.title || !post.facts.date || !post.facts.startTime) continue;
    const result = matchMeetupEvent(
      { title: post.facts.title, date: post.facts.date, startTime: post.facts.startTime },
      events,
      await linkedMeetupIds(deps),
    );
    if (result.kind === 'strong') {
      if (await linkMeetup(deps, post.id, { meetupId: result.event.meetupId, url: result.event.url, via: 'ical' }, 'postomat')) linked++;
    } else if (result.kind === 'ambiguous') {
      const [open] = await deps.db.select().from(meetupQuestions).where(eq(meetupQuestions.postId, post.id)).limit(1);
      if (open) continue; // ask only once
      const candidates = result.candidates.map((c) => c.event);
      await deps.db.insert(meetupQuestions).values({
        postId: post.id,
        candidates: candidates.map((e) => ({ uid: e.meetupId, url: e.url, title: e.summary, start: e.start.toISOString() })),
      });
      await deps.queue.send('bot.thread', { postId: post.id, text: THREAD.meetupQuestion(post.facts.title, candidates.map(describe)) });
      asked++;
    }
  }
  return { checked: candidates.length, linked, asked };
}

/**
 * Handles a thread reply to the Meetup question. Returns true when the reply
 * was an answer (number or "nein") – such replies are not change requests.
 */
export async function answerMeetupQuestion(deps: WorkflowDeps, postId: number, text: string, actor: string): Promise<boolean> {
  const [q] = await deps.db
    .select()
    .from(meetupQuestions)
    .where(and(eq(meetupQuestions.postId, postId), eq(meetupQuestions.resolved, false)))
    .limit(1);
  if (!q) return false;
  const t = text.trim().toLowerCase();
  if (/^(nein|nö|keins?|keines)\b/.test(t)) {
    await deps.db.update(meetupQuestions).set({ resolved: true }).where(eq(meetupQuestions.id, q.id));
    await deps.queue.send('bot.thread', { postId, text: THREAD.meetupDeclined });
    return true;
  }
  const m = /^\s*([1-9])(?:\uFE0F?\u20E3)?\s*[.!)]?\s*$/u.exec(t);
  const pick = m ? q.candidates[Number(m[1]) - 1] : undefined;
  if (!pick) return false;
  await linkMeetup(deps, postId, { meetupId: pick.uid, url: pick.url, via: 'thread' }, actor);
  await deps.queue.send('bot.thread', { postId, text: THREAD.meetupLinked(pick.url) });
  return true;
}
