# capgo-update-lite

Lightweight OTA update server for [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater), built for Cloudflare Workers + R2 + Hyperdrive (Postgres). Ships with a publish CLI.

This monorepo has two packages:

| Path            | Package                                                             | Purpose                                                    |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/app/` | `capgo-update-lite` (private)                                       | SvelteKit + Drizzle server, deploys to Cloudflare Workers  |
| `packages/cli/` | [`capgo-update-lite-cli`](./packages/cli/README.md) (public on npm) | Publishes built Capacitor bundles to the server            |

## Try the CLI

```sh
pnpm dlx capgo-update-lite-cli <app-id> <version> <dist-dir>
```

See [`packages/cli/README.md`](./packages/cli/README.md) for full docs, config file format, and all preflight checks.

## Deploying your own instance

You'll need: a Cloudflare account, an R2 bucket, a Hyperdrive binding pointing at a Postgres database you own.

1. **Clone the repo and install:**
    ```sh
    git clone <this-repo>
    cd capgo-update-lite
    pnpm install
    ```

2. **Create `packages/app/wrangler.jsonc`** (gitignored) by copying the example and filling in the two `<placeholder>` values:
    ```sh
    cp packages/app/wrangler.example.jsonc packages/app/wrangler.jsonc
    $EDITOR packages/app/wrangler.jsonc
    ```
    You'll replace:
    - `<YOUR_HYPERDRIVE_ID>` — the Hyperdrive binding ID from the Cloudflare dashboard.
    - `<your-worker-domain.example.com>` — your custom domain, or remove the `route` block to deploy to the default `*.workers.dev` URL.

3. **Create `packages/app/.env`** and `packages/app/.dev.vars`** from their `*.example` siblings:
    ```sh
    cp packages/app/.env.example packages/app/.env
    cp packages/app/.dev.vars.example packages/app/.dev.vars
    ```
    Fill in the Postgres connection string, `PRIVATE_ADMIN_TOKEN`, and R2 S3 credentials. See each example file for the details.

4. **Apply the DB schema** (one-time, against whatever DB your Hyperdrive points at):
    ```sh
    pnpm db:push
    ```

5. **Set production secrets** so they don't live in `.dev.vars`:
    ```sh
    wrangler secret put R2_S3_ENDPOINT
    wrangler secret put R2_ACCESS_KEY_ID
    wrangler secret put R2_SECRET_ACCESS_KEY
    ```

6. **Configure CORS on your R2 bucket** so the admin UI's direct-to-R2 uploads work:
    ```sh
    # edit packages/app/scripts/r2-cors.json to use your production domain
    bash packages/app/scripts/apply-r2-cors.sh <your-bucket-name>
    ```

7. **Deploy:**
    ```sh
    pnpm deploy
    ```

### Cloudflare Workers Builds (git-integrated deploys)

Because `packages/app/wrangler.jsonc` is gitignored, CF Workers Builds can't deploy straight from `git push`. Two clean ways to handle it:

- **Generate `wrangler.jsonc` during the build** — set `HYPERDRIVE_ID` and `WORKER_ROUTE` as environment variables in the CF Workers Builds dashboard, and extend the build command to materialize the real `wrangler.jsonc` from the example. Example build command:
    ```sh
    pnpm install --frozen-lockfile \
        && sed -e "s|<YOUR_HYPERDRIVE_ID>|$HYPERDRIVE_ID|" -e "s|<your-worker-domain.example.com>|$WORKER_ROUTE|" \
            packages/app/wrangler.example.jsonc > packages/app/wrangler.jsonc \
        && pnpm -F ./packages/app build
    ```
    Deploy command: `pnpm -F ./packages/app exec wrangler deploy`.

- **Deploy from a local machine instead** — skip CF Workers Builds entirely and run `pnpm deploy` from a workstation / CI you control, where `wrangler.jsonc` is populated.

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
