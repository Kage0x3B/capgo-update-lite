// See https://svelte.dev/docs/kit/types#app
// `Env` / `Cloudflare.Env` come from the generated worker-configuration.d.ts
// (regenerate via `pnpm cf-typegen` after editing wrangler.jsonc).

declare global {
	namespace App {
		interface Error {}
		interface Locals {}
		interface PageData {}
		interface PageState {}
		interface Platform {
			// Merge wrangler-generated bindings with secrets (secrets are not
			// declared in wrangler.jsonc so they don't appear in Cloudflare.Env).
			env: Env & {
				ADMIN_TOKEN: string;
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
