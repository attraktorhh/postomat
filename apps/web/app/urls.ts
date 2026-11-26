/** URL helpers shared by server and browser code (no imports, no secrets). */

export type BannerFormat = '4x5' | '16x9';
export type BannerIds = Record<BannerFormat, number | null>;

/**
 * Banner image URL. With the current banner row id the URL is versioned, so
 * the browser may cache it for good; a new render gets a new id and URL.
 */
export function bannerSrc(
  postId: number,
  format: BannerFormat,
  bannerId?: number | null,
  download = false,
): string {
  const q = new URLSearchParams();
  if (bannerId) q.set('b', String(bannerId));
  if (download) q.set('download', '1');
  const qs = q.toString();
  return `/banner/${postId}/${format}${qs ? `?${qs}` : ''}`;
}
