import {
  channelModeWarnings,
  createLogger,
  credentialsFromEnv,
  fromRoot,
  loadConfig,
  loadEnv,
  type Env,
  type Logger,
} from '@postomat/core';
import { createDb, type DbHandle } from '@postomat/db';
import { createAiFromEnv } from '@postomat/ai';
import { LocalFileStore, WebDavClient, type MediaStore } from '@postomat/media';
import { WordPressClient } from '@postomat/channel-wordpress';
import { MediaWikiClient } from '@postomat/channel-mediawiki';
import type { WorkflowDeps } from './deps.ts';
import { PgBossQueue } from './queue.ts';

export function mediaStoreFromEnv(env: Env, log: Logger): MediaStore {
  if (env.NEXTCLOUD_USERNAME && env.NEXTCLOUD_PASSWORD) {
    return new WebDavClient({ baseUrl: env.NEXTCLOUD_WEBDAV_URL, username: env.NEXTCLOUD_USERNAME, password: env.NEXTCLOUD_PASSWORD });
  }
  log.warn('Nextcloud credentials missing – storing photos in MEDIA_LOCAL_DIR (dev only)', { dir: env.MEDIA_LOCAL_DIR });
  return new LocalFileStore(fromRoot(env.MEDIA_LOCAL_DIR));
}

/** Builds the production dependencies from environment variables. */
export async function createDepsFromEnv(name: string, opts: { startQueue?: boolean } = {}): Promise<{ deps: WorkflowDeps; db: DbHandle; queue: PgBossQueue }> {
  const env = loadEnv();
  const log = createLogger(name, env.LOG_LEVEL);
  const config = loadConfig(env.POSTOMAT_CONFIG);
  for (const w of channelModeWarnings(config, credentialsFromEnv(env))) log.warn(`channel mode: ${w}`);
  const db = createDb(env.DATABASE_URL);
  const queue = new PgBossQueue(env.DATABASE_URL, { retryLimit: env.JOB_RETRY_LIMIT, logger: log.child('jobs') });
  if (opts.startQueue !== false) await queue.start();
  const deps: WorkflowDeps = {
    db: db.db,
    env,
    config,
    queue,
    log,
    now: () => new Date(),
    ai: createAiFromEnv(env, log.child('ai')),
    media: mediaStoreFromEnv(env, log),
    wordpress:
      env.WORDPRESS_USERNAME && env.WORDPRESS_APP_PASSWORD
        ? new WordPressClient({ baseUrl: env.WORDPRESS_URL, username: env.WORDPRESS_USERNAME, appPassword: env.WORDPRESS_APP_PASSWORD })
        : null,
    mediawiki:
      env.MEDIAWIKI_BOT_USERNAME && env.MEDIAWIKI_BOT_PASSWORD
        ? new MediaWikiClient({ apiUrl: env.MEDIAWIKI_API_URL, username: env.MEDIAWIKI_BOT_USERNAME, password: env.MEDIAWIKI_BOT_PASSWORD })
        : null,
    fetch,
    bannerAssets: { logoPath: env.BANNER_LOGO_PATH, titleFontPath: env.BANNER_TITLE_FONT_PATH },
  };
  return { deps, db, queue };
}
