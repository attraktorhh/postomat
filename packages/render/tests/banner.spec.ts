import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BANNER_COLORS, type BannerColor } from '@postomat/core';
import {
  BANNER_PALETTE,
  BANNER_SIZES,
  ICON_STROKE_WIDTH,
  renderBanner,
  renderBannerSvg,
  type BannerFormat,
  type BannerInput,
} from '../src/index.ts';

const OUT = new URL('../test-output/', import.meta.url);
const FORMATS: BannerFormat[] = ['4x5', '16x9'];

const base = {
  title: 'Lötworkshop für Anfänger',
  when: 'Freitag, den 11.12.26 | 18 – 21 Uhr',
  where: 'Attraktor e.V. Eschelsweg 4, 22767 Hamburg',
};

async function testPhoto(kind: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const shapes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">' +
      '<circle cx="480" cy="520" r="320" fill="#d08840"/><rect x="900" y="260" width="520" height="760" fill="#30587a"/></svg>',
  );
  return sharp({
    create: { width: 1600, height: 1200, channels: 3, background: '#857565' },
  })
    .composite([{ input: shapes }])
    .toFormat(kind)
    .toBuffer();
}

/** Concatenated text content of all `<text>` elements (Satori emits one per word). */
const svgText = (svg: string): string =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((m) => m[1])
    .join('')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** Decoded inline SVGs (icons, band curve) that Satori embeds as `data:image/svg+xml;utf8,` images. */
const inlineSvgs = (svg: string): string =>
  [...svg.matchAll(/href="data:image\/svg\+xml;utf8,([^"]*)"/g)]
    .map((m) => decodeURIComponent(m[1]))
    .join('\n');

describe('renderBanner', () => {
  const photos = Promise.all([
    testPhoto('jpeg'),
    testPhoto('png'),
    testPhoto('webp'),
  ]);

  for (const format of FORMATS) {
    for (const color of BANNER_COLORS) {
      it(`renders ${color} ${format} with and without photo at the exact size`, async () => {
        const [jpeg, png, webp] = await photos;
        const photo = { mint: jpeg, blau: png, rot: webp, hellblau: jpeg }[
          color
        ];
        const { width, height } = BANNER_SIZES[format];
        await mkdir(OUT, { recursive: true });

        for (const [suffix, input] of [
          ['photo', { ...base, color, format, photo }],
          ['nophoto', { ...base, color, format, photo: null }],
        ] as const) {
          const started = Date.now();
          const result = await renderBanner(input);
          expect(Date.now() - started).toBeLessThan(2000);
          expect(result.width).toBe(width);
          expect(result.height).toBe(height);
          const meta = await sharp(result.png).metadata();
          expect(meta.format).toBe('png');
          expect(meta.width).toBe(width);
          expect(meta.height).toBe(height);
          await writeFile(
            new URL(`banner-${format}-${color}-${suffix}.png`, OUT),
            result.png,
          );
        }
      });
    }
  }

  it('fits a very long title into the canvas', async () => {
    const title =
      'Großer Elektronik-Flohmarkt mit Reparatur-Café, Lötstationen und offenem Hackspace-Abend!';
    expect(title.length).toBeGreaterThanOrEqual(88);
    for (const format of FORMATS) {
      const { width, height } = BANNER_SIZES[format];
      const input: BannerInput = { ...base, title, color: 'blau', format };
      const svg = await renderBannerSvg(input, {}, { embedFont: false });
      const words = [
        ...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g),
      ];
      expect(words.length).toBeGreaterThan(0);
      for (const [, x, y, w] of words) {
        expect(Number(x)).toBeGreaterThanOrEqual(0);
        expect(Number(x) + Number(w)).toBeLessThanOrEqual(width);
        expect(Number(y)).toBeGreaterThanOrEqual(0);
        expect(Number(y)).toBeLessThanOrEqual(height);
      }
      const { png } = await renderBanner(input);
      expect((await sharp(png).metadata()).width).toBe(width);
      await writeFile(new URL(`banner-${format}-long-title.png`, OUT), png);
    }
  });

  it('also renders without when/where', async () => {
    const { width, height } = await renderBanner({
      title: 'Offener Abend',
      color: 'hellblau',
      format: '16x9',
    });
    expect([width, height]).toEqual([1200, 675]);
  });
});

