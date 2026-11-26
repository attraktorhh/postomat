import {
  ageDe,
  factsLineShort,
  memberStage,
  type ChannelId,
  type PostStatus,
} from '@postomat/core';
import {
  and,
  desc,
  eq,
  history,
  inArray,
  isNotNull,
  ne,
  or,
  posts,
  settings,
  sql,
} from '@postomat/db';
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
  status: string;
  textDe: string;
  textEn: string;
  fields: Record<string, string>;
  url: string | null;
  error: string | null;
  copyFields: CopyField[];
  linkedVia?: string;
  linkedAt?: string;
}

export async function loadPostView(id: number) {
  const deps = await getDeps();
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
  const log = await deps.db
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
      approvedBy: post.approvedBy,
      pendingQuestion: post.pendingQuestion,
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
      error: c.error,
      copyFields:
        c.mode === 'off'
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
    photos: allPhotos
      .filter((p) => p.kind === 'photo')
      .map((p) => ({
        id: p.id,
        consent: p.consent,
        path: p.path,
        width: p.width,
        height: p.height,
      })),
    hasBanner: allPhotos.some((p) => p.kind === 'banner'),
    checks: await checksFor(deps, id),
    history: log.map((h) => ({
      id: h.id,
      actor: h.actor,
      message: h.message,
      at: h.createdAt.toISOString(),
    })),
    meetupCategories: deps.config.meetup.categories,
    meetupGroupUrl: deps.env.MEETUP_GROUP_URL,
    matrixBot: deps.env.MATRIX_USERNAME ?? 'postomat',
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
  const result = [];
  for (const p of rows) {
    const channels = await getChannels(deps.db, p.id);
    const links = channels.filter(
      (c) =>
        c.url && (c.status === 'veroeffentlicht' || c.status === 'erledigt'),
    );
    result.push({
      id: p.id,
      title: p.facts.title ?? 'Ohne Titel',
      sub: factsLineShort(p.type, p.facts),
      status: p.status,
      stage: memberStage(p.status),
      channels: channels
        .filter((c) => c.mode !== 'off')
        .map((c) => CHANNEL_NAMES[c.channel]),
      links: links.map((c) => ({
        name: CHANNEL_NAMES[c.channel],
        url: c.url!,
      })),
      approvedBy: p.approvedBy,
    });
  }
  return result;
}

const GROUPS: Array<{ label: string; statuses: PostStatus[] }> = [
  { label: 'Zur Freigabe', statuses: ['zur_freigabe'] },
  { label: 'Änderung gewünscht', statuses: ['aenderung_gewuenscht'] },
  { label: 'Geplant', statuses: ['geplant'] },
  { label: 'Online', statuses: ['online'] },
];

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
        meta: `${r.type === 'event' ? 'Event' : 'Projekt'} · @${r.authorUsername} · ${ageDe(r.submittedAt ?? r.createdAt, now)}`,
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
