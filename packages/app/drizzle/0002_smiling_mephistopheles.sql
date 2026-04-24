-- Strict compatibility guards: min_android_build, min_ios_build, and native_packages
-- are NOT NULL on bundles without defaults, so existing rows must be cleared before
-- the ALTER TABLE ADD COLUMN statements below. This is intentional; republish any
-- live bundles through the CLI (which now requires/auto-detects these fields).
TRUNCATE TABLE "bundles" CASCADE;--> statement-breakpoint
CREATE TYPE "public"."disable_auto_update_kind" AS ENUM('none', 'major', 'minor', 'patch');--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "disable_auto_update" "disable_auto_update_kind" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "disable_auto_update_under_native" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "min_plugin_version" text;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "min_android_build" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "min_ios_build" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "native_packages" jsonb NOT NULL;