describe('renderBannerSvg', () => {
  it.each(BANNER_COLORS.map((c) => [c] as [BannerColor]))(
    'contains texts, band colour and icons (%s)',
    async (color) => {
      const svg = await renderBannerSvg(
        { ...base, color, format: '4x5' },
        {},
        { embedFont: false },
      );
      const text = svgText(svg);
      expect(text).toContain('LÖTWORKSHOP FÜR ANFÄNGER');
      expect(text).toContain(base.when);
      expect(text).toContain(base.where);
      expect(text).toContain('attraktor');
      expect(text).toContain('e.V. Hamburg');

      const { band, ink } = BANNER_PALETTE[color];
      expect(svg).toContain(`fill="${band}"`);
      // The icons are inline SVG images with a unique stroke width in the band's ink colour.
      const decoded = inlineSvgs(svg);
      const icons =
        decoded.match(
          new RegExp(
            `stroke="${ink}" stroke-width="${ICON_STROKE_WIDTH}"`,
            'g',
          ),
        ) ?? [];
      expect(icons.length).toBe(4); // clock: circle + hands, pin: outline + dot
      expect(decoded).toContain('<circle cx="12" cy="12" r="8.6"'); // clock face
      expect(decoded).toContain('M12 21.6s-6.8-6.1'); // pin outline
    },
  );

  it('omits icons for missing when/where', async () => {
    const svg = await renderBannerSvg(
      { title: 'Test', color: 'mint', format: '4x5' },
      {},
      { embedFont: false },
    );
    expect(inlineSvgs(svg)).not.toContain(
      `stroke-width="${ICON_STROKE_WIDTH}"`,
    );
  });
});

describe('logo override', () => {
  it('renders a PNG logo instead of the lettering', async () => {
    const logoPath = join(tmpdir(), `postomat-logo-${process.pid}.png`);
    await writeFile(
      logoPath,
      await sharp({
        create: {
          width: 300,
          height: 100,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    );
    const svg = await renderBannerSvg(
      { ...base, color: 'rot', format: '4x5' },
      { logoPath },
      { embedFont: false },
    );
    expect(svg).toContain('data:image/png;base64,');
    expect(svgText(svg)).not.toContain('attraktor');

    const { png, width, height } = await renderBanner(
      { ...base, color: 'rot', format: '16x9' },
      { logoPath },
    );
    expect([width, height]).toEqual([1200, 675]);
    await writeFile(new URL('banner-16x9-rot-logo.png', OUT), png);
  });

  it('renders an SVG logo', async () => {
    const logoPath = join(tmpdir(), `postomat-logo-${process.pid}.svg`);
    await writeFile(
      logoPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#fff"/></svg>',
    );
    const svg = await renderBannerSvg(
      { ...base, color: 'mint', format: '4x5' },
      { logoPath },
      { embedFont: false },
    );
    expect(svg).toContain('data:image/svg+xml;base64,');
  });
});

describe('default logo lettering', () => {
  it('uses the band ink colour so it is readable on light bands', async () => {
    const svg = await renderBannerSvg(
      { ...base, format: '4x5', color: 'mint' },
      {},
      { embedFont: false },
    );
    const logo = /<text[^>]*>attraktor<\/text>/.exec(svg)?.[0] ?? '';
    expect(logo).toContain(`fill="${BANNER_PALETTE.mint.ink}"`);
    const white = await renderBannerSvg(
      { ...base, format: '4x5', color: 'rot' },
      {},
      { embedFont: false },
    );
    expect(/<text[^>]*>attraktor<\/text>/.exec(white)?.[0]).toContain(
      'fill="#ffffff"',
    );
  });
});
