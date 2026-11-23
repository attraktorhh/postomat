import { createHash } from 'node:crypto';
import { bannerWhenDe, slugify, type Consent } from '@postomat/core';
import { inArray, photos, type Photo, type Post } from '@postomat/db';
import { photoFolder } from '@postomat/media';
import { inspectPhoto, renderBanner, UnsupportedImageError, type BannerFormat } from '@postomat/render';
import type { WorkflowDeps } from './deps.ts';
import { effectiveEnd } from '@postomat/templates';
import { getPhotos, latestBanner } from './repo.ts';
import { templateContext } from './context.ts';

export { UnsupportedImageError };

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Folder for a post's photos and banners in Nextcloud. */
export function folderFor(deps: WorkflowDeps, post: Post): string {
  const date = post.facts.date ?? post.createdAt.toISOString().slice(0, 10);
  return photoFolder(deps.env.NEXTCLOUD_BASE_FOLDER, date, slugify(post.facts.title ?? `beitrag-${post.id}`, 40));
}

async function store(deps: WorkflowDeps, path: string, data: Buffer, mime: string): Promise<void> {
  await deps.media.ensureDir(path.split('/').slice(0, -1).join('/'));
  await deps.media.put(path, data, mime);
}

/**
 * Validates a member photo, stores it in Nextcloud under
 * /Postomat-Fotos/YYYY/YYYY-MM-DD-<slug>/<n>.<ext> and records metadata.
 * Throws UnsupportedImageError for anything but JPEG/PNG/WebP.
 */
export async function storeMemberPhoto(deps: WorkflowDeps, post: Post, data: Buffer, uploader: string): Promise<Photo> {
  const info = await inspectPhoto(data);
  const existing = (await getPhotos(deps.db, post.id)).filter((p) => p.kind === 'photo');
  const path = `${folderFor(deps, post)}/${existing.length + 1}.${MIME_EXT[info.mime]}`;
  await store(deps, path, data, info.mime);
  const [row] = await deps.db
    .insert(photos)
    .values({
      postId: post.id,
      kind: 'photo',
      path,
      mime: info.mime,
      width: info.width,
      height: info.height,
      sha256: createHash('sha256').update(data).digest('hex'),
      uploaderMatrixId: uploader,
      consent: 'einwilligung_fehlt',
      tags: [post.type, ...(post.facts.isWorkshop ? ['workshop'] : [])],
    })
    .returning();
  return row;
}

export async function setConsent(deps: WorkflowDeps, photoIds: number[], consent: Consent): Promise<void> {
  if (!photoIds.length) return;
  await deps.db.update(photos).set({ consent }).where(inArray(photos.id, photoIds));
}

/** Renders the 4:5 and 16:9 banners for the current version and stores them. */
export async function renderBanners(deps: WorkflowDeps, post: Post): Promise<Record<BannerFormat, Photo>> {
  const userPhoto = (await getPhotos(deps.db, post.id)).find((p) => p.kind === 'photo');
  const photoData = userPhoto ? await deps.media.get(userPhoto.path) : null;
  const ctx = templateContext(deps, post);
  const when = post.type === 'event' && post.facts.date ? bannerWhenDe(post.facts.date, post.facts.startTime, effectiveEnd(ctx)) : undefined;
  const out = {} as Record<BannerFormat, Photo>;
  for (const format of ['4x5', '16x9'] as const) {
    const { png, width, height } = await renderBanner(
      {
        title: post.facts.title ?? 'Attraktor',
        when,
        where: post.type === 'event' ? deps.config.location.banner : undefined,
        color: post.bannerColor,
        format,
        photo: photoData,
      },
      deps.bannerAssets,
    );
    const path = `${folderFor(deps, post)}/banner-v${post.version}-${post.bannerColor}-${format}.png`;
    await store(deps, path, png, 'image/png');
    const [row] = await deps.db
      .insert(photos)
      .values({
        postId: post.id,
        kind: 'banner',
        format,
        bannerColor: post.bannerColor,
        version: post.version,
        path,
        mime: 'image/png',
        width,
        height,
        sha256: createHash('sha256').update(png).digest('hex'),
        consent: userPhoto?.consent ?? 'frei',
        tags: ['banner'],
      })
      .returning();
    out[format] = row;
  }
  return out;
}

/** Loads the latest banner of a format, rendering it first if needed. */
export async function bannerData(deps: WorkflowDeps, post: Post, format: BannerFormat): Promise<{ row: Photo; data: Buffer }> {
  let row = await latestBanner(deps.db, post.id, format);
  if (!row || row.version !== post.version || row.bannerColor !== post.bannerColor) {
    row = (await renderBanners(deps, post))[format];
  }
  return { row, data: await deps.media.get(row.path) };
}
