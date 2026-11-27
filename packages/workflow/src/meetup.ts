import {
  localDateOf,
  shortWeekdayDateDe,
  localTimeOf,
  type CandidateChoice,
} from '@postomat/core';
import { isAiError } from '@postomat/ai';
import {
  and,
  channelPosts,
  eq,
  gte,
  meetupQuestions,
  posts,
  sql,
} from '@postomat/db';
import {
  fetchFeed,
  matchMeetupEvent,
  type FeedEvent,
} from '@postomat/channel-meetup';
import { DM, THREAD } from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';
import { addHistory, getChannel, getPost, updateChannel } from './repo.ts';
import { notifyMemberLink, recomputeOverall, WorkflowError } from './posts.ts';

export interface MeetupLink {
  meetupId: string;
  url: string;
  via: 'ical' | 'manual' | 'thread';
}

/**
 * Links a Meetup event: channel erledigt, WordPress + wiki updated, card, member.
 * Returns false when exactly this event is already linked (nothing to do).
 * Throws a WorkflowError with a German message when linking is not possible.
 * An already linked Meetup channel can be re-linked (fixing a wrong match).
 */
export async function linkMeetup(
  deps: WorkflowDeps,
  postId: number,
  link: MeetupLink,
  actor: string,
): Promise<boolean> {
  const done = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, postId, true);
    const c = await getChannel(tx, postId, 'meetup');
    if (!c || c.mode === 'off')
      throw new WorkflowError('Meetup ist für diesen Beitrag aus');
    if (c.status === 'erledigt' && c.remoteId === link.meetupId) return false;
    if (post.status !== 'geplant' && post.status !== 'online')
      throw new WorkflowError(
        'Den Meetup-Link kannst du erst nach der Freigabe eintragen',
      );
    const [other] = await tx
      .select({ postId: channelPosts.postId, title: posts.facts })
      .from(channelPosts)
      .innerJoin(posts, eq(posts.id, channelPosts.postId))
      .where(
        and(
          eq(channelPosts.channel, 'meetup'),
          eq(channelPosts.status, 'erledigt'),
          eq(channelPosts.remoteId, link.meetupId),
        ),
      )
      .limit(1);
    if (other && other.postId !== postId)
      throw new WorkflowError(
        `Dieses Meetup-Event ist schon mit „${other.title.title ?? `Beitrag ${other.postId}`}“ verlinkt`,
      );
    const relinked = c.status === 'erledigt';
    await updateChannel(tx, postId, 'meetup', {
      status: 'erledigt',
      url: link.url,
      remoteId: link.meetupId,
      publishedAt: deps.now(),
      fields: {
        ...c.fields,
        linkedVia: link.via,
        linkedAt: deps.now().toISOString(),
      },
    });
    await tx
      .update(meetupQuestions)
      .set({ resolved: true })
      .where(eq(meetupQuestions.postId, postId));
    const how =
      link.via === 'ical'
        ? 'im iCal-Feed erkannt'
        : link.via === 'thread'
          ? 'im Thread bestätigt'
          : 'von Hand eingetragen';
    await addHistory(
      tx,
      postId,
      actor,
      'linked',
      `Meetup ${relinked ? 'neu ' : ''}verlinkt (${how})`,
      { url: link.url },
    );
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
    .innerJoin(
      channelPosts,
      and(
        eq(channelPosts.postId, posts.id),
        eq(channelPosts.channel, 'meetup'),
      ),
    )
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
    .where(
      and(
        eq(channelPosts.channel, 'meetup'),
        eq(channelPosts.status, 'erledigt'),
      ),
    );
  return new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
}

const describe = (e: FeedEvent) => ({
  title: e.summary,
  when: `${shortWeekdayDateDe(localDateOf(e.start))} ${localTimeOf(e.start)}`,
});

