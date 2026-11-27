CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"version" integer NOT NULL,
	"actor" text NOT NULL,
	"result" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"channel" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'entwurf' NOT NULL,
	"text_de" text DEFAULT '' NOT NULL,
	"text_en" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remote_id" text,
	"remote_media_id" text,
	"url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"matrix_user_id" text PRIMARY KEY NOT NULL,
	"dm_room_id" text,
	"post_id" integer,
	"state" jsonb,
	"question_post_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetup_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"candidates" jsonb NOT NULL,
	"event_id" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer,
	"kind" text DEFAULT 'photo' NOT NULL,
	"format" text,
	"banner_color" text,
	"version" integer,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text NOT NULL,
	"uploader_matrix_id" text,
	"consent" text DEFAULT 'einwilligung_fehlt' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'sammeln' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"author_matrix_id" text NOT NULL,
	"author_username" text NOT NULL,
	"author_display_name" text,
	"note" text,
	"banner_color" text DEFAULT 'mint' NOT NULL,
	"meetup_category" text,
	"ai_used" boolean DEFAULT false NOT NULL,
	"card_room_id" text,
	"card_event_id" text,
	"card_banner_version" integer,
	"pending_question" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"auto_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_question_post_id_posts_id_fk" FOREIGN KEY ("question_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history" ADD CONSTRAINT "history_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetup_questions" ADD CONSTRAINT "meetup_questions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_posts_post_channel" ON "channel_posts" USING btree ("post_id","channel");--> statement-breakpoint
CREATE INDEX "history_post_idx" ON "history" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "photos_post_idx" ON "photos" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" USING btree ("author_username");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_one_draft_per_author" ON "posts" USING btree ("author_matrix_id") WHERE "posts"."status" = 'sammeln';