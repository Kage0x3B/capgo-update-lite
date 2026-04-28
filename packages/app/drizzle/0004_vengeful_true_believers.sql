ALTER TABLE "apps" ADD COLUMN "fail_warn_rate" real;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "fail_risk_rate" real;--> statement-breakpoint
ALTER TABLE "bundles" ADD COLUMN "blacklist_reset_at" timestamp with time zone;