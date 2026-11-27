import sharp from 'sharp';
import {
  DEFAULT_CONFIG,
  loadEnv,
  type Logger,
  type MatrixIncoming,
} from '@postomat/core';
import { createDb, runMigrations, sql, type DbHandle } from '@postomat/db';
import { WebDavClient } from '@postomat/media';
import { WordPressClient } from '@postomat/channel-wordpress';
import { MediaWikiClient } from '@postomat/channel-mediawiki';
import {
  createScriptedAi,
  FakeMatrix,
  FakeMediaWiki,
  FakeMeetupFeed,
  FakeWebDav,
  FakeWordPress,
  type ScriptedAi,
} from '@postomat/testing';
import { E2E_RULES, e2eCandidate } from './ai-script.ts';
import {
  BotService,
  InMemoryQueue,
  registerWorkerJobs,
  type WorkflowDeps,
} from '@postomat/workflow';

const BASE_TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ??
  'postgres://postomat:postomat@localhost:55432/postomat_test';

/**
 * The e2e suite truncates every table, so it gets its own database
 * (`<test db>_e2e`, or DATABASE_URL_E2E). Other DB tests (packages/db) can then
 * run in parallel on DATABASE_URL_TEST without seeing rows disappear.
 */
export const TEST_DB_URL =
  process.env['DATABASE_URL_E2E'] ?? e2eUrl(BASE_TEST_DB_URL);

function e2eUrl(base: string): string {
  const u = new URL(base);
  u.pathname = `${u.pathname.replace(/\/$/, '')}_e2e`;
  return u.toString();
}

let ensured: Promise<void> | undefined;
/** Creates the e2e database once (needs CREATEDB, as in docker compose and CI). */
function ensureE2eDatabase(): Promise<void> {
  ensured ??= (async () => {
    const name = decodeURIComponent(new URL(TEST_DB_URL).pathname.slice(1));
    const admin = createDb(BASE_TEST_DB_URL, 1);
    try {
      const rows = await admin.db.execute(
        sql`select 1 from pg_database where datname = ${name}`,
      );
      if (!rows.rows.length)
        await admin.db.execute(
          sql.raw(`create database "${name.replace(/"/g, '""')}"`),
        );
    } finally {
      await admin.close();
    }
  })();
  return ensured;
}

export const ROOMS = {
  members: '!mitglieder:localhost',
  medienteam: '!medienteam:localhost',
  dmLena: '!dm-lena:localhost',
  dmGast: '!dm-gast:localhost',
};

const BOT = '@postomat:localhost';

export interface LoggedError {
  name: string;
  msg: string;
  data?: Record<string, unknown>;
}

/**
 * Silent logger that keeps error-level entries. The bot catches and logs
 * handler errors, so a crash would otherwise look like "nothing happened".
 */
export function collectingLogger(errors: LoggedError[], name = 'e2e'): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (msg, data) => errors.push({ name, msg, data }),
    child: (n) => collectingLogger(errors, `${name}:${n}`),
  };
}

/** Wires the real bot and worker logic to Postgres, an in-memory queue and HTTP fakes. */
export class Harness {
  db!: DbHandle;
  deps!: WorkflowDeps;
  bot!: BotService;
  queue = new InMemoryQueue(2);
  matrix = new FakeMatrix(BOT);
  wordpress = new FakeWordPress();
  wiki = new FakeMediaWiki();
  webdav = new FakeWebDav();
  meetup = new FakeMeetupFeed();
  clock = new Date('2026-11-23T13:02:00Z');
  /** The scripted stub model behind the real AiService. */
  ai: ScriptedAi = createScriptedAi({
    rules: E2E_RULES,
    candidate: e2eCandidate,
  });
  /** Every text message sent to the bot, in order (DM and thread). */
  sentTexts: Array<{ user: string; text: string; thread: boolean }> = [];
  /** Error-level log entries; see assertNoErrors. */
  errors: LoggedError[] = [];
  /** Error logs a test provokes on purpose (checked in afterEach). */
  allowedErrors: RegExp[] = [];
  private counter = 0;

