import { slugify } from '@postomat/core';
import { PageExistsError, wikiPageUrl } from '@postomat/channel-mediawiki';
import {
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
import { settleAfterPublish } from './posts.ts';

const marker = (postId: number) => `<!-- postomat:post=${postId} -->`;

/** Publishes one auto channel. Idempotent: stored remote IDs prevent duplicates on retry. */
export async function publishChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: 'wordpress' | 'wiki',
  meta: JobMeta,
): Promise<void> {
  const c = await getChannel(deps.db, postId, channel);
  if (!c || c.status !== 'wartet') return; // already done, skipped or retried elsewhere
  try {
    const url =
      channel === 'wordpress'
        ? await publishWordPress(deps, postId)
        : await publishWiki(deps, postId);
    await updateChannel(deps.db, postId, channel, {
      status: 'veroeffentlicht',
      url,
      error: null,
      publishedAt: deps.now(),
      attempts: c.attempts + 1,
    });
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'published',
      `${channel === 'wordpress' ? 'Website' : 'Wiki'} veröffentlicht`,
      { url },
    );
    await settleAfterPublish(deps, postId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log.warn('publish failed', {
      postId,
      channel,
      attempt: meta.attempt,
      error: message,
    });
    await updateChannel(deps.db, postId, channel, {
      error: message,
      attempts: c.attempts + 1,
    });
    const final = meta.isLastAttempt || e instanceof PageExistsError;
    if (!final) throw e;
    await updateChannel(deps.db, postId, channel, { status: 'fehler' });
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'failed',
      `${channel === 'wordpress' ? 'Website' : 'Wiki'}: Fehler – ${message}`,
    );
    await settleAfterPublish(deps, postId);
  }
}

async function publishWordPress(
  deps: WorkflowDeps,
  postId: number,
): Promise<string> {
  const wp = deps.wordpress;
  if (!wp) throw new Error('WordPress ist nicht konfiguriert');
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

  const content = wordpressContent(ctx, draftOf(c), linksOf(channels));
  if (c.remoteId)
    return (await wp.updatePost(Number(c.remoteId), { content })).link;

  // A crash between create and storing the id is covered by the deterministic slug.
  const slug = `${slugify(post.facts.title ?? 'termin', 50)}-${post.facts.date ?? post.id}`;
  const existing = await wp.findPostBySlug(slug);
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
): Promise<string> {
  const mw = deps.mediawiki;
  if (!mw) throw new Error('Wiki ist nicht konfiguriert');
  const post = await getPost(deps.db, postId);
  const channels = await getChannels(deps.db, postId);
  const c = channels.find((x) => x.channel === 'wiki')!;
  const ctx = templateContext(deps, post);
  const title = c.remoteId ?? wikiPageTitle(ctx);
  const url = wikiPageUrl(deps.env.MEDIAWIKI_PAGE_BASE_URL, title);
  if (c.remoteId) return url;
  const text = `${wikiContent(ctx, draftOf(c), linksOf(channels))}${marker(post.id)}\n`;
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
  return url;
}

/** Re-renders a published WordPress post / wiki page (after the Meetup link arrived). */
export async function updatePublished(
  deps: WorkflowDeps,
  postId: number,
  channel: 'wordpress' | 'wiki',
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
      content: wordpressContent(ctx, draftOf(c), links),
    });
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'updated',
      'Website: Meetup-Link ergänzt',
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
      'Wiki: meetupid ergänzt',
    );
  }
}
