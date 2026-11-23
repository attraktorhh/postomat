import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  BannerColor,
  ChannelId,
  ChannelMode,
  ChannelPostStatus,
  Consent,
  DialogState,
  PostFacts,
  PostStatus,
  PostType,
} from '@postomat/core';

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

/** A Beitrag. `id` is short on purpose: it shows up in URLs like /b/42. */
export const posts = pgTable(
  'posts',
  {
    id: serial('id').primaryKey(),
    type: text('type').$type<PostType>().notNull(),
    status: text('status').$type<PostStatus>().notNull().default('sammeln'),
    version: integer('version').notNull().default(1),
    facts: jsonb('facts').$type<PostFacts>().notNull().default({}),
    authorMatrixId: text('author_matrix_id').notNull(),
    authorUsername: text('author_username').notNull(),
    authorDisplayName: text('author_display_name'),
    note: text('note'),
    bannerColor: text('banner_color')
      .$type<BannerColor>()
      .notNull()
      .default('mint'),
    meetupCategory: text('meetup_category'),
    aiUsed: boolean('ai_used').notNull().default(false),
    cardRoomId: text('card_room_id'),
    cardEventId: text('card_event_id'),
    /** Version whose banner was last posted in the card thread. */
    cardBannerVersion: integer('card_banner_version'),
    /** Open "Rückfrage ans Mitglied": the next DM reply is attached to history. */
    pendingQuestion: text('pending_question'),
    approvedBy: text('approved_by'),
    approvedAt: ts('approved_at'),
    submittedAt: ts('submitted_at'),
    /** Set once the "auto channels done" notifications went out. */
    autoNotifiedAt: ts('auto_notified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('posts_status_idx').on(t.status),
    index('posts_author_idx').on(t.authorUsername),
    // At most one draft per member.
    uniqueIndex('posts_one_draft_per_author')
      .on(t.authorMatrixId)
      .where(sql`${t.status} = 'sammeln'`),
  ],
);

/** One row per post and channel (Kanal-Post). */
export const channelPosts = pgTable(
  'channel_posts',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<ChannelId>().notNull(),
    mode: text('mode').$type<ChannelMode>().notNull(),
    status: text('status')
      .$type<ChannelPostStatus>()
      .notNull()
      .default('entwurf'),
    textDe: text('text_de').notNull().default(''),
    textEn: text('text_en').notNull().default(''),
    /** Extra copy fields (e.g. title, hashtags). */
    fields: jsonb('fields')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** Remote IDs (WordPress post/media id, wiki page title, Meetup event id). */
    remoteId: text('remote_id'),
    remoteMediaId: text('remote_media_id'),
    url: text('url'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    publishedAt: ts('published_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channel_posts_post_channel').on(t.postId, t.channel)],
);

/** Photos and rendered banners stored in Nextcloud. */
export const photos = pgTable(
  'photos',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id').references(() => posts.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<'photo' | 'banner'>().notNull().default('photo'),
    /** Banner format: '4x5' | '16x9'. */
    format: text('format'),
    bannerColor: text('banner_color').$type<BannerColor>(),
    /** Post version the banner was rendered for. */
    version: integer('version'),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256').notNull(),
    uploaderMatrixId: text('uploader_matrix_id'),
    consent: text('consent')
      .$type<Consent>()
      .notNull()
      .default('einwilligung_fehlt'),
    tags: text('tags').array().notNull().default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('photos_post_idx').on(t.postId)],
);

/** Verlauf: everything that happened to a post. */
export const history = pgTable(
  'history',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull(),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('history_post_idx').on(t.postId)],
);

/** Freigaben and change requests. */
export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  actor: text('actor').notNull(),
  result: text('result')
    .$type<'approved' | 'change_requested' | 'refused'>()
    .notNull(),
  comment: text('comment'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** DM conversation state per member. */
export const conversations = pgTable('conversations', {
  matrixUserId: text('matrix_user_id').primaryKey(),
  dmRoomId: text('dm_room_id'),
  postId: integer('post_id').references(() => posts.id, {
    onDelete: 'set null',
  }),
  state: jsonb('state').$type<DialogState>(),
  /** Post whose Rückfrage is open. */
  questionPostId: integer('question_post_id').references(() => posts.id, {
    onDelete: 'set null',
  }),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Settings edited in the web (room picker). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: text('updated_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Matrix events already handled (sync may deliver events twice). */
export const processedEvents = pgTable('processed_events', {
  eventId: text('event_id').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Open "Ist eins davon das Meetup-Event?" questions in a card thread. */
export const meetupQuestions = pgTable('meetup_questions', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  candidates: jsonb('candidates')
    .$type<Array<{ uid: string; url: string; title: string; start: string }>>()
    .notNull(),
  eventId: text('event_id'),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Server-side web sessions. */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type ChannelPost = typeof channelPosts.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type HistoryEntry = typeof history.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type MeetupQuestion = typeof meetupQuestions.$inferSelect;
