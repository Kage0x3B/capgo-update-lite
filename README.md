# capgo-update-lite

Self-hostable OTA update server for [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater). The official self-hosted stack pulls in Supabase, optional Workers, and a lot of other moving parts. This project is one Cloudflare Worker plus one Postgres, with an almost-automatic deploy.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kage0x3B/capgo-update-lite/tree/main/packages/app)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](./packages/cli/LICENSE)

## Features

- **Drop-in replacement** for capgo.app's hosted service or their sprawling self-hosted backend. Devices hit the same `/updates` and `/stats` endpoints the plugin already expects.
- **Channel-scoped rollouts.** Use `production`, `staging`, `canary`, whatever you want; devices only see bundles whose channel matches their `defaultChannel`.
- **Web dashboard** at `/dashboard`. Manage apps and bundles, review usage stats and update failures reported by devices.
- **Publish CLI** at `pnpx capgo-update-lite-cli`. Ships new bundles, manages apps and bundles, and inspects stats from the terminal.
- **Runs on Cloudflare + R2 free tiers** for low-traffic apps. Bring your own Postgres.

## Quickstart: one-click deploy

Click **Deploy to Cloudflare** above. The wizard:

1. Forks this repo into your GitHub account.
2. Provisions an R2 bucket for the `BUNDLES` binding.
3. Prompts you for a Postgres connection string, creates a Hyperdrive binding, replaces the placeholder id in `wrangler.jsonc`.
4. Builds the SvelteKit worker and deploys.

Three follow-ups after the first deploy. The worker will log errors until they're done:

