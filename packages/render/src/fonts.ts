import { readFile } from 'node:fs/promises';
import type { Font } from 'satori';

/** Family names used inside the Satori tree. */
export const TITLE_FAMILY = 'Banner Title';
export const TEXT_FAMILY = 'Space Grotesk';
export const LOGO_FAMILY = 'Kaushan Script';

/**
 * Bundled OFL fonts live in `packages/render/assets/fonts`. The URL is
 * resolved relative to this module, which sits in `src/` when running from
 * source and in `dist/` after the build, so `../assets` works from both.
 */
const fontUrl = (file: string): URL => new URL(`../assets/fonts/${file}`, import.meta.url);

const BUNDLED = {
  title: ['space-grotesk-latin-700-normal.woff', 'space-grotesk-latin-ext-700-normal.woff'],
  text: ['space-grotesk-latin-600-normal.woff', 'space-grotesk-latin-ext-600-normal.woff'],
  logo: ['kaushan-script-latin-400-normal.woff'],
} as const;

const cache = new Map<string, Promise<Buffer>>();

function load(source: string | URL): Promise<Buffer> {
  const key = source.toString();
  let hit = cache.get(key);
  if (!hit) {
    hit = readFile(source);
    // Do not keep failed reads around, a later call may succeed (e.g. after a fixed env var).
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

/** Loads all fonts for a banner. `titleFontPath` (TTF/OTF/WOFF) replaces the bundled title font. */
export async function loadFonts(titleFontPath?: string): Promise<Font[]> {
  const titleFiles: (string | URL)[] = titleFontPath ? [titleFontPath] : BUNDLED.title.map(fontUrl);
  const [title, text, logo] = await Promise.all([
    Promise.all(titleFiles.map(load)),
    Promise.all(BUNDLED.text.map((f) => load(fontUrl(f)))),
    Promise.all(BUNDLED.logo.map((f) => load(fontUrl(f)))),
  ]);
  return [
    ...title.map((data): Font => ({ name: TITLE_FAMILY, data, weight: 700, style: 'normal' })),
    ...text.map((data): Font => ({ name: TEXT_FAMILY, data, weight: 600, style: 'normal' })),
    ...logo.map((data): Font => ({ name: LOGO_FAMILY, data, weight: 400, style: 'normal' })),
  ];
}
