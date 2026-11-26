import { createHash } from 'node:crypto';
import { bannerWhenDe, slugify, type Consent } from '@postomat/core';
import { inArray, photos, type Photo, type Post } from '@postomat/db';
import { photoFolder } from '@postomat/media';
import {
  normalizePhoto,
  renderBanner,
  UnsupportedImageError,
  type BannerFormat,
} from '@postomat/render';
import type { WorkflowDeps } from './deps.ts';
import { effectiveEnd } from '@postomat/templates';
import { getPhotos, latestBanner } from './repo.ts';
import { templateContext } from './context.ts';

export { UnsupportedImageError };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Folder for a post's photos and banners in Nextcloud:
 * /Postomat-Fotos/YYYY/YYYY-MM-DD-<slug>-<id>. The post id keeps two posts
 * with the same title and date apart.
 */
export function folderFor(deps: WorkflowDeps, post: Post): string {
  const fact = post.facts.date;
  const date =
    fact && ISO_DATE.test(fact)
      ? fact
      : post.createdAt.toISOString().slice(0, 10);
  const slug = slugify(post.facts.title ?? 'beitrag', 40) || 'beitrag';
  return photoFolder(
    deps.env.NEXTCLOUD_BASE_FOLDER,
    date,
    `${slug}-${post.id}`,
  );
}

/** Next free photo number: one more than the highest stored "<n>.<ext>". */
function nextPhotoNumber(existing: Photo[]): number {
  let max = 0;
  for (const p of existing) {
    const n = Number(/\/(\d+)\.[a-z]+$/.exec(p.path)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return Math.max(max, existing.length) + 1;
}

async function store(
  deps: WorkflowDeps,
  path: string,
  data: Buffer,
  mime: string,
): Promise<void> {
  await deps.media.ensureDir(path.split('/').slice(0, -1).join('/'));
  await deps.media.put(path, data, mime);
}

/**
 * Validates a member photo, normalises it (EXIF orientation applied, metadata
 * such as GPS stripped, max. 2400 px, JPEG), stores it in Nextcloud under
 * /Postomat-Fotos/YYYY/YYYY-MM-DD-<slug>-<id>/<n>.jpg and records metadata.
 * Throws UnsupportedImageError for anything but JPEG/PNG/WebP.
 * Callers must not run two uploads for the same post at once (the bot
 * serialises events per sender).
 */
export async function storeMemberPhoto(
  deps: WorkflowDeps,
  post: Post,
  data: Buffer,
  uploader: string,
): Promise<Photo> {
  const photo = await normalizePhoto(data);
  const existing = (await getPhotos(deps.db, post.id)).filter(
    (p) => p.kind === 'photo',
  );
  const path = `${folderFor(deps, post)}/${nextPhotoNumber(existing)}.jpg`;
  await store(deps, path, photo.jpeg, 'image/jpeg');
  const [row] = await deps.db
    .insert(photos)
    .values({
      postId: post.id,
      kind: 'photo',
      path,
      mime: 'image/jpeg',
      width: photo.width,
      height: photo.height,
      sha256: createHash('sha256').update(photo.jpeg).digest('hex'),
      uploaderMatrixId: uploader,
      consent: 'einwilligung_fehlt',
      tags: [post.type, ...(post.facts.isWorkshop ? ['workshop'] : [])],
    })
    .returning();
  return row;
}

export async function setConsent(
  deps: WorkflowDeps,
  photoIds: number[],
  consent: Consent,
): Promise<void> {
  if (!photoIds.length) return;
  await deps.db
    .update(photos)
    .set({ consent })
    .where(inArray(photos.id, photoIds));
}

/** Renders the 4:5 and 16:9 banners for the current version and stores them. */
export async function renderBanners(
  deps: WorkflowDeps,
  post: Post,
): Promise<Record<BannerFormat, Photo>> {
  const userPhoto = (await getPhotos(deps.db, post.id)).find(
    (p) => p.kind === 'photo',
  );
  const photoData = userPhoto ? await deps.media.get(userPhoto.path) : null;
  const ctx = templateContext(deps, post);
  const when =
    post.type === 'event' && post.facts.date
      ? bannerWhenDe(post.facts.date, post.facts.startTime, effectiveEnd(ctx))
      : undefined;
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

/**
 * Loads the latest banner of a format.
 * - `render: true` (default): renders it first when missing or stale.
 * - `render: false` (web requests): never renders; returns the newest stored
 *   banner (or null) and queues `banner.render` when it is missing or stale.
 */
export async function bannerData(
  deps: WorkflowDeps,
  post: Post,
  format: BannerFormat,
  opts?: { render?: true },
): Promise<{ row: Photo; data: Buffer }>;
export async function bannerData(
  deps: WorkflowDeps,
  post: Post,
  format: BannerFormat,
  opts: { render: boolean },
): Promise<{ row: Photo; data: Buffer; stale: boolean } | null>;
export async function bannerData(
  deps: WorkflowDeps,
  post: Post,
  format: BannerFormat,
  opts: { render?: boolean } = {},
): Promise<{ row: Photo; data: Buffer; stale?: boolean } | null> {
  let row = await latestBanner(deps.db, post.id, format);
  const stale =
    !row ||
    row.version !== post.version ||
    row.bannerColor !== post.bannerColor;
  if (stale && opts.render === false) {
    await deps.queue.send(
      'banner.render',
      { postId: post.id },
      { singletonKey: `banner:${post.id}` },
    );
    if (!row) return null;
    return { row, data: await deps.media.get(row.path), stale: true };
  }
  if (!row || stale) row = (await renderBanners(deps, post))[format];
  return { row, data: await deps.media.get(row.path), stale: false };
}
