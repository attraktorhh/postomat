import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  UnsupportedImageError,
  inspectPhoto,
  normalizePhoto,
} from '../src/index.ts';

const image = (
  format: 'jpeg' | 'png' | 'webp' | 'gif',
  width = 64,
  height = 48,
): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: '#3d7fc4' } })
    .toFormat(format)
    .toBuffer();

describe('inspectPhoto', () => {
  it.each([
    ['jpeg', 'image/jpeg', 'jpg'],
    ['png', 'image/png', 'png'],
    ['webp', 'image/webp', 'webp'],
  ] as const)('accepts %s', async (format, mime, ext) => {
    expect(await inspectPhoto(await image(format))).toEqual({
      mime,
      ext,
      width: 64,
      height: 48,
    });
  });

  it('rejects GIF', async () => {
    await expect(inspectPhoto(await image('gif'))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it('rejects random bytes', async () => {
    await expect(inspectPhoto(randomBytes(512))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it('reports dimensions after EXIF rotation', async () => {
    const rotated = await sharp(await image('jpeg', 80, 40))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(await inspectPhoto(rotated)).toMatchObject({
      width: 40,
      height: 80,
    });
  });
});

describe('normalizePhoto', () => {
  it('rotates, strips metadata and limits the long edge', async () => {
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#b8322b' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const { jpeg, width, height } = await normalizePhoto(big);
    expect([width, height]).toEqual([1200, 2400]);
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([1200, 2400]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it('converts PNG with alpha to JPEG', async () => {
    const png = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const { jpeg, width } = await normalizePhoto(png);
    expect(width).toBe(20);
    expect((await sharp(jpeg).metadata()).format).toBe('jpeg');
  });

  it('rejects unsupported input', async () => {
    await expect(
      normalizePhoto(Buffer.from('not an image')),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});
