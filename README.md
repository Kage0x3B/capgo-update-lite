# capgo-update-lite

Self-hostable OTA update server for [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater) — Cloudflare Workers + R2 + Postgres, minus the managed-service lock-in.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kage0x3B/capgo-update-lite/tree/main/packages/app)
[![npm](https://img.shields.io/npm/v/capgo-update-lite-cli.svg?label=capgo-update-lite-cli)](https://www.npmjs.com/package/capgo-update-lite-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./packages/cli/LICENSE)

## What you get

- **Drop-in replacement** for capgo.app's hosted service. Devices hit the same `/updates` and `/stats` endpoints the plugin already expects.
- **Channel-scoped rollouts** — `production`, `staging`, `canary`, whatever you want. Devices only see bundles whose channel matches their `defaultChannel`.
- **Presigned-URL uploads** so bundles bypass the Worker's request-size cap. The server hands out pre-signed R2 URLs; the CLI and browser upload straight to R2.
- **Web dashboard** at `/dashboard` — apps, bundles, stats, login.
- **OpenAPI 3 spec** at `/openapi.json`, interactive reference (Scalar) at `/docs`.
- **Publish CLI** shipped alongside: `pnpm dlx capgo-update-lite-cli ...`.
- **Runs on Cloudflare + R2 free tiers** for low-traffic apps. Hyperdrive's free tier + a free Neon/Supabase Postgres covers the database.

---

## Quickstart — one-click deploy

Click **Deploy to Cloudflare** above. The wizard:

1. Forks this repo into your GitHub account.
2. Provisions an R2 bucket for the `BUNDLES` binding.
3. Prompts you for a Postgres connection string, creates a Hyperdrive binding, replaces the placeholder id in `wrangler.jsonc`.
4. Builds the SvelteKit worker and deploys.

Three manual steps after the first deploy (the worker will log errors until these are done):

1. **Create an R2 API token** and set three Worker secrets. Dashboard → R2 → Manage R2 API Tokens → Create (scope it to the bundles bucket). Then:
    ```sh
    wrangler secret put R2_S3_ENDPOINT        # https://<acct>.<region>.r2.cloudflarestorage.com
    wrangler secret put R2_ACCESS_KEY_ID
    wrangler secret put R2_SECRET_ACCESS_KEY
    ```
2. **Apply the DB schema:**
    ```sh
    pnpm db:push
    ```
3. **Apply R2 CORS** so the dashboard's direct-to-R2 uploads work (edit `packages/app/scripts/r2-cors.json` first to list your domain):
    ```sh
    CLOUDFLARE_ACCOUNT_ID=<your-account-id> bash packages/app/scripts/apply-r2-cors.sh <your-bucket-name>
    ```

Register your first app via `POST /admin/apps` or the dashboard, then you're ready to publish bundles.

---

## Manual setup (non-button path)

**Prerequisites:** Cloudflare account, a Postgres you own, `pnpm`, Node 20+.

```sh
git clone https://github.com/Kage0x3B/capgo-update-lite.git
cd capgo-update-lite
pnpm install

# Replace the placeholder Hyperdrive id with your own (dashboard →
# Workers & Pages → Hyperdrive → your binding → ID).
$EDITOR packages/app/wrangler.jsonc

# Fill in the Postgres URL + PRIVATE_ADMIN_TOKEN + R2 creds.
cp packages/app/.env.example      packages/app/.env
cp packages/app/.dev.vars.example packages/app/.dev.vars
$EDITOR packages/app/.env packages/app/.dev.vars

pnpm db:push     # apply schema to your Postgres
pnpm deploy      # vite build + wrangler deploy
```

After the first deploy, run the three post-deploy steps from the quickstart (R2 secrets, CORS — the `db:push` above already handled the schema).

---

## Postgres + Drizzle setup

### 1. Pick a Postgres host

Any Postgres 14+ works. Popular free/low-cost options:

- [**Neon**](https://neon.tech) — generous free tier, serverless, cold-start friendly.
- [**Supabase**](https://supabase.com) — free tier, included auth/storage you can ignore.
- [**Render**](https://render.com) — simple managed Postgres.
- **AWS RDS / GCP Cloud SQL** — if you're already on a cloud.
- **Self-hosted** — fine, just make sure Hyperdrive can reach it.

### 2. Create a Hyperdrive binding

Cloudflare dashboard → Workers & Pages → Hyperdrive → **Create configuration** → paste your Postgres connection string. Copy the resulting binding ID into `packages/app/wrangler.jsonc`:

```jsonc
"hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<your-hyperdrive-id>" }
]
```

The Deploy-to-Cloudflare button does this for you automatically.

### 3. Apply the schema

```sh
pnpm db:push       # fastest path for first-time setup
```

Schema source: [`packages/app/src/lib/server/db/schema.ts`](./packages/app/src/lib/server/db/schema.ts) — three tables (`apps`, `bundles`, `stats_events`). Existing migration SQL lives under `packages/app/drizzle/`.

### 4. Drizzle commands

| Command            | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `pnpm db:generate` | Diff schema ↔ migrations, write a new migration SQL file.  |
| `pnpm db:migrate`  | Apply pending migrations to the target DB.                 |
| `pnpm db:push`     | Push schema directly (no migration files). First-time use. |
| `pnpm db:studio`   | Open Drizzle Studio (browser UI for the DB).               |

### 5. Local dev shortcut

Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in `packages/app/.env`. Wrangler picks it up and `wrangler dev` talks to Postgres directly, bypassing the Hyperdrive edge pool for the local session.

### 6. Connection pool note

[`createDb()`](./packages/app/src/lib/server/db/index.ts) uses `postgres.js` with pool size 5 and closes the pool after each request via `platform.context.waitUntil`. No tuning needed for typical workloads.

---

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

Edit [`packages/app/scripts/r2-cors.json`](./packages/app/scripts/r2-cors.json) — replace the placeholder origin with your dashboard's public URL. Keep the `localhost` entries if you plan to develop against a local dashboard.

```sh
CLOUDFLARE_ACCOUNT_ID=<your-account-id> bash packages/app/scripts/apply-r2-cors.sh <your-bucket-name>
```

Script requires `wrangler` (included as a devDep) and your Cloudflare account ID.

---

## Client setup (Capacitor app side)

Install the plugin in your Capacitor project:

```sh
pnpm add @capgo/capacitor-updater
npx cap sync
```

Point the plugin at your deployed worker in `capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.example.app',
    appName: 'Example',
    plugins: {
        CapacitorUpdater: {
            updateUrl: 'https://<your-worker>/updates',
            statsUrl: 'https://<your-worker>/stats',
            defaultChannel: 'production'
        }
    }
};

export default config;
```

> The `appId` must match the one you register via `POST /admin/apps`. The CLI's preflight checks this automatically for you.

For the full plugin API — triggering update checks manually, listening for lifecycle events, handling rollbacks, channel overrides, encrypted bundles — see the upstream docs: <https://github.com/Cap-go/capacitor-updater>.

---

## Publishing updates

### 1. Register the app (once)

Either through the dashboard (`/dashboard/apps`) or via curl:

```sh
curl -X POST "https://<your-worker>/admin/apps" \
    -H "authorization: Bearer $PRIVATE_ADMIN_TOKEN" \
    -H "content-type: application/json" \
    -d '{"id":"com.example.app","name":"Example"}'
```

### 2. Build your web assets

Produce whatever Capacitor expects — typically a `build/` or `www/` directory with `index.html` at the root. The CLI's preflight rejects builds containing Cloudflare adapter artifacts (`_worker.js`, `_routes.json`), which catches the common mistake of pointing at a SvelteKit `.svelte-kit/cloudflare` directory instead of the Capacitor build.

### 3. Publish with the CLI

```sh
pnpm dlx capgo-update-lite-cli publish com.example.app 1.2.3 ./build --activate
```

The CLI can authenticate via any of three routes (pick whichever suits your environment): `--admin-token <token>`, `CAPGO_ADMIN_TOKEN` env, or an `adminToken` key in a `capgo-update.json` config. Same for every other option — CLI flag > `CAPGO_*` env > JSON config > default.

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
pnpm dlx capgo-update-lite-cli publish com.example.app 1.2.3 ./build --channel staging --activate
```

To roll back, activate an older bundle — dashboard (`/dashboard/apps/<id>`) or API:

```sh
curl -X PATCH "https://<your-worker>/admin/bundles/41" \
    -H "authorization: Bearer $PRIVATE_ADMIN_TOKEN" \
    -H "content-type: application/json" \
    -d '{"active":true}'
```

Activation is atomic: it deactivates siblings in the same `(appId, channel)` in the same transaction, so there's no window where two bundles are both "active".

See [`packages/cli/README.md`](./packages/cli/README.md) for the full flag reference, preflight check list, and JSON config file format.

---

## Dashboard + API

### Dashboard

Lives at `/dashboard`. Log in with `PRIVATE_ADMIN_TOKEN`; login mints a 30-day `capgo_admin_session` cookie (HMAC-signed, httpOnly, Secure, SameSite=strict). Pages:

- `/dashboard/apps` — list, register, inspect apps and their bundles
- `/dashboard/apps/<id>/stats` — per-app analytics (adoption, platform mix, failures)
- `/dashboard/stats` — global stats
- `/dashboard/cli` — quick CLI reference (copy-pasteable commands scoped to your deployment)

### API

- `GET /openapi.json` — generated OpenAPI 3 spec.
- `GET /docs` — interactive reference rendered with Scalar.

Endpoint groups:

- **`plugin`** — `/updates`, `/stats` (called by devices). These **always return HTTP 200**, with error details in the response body, because the plugin treats any non-200 as a network failure and rolls back. Don't be surprised by "errors" with 200 status codes.
- **`admin`** — `/admin/*`. Bearer auth against `PRIVATE_ADMIN_TOKEN`, timing-safe comparison.
- **`ops`** — `/health` probes DB + R2; returns 200 when both healthy, 503 if degraded. Body always carries per-dependency results.

---

## How it works

```
                           ┌───────────────────────────────┐
                           │       Cloudflare Worker       │
                           │   (SvelteKit + Drizzle)       │
                           └───────────────────────────────┘
                              │            ▲            │
                              │            │            │
                  admin REST  │   bearer   │  plugin    │   plugin
                  + dashboard │   auth     │  /updates  │   /stats
                              │            │            │
  ┌──────────┐    presigned   │            │            │   ┌──────────────┐
  │ Publish  │ ─────PUT──▶    │            │            │   │ @capgo/      │
  │   CLI    │                │            │            ◀── │ capacitor-   │
  └──────────┘    init+commit │            │            │   │ updater      │
       │         ◀──REST───▶  │            │            │   │ (on device)  │
       │                      │            │            │   └──────────────┘
       │                      ▼            ▼            ▼           ▲
       │                ┌─────────┐  ┌────────────┐  ┌──────┐       │
       │                │  R2     │  │ Hyperdrive │  │  R2  │       │
       │                │ (S3 API)│  │ + Postgres │  │(S3)  │       │
       │                └─────────┘  └────────────┘  └──────┘       │
       │                     ▲                           │          │
       └─── direct PUT ──────┘                           └── direct GET ──┘
              to presigned URL                               presigned URL
```

**Device side.** The plugin polls `/updates` on launch or foreground. The server looks up the active bundle for the device's `(appId, channel, platform)`, issues a presigned R2 GET URL, and returns a manifest. The plugin downloads the zip directly from R2, verifies the checksum, extracts, and hot-swaps on next launch.

**Publisher side.** The CLI calls `POST /admin/bundles/init` with `{app_id, version, channel}`. The server inserts a `pending` bundle row and returns a presigned R2 PUT URL (15-minute expiry). The CLI uploads the zip directly to R2, then calls `POST /admin/bundles/commit` with the sha256 checksum. The server re-hashes the R2 object server-side, and if the checksum matches, transitions `state=pending → active` and (if `activate=true`) atomically deactivates siblings.

**Why it works on a Worker.** Bundle bytes never transit the Worker request body — uploads and downloads both go through presigned R2 URLs. The Worker's 100 MB request-size cap doesn't apply. The Worker only handles small JSON payloads (manifests, commit metadata, stats events).

---

## Configuration reference

### Environment variables

| Name                                                       | Where                                                   | Purpose                                       |
| ---------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `PRIVATE_ADMIN_TOKEN`                                      | `.env` (build-time; baked in via `$env/static/private`) | Bearer token for `/admin/*` + dashboard login |
| `R2_S3_ENDPOINT`                                           | `wrangler secret put`                                   | R2 S3-compatible endpoint URL                 |
| `R2_ACCESS_KEY_ID`                                         | `wrangler secret put`                                   | R2 API token access key                       |
| `R2_SECRET_ACCESS_KEY`                                     | `wrangler secret put`                                   | matching secret                               |
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` | `.env` (local dev only)                                 | Direct Postgres connection for `wrangler dev` |
| `CLOUDFLARE_ACCOUNT_ID`                                    | shell env when running `apply-r2-cors.sh`               | Used by wrangler to target the right account  |

### Wrangler bindings

Defined in [`packages/app/wrangler.jsonc`](./packages/app/wrangler.jsonc):

| Binding      | Kind         | Purpose                                                                                           |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `ASSETS`     | `assets`     | Serves the SvelteKit client bundle from `.svelte-kit/cloudflare`.                                 |
| `HYPERDRIVE` | `hyperdrive` | Connection pool to your Postgres.                                                                 |
| `BUNDLES`    | `r2_bucket`  | Declared so the Deploy wizard creates the bucket; server talks to R2 via S3 API (presigned URLs). |

---

## Development

```sh
pnpm dev         # SvelteKit + Miniflare on :8765
pnpm check       # svelte-check + tsc across the workspace
pnpm format      # prettier --write .
pnpm db:studio   # Drizzle Studio
```

**Monorepo layout:**

| Path            | Package                                                                        | Purpose                                                |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `packages/app/` | `capgo-update-lite` (private)                                                  | The Worker. SvelteKit + Drizzle, deploys via wrangler. |
| `packages/cli/` | [`capgo-update-lite-cli`](https://www.npmjs.com/package/capgo-update-lite-cli) | Publish CLI, shipped to npm.                           |

All root scripts passthrough to `pnpm -F ./packages/app <cmd>`. CLI-only scripts: `pnpm -F ./packages/cli <cmd>` (e.g. `build`, `dev`, `check`).

See [`packages/cli/README.md`](./packages/cli/README.md) for CLI-specific development.

---

## License

MIT. See [`packages/cli/LICENSE`](./packages/cli/LICENSE); the server code under `packages/app/` is covered under the same terms.
