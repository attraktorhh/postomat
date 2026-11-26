ALTER TABLE "posts" ADD COLUMN "suggested_facts" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "texts_error" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "texts_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "texts_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "texts_facts" jsonb;