import type {
  Env,
  FetchLike,
  Logger,
  MatrixPort,
  PostomatConfig,
} from '@postomat/core';
import type { Database } from '@postomat/db';
import type { AiService } from '@postomat/ai';
import type { MediaStore } from '@postomat/media';
import type { WordPressClient } from '@postomat/channel-wordpress';
import type { MediaWikiClient } from '@postomat/channel-mediawiki';
import type { BannerAssets } from '@postomat/render';
import type { JobQueue } from './queue.ts';

/** Everything the application services need. Apps build it from env; tests inject fakes. */
export interface WorkflowDeps {
  db: Database;
  env: Env;
  config: PostomatConfig;
  queue: JobQueue;
  log: Logger;
  now: () => Date;
  /** Required: the only way Postomat interprets chat text and writes texts. */
  ai: AiService;
  /** Nextcloud WebDAV, or a local folder fallback. */
  media: MediaStore;
  /** Null when the channel has no credentials (copy mode). */
  wordpress: WordPressClient | null;
  mediawiki: MediaWikiClient | null;
  fetch: FetchLike;
  bannerAssets: BannerAssets;
  /** Only available inside the bot process. */
  matrix?: MatrixPort;
}
