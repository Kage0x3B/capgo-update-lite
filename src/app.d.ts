// See https://svelte.dev/docs/kit/types#app
// `Env` / `Cloudflare.Env` come from the generated worker-configuration.d.ts
// (regenerate via `pnpm cf-typegen` after editing wrangler.jsonc).

declare global {
    namespace App {
        interface Error {}
        interface Locals {
            admin: boolean;
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
            };
            cf: CfProperties;
            ctx: ExecutionContext;
        }
    }
}

export {};
