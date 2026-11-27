import { z } from 'zod';
import {
  CHANNELS,
  type ChannelId,
  type ChannelMode,
  type PostType,
} from './types.ts';
import type { Env } from './env.ts';
import { fromRoot, nodeFs } from './paths.ts';

const mode = z.enum(['auto', 'copy', 'off']);
const channelMap = z.partialRecord(z.enum(CHANNELS), mode);

export const configSchema = z.object({
  channels: z.object({ event: channelMap, projekt: channelMap }),
  location: z.object({
    /** Full address used in Meetup and the wiki. */
    full: z.string(),
    /** Short address for Instagram/Facebook/website. */
    short: z.string(),
    /** Address line on the banner. */
    banner: z.string(),
    transit: z.string(),
  }),
  contact: z.string(),
  meetup: z.object({ categories: z.array(z.string()).min(1) }),
  hashtags: z.object({
    base: z.array(z.string()),
    event: z.array(z.string()),
    workshop: z.array(z.string()),
    projekt: z.array(z.string()),
  }),
  wordpress: z.object({
    eventCategories: z.array(z.string()),
    workshopCategories: z.array(z.string()),
  }),
  banner: z.object({
    defaultColor: z.enum(['mint', 'blau', 'rot', 'hellblau']),
  }),
});

export type PostomatConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: PostomatConfig = {
  channels: {
    event: {
      wordpress: 'auto',
      wiki: 'auto',
      meetup: 'copy',
      instagram: 'copy',
      facebook: 'copy',
    },
    projekt: { instagram: 'copy', facebook: 'copy' },
  },
  location: {
    full: 'Attraktor e.V., Eschelsweg 4, 1. Stock, 22767 Hamburg',
    short: 'Attraktor e.V., Eschelsweg 4, 22767 Hamburg',
    banner: 'Attraktor e.V. Eschelsweg 4, 22767 Hamburg',
    transit: 'Gut erreichbar mit Bus und Bahn in Hamburg-Altona.',
  },
  contact:
    'Fragen? Komm donnerstags zum Basteldonnerstag vorbei oder schreib uns über Meetup.',
  meetup: {
    categories: [
      'Bildung & Workshops',
      'Technik',
      'Wissenschaft & Bildung',
      'Hobbys & Leidenschaften',
    ],
  },
  hashtags: {
    base: ['#makerspace', '#hamburg', '#altona', '#attraktor'],
    event: [],
    workshop: ['#workshop'],
    projekt: ['#diy', '#maker'],
  },
  wordpress: {
    eventCategories: ['termine'],
    workshopCategories: ['workshops'],
  },
  banner: { defaultColor: 'mint' },
};

export function loadConfig(path?: string): PostomatConfig {
  if (!path) return DEFAULT_CONFIG;
  const raw = JSON.parse(
    nodeFs().readFileSync(fromRoot(path), 'utf8'),
  ) as unknown;
  return configSchema.parse(raw);
}

/** Which channel credentials are present. */
export interface ChannelCredentials {
  wordpress: boolean;
  wiki: boolean;
}

export function credentialsFromEnv(env: Env): ChannelCredentials {
  return {
    wordpress: !!(env.WORDPRESS_USERNAME && env.WORDPRESS_APP_PASSWORD),
    wiki: !!(env.MEDIAWIKI_BOT_USERNAME && env.MEDIAWIKI_BOT_PASSWORD),
  };
}

const AUTO_CAPABLE: ReadonlySet<ChannelId> = new Set(['wordpress', 'wiki']);

export interface ResolvedChannel {
  channel: ChannelId;
  mode: ChannelMode;
}

/**
 * Effective channel modes for a post type. Channels that are not configured
 * are `off`. An `auto` channel without credentials (or without an API at all)
 * falls back to `copy`.
 */
export function resolveChannelModes(
  config: PostomatConfig,
  type: PostType,
  creds: ChannelCredentials,
): ResolvedChannel[] {
  const map = config.channels[type];
  return CHANNELS.map((channel) => {
    let m: ChannelMode = map[channel] ?? 'off';
    if (m === 'auto') {
      const capable =
        AUTO_CAPABLE.has(channel) && creds[channel as keyof ChannelCredentials];
      if (!capable) m = 'copy';
    }
    return { channel, mode: m };
  });
}

/** Startup warnings for auto channels that fall back to copy mode. */
export function channelModeWarnings(
  config: PostomatConfig,
  creds: ChannelCredentials,
): string[] {
  const warnings: string[] = [];
  for (const type of ['event', 'projekt'] as const) {
    for (const [channel, m] of Object.entries(config.channels[type])) {
      if (m !== 'auto') continue;
      if (!AUTO_CAPABLE.has(channel as ChannelId)) {
        warnings.push(`${type}/${channel}: no API in Stage 1, using copy mode`);
      } else if (!creds[channel as keyof ChannelCredentials]) {
        warnings.push(
          `${type}/${channel}: credentials missing, using copy mode`,
        );
      }
    }
  }
  return warnings;
}
