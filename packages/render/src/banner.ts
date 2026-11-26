import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { Font } from 'satori';
import sharp from 'sharp';
import type { BannerColor } from '@postomat/core';
import { LOGO_FAMILY, TEXT_FAMILY, TITLE_FAMILY, loadFonts } from './fonts.ts';
import { BANNER_PALETTE, BANNER_SIZES, type BannerFormat } from './palette.ts';
import { coverPhoto } from './photo.ts';

export interface BannerInput {
  /** Rendered in CAPITALS. */
  title: string;
  /** E.g. 'Freitag, den 11.12.26 | 18 – 21 Uhr' (clock icon line). */
  when?: string;
  /** E.g. 'Attraktor e.V. Eschelsweg 4, 22767 Hamburg' (pin icon line). */
  where?: string;
  color: BannerColor;
  format: BannerFormat;
  /** Any JPEG/PNG/WebP; null or missing → neutral fallback background. */
  photo?: Buffer | null;
}

/** Optional overrides, usually from env BANNER_LOGO_PATH / BANNER_TITLE_FONT_PATH. */
export interface BannerAssets {
  /** PNG or SVG logo, replaces the "attraktor" lettering. */
  logoPath?: string;
  /** TTF/OTF/WOFF file for the title, replaces Space Grotesk Bold. */
  titleFontPath?: string;
}

type SatoriElement = Parameters<typeof satori>[0];
type Style = Record<string, string | number>;
interface Node {
  type: string;
  key?: string;
  props: Record<string, unknown> & {
    style?: Style;
    children?: Child | Child[];
  };
}
type Child = Node | string | null;

const h = (type: string, props: Node['props'], ...children: Child[]): Node => ({
  type,
  props: children.length ? { ...props, children } : props,
});

/** Layout values in "units" (1 unit = 1% of the width in 4:5, the prototype's `cqw`). */
interface Layout {
  unit: number;
  curve: number;
  padX: number;
  padTop: number;
  padBottom: number;
  titleMax: number;
  titleMin: number;
  /** Preferred maximum number of title lines while shrinking the font. */
  titleLines: number;
  /** Hard limit at the minimum font size; longer titles are cut with an ellipsis. */
  titleLinesMax: number;
  logoReserve: number;
  line: number;
  minBand: number;
}

const LAYOUTS: Record<BannerFormat, Layout> = {
  '4x5': {
    unit: 10.8,
    curve: 7,
    padX: 5,
    padTop: 1.5,
    padBottom: 4.5,
    titleMax: 7.4,
    titleMin: 4.2,
    titleLines: 3,
    titleLinesMax: 4,
    logoReserve: 26,
    line: 3.6,
    minBand: 0.31,
  },
  '16x9': {
    unit: 7.2,
    curve: 6,
    padX: 5,
    padTop: 1,
    padBottom: 3.6,
    titleMax: 7,
    titleMin: 4.2,
    titleLines: 3,
    titleLinesMax: 3,
    logoReserve: 26,
    line: 3.6,
    minBand: 0.4,
  },
};

const TITLE_LINE_HEIGHT = 1.05;

/** Stroke width marker of the info icons; a unique value so tests can find the icons in the SVG. */
export const ICON_STROKE_WIDTH = 2.15;
const CLOCK_PATHS = ['M12 6.6V12l3.6 2.2'];
const PIN_PATHS = [
  'M12 21.6s-6.8-6.1-6.8-11.6a6.8 6.8 0 0 1 13.6 0c0 5.5-6.8 11.6-6.8 11.6z',
];

function icon(kind: 'clock' | 'pin', size: number, ink: string): Node {
  const stroke = {
    stroke: ink,
    'stroke-width': ICON_STROKE_WIDTH,
    fill: 'none',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const parts: Node[] =
    kind === 'clock'
      ? [
          h('circle', { cx: 12, cy: 12, r: 8.6, ...stroke }),
          ...CLOCK_PATHS.map((d) => h('path', { d, ...stroke })),
        ]
      : [
          ...PIN_PATHS.map((d) => h('path', { d, ...stroke })),
          h('circle', { cx: 12, cy: 10, r: 2.4, ...stroke }),
        ];
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      style: { flexShrink: 0 },
    },
    ...parts,
  );
}

/** Asymmetric soft wave like the prototype: low on the left, peak at ~55 %, a bit higher on the right. */
function bandCurve(width: number, curve: number, fill: string): Node {
  const c = curve;
  const d = [
    `M0 ${c * 0.92}`,
    `C${width * 0.18} ${c * 0.62} ${width * 0.36} ${c * 0.02} ${width * 0.56} 0`,
    `C${width * 0.74} ${-c * 0.02} ${width * 0.88} ${c * 0.42} ${width} ${c * 0.6}`,
    `L${width} ${c + 2}`,
    `L0 ${c + 2}Z`,
  ].join(' ');
  return h(
    'svg',
    {
      width,
      height: c + 2,
      viewBox: `0 0 ${width} ${c + 2}`,
      style: { display: 'flex', marginBottom: -2 },
    },
    h('path', { d, fill }),
  );
}

