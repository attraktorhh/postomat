import {
  ageDe,
  factsLineShort,
  memberStage,
  shortWeekdayDateDe,
  TYPE_LABELS,
  WEB_STATUS_LABELS,
  type ChannelId,
  type ChannelPostStatus,
  type PostFacts,
  type PostStatus,
} from '@postomat/core';
import {
  and,
  asc,
  channelPosts,
  desc,
  eq,
  history,
  inArray,
  isNotNull,
  ne,
  or,
  photos,
  posts,
  settings,
  sql,
  type Photo,
  type Post,
} from '@postomat/db';
import type { BannerIds } from '../urls';
import {
  CHANNEL_NAMES,
  facebookText,
  instagramCaption,
  meetupCopyFields,
  wikiContent,
  wikiPageTitle,
  wordpressContent,
  wordpressTitle,
} from '@postomat/templates';
import { copyFieldsFor, type CopyField } from '@postomat/channel-copy';
import {
  checksFor,
  draftOf,
  getChannels,
  getPhotos,
  getPost,
  linksOf,
  NotFoundError,
  templateContext,
} from '@postomat/workflow';
import { getDeps } from './deps.server';

export interface ChannelView {
  channel: ChannelId;
  name: string;
  mode: 'auto' | 'copy' | 'off';
  status: ChannelPostStatus;
  textDe: string;
  textEn: string;
  fields: Record<string, string>;
  url: string | null;
  error: string | null;
  copyFields: CopyField[];
  linkedVia?: string;
  linkedAt?: string;
}

/**
 * The bot's Matrix ID. The bot stores its real ID (whoami) in settings; until
 * it has, guess it from MATRIX_USERNAME and the homeserver host.
 */
export async function botMatrixId(): Promise<string> {
  const deps = await getDeps();
  const [row] = await deps.db
    .select()
    .from(settings)
    .where(eq(settings.key, 'matrix_bot_user_id'));
  if (typeof row?.value === 'string' && row.value.startsWith('@'))
    return row.value;
  const server = new URL(deps.env.MATRIX_HOMESERVER_URL).hostname;
  return `@${deps.env.MATRIX_USERNAME ?? 'postomat'}:${server}`;
}

/** Id of the newest banner per format that matches the post's version and colour. */
function currentBannerIds(
  rows: Array<
    Pick<Photo, 'id' | 'kind' | 'format' | 'version' | 'bannerColor'>
  >,
  post: Pick<Post, 'version' | 'bannerColor'>,
): BannerIds {
  const pick = (format: '4x5' | '16x9') =>
    rows
      .filter(
        (r) =>
          r.kind === 'banner' &&
          r.format === format &&
          r.version === post.version &&
          r.bannerColor === post.bannerColor,
      )
      .reduce<number | null>(
        (max, r) => (max && max > r.id ? max : r.id),
        null,
      );
  return { '4x5': pick('4x5'), '16x9': pick('16x9') };
}

/**
 * Everything one post page needs. `forMember` (the author without the
 * Medienteam role) leaves out internal data: history comments, checks, error
 * texts, storage paths, approver and open questions. React Router sends all
 * loader data to the browser, so hiding it in the UI is not enough.
 */