1. **Apply the DB schema.** Run `pnpm db:push`. Details: [Postgres + Drizzle setup](#postgres--drizzle-setup).
2. **Set the R2 secrets.** Mint an R2 API token, then `wrangler secret put` three values. Details: [R2 + CORS setup](#r2--cors-setup).
3. **Apply R2 CORS.** Paste a small JSON blob into the R2 dashboard or run `wrangler r2 bucket cors put`. Details: [R2 + CORS setup](#r2--cors-setup).

Then wire up your Capacitor app (see [Client setup](#client-setup-capacitor-app-side)) and register your first app via the dashboard or `pnpx capgo-update-lite-cli apps add`.

## Manual setup (non-button path)

**Prerequisites:** Cloudflare account, a Postgres you own, `pnpm`, Node 20+.

```sh
git clone https://github.com/Kage0x3B/capgo-update-lite.git
cd capgo-update-lite
pnpm install

# Replace the placeholder Hyperdrive id with your own (dashboard →
# Workers & Pages → Hyperdrive → your binding → ID).
vim packages/app/wrangler.jsonc

# Fill in the Postgres URL + PRIVATE_ADMIN_TOKEN + R2 creds.
cp packages/app/.env.example      packages/app/.env
cp packages/app/.dev.vars.example packages/app/.dev.vars
vim packages/app/.env packages/app/.dev.vars

pnpm db:push     # apply schema to your Postgres
pnpm deploy      # vite build + wrangler deploy
```

After the first deploy, run the post-deploy steps from the quickstart (R2 secrets and CORS; the `db:push` above already handled the schema).

## Postgres + Drizzle setup

### 1. Pick a Postgres host

- **Self-hosted.** A `postgres:18-alpine` container on a Hetzner (or equivalent) VPS is enough; any Postgres 14+ works.
    - Hyperdrive connects with `sslmode=require`, so Postgres must be configured to accept SSL connections.
- **Managed Postgres.** Any Hyperdrive-compatible provider works:
    - [Neon](https://neon.tech)
    - [Render](https://render.com)
    - See Cloudflare's [full list of compatible providers](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/#supported-database-providers).

### 2. Create a Hyperdrive binding

Cloudflare dashboard → Workers & Pages → Hyperdrive → **Create configuration** → paste your Postgres connection string. Copy the resulting binding ID.

If you're using the Deploy to Cloudflare button, paste the ID into the wizard's `HYPERDRIVE` prompt during setup; Cloudflare writes it into the forked repo's `wrangler.jsonc` for you.

For a manual deploy, paste the ID into `packages/app/wrangler.jsonc` yourself:

```jsonc
"hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<your-hyperdrive-id>" }
]
```

### 3. Apply the schema

```sh
pnpm db:push       # fastest path for first-time setup
```

Schema source: [`packages/app/src/lib/server/db/schema.ts`](./packages/app/src/lib/server/db/schema.ts), defining three tables (`apps`, `bundles`, `stats_events`). Existing migration SQL lives under `packages/app/drizzle/`.

## R2 + CORS setup

The dashboard uploads bundles directly to presigned R2 URLs from the browser. Without a CORS policy on the bucket, those PUTs fail with a cross-origin error.

### 1. Mint an R2 API token

Cloudflare dashboard → R2 → Manage R2 API Tokens → **Create API token**. Scope it to the bundles bucket (read + write). Note the **Access Key ID**, **Secret Access Key**, and the **S3 API endpoint URL** shown after creation.

### 2. Set the three secrets

```sh
wrangler secret put R2_S3_ENDPOINT        # https://<account-id>.<region>.r2.cloudflarestorage.com
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### 3. Apply the CORS policy

Use this rule set, replacing `https://my-update-server.example.com` with the public URL of your deployed dashboard:

```json
[
    {
        "AllowedOrigins": ["https://my-update-server.example.com"],
        "AllowedMethods": ["PUT"],
        "AllowedHeaders": ["content-type"],
        "ExposeHeaders": ["etag"],
        "MaxAgeSeconds": 3600
    }
]
```

In the Cloudflare dashboard, go to R2 → your bucket → Settings → CORS Policy and paste the JSON.

Alternatively, from the CLI, save the JSON as `cors.json` and run (omit `--jurisdiction` if your bucket isn't in the EU jurisdiction):

```sh
wrangler r2 bucket cors put <your-bucket-name> --rules ./cors.json --jurisdiction eu
```

## Client setup (Capacitor app side)

Install the plugin in your Capacitor project:

```sh
pnpm add @capgo/capacitor-updater
pnpx cap sync
```

Point the plugin at your deployed worker in `capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.example.app',
    appName: 'Example',
    plugins: {
        CapacitorUpdater: {
            updateUrl: 'https://<my-update-server.example.com>/updates',
            statsUrl: 'https://<my-update-server.example.com>/stats',
            defaultChannel: 'production'
        }
    }
};

export default config;
```

> The `appId` must match the one you register via `POST /admin/apps`. The CLI's preflight checks this automatically for you.

For the full plugin API (triggering update checks manually, listening for lifecycle events, handling rollbacks, channel overrides, encrypted bundles), see the upstream docs: <https://github.com/Cap-go/capacitor-updater>.

## Publishing updates

### 1. Register the app (once)

Through the dashboard (`/dashboard/apps`) or the CLI:

```sh
pnpx capgo-update-lite-cli apps add com.example.app --name "Example"
```

### 2. Build your web assets

Produce whatever Capacitor expects, typically a `build/` or `www/` directory with `index.html` at the root. The CLI's preflight rejects builds containing Cloudflare adapter artifacts (`_worker.js`, `_routes.json`), which catches the common mistake of pointing at a SvelteKit `.svelte-kit/cloudflare` directory instead of the Capacitor build.

### 3. Publish with the CLI

```sh
pnpx capgo-update-lite-cli publish com.example.app 1.2.3 ./build --activate
```

The CLI can authenticate via any of three routes (pick whichever suits your environment): `--admin-token <token>`, `CAPGO_ADMIN_TOKEN` env, or an `adminToken` key in a `capgo-update.json` config. Same for every other option, with precedence CLI flag > `CAPGO_*` env > JSON config > default.

### CLI subcommand summary

| Subcommand                | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `publish`                 | Zip a dist directory and ship it as a bundle (init → R2 PUT → commit). |
| `apps list` / `add`       | List registered apps; register a new one.                              |
| `bundles list` / `delete` | Inspect or remove bundles (soft delete or `--purge` for hard delete).  |
| `probe`                   | Smoke-test `POST /updates` with a synthetic device request.            |
| `stats`                   | List recent stats events, filterable by app / action / time window.    |
| `init`                    | Scaffold a `capgo-update.json` config file.                            |

### Channels and rollback

Devices only receive bundles whose channel matches their plugin's `defaultChannel`. Publish to `staging` first:

```sh
pnpx capgo-update-lite-cli publish com.example.app 1.2.3 ./build --channel staging --activate
```

To roll back, promote an older bundle via the dashboard (`/dashboard/apps/<id>`) or the CLI:

```sh
pnpx capgo-update-lite-cli bundles promote 1.1.0 --app com.example.app
```

Activation is atomic: it deactivates siblings in the same `(appId, channel)` in the same transaction, so there's no window where two bundles are both "active".

See [`packages/cli/README.md`](./packages/cli/README.md) for the full flag reference, preflight check list, and JSON config file format.

## Dashboard + API

- **`/dashboard`**: web UI. Log in with your `PRIVATE_ADMIN_TOKEN`.
- **`/updates`, `/stats`**: plugin-facing routes that match the `@capgo/capacitor-updater` server spec.
- **`/health`**: liveness / readiness probe.
- **`/admin/*`**: admin routes consumed by the CLI (bearer auth).
- **`/openapi.json`** and **`/docs`**: OpenAPI spec and a Scalar-rendered UI.

## How it works

Bundle bytes never transit the Worker's request body. Uploads and downloads go through presigned R2 URLs, so the Worker's 100 MB request-size cap doesn't apply; it only handles small JSON payloads (manifests, commit metadata, stats events).

### Publishing a bundle

```mermaid
sequenceDiagram
    autonumber
    participant CLI as Publish CLI
    participant Worker
    participant R2
    participant DB as Postgres

    CLI->>Worker: POST /admin/bundles/init
    Worker->>DB: insert pending bundle row
    Worker-->>CLI: bundle_id + presigned PUT URL
    CLI->>R2: PUT bundle.zip (direct, bypasses Worker)
    CLI->>Worker: POST /admin/bundles/commit (sha256)
    Worker->>R2: HEAD + re-hash to verify
    Worker->>DB: state=active, deactivate siblings
    Worker-->>CLI: committed bundle row
```

### Checking for updates (on-device)

```mermaid
sequenceDiagram
    autonumber
    participant Device as @capgo/capacitor-updater
    participant Worker
    participant R2
    participant DB as Postgres

    Device->>Worker: POST /updates (appId, channel, platform, currentVersion)
    Worker->>DB: lookup active bundle
    Worker->>R2: presign GET URL
    Worker-->>Device: manifest (version, checksum, download URL)
    Device->>R2: GET bundle.zip (direct)
    Device->>Device: verify checksum, extract, hot-swap
    Device-)Worker: POST /stats (async, fire-and-forget)
```

## Configuration reference

### Environment variables

| Name                                                       | Where                                                   | Purpose                                       |
| ---------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `PRIVATE_ADMIN_TOKEN`                                      | `.env` (build-time; baked in via `$env/static/private`) | Bearer token for `/admin/*` + dashboard login |
| `R2_S3_ENDPOINT`                                           | `wrangler secret put`                                   | R2 S3-compatible endpoint URL                 |
| `R2_ACCESS_KEY_ID`                                         | `wrangler secret put`                                   | R2 API token access key                       |
| `R2_SECRET_ACCESS_KEY`                                     | `wrangler secret put`                                   | matching secret                               |

### Wrangler bindings

Defined in [`packages/app/wrangler.jsonc`](./packages/app/wrangler.jsonc):

| Binding      | Kind         | Purpose                                                                                           |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `ASSETS`     | `assets`     | Serves the SvelteKit client bundle from `.svelte-kit/cloudflare`.                                 |
| `HYPERDRIVE` | `hyperdrive` | Connection pool to your Postgres.                                                                 |
| `BUNDLES`    | `r2_bucket`  | Declared so the Deploy wizard creates the bucket; server talks to R2 via S3 API (presigned URLs). |

## License

MIT. See [`packages/cli/LICENSE`](./packages/cli/LICENSE); the server code under `packages/app/` is covered under the same terms.
