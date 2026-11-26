import { HttpError, slugify } from '@postomat/core';
import {
  MediaWikiError,
  PageExistsError,
  wikiPageUrl,
} from '@postomat/channel-mediawiki';
import { CategoryNotFoundError } from '@postomat/channel-wordpress';
import {
  and,
  channelPosts,
  eq,
  inArray,
  isNull,
  lt,
  or,
  posts,
  sql,
  type ChannelPost,
} from '@postomat/db';
import {
  CHANNEL_NAMES,
  wikiContent,
  wikiPageTitle,
  wordpressContent,
  wordpressTitle,
} from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';
import type { JobMeta } from './queue.ts';
import {
  addHistory,
  getChannel,
  getChannels,
  getPost,
  updateChannel,
} from './repo.ts';
import { draftOf, linksOf, templateContext } from './context.ts';
import { bannerData } from './photos.ts';
import { notifyMemberLink, settleAfterPublish } from './posts.ts';

export type AutoChannel = 'wordpress' | 'wiki';

const marker = (postId: number) => `<!-- postomat:post=${postId} -->`;

/** How long one publish job may hold a channel before another may take over. */
const LEASE = sql`now() + interval '5 minutes'`;

/**
 * Takes the channel for this job: `wartet` and not held by another job.
 * Two jobs for the same channel (double send, sweeper, retry) can never both
 * publish, so a retry never creates a second WordPress post or wiki page.
 */