/** Worker job: read the Meetup iCal feed and link or ask. */
export async function pollMeetup(
  deps: WorkflowDeps,
): Promise<{ checked: number; linked: number; asked: number }> {
  const candidates = await meetupCandidates(deps);
  if (!candidates.length) return { checked: 0, linked: 0, asked: 0 };
  const events = await fetchFeed(deps.env.MEETUP_ICAL_URL, deps.fetch);
  const taken = await linkedMeetupIds(deps);
  let linked = 0;
  let asked = 0;
  for (const { post } of candidates) {
    if (!post.facts.title || !post.facts.date || !post.facts.startTime)
      continue;
    const result = matchMeetupEvent(
      {
        title: post.facts.title,
        date: post.facts.date,
        startTime: post.facts.startTime,
      },
      events,
      taken,
    );
    if (result.kind === 'strong') {
      try {
        if (
          await linkMeetup(
            deps,
            post.id,
            {
              meetupId: result.event.meetupId,
              url: result.event.url,
              via: 'ical',
            },
            'postomat',
          )
        ) {
          linked++;
          taken.add(result.event.meetupId);
        }
      } catch (e) {
        if (!(e instanceof WorkflowError)) throw e;
        deps.log.warn('meetup auto-link refused', {
          postId: post.id,
          error: e.message,
        });
      }
    } else if (result.kind === 'ambiguous') {
      const [open] = await deps.db
        .select()
        .from(meetupQuestions)
        .where(eq(meetupQuestions.postId, post.id))
        .limit(1);
      if (open) continue; // ask only once
      const candidates = result.candidates.map((c) => c.event);
      await deps.db.insert(meetupQuestions).values({
        postId: post.id,
        candidates: candidates.map((e) => ({
          uid: e.meetupId,
          url: e.url,
          title: e.summary,
          start: e.start.toISOString(),
        })),
      });
      await deps.queue.send('bot.thread', {
        postId: post.id,
        text: THREAD.meetupQuestion(post.facts.title, candidates.map(describe)),
      });
      asked++;
    }
  }
  return { checked: candidates.length, linked, asked };
}

/** Longer replies are not sent to the AI (same cap as DMs). */
const MAX_REPLY_CHARS = 4000;

export type MeetupReplyResult =
  /** No open question: a normal thread reply. */
  | 'no_question'
  /** Linked, declined, or the AI failed (the thread was told): not a change request. */
  | 'handled'
  /** The reply is about something else: a normal thread reply (U4). */
  | 'unrelated';

/**
 * Handles a Medienteam thread reply while the Meetup candidate question is
 * open. The AI reads the reply ("2", "das zweite", "keins davon", or something
 * unrelated); nothing else interprets the text.
 */
export async function answerMeetupQuestion(
  deps: WorkflowDeps,
  postId: number,
  text: string,
  actor: string,
  opts: {
    /** Wraps the AI call (the bot shows "Postomat schreibt …"). */
    during?: <T>(fn: () => Promise<T>) => Promise<T>;
  } = {},
): Promise<MeetupReplyResult> {
  const [q] = await deps.db
    .select()
    .from(meetupQuestions)
    .where(
      and(
        eq(meetupQuestions.postId, postId),
        eq(meetupQuestions.resolved, false),
      ),
    )
    .limit(1);
  if (!q) return 'no_question';
  if (text.length > MAX_REPLY_CHARS) {
    await deps.queue.send('bot.thread', { postId, text: DM.messageTooLong });
    return 'handled';
  }
  const during = opts.during ?? (<T>(fn: () => Promise<T>) => fn());
  let reply: CandidateChoice;
  try {
    reply = await during(() =>
      deps.ai.interpretCandidateReply({
        text,
        candidates: q.candidates.map((c) => {
          const start = new Date(c.start);
          return {
            title: c.title,
            date: localDateOf(start),
            time: localTimeOf(start),
          };
        }),
      }),
    );
  } catch (e) {
    if (!isAiError(e)) throw e;
    await deps.queue.send('bot.thread', { postId, text: DM.aiUnavailable });
    return 'handled';
  }
  if (reply.choice === 'unrelated') return 'unrelated';
  if (reply.choice === 'none') {
    await deps.db
      .update(meetupQuestions)
      .set({ resolved: true })
      .where(eq(meetupQuestions.id, q.id));
    await deps.queue.send('bot.thread', {
      postId,
      text: THREAD.meetupDeclined,
    });
    return 'handled';
  }
  const pick = q.candidates[reply.choice - 1];
  if (!pick) return 'unrelated';
  try {
    // linkMeetup re-checks that the event isn't linked to another post meanwhile.
    await linkMeetup(
      deps,
      postId,
      { meetupId: pick.uid, url: pick.url, via: 'thread' },
      actor,
    );
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    await deps.queue.send('bot.thread', {
      postId,
      text: `Das hat nicht geklappt: ${e.message}.`,
    });
    return 'handled';
  }
  await deps.queue.send('bot.thread', {
    postId,
    text: THREAD.meetupLinked(pick.url),
  });
  return 'handled';
}