export async function loadPostView(
  id: number,
  opts: { forMember?: boolean } = {},
) {
  const deps = await getDeps();
  const forMember = opts.forMember ?? false;
  let post;
  try {
    post = await getPost(deps.db, id);
  } catch (e) {
    if (e instanceof NotFoundError)
      throw new Response('Beitrag nicht gefunden', { status: 404 });
    throw e;
  }
  const channels = await getChannels(deps.db, id);
  const allPhotos = await getPhotos(deps.db, id);
  const ctx = templateContext(deps, post);
  const links = linksOf(channels);
  const byCh = (ch: ChannelId) => channels.find((c) => c.channel === ch);
  const ig = byCh('instagram');
  const fb = byCh('facebook');
  const mu = byCh('meetup');
  const wp = byCh('wordpress');
  const wiki = byCh('wiki');
  const log = forMember
    ? []
    : await deps.db
        .select()
        .from(history)
        .where(eq(history.postId, id))
        .orderBy(desc(history.id))
        .limit(50);
  return {
    post: {
      id: post.id,
      type: post.type,
      status: post.status,
      version: post.version,
      facts: post.facts,
      title: post.facts.title ?? 'Ohne Titel',
      factsLine: factsLineShort(post.type, post.facts),
      authorUsername: post.authorUsername,
      note: post.note,
      bannerColor: post.bannerColor,
      meetupCategory: post.meetupCategory,
      approvedBy: forMember ? null : post.approvedBy,
      pendingQuestion: forMember ? null : post.pendingQuestion,
      /** Facts the AI read from a Rückfrage answer (Redaktion only). */
      suggestedFacts: forMember ? null : suggestionLines(post),
      /** Text generation failed after all retries (Redaktion only). */
      textsError: forMember ? null : post.textsError,
      stage: memberStage(post.status),
    },
    channels: channels.map<ChannelView>((c) => ({
      channel: c.channel,
      name: CHANNEL_NAMES[c.channel],
      mode: c.mode,
      status: c.status,
      textDe: c.textDe,
      textEn: c.textEn,
      fields: c.fields,
      url: c.url,
      error: forMember ? null : c.error,
      copyFields:
        c.mode === 'off' || forMember
          ? []
          : copyFieldsFor(
              c.channel,
              ctx,
              draftOf(c),
              links,
              post.meetupCategory,
            ),
      linkedVia: c.fields['linkedVia'],
      linkedAt: c.fields['linkedAt'],
    })),
    previews: {
      instagram: ig && ig.mode !== 'off' ? instagramCaption(draftOf(ig)) : null,
      facebook:
        fb && fb.mode !== 'off' ? facebookText(draftOf(fb), links) : null,
      meetup:
        mu && mu.mode !== 'off'
          ? meetupCopyFields(ctx, draftOf(mu), post.meetupCategory)
          : null,
      website:
        wp && wp.mode !== 'off'
          ? {
              title: wordpressTitle(ctx, draftOf(wp)),
              html: wordpressContent(ctx, draftOf(wp), links),
            }
          : null,
      wiki:
        wiki && wiki.mode !== 'off' && post.facts.date
          ? {
              title: wikiPageTitle(ctx),
              text: wikiContent(ctx, draftOf(wiki), links),
            }
          : null,
    },
    photos: forMember
      ? []
      : allPhotos
          .filter((p) => p.kind === 'photo')
          .map((p) => ({
            id: p.id,
            consent: p.consent,
            width: p.width,
            height: p.height,
          })),
    hasBanner: allPhotos.some((p) => p.kind === 'banner'),
    bannerIds: currentBannerIds(allPhotos, post),
    checks: forMember ? [] : await checksFor(deps, id),
    history: log.map((h) => ({
      id: h.id,
      actor: h.actor,
      message: h.message,
      at: h.createdAt.toISOString(),
    })),
    meetupCategories: deps.config.meetup.categories,
    meetupGroupUrl: deps.env.MEETUP_GROUP_URL,
    wordpressCategories: {
      event: deps.config.wordpress.eventCategories,
      workshop: deps.config.wordpress.workshopCategories,
    },
  };
}

export type PostView = Awaited<ReturnType<typeof loadPostView>>;

