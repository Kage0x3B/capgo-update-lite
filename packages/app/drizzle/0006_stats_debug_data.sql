-- The two partial indexes below were first created by hand in 0003 but never
-- declared in schema.ts, so `db:push` deployments never got them. IF NOT EXISTS
-- keeps this migration safe for databases that did run 0003.
CREATE TABLE "update_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_id" text NOT NULL,
	"device_id" text NOT NULL,
	"platform" text,
	"channel" text,
	"version_name" text,
	"version_build" text,
	"version_code" text,
	"version_os" text,
	"plugin_version" text,
	"custom_id" text,
	"is_emulator" boolean,
	"is_prod" boolean,
	"country" text,
	"result" text NOT NULL,
	"detail" text,
	"candidates" integer,
	"bundle_id" integer,
	"bundle_version" text
);
--> statement-breakpoint
DROP INDEX IF EXISTS "stats_events_action_time_idx";--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "version_build" text;--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "version_code" text;--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "version_os" text;--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "custom_id" text;--> statement-breakpoint
ALTER TABLE "stats_events" ADD COLUMN "country" text;--> statement-breakpoint
CREATE INDEX "update_checks_app_time_idx" ON "update_checks" USING btree ("app_id","received_at");--> statement-breakpoint
CREATE INDEX "update_checks_app_device_time_idx" ON "update_checks" USING btree ("app_id","device_id","received_at");--> statement-breakpoint
CREATE INDEX "update_checks_received_brin" ON "update_checks" USING brin ("received_at");--> statement-breakpoint
CREATE INDEX "stats_events_app_device_time_idx" ON "stats_events" USING btree ("app_id","device_id","received_at");--> statement-breakpoint
CREATE INDEX "stats_events_received_brin" ON "stats_events" USING brin ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stats_events_device_failure_idx" ON "stats_events" USING btree ("app_id","device_id","version_name") WHERE "stats_events"."action" IN ('set_fail','update_fail','decrypt_fail','checksum_fail','unzip_fail');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stats_events_bundle_health_idx" ON "stats_events" USING btree ("app_id","version_name","device_id","action") WHERE "stats_events"."action" IN ('set','set_fail','update_fail','decrypt_fail','checksum_fail','unzip_fail');