# capgo-update-lite

Lightweight OTA update server for [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater), built for Cloudflare Workers + R2 + Hyperdrive (Postgres). Ships with a publish CLI.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kage0x3B/capgo-update-lite/tree/main/packages/app)

This monorepo has two packages:

| Path            | Package                                                             | Purpose                                                    |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/app/` | `capgo-update-lite` (private)                                       | SvelteKit + Drizzle server, deploys to Cloudflare Workers  |
| `packages/cli/` | [`capgo-update-lite-cli`](./packages/cli/README.md) (public on npm) | Publishes built Capacitor bundles to the server            |

## Try the CLI

```sh
pnpm dlx capgo-update-lite-cli <app-id> <version> <dist-dir>
```

See [`packages/cli/README.md`](./packages/cli/README.md) for full docs, config file format, and preflight checks.

## Deploy your own instance

You'll need a Cloudflare account, an R2 bucket (the wizard creates it), and a Postgres database **you own** (Neon, Supabase, Render, RDS, a self-hosted instance, anything — Hyperdrive just needs a connection string).

### One-click via the Deploy button

1. Click **Deploy to Cloudflare** above. Cloudflare will fork this repo into your GitHub account, read `packages/app/wrangler.jsonc`, and walk you through:
    - Provisioning the R2 bucket (`BUNDLES`).
    - Creating a Hyperdrive binding — it'll ask for your Postgres connection string.
    - Creating the Worker and (on first deploy) running the build.
2. After the first deploy succeeds, finish the setup manually (see **Required secrets** below). The Worker will log errors until these are set.

### Manual setup (git clone, deploy from your workstation)

```sh
git clone https://github.com/Kage0x3B/capgo-update-lite.git
cd capgo-update-lite
pnpm install

# Edit packages/app/wrangler.jsonc — replace the placeholder Hyperdrive
# id with your own (Cloudflare dashboard → Workers & Pages → Hyperdrive).
$EDITOR packages/app/wrangler.jsonc

# Fill in Postgres connection string, PRIVATE_ADMIN_TOKEN, etc.
cp packages/app/.env.example packages/app/.env
$EDITOR packages/app/.env

# Fill in R2 S3 credentials for local `wrangler dev`.
cp packages/app/.dev.vars.example packages/app/.dev.vars
$EDITOR packages/app/.dev.vars

# Apply the DB schema to whatever DB your Hyperdrive points at.
pnpm db:push

# Deploy.
pnpm deploy
```

## Required secrets (regardless of deploy path)

The R2 binding is created by the wizard, but the server **issues presigned upload URLs via the R2 S3 API**, which needs an API token that only you can mint. After the first deploy:

1. **Create an R2 API token** (Cloudflare dashboard → R2 → Manage R2 API Tokens → Create, scoped to the bundles bucket). Copy the Access Key ID, Secret Access Key, and S3 endpoint URL.
2. **Set three Worker secrets:**
    ```sh
    wrangler secret put R2_S3_ENDPOINT       # https://<acct>.<region>.r2.cloudflarestorage.com
    wrangler secret put R2_ACCESS_KEY_ID     # Access Key ID
    wrangler secret put R2_SECRET_ACCESS_KEY # Secret Access Key
    ```
3. **Apply R2 CORS** so the admin UI's direct-to-R2 uploads work (edit `packages/app/scripts/r2-cors.json` to point at your domain, then):
    ```sh
    bash packages/app/scripts/apply-r2-cors.sh <your-bucket-name>
    ```

`PRIVATE_ADMIN_TOKEN` is a **build-time** env var (baked into the bundle via `$env/static/private`), not a runtime secret — set it in `.env` locally, or as a build-time variable in the Cloudflare Workers Builds dashboard (Project → Settings → Variables and Secrets → "Build-time").

## Development

```sh
pnpm dev         # SvelteKit + Miniflare on :8765
pnpm check       # svelte-check across the workspace
pnpm format      # prettier --write .
pnpm db:studio   # Drizzle Studio
```

All root scripts are thin passthroughs to `pnpm -F ./packages/app <cmd>`. Run CLI-only scripts with `pnpm -F ./packages/cli <cmd>` (e.g. `build`, `dev`, `check`).

## License

MIT. See [`packages/cli/LICENSE`](./packages/cli/LICENSE) for the CLI package; the server code is covered under the same terms.
