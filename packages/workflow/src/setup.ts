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
import {
  AiError,
  createAiFromEnv,
  unavailableAi,
  waitForAi,
  type AiService,
} from '@postomat/ai';
import { LocalFileStore, WebDavClient, type MediaStore } from '@postomat/media';
import { WordPressClient } from '@postomat/channel-wordpress';
import { MediaWikiClient } from '@postomat/channel-mediawiki';
import type { WorkflowDeps } from './deps.ts';
import { PgBossQueue } from './queue.ts';

export function mediaStoreFromEnv(env: Env, log: Logger): MediaStore {
  if (env.NEXTCLOUD_USERNAME && env.NEXTCLOUD_PASSWORD) {
    return new WebDavClient({
      baseUrl: env.NEXTCLOUD_WEBDAV_URL,
      username: env.NEXTCLOUD_USERNAME,
      password: env.NEXTCLOUD_PASSWORD,
    });
  }
  log.warn(
    'Nextcloud credentials missing – storing photos in MEDIA_LOCAL_DIR (dev only)',
    { dir: env.MEDIA_LOCAL_DIR },
  );
  return new LocalFileStore(fromRoot(env.MEDIA_LOCAL_DIR));
}

/**
 * The AI service from env. Bot and worker cannot run without it (throws an
 * `AiError('config')`); the web starts anyway and reports AI errors per call.
 */
export function aiFromEnv(env: Env, log: Logger, required: boolean): AiService {
  try {
    return createAiFromEnv(env, log.child('ai'));
  } catch (e) {
    if (required || !(e instanceof AiError)) throw e;
    log.warn(e.message);
    return unavailableAi(e);
  }
}

/**
 * Startup check for bot and worker: AI config present and the endpoint
 * answers a structured probe within AI_STARTUP_TIMEOUT_MS. Throws otherwise,
 * so the process exits and Docker/Coolify shows it as failing.
 */
export async function startupAi(
  env: Env,
  log: Logger,
  create: (env: Env, log: Logger) => AiService = (e, l) =>
    createAiFromEnv(e, l.child('ai')),
): Promise<AiService> {
  const ai = create(env, log);
  await waitForAi(ai, { timeoutMs: env.AI_STARTUP_TIMEOUT_MS, logger: log });
  log.info('AI endpoint ready', { model: env.AI_MODEL });
  return ai;
}

/**
 * Builds the production dependencies from environment variables. Only the
 * worker runs pg-boss maintenance and cron; bot and web just send and work jobs.
 */
export async function createDepsFromEnv(
  name: string,
  opts: {
    startQueue?: boolean;
    queueMaintenance?: boolean;
    /** Default: required for everything but the web. */
    requireAi?: boolean;
  } = {},
): Promise<{ deps: WorkflowDeps; db: DbHandle; queue: PgBossQueue }> {
  const env = loadEnv();
  const log = createLogger(name, env.LOG_LEVEL);
  // Before anything else: bot and worker refuse to start without a working AI.
  const requireAi = opts.requireAi ?? name !== 'web';
  const ai = requireAi ? await startupAi(env, log) : aiFromEnv(env, log, false);
  const config = loadConfig(env.POSTOMAT_CONFIG);
  // One source of truth for "has credentials": the same check picks the channel modes.
  const creds = credentialsFromEnv(env);
  for (const w of channelModeWarnings(config, creds))
    log.warn(`channel mode: ${w}`);
  const db = createDb(env.DATABASE_URL);
  const queue = new PgBossQueue(env.DATABASE_URL, {
    retryLimit: env.JOB_RETRY_LIMIT,
    logger: log.child('jobs'),
    maintenance: opts.queueMaintenance ?? name === 'worker',
  });
  if (opts.startQueue !== false) await queue.start();
  const deps: WorkflowDeps = {
    db: db.db,
    env,
    config,
    queue,
    log,
    now: () => new Date(),
    ai,
    media: mediaStoreFromEnv(env, log),
    wordpress: creds.wordpress
      ? new WordPressClient({
          baseUrl: env.WORDPRESS_URL,
          username: env.WORDPRESS_USERNAME!,
          appPassword: env.WORDPRESS_APP_PASSWORD!,
        })
      : null,
    mediawiki: creds.wiki
      ? new MediaWikiClient({
          apiUrl: env.MEDIAWIKI_API_URL,
          username: env.MEDIAWIKI_BOT_USERNAME!,
          password: env.MEDIAWIKI_BOT_PASSWORD!,
        })
      : null,
    fetch,
    bannerAssets: {
      logoPath: env.BANNER_LOGO_PATH,
      titleFontPath: env.BANNER_TITLE_FONT_PATH,
    },
  };
  return { deps, db, queue };
}
