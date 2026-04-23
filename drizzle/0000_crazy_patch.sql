CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"channel" text DEFAULT 'production' NOT NULL,
	"version" text NOT NULL,
	"platforms" text[] DEFAULT ARRAY['ios','android']::text[] NOT NULL,
	"r2_key" text NOT NULL,
	"checksum" text DEFAULT '' NOT NULL,
	"session_key" text DEFAULT '' NOT NULL,
	"link" text,
	"comment" text,
	"active" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_id" text NOT NULL,
	"device_id" text NOT NULL,
	"action" text,
	"version_name" text,
	"old_version_name" text,
	"platform" text,
	"plugin_version" text,
	"is_emulator" boolean,
	"is_prod" boolean
);
--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bundles_app_channel_version_uq" ON "bundles" USING btree ("app_id","channel","version");--> statement-breakpoint
CREATE INDEX "bundles_resolver_idx" ON "bundles" USING btree ("app_id","channel","active","released_at");--> statement-breakpoint
CREATE INDEX "stats_events_app_time_idx" ON "stats_events" USING btree ("app_id","received_at");--> statement-breakpoint
CREATE INDEX "stats_events_app_action_time_idx" ON "stats_events" USING btree ("app_id","action","received_at");