ALTER TABLE "daily_stats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "daily_stats" CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");