  async start(): Promise<this> {
    await Promise.all([
      this.wordpress.start(),
      this.wiki.start(),
      this.webdav.start(),
      this.meetup.start(),
    ]);
    await ensureE2eDatabase();
    this.db = createDb(TEST_DB_URL, 4);
    await runMigrations(this.db.db);
    await this.db.db.execute(
      sql`truncate posts, channel_posts, photos, history, approvals, conversations, settings, processed_events, meetup_questions restart identity cascade`,
    );
    this.matrix.addRoom(
      ROOMS.members,
      [BOT, '@lena:localhost', '@kai:localhost', '@mira:localhost'],
      { alias: '#mitglieder:localhost', name: 'Attraktor Mitglieder' },
    );
    this.matrix.addRoom(
      ROOMS.medienteam,
      [BOT, '@kai:localhost', '@mira:localhost'],
      { alias: '#medienteam:localhost', name: 'Medienteam' },
    );
    this.matrix.addRoom(ROOMS.dmLena, [BOT, '@lena:localhost']);
    this.matrix.addRoom(ROOMS.dmGast, [BOT, '@gast:localhost']);
    this.matrix.displayNames.set('@lena:localhost', 'Lena');

    const env = loadEnv({
      PUBLIC_WEB_URL: 'http://postomat.test',
      MATRIX_MEMBER_ROOMS: '#mitglieder:localhost',
      MATRIX_MEDIENTEAM_ROOM: '#medienteam:localhost',
      WORDPRESS_URL: this.wordpress.url,
      WORDPRESS_USERNAME: this.wordpress.username,
      WORDPRESS_APP_PASSWORD: this.wordpress.appPassword,
      MEDIAWIKI_API_URL: this.wiki.apiUrl,
      MEDIAWIKI_BOT_USERNAME: this.wiki.username,
      MEDIAWIKI_BOT_PASSWORD: this.wiki.password,
      MEDIAWIKI_PAGE_BASE_URL: 'http://wiki.test/index.php/',
      NEXTCLOUD_WEBDAV_URL: this.webdav.url,
      NEXTCLOUD_USERNAME: this.webdav.username,
      NEXTCLOUD_PASSWORD: this.webdav.password,
      MEETUP_ICAL_URL: this.meetup.url,
    });
    this.deps = {
      db: this.db.db,
      env,
      config: DEFAULT_CONFIG,
      queue: this.queue,
      log: collectingLogger(this.errors),
      now: () => this.clock,
      ai: this.ai,
      media: new WebDavClient({
        baseUrl: env.NEXTCLOUD_WEBDAV_URL,
        username: env.NEXTCLOUD_USERNAME,
        password: env.NEXTCLOUD_PASSWORD,
      }),
      wordpress: new WordPressClient({
        baseUrl: env.WORDPRESS_URL,
        username: env.WORDPRESS_USERNAME!,
        appPassword: env.WORDPRESS_APP_PASSWORD!,
      }),
      mediawiki: new MediaWikiClient({
        apiUrl: env.MEDIAWIKI_API_URL,
        username: env.MEDIAWIKI_BOT_USERNAME!,
        password: env.MEDIAWIKI_BOT_PASSWORD!,
      }),
      fetch,
      bannerAssets: {},
      matrix: this.matrix,
    };
    // Same object: tests may swap deps (e.g. the AI) later.
    this.bot = new BotService(
      this.deps as WorkflowDeps & { matrix: FakeMatrix },
    );
    await this.bot.registerJobs(this.queue);
    await registerWorkerJobs(this.deps, this.queue);
    return this;
  }

  /**
   * Fails when anything logged an error, except entries matching `allowed`
   * (for tests that provoke failures on purpose).
   */
  assertNoErrors(allowed: RegExp[] = []): void {
    const unexpected = this.errors.filter(
      (e) =>
        !allowed.some((re) =>
          re.test(`${e.msg} ${JSON.stringify(e.data ?? {})}`),
        ),
    );
    if (unexpected.length)
      throw new Error(
        `Unexpected error logs:\n${unexpected.map((e) => `${e.name}: ${e.msg} ${JSON.stringify(e.data ?? {})}`).join('\n')}`,
      );
  }

  async stop(): Promise<void> {
    await this.db?.close();
    await Promise.all([
      this.wordpress.stop(),
      this.wiki.stop(),
      this.webdav.stop(),
      this.meetup.stop(),
    ]);
  }

  private id(): string {
    return `$in${++this.counter}`;
  }

  /** Sends a DM from a user and runs resulting jobs. Returns the bot's replies. */
  async dm(
    user: string,
    text: string,
    roomId = ROOMS.dmLena,
  ): Promise<string[]> {
    const before = this.matrix.sent.length;
    this.sentTexts.push({ user, text, thread: false });
    await this.bot.handle({
      kind: 'message',
      roomId,
      eventId: this.id(),
      sender: user,
      msgtype: 'm.text',
      body: text,
      content: { msgtype: 'm.text', body: text },
    });
    await this.queue.drain();
    return this.matrix.sent
      .slice(before)
      .filter((m) => m.roomId === roomId)
      .map((m) => m.body);
  }

  async photo(
    user: string,
    data: Buffer,
    roomId = ROOMS.dmLena,
  ): Promise<string[]> {
    const before = this.matrix.sent.length;
    const content = this.matrix.uploadImage(data);
    await this.bot.handle({
      kind: 'message',
      roomId,
      eventId: this.id(),
      sender: user,
      msgtype: 'm.image',
      body: 'photo.jpg',
      content,
    });
    await this.queue.drain();
    return this.matrix.sent
      .slice(before)
      .filter((m) => m.roomId === roomId)
      .map((m) => m.body);
  }

  async react(user: string, eventId: string, key: string): Promise<void> {
    const evt: MatrixIncoming = {
      kind: 'reaction',
      roomId: ROOMS.medienteam,
      eventId: this.id(),
      sender: user,
      relatesTo: eventId,
      key,
    };
    await this.bot.handle(evt);
    await this.queue.drain();
  }

  async threadReply(user: string, root: string, text: string): Promise<void> {
    this.sentTexts.push({ user, text, thread: true });
    await this.bot.handle({
      kind: 'message',
      roomId: ROOMS.medienteam,
      eventId: this.id(),
      sender: user,
      msgtype: 'm.text',
      body: text,
      threadRoot: root,
      content: {},
    });
    await this.queue.drain();
  }

  /** The current card text (after in-place edits). */
  card(eventId: string): string {
    return this.matrix.latest(eventId)?.body ?? '';
  }

  async runMeetupPoll(): Promise<void> {
    await this.queue.send('meetup.poll', {});
    await this.queue.drain();
  }
}

export async function testPhoto(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}
