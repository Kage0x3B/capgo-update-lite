CREATE TYPE "public"."admin_role" AS ENUM('viewer', 'publisher', 'admin');--> statement-breakpoint
CREATE TABLE "admin_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_tokens_token_hash_unique" UNIQUE("token_hash")
);
