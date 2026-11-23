import sharp from 'sharp';

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Thrown when a buffer is not a JPEG, PNG or WebP image (or cannot be decoded at all). */
export class UnsupportedImageError extends Error {
  constructor(
    message = 'Unsupported image: only JPEG, PNG and WebP are accepted',
  ) {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

const FORMATS: Record<
  string,
  { mime: PhotoMime; ext: 'jpg' | 'png' | 'webp' }
> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

/** Longest edge of a normalized photo. */
export const NORMALIZED_MAX_EDGE = 2400;

/**
 * Detects the image type by content (not by file name) and returns the
 * dimensions as displayed, i.e. after applying the EXIF orientation.
 * Throws `UnsupportedImageError` for anything but JPEG, PNG and WebP.
 */
export async function inspectPhoto(
  buf: Buffer,
): Promise<{
  mime: PhotoMime;
  width: number;
  height: number;
  ext: 'jpg' | 'png' | 'webp';
}> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new UnsupportedImageError(
      'Unsupported image: the data could not be decoded',
    );
  }
  const format = FORMATS[meta.format ?? ''];
  if (!format)
    throw new UnsupportedImageError(
      `Unsupported image format: ${meta.format ?? 'unknown'}`,
    );
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height)
    throw new UnsupportedImageError('Unsupported image: missing dimensions');
  return { ...format, width, height };
}

/**
 * Validates the photo, rotates it according to EXIF, strips all metadata,
 * flattens transparency onto white and re-encodes it as JPEG with at most
 * `NORMALIZED_MAX_EDGE` pixels on the long edge.
 */
export async function normalizePhoto(
  buf: Buffer,
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  await inspectPhoto(buf);
  const { data, info } = await sharp(buf)
    .autoOrient()
    .resize({
      width: NORMALIZED_MAX_EDGE,
      height: NORMALIZED_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

/** Decodes any supported photo and cover-crops it to exactly `width` × `height`, returned as JPEG. */
export async function coverPhoto(
  buf: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  await inspectPhoto(buf);
  return sharp(buf)
    .autoOrient()
    .resize({ width, height, fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 86 })
    .toBuffer();
}
