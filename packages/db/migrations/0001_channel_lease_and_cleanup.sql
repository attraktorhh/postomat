ALTER TABLE "channel_posts" ADD COLUMN "claimed_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "processed_events_created_idx" ON "processed_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");