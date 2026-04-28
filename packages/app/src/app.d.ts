// See https://svelte.dev/docs/kit/types#app
// `Env` / `Cloudflare.Env` come from the generated worker-configuration.d.ts
// (regenerate via `pnpm cf-typegen` after editing wrangler.jsonc).

import type { ResolvedAuth } from '$lib/server/roles.js';

declare global {
    namespace App {
        interface Error {}
        interface Locals {
            /**
             * Resolved bearer/session auth for the current request, or null
             * when unauthenticated. Populated by hooks.server.ts (dashboard,
             * via session cookie) or by defineRoute (admin API, via Bearer).
             */
            auth: ResolvedAuth | null;
        }
        interface PageData {}
        interface PageState {}
        interface Platform {
            // Merge wrangler-generated bindings with R2 secrets (secrets aren't
            // declared in wrangler.jsonc so they don't appear in Cloudflare.Env).
            // ADMIN_TOKEN is read via `$env/static/private` at build time, not
            // here, so it deliberately isn't declared on platform.env.
            env: Env & {
                R2_S3_ENDPOINT: string;
                R2_ACCESS_KEY_ID: string;
                R2_SECRET_ACCESS_KEY: string;
                R2_DOWNLOAD_TTL_SECONDS?: string;
                STATS_RETENTION_DAYS?: string;
                CRON_SECRET?: string;
            };
            cf: CfProperties;
            ctx: ExecutionContext;
        }
    }
}

export {};
