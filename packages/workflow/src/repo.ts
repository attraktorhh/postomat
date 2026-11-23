import {
  and,
  asc,
  channelPosts,
  desc,
  eq,
  history,
  photos,
  posts,
  type ChannelPost,
  type DbOrTx,
  type Photo,
  type Post,
} from '@postomat/db';
import type { ChannelId, ChannelPostSnapshot, PhotoSnapshot, PostSnapshot } from '@postomat/core';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export async function getPost(db: DbOrTx, id: number, lock = false): Promise<Post> {
  const q = db.select().from(posts).where(eq(posts.id, id));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new NotFoundError(`post ${id}`);
  return row;
}

export async function getChannels(db: DbOrTx, postId: number): Promise<ChannelPost[]> {
  return db.select().from(channelPosts).where(eq(channelPosts.postId, postId)).orderBy(asc(channelPosts.id));
}

export async function getChannel(db: DbOrTx, postId: number, channel: ChannelId): Promise<ChannelPost | undefined> {
  const [row] = await db
    .select()
    .from(channelPosts)
    .where(and(eq(channelPosts.postId, postId), eq(channelPosts.channel, channel)));
  return row;
}

export async function updateChannel(
  db: DbOrTx,
  postId: number,
  channel: ChannelId,
  values: Partial<typeof channelPosts.$inferInsert>,
): Promise<void> {
  await db
    .update(channelPosts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(channelPosts.postId, postId), eq(channelPosts.channel, channel)));
}

export async function getPhotos(db: DbOrTx, postId: number): Promise<Photo[]> {
  return db.select().from(photos).where(eq(photos.postId, postId)).orderBy(asc(photos.id));
}

export async function latestBanner(db: DbOrTx, postId: number, format: '4x5' | '16x9'): Promise<Photo | undefined> {
  const [row] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.postId, postId), eq(photos.kind, 'banner'), eq(photos.format, format)))
    .orderBy(desc(photos.id))
    .limit(1);
  return row;
}

export async function addHistory(
  db: DbOrTx,
  postId: number,
  actor: string,
  kind: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(history).values({ postId, actor, kind, message, data });
}

export async function updatePost(db: DbOrTx, id: number, values: Partial<typeof posts.$inferInsert>): Promise<void> {
  await db
    .update(posts)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(posts.id, id));
}

export const toSnapshot = (p: Post): PostSnapshot => ({
  id: p.id,
  type: p.type,
  status: p.status,
  version: p.version,
  facts: p.facts,
  authorMatrixId: p.authorMatrixId,
  authorUsername: p.authorUsername,
});

export const channelSnapshot = (c: ChannelPost): ChannelPostSnapshot => ({
  channel: c.channel,
  mode: c.mode,
  status: c.status,
  textDe: c.textDe,
  textEn: c.textEn,
  fields: c.fields,
  url: c.url,
});

export const photoSnapshot = (p: Photo): PhotoSnapshot => ({ id: p.id, consent: p.consent, kind: p.kind });

/** "@lena:localhost" → "lena" */
export const localpart = (matrixId: string): string => matrixId.replace(/^@/, '').split(':')[0];