export async function listMine(username: string) {
  const deps = await getDeps();
  const rows = await deps.db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.authorUsername, username),
        // discarded posts that reached the Medienteam show as "Verworfen";
        // drafts the member cancelled in the DM are left out
        or(ne(posts.status, 'verworfen'), isNotNull(posts.cardEventId)),
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(50);
  const ids = rows.map((p) => p.id);
  // One query each for all channels and banners (no N+1 per post).
  const allChannels = ids.length
    ? await deps.db
        .select()
        .from(channelPosts)
        .where(inArray(channelPosts.postId, ids))
        .orderBy(asc(channelPosts.id))
    : [];
  const banners = ids.length
    ? await deps.db
        .select({
          id: photos.id,
          postId: photos.postId,
          kind: photos.kind,
          format: photos.format,
          version: photos.version,
          bannerColor: photos.bannerColor,
        })
        .from(photos)
        .where(and(inArray(photos.postId, ids), eq(photos.kind, 'banner')))
    : [];
  return rows.map((p) => {
    const channels = allChannels.filter((c) => c.postId === p.id);
    const done = channels.filter(
      (c) =>
        c.url && (c.status === 'veroeffentlicht' || c.status === 'erledigt'),
    );
    return {
      id: p.id,
      title: p.facts.title ?? 'Ohne Titel',
      sub: factsLineShort(p.type, p.facts),
      status: p.status,
      stage: memberStage(p.status),
      /** Channels that are really out (published or linked), for "Online: …". */
      onlineChannels: done.map((c) => CHANNEL_NAMES[c.channel]),
      links: done.map((c) => ({
        name: CHANNEL_NAMES[c.channel],
        url: c.url!,
      })),
      bannerId: currentBannerIds(
        banners.filter((b) => b.postId === p.id),
        p,
      )['4x5'],
      approvedBy: p.approvedBy,
    };
  });
}

const QUEUE_STATUSES: PostStatus[] = [
  'zur_freigabe',
  'aenderung_gewuenscht',
  'geplant',
  'online',
];
const GROUPS = QUEUE_STATUSES.map((s) => ({
  label: WEB_STATUS_LABELS[s],
  statuses: [s],
}));

export async function loadQueue() {
  const deps = await getDeps();
  const now = deps.now();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const rows = await deps.db
    .select()
    .from(posts)
    .where(
      and(
        inArray(posts.status, [
          'zur_freigabe',
          'aenderung_gewuenscht',
          'geplant',
          'online',
        ]),
        sql`(${posts.status} <> 'online' or ${posts.updatedAt} >= ${since.toISOString()})`,
      ),
    )
    .orderBy(desc(posts.updatedAt));
  return GROUPS.map((g) => ({
    label: g.label,
    items: rows
      .filter((r) => g.statuses.includes(r.status))
      .map((r) => ({
        id: r.id,
        title: r.facts.title ?? 'Ohne Titel',
        meta: `${TYPE_LABELS[r.type]} · @${r.authorUsername} · ${ageDe(r.submittedAt ?? r.createdAt, now)}`,
        version: r.version,
      })),
  }));
}

export interface RoomDirectoryEntry {
  roomId: string;
  name?: string;
  alias?: string;
  memberCount: number;
  encrypted: boolean;
}

/** The bot publishes the rooms it has joined into `settings` (key matrix_room_directory). */
export async function loadRoomDirectory(): Promise<{
  rooms: RoomDirectoryEntry[];
  updatedAt?: string;
}> {
  const deps = await getDeps();
  const [row] = await deps.db
    .select()
    .from(settings)
    .where(eq(settings.key, 'matrix_room_directory'));
  if (!row) return { rooms: [] };
  return {
    rooms: row.value as RoomDirectoryEntry[],
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SUGGESTION_LABELS: Partial<Record<keyof PostFacts, string>> = {
  title: 'Titel',
  description: 'Beschreibung',
  date: 'Datum',
  startTime: 'Beginn',
  endTime: 'Ende',
  places: 'Plätze',
  costs: 'Kosten',
  audience: 'Zielgruppe',
  trickiest: 'Kniffligste',
  isWorkshop: 'Workshop',
};

/** "Zielgruppe: ab 12 Jahren" lines for the suggested facts, or null. */
function suggestionLines(post: Post): string[] | null {
  const s = post.suggestedFacts;
  if (!s) return null;
  const lines = Object.entries(s)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const label = SUGGESTION_LABELS[k as keyof PostFacts] ?? k;
      const value =
        k === 'date' && typeof v === 'string'
          ? shortWeekdayDateDe(v)
          : typeof v === 'boolean'
            ? v
              ? 'ja'
              : 'nein'
            : String(v);
      return `${label}: ${value}`;
    });
  return lines.length ? lines : null;
}
