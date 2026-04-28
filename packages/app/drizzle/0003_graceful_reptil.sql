ALTER TABLE "apps" ADD COLUMN "fail_min_devices" integer;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "fail_rate_threshold" real;--> statement-breakpoint
-- Partial indexes for broken-bundle protection (see services/bundleHealth.ts).
-- The action lists must stay in sync with BUNDLE_BREAKING_ACTIONS in
-- services/analytics.ts. Both are partial so they stay small even as
-- stats_events grows — they only cover the specific actions we look at.
CREATE INDEX "stats_events_device_failure_idx" ON "stats_events" ("app_id","device_id","version_name") WHERE "action" IN ('set_fail','update_fail','decrypt_fail','checksum_fail','unzip_fail');--> statement-breakpoint
CREATE INDEX "stats_events_bundle_health_idx" ON "stats_events" ("app_id","version_name","device_id","action") WHERE "action" IN ('set','set_fail','update_fail','decrypt_fail','checksum_fail','unzip_fail');