import type { BannerColor } from '@postomat/core';

export type BannerFormat = '4x5' | '16x9';

/** Canvas sizes in pixels. 4:5 is the Instagram feed format, 16:9 is used for web and Meetup. */
export const BANNER_SIZES: Record<
  BannerFormat,
  { width: number; height: number }
> = {
  '4x5': { width: 1080, height: 1350 },
  '16x9': { width: 1200, height: 675 },
};

/** Band colour, text colour on the band and a German label for the UI. */
export const BANNER_PALETTE: Record<
  BannerColor,
  { band: string; ink: string; label: string }
> = {
  mint: { band: '#8ff0cf', ink: '#14213d', label: 'Mint' },
  blau: { band: '#3d7fc4', ink: '#ffffff', label: 'Blau' },
  rot: { band: '#b8322b', ink: '#ffffff', label: 'Rot' },
  hellblau: { band: '#a9cdea', ink: '#17325c', label: 'Hellblau' },
};
