ALTER TABLE "channel_posts" ADD COLUMN "facts_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "ai_texts" jsonb;