async function claimChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: AutoChannel,
): Promise<ChannelPost | null> {
  const [row] = await deps.db
    .update(channelPosts)
    .set({ claimedUntil: LEASE, updatedAt: new Date() })
    .where(
      and(
        eq(channelPosts.postId, postId),
        eq(channelPosts.channel, channel),
        eq(channelPosts.status, 'wartet'),
        or(
          isNull(channelPosts.claimedUntil),
          lt(channelPosts.claimedUntil, sql`now()`),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

class NotConfiguredError extends Error {
  constructor(channel: AutoChannel) {
    super(`${CHANNEL_NAMES[channel]} ist nicht konfiguriert.`);
    this.name = 'NotConfiguredError';
  }
}

/**
 * Short German error for the Redaktion and the card. The raw error goes to the
 * log only (it can contain HTTP bodies).
 */
export function channelErrorText(channel: AutoChannel, e: unknown): string {
  const name = CHANNEL_NAMES[channel];
  if (e instanceof PageExistsError)
    return `Die Wiki-Seite „${e.title}“ gibt es schon. Postomat überschreibt sie nicht – bitte im Wiki prüfen.`;
  if (e instanceof CategoryNotFoundError)
    return `Kategorie „${e.slugs.join('“, „')}“ fehlt in WordPress.`;
  if (e instanceof HttpError && (e.status === 401 || e.status === 403))
    return `${name}: Zugang abgelehnt – Zugangsdaten prüfen.`;
  if (
    e instanceof MediaWikiError &&
    ['login', 'notloggedin', 'assertuserfailed', 'permissiondenied'].includes(
      e.code,
    )
  )
    return `${name}: Zugang abgelehnt – Zugangsdaten prüfen.`;
  if (e instanceof MediaWikiError)
    return `${name} hat die Änderung abgelehnt (${e.code}).`;
  if (e instanceof HttpError && e.status >= 400 && e.status < 500)
    return `${name} hat die Anfrage abgelehnt (HTTP ${e.status}).`;
  if (e instanceof NotConfiguredError) return e.message;
  return `${name} nicht erreichbar – später „Erneut versuchen“.`;
}

/**
 * Publishes one auto channel. Idempotent: the channel is claimed atomically
 * and stored remote IDs (plus a marker in the content) prevent duplicates.
 * Only the remote call decides success or failure; follow-ups (summary, DMs,
 * wiki link update) run afterwards and never turn a published channel into
 * an error.
 */
export async function publishChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: AutoChannel,
  meta: JobMeta,
): Promise<void> {
  const c = await claimChannel(deps, postId, channel);
  if (!c) {
    // Already published (e.g. a retry after a failing follow-up): the follow-ups
    // are idempotent, so make sure they ran. Otherwise skipped or held elsewhere.
    const cur = await getChannel(deps.db, postId, channel);
    if (cur?.status === 'veroeffentlicht')
      await settleAfterPublish(deps, postId);
    return;
  }
  // Main "ist online" DM already sent → this is a late publish (e.g. "Erneut versuchen").
  const late = !!(await getPost(deps.db, postId)).autoNotifiedAt;
  let result: { url: string; hadWebsiteLink: boolean };
  try {
    result =
      channel === 'wordpress'
        ? { url: await publishWordPress(deps, postId), hadWebsiteLink: true }
        : await publishWiki(deps, postId);
    await updateChannel(deps.db, postId, channel, {
      status: 'veroeffentlicht',
      url: result.url,
      error: null,
      publishedAt: deps.now(),
      attempts: c.attempts + 1,
      claimedUntil: null,
    });
  } catch (e) {
    await publishFailed(deps, postId, channel, c, meta, e);
    return;
  }
  await addHistory(
    deps.db,
    postId,
    'postomat',
    'published',
    `${CHANNEL_NAMES[channel]} veröffentlicht`,
    { url: result.url },
  );
  await settleAfterPublish(deps, postId);
  if (late) await notifyMemberLink(deps, postId, channel, result.url);
  // The wiki page needs the website link (url=…). Whichever of the two
  // finishes last makes sure it is there.
  const wiki = await getChannel(deps.db, postId, 'wiki');
  if (
    wiki?.status === 'veroeffentlicht' &&
    (channel === 'wordpress' || !result.hadWebsiteLink) &&
    (await getChannel(deps.db, postId, 'wordpress'))?.status ===
      'veroeffentlicht'
  )
    await deps.queue.send('publish.update', { postId, channel: 'wiki' });
}

async function publishFailed(
  deps: WorkflowDeps,
  postId: number,
  channel: AutoChannel,
  c: ChannelPost,
  meta: JobMeta,
  e: unknown,
): Promise<void> {
  const message = channelErrorText(channel, e);
  deps.log.warn('publish failed', {
    postId,
    channel,
    attempt: meta.attempt,
    error: e instanceof Error ? e.message : String(e),
  });
  const final =
    meta.isLastAttempt ||
    e instanceof PageExistsError ||
    e instanceof NotConfiguredError;
  await updateChannel(deps.db, postId, channel, {
    error: message,
    attempts: c.attempts + 1,
    claimedUntil: null,
    ...(final ? { status: 'fehler' as const } : {}),
  });
  if (!final) throw e; // pg-boss retries with backoff
  await addHistory(
    deps.db,
    postId,
    'postomat',
    'failed',
    `${CHANNEL_NAMES[channel]}: Fehler – ${message}`,
  );
  await settleAfterPublish(deps, postId);
}

/**
 * Worker job: re-enqueues auto channels that wait for longer than 10 minutes
 * without a job holding them, e.g. after a crash between approval and
 * enqueueing, or a lost job. Returns the number of channels re-sent.
 */
export async function sweepStrandedChannels(
  deps: WorkflowDeps,
): Promise<number> {
  const rows = await deps.db
    .select({ postId: channelPosts.postId, channel: channelPosts.channel })
    .from(channelPosts)
    .innerJoin(posts, eq(posts.id, channelPosts.postId))
    .where(
      and(
        inArray(posts.status, ['geplant', 'online']),
        eq(channelPosts.mode, 'auto'),
        eq(channelPosts.status, 'wartet'),
        lt(channelPosts.updatedAt, sql`now() - interval '10 minutes'`),
        or(
          isNull(channelPosts.claimedUntil),
          lt(channelPosts.claimedUntil, sql`now()`),
        ),
      ),
    );
  for (const r of rows) {
    deps.log.warn('re-enqueueing stranded publish job', r);
    await deps.queue.send('publish.channel', {
      postId: r.postId,
      channel: r.channel as AutoChannel,
    });
  }
  return rows.length;
}

async function publishWordPress(
  deps: WorkflowDeps,
  postId: number,
): Promise<string> {
  const wp = deps.wordpress;
  if (!wp) throw new NotConfiguredError('wordpress');
  const post = await getPost(deps.db, postId);
  const channels = await getChannels(deps.db, postId);
  const c = channels.find((x) => x.channel === 'wordpress')!;
  const ctx = templateContext(deps, post);

  // Featured image: upload once, remember the media id.
  let mediaId = c.remoteMediaId ? Number(c.remoteMediaId) : undefined;
  if (!mediaId) {
    const banner = await bannerData(deps, post, '16x9');
    const media = await wp.uploadMedia(
      banner.data,
      `postomat-${post.id}-${slugify(post.facts.title ?? 'banner', 40)}.png`,
      'image/png',
      post.facts.title,
    );
    mediaId = media.id;
    await updateChannel(deps.db, postId, 'wordpress', {
      remoteMediaId: String(mediaId),
    });
  }

  // The marker identifies our own post (crash recovery below, never someone else's post).
  const content = `${wordpressContent(ctx, draftOf(c), linksOf(channels))}\n${marker(post.id)}`;
  if (c.remoteId)
    return (await wp.updatePost(Number(c.remoteId), { content })).link;

  // A crash between create and storing the id is covered by the deterministic slug.
  const slug = `${slugify(post.facts.title ?? 'termin', 50)}-${post.facts.date ?? post.id}`;
  const found = await wp.findPostBySlug(slug);
  // Same title + date as an earlier, different post: WordPress picks a new slug.
  const existing =
    found && (await wp.getPost(found.id)).content.includes(marker(post.id))
      ? found
      : null;
  const categories = [
    ...deps.config.wordpress.eventCategories,
    ...(post.facts.isWorkshop ? deps.config.wordpress.workshopCategories : []),
  ];
  const ref =
    existing ??
    (await wp.createPost({
      title: wordpressTitle(ctx, draftOf(c)),
      content,
      status: deps.env.WORDPRESS_POST_STATUS,
      slug,
      categories: await wp.resolveCategoryIds(categories),
      featuredMedia: mediaId,
    }));
  await updateChannel(deps.db, postId, 'wordpress', {
    remoteId: String(ref.id),
    url: ref.link,
  });
  return ref.link;
}

async function publishWiki(
  deps: WorkflowDeps,
  postId: number,
): Promise<{ url: string; hadWebsiteLink: boolean }> {
  const mw = deps.mediawiki;
  if (!mw) throw new NotConfiguredError('wiki');
  const post = await getPost(deps.db, postId);
  const channels = await getChannels(deps.db, postId);
  const c = channels.find((x) => x.channel === 'wiki')!;
  const ctx = templateContext(deps, post);
  const title = c.remoteId ?? wikiPageTitle(ctx);
  const url = wikiPageUrl(deps.env.MEDIAWIKI_PAGE_BASE_URL, title);
  const links = linksOf(channels);
  const hadWebsiteLink = !!links.website;
  if (c.remoteId) return { url, hadWebsiteLink: false };
  const text = `${wikiContent(ctx, draftOf(c), links)}${marker(post.id)}\n`;
  try {
    await mw.createPage(title, text, 'Termin von Postomat');
  } catch (e) {
    if (!(e instanceof PageExistsError)) throw e;
    // Our own page from an earlier attempt? Then it's fine; otherwise never overwrite.
    const existing = await mw.getPageText(title);
    if (!existing?.includes(marker(post.id))) {
      throw new PageExistsError(title);
    }
  }
  await updateChannel(deps.db, postId, 'wiki', { remoteId: title, url });
  return { url, hadWebsiteLink };
}

/** Re-renders a published WordPress post / wiki page (after the Meetup link arrived). */
export async function updatePublished(
  deps: WorkflowDeps,
  postId: number,
  channel: AutoChannel,
  note?: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  const channels = await getChannels(deps.db, postId);
  const c = channels.find((x) => x.channel === channel);
  if (!c?.remoteId || c.status !== 'veroeffentlicht') return;
  const ctx = templateContext(deps, post);
  const links = linksOf(channels);
  if (channel === 'wordpress') {
    if (!deps.wordpress) return;
    await deps.wordpress.updatePost(Number(c.remoteId), {
      content: `${wordpressContent(ctx, draftOf(c), links)}\n${marker(post.id)}`,
    });
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'updated',
      note ?? 'Website: Meetup-Link ergänzt',
    );
  } else {
    if (!deps.mediawiki) return;
    await deps.mediawiki.updatePage(
      c.remoteId,
      `${wikiContent(ctx, draftOf(c), links)}${marker(post.id)}\n`,
      'Meetup-Link ergänzt (Postomat)',
    );
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'updated',
      note ?? 'Wiki: meetupid ergänzt',
    );
  }
}