// --- colour helpers -------------------------------------------------------

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (rgb: number[]): string =>
  '#' +
  rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a: string, b: string, t: number): string => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
};

// --- background -----------------------------------------------------------

const fallbackCache = new Map<string, Promise<Buffer>>();

/** Neutral background without a photo: a deep, desaturated shade of the band colour with a dot grid and faint traces. */
function fallbackBackground(
  color: BannerColor,
  width: number,
  height: number,
): Promise<Buffer> {
  const key = `${color}:${width}x${height}`;
  let hit = fallbackCache.get(key);
  if (!hit) {
    const band = BANNER_PALETTE[color].band;
    const base = mix(mix(band, '#59606b', 0.45), '#0c111d', 0.62);
    const light = mix(base, band, 0.28);
    const dark = mix(base, '#05070c', 0.45);
    const s = Math.round(width / 27);
    const tw = Math.max(2, width / 400);
    const r = Math.max(3, width / 200);
    const traces = [
      [0.08, 0.1, 0.3, 0.1, 0.38, 0.18, 0.38, 0.34],
      [0.62, 0.06, 0.62, 0.2, 0.74, 0.32, 0.95, 0.32],
      [0.14, 0.42, 0.26, 0.42, 0.34, 0.5, 0.52, 0.5],
      [0.8, 0.12, 0.92, 0.12],
      [0.06, 0.24, 0.06, 0.58],
      [0.7, 0.46, 0.84, 0.46, 0.9, 0.52, 0.9, 0.64],
    ];
    const trace = traces
      .map((t) => {
        const pts: string[] = [];
        for (let i = 0; i < t.length; i += 2)
          pts.push(
            `${(t[i] * width).toFixed(1)},${(t[i + 1] * height).toFixed(1)}`,
          );
        const [sx, sy] = pts[0].split(',');
        const [ex, ey] = pts[pts.length - 1].split(',');
        return (
          `<polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="${tw}" stroke-linejoin="round"/>` +
          `<circle cx="${sx}" cy="${sy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="${tw}"/>` +
          `<circle cx="${ex}" cy="${ey}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="${tw}"/>`
        );
      })
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<radialGradient id="g" cx="28%" cy="18%" r="95%"><stop offset="0" stop-color="${light}"/><stop offset=".6" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>
<pattern id="p" width="${s}" height="${s}" patternUnits="userSpaceOnUse"><circle cx="${s / 2}" cy="${s / 2}" r="${Math.max(1.5, s / 22)}" fill="#fff" fill-opacity=".11"/></pattern>
</defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#p)"/>${trace}
</svg>`;
    hit = sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
    hit.catch(() => fallbackCache.delete(key));
    fallbackCache.set(key, hit);
  }
  return hit;
}

// --- logo -----------------------------------------------------------------

async function logoNode(
  logoPath: string | undefined,
  layout: Layout,
  ink: string,
): Promise<Node> {
  const u = layout.unit;
  const box: Style = {
    position: 'absolute',
    right: 4 * u,
    // below the curved edge, so the whole logo sits on the band colour
    top: Math.round(layout.curve * u),
    display: 'flex',
  };
  if (logoPath) {
    const data = await readFile(logoPath);
    const isSvg =
      /\.svg$/i.test(logoPath) ||
      /^\s*(<\?xml|<svg)/i.test(data.subarray(0, 200).toString('utf8'));
    const meta = await sharp(data).metadata();
    const maxW = 24 * u;
    const maxH = 10 * u;
    const ratio = (meta.width || 1) / (meta.height || 1);
    const height = Math.round(Math.min(maxH, maxW / ratio));
    const width = Math.round(height * ratio);
    const src = `data:${isSvg ? 'image/svg+xml' : `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`};base64,${data.toString('base64')}`;
    return h(
      'div',
      { style: box },
      h('img', { src, width, height, style: { width, height } }),
    );
  }
  return h(
    'div',
    {
      style: {
        ...box,
        flexDirection: 'column',
        alignItems: 'flex-end',
        // band ink: readable on light (mint, hellblau) and dark (blau, rot) bands
        color: ink,
      },
    },
    h(
      'div',
      {
        style: { fontFamily: LOGO_FAMILY, fontSize: 6.4 * u, lineHeight: 0.95 },
      },
      'attraktor',
    ),
    h(
      'div',
      {
        style: {
          fontFamily: TEXT_FAMILY,
          fontSize: 2.6 * u,
          fontWeight: 600,
          marginTop: 0.2 * u,
        },
      },
      'e.V. Hamburg',
    ),
  );
}

// --- title fitting ----------------------------------------------------------

function titleNode(
  text: string,
  fontSize: number,
  ink: string,
  maxLines: number,
): Node {
  return h(
    'div',
    {
      style: {
        display: 'block',
        fontFamily: TITLE_FAMILY,
        fontWeight: 700,
        fontSize,
        lineHeight: TITLE_LINE_HEIGHT,
        color: ink,
        wordBreak: 'break-word',
        lineClamp: maxLines,
      },
    },
    text,
  );
}

/** Measures how many lines `text` needs at `fontSize` in a box `width` wide (via Satori's own layout). */
async function countLines(
  text: string,
  fontSize: number,
  width: number,
  fonts: Font[],
): Promise<number> {
  let height = 0;
  const tree = h(
    'div',
    { style: { display: 'flex', width, flexDirection: 'column' } },
    { ...titleNode(text, fontSize, '#000', 99), key: 'title' },
  );
  await satori(tree as unknown as SatoriElement, {
    width,
    fonts,
    embedFont: false,
    onNodeDetected: (node) => {
      if (node.key === 'title') height = node.height;
    },
  });
  return Math.max(1, Math.round(height / (fontSize * TITLE_LINE_HEIGHT)));
}

/**
 * Largest font size (in px) between max and min at which the title fits into
 * `titleLines` lines. If even the minimum size needs more, the minimum size is
 * used with up to `titleLinesMax` lines (the rest is clamped with an ellipsis).
 */
async function fitTitle(
  text: string,
  width: number,
  layout: Layout,
  fonts: Font[],
): Promise<{ size: number; lines: number }> {
  const u = layout.unit;
  const step = 0.4 * u;
  for (
    let size = layout.titleMax * u;
    size > layout.titleMin * u;
    size -= step
  ) {
    if ((await countLines(text, size, width, fonts)) <= layout.titleLines) {
      return { size: Math.round(size), lines: layout.titleLines };
    }
  }
  return { size: Math.round(layout.titleMin * u), lines: layout.titleLinesMax };
}

// --- public API -------------------------------------------------------------

/** Renders the banner as an SVG string. With `embedFont: false` text stays as `<text>` (useful for tests). */
export async function renderBannerSvg(
  input: BannerInput,
  assets: BannerAssets = {},
  opts: { embedFont?: boolean } = {},
): Promise<string> {
  const { width, height } = BANNER_SIZES[input.format];
  const layout = LAYOUTS[input.format];
  const palette = BANNER_PALETTE[input.color];
  const u = layout.unit;

  const [fonts, background, logo] = await Promise.all([
    loadFonts(assets.titleFontPath),
    input.photo
      ? coverPhoto(input.photo, width, height)
      : fallbackBackground(input.color, width, height),
    logoNode(assets.logoPath, layout, palette.ink),
  ]);

  const title = input.title.trim().toUpperCase();
  const titleWidth = width - 2 * layout.padX * u - layout.logoReserve * u;
  const titleFit = title
    ? await fitTitle(title, titleWidth, layout, fonts)
    : { size: 0, lines: 0 };

  const lineSize = layout.line * u;
  const infoLine = (kind: 'clock' | 'pin', text: string): Node =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5 * u,
          marginTop: 1.2 * u,
        },
      },
      icon(kind, Math.round(lineSize * 1.15), palette.ink),
      h(
        'div',
        {
          style: {
            display: 'block',
            fontFamily: TEXT_FAMILY,
            fontWeight: 600,
            fontSize: lineSize,
            lineHeight: 1.15,
            color: palette.ink,
            lineClamp: 2,
            flexShrink: 1,
          },
        },
        text,
      ),
    );

  const when = input.when?.trim();
  const where = input.where?.trim();
  const curve = Math.round(layout.curve * u);

  const band = h(
    'div',
    {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
      },
    },
    bandCurve(width, curve, palette.band),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: palette.band,
          minHeight: Math.round(layout.minBand * height - curve),
          padding: `${layout.padTop * u}px ${layout.padX * u}px ${layout.padBottom * u}px`,
        },
      },
      title
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                width: titleWidth,
                marginBottom: 0.6 * u,
              },
            },
            titleNode(title, titleFit.size, palette.ink, titleFit.lines),
          )
        : null,
      when ? infoLine('clock', when) : null,
      where ? infoLine('pin', where) : null,
    ),
    logo,
  );

  const tree = h(
    'div',
    {
      style: {
        display: 'flex',
        position: 'relative',
        width,
        height,
        backgroundColor: '#222222',
      },
    },
    h('img', {
      src: `data:image/jpeg;base64,${background.toString('base64')}`,
      width,
      height,
      style: { position: 'absolute', left: 0, top: 0, width, height },
    }),
    band,
  );

  return satori(tree as unknown as SatoriElement, {
    width,
    height,
    fonts,
    embedFont: opts.embedFont ?? true,
  });
}

/** Renders the banner to a PNG of exactly the canvas size of `input.format`. */
export async function renderBanner(
  input: BannerInput,
  assets: BannerAssets = {},
): Promise<{ png: Buffer; width: number; height: number }> {
  const { width } = BANNER_SIZES[input.format];
  const svg = await renderBannerSvg(input, assets);
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
  }).render();
  const png = Buffer.from(rendered.asPng());
  return { png, width: rendered.width, height: rendered.height };
}
