# capgo-update-lite-cli

CLI for publishing Capacitor OTA bundles to a [`capgo-update-lite`](https://github.com/Kage0x3B/capgo-update-lite) server.

Runs a full set of preflight checks — semver sanity, package.json alignment, capacitor config match, server reachability, duplicate/downgrade detection, dist-dir validation, zip size/integrity — before touching the server.

## Install-free usage

```sh
pnpm dlx capgo-update-lite-cli <app-id> <version> <dist-dir>
# or
npx capgo-update-lite-cli <app-id> <version> <dist-dir>
```

## Quick start

```sh
export CAPGO_SERVER_URL=https://ota.example.com
export CAPGO_ADMIN_TOKEN=<bearer-token>

pnpm dlx capgo-update-lite-cli com.example.app 1.4.2 ./build
```

## Configuration layers

Every value has three interchangeable routes — CLI flag, environment variable, or config file key — and you pick whichever fits your workflow. Precedence (highest wins):

1. **CLI flags** (`--server-url`, `--channel`, …) and positional args
2. **Environment variables** (`CAPGO_*`)
3. **JSON config file** — `./capgo-update.json` (auto-loaded) or `--config <path>`
4. **Built-in defaults** — `channel=production`, `activate=true`

The admin token is *not* special — it accepts all three routes like everything else. Some guidance:

- Prefer `CAPGO_ADMIN_TOKEN` via env over `--admin-token` on the CLI. Values on the command line show up in `ps` listings.
- If you put `"adminToken"` in the config file, gitignore that file.

### Config file example

Drop `capgo-update.json` in the directory where you run the CLI (typically your mobile app's project root):

```json
{
    "appId": "com.example.app",
    "serverUrl": "https://ota.example.com",
    "distDir": "./build",
    "channel": "production",
    "platforms": ["ios", "android"],
    "activate": true
}
```

With the config file in place, the invocation shortens to:

```sh
pnpm dlx capgo-update-lite-cli --version 1.4.2
```

Or, if you prefer positionals, skip any you've configured via defaults:

```sh
pnpm dlx capgo-update-lite-cli com.example.app 1.4.2 ./build
```

### Options — all three routes at a glance

| CLI flag                    | Environment variable         | Config file key       | Notes                                                     |
| --------------------------- | ---------------------------- | --------------------- | --------------------------------------------------------- |
| `<app-id>` / `--app-id`     | `CAPGO_APP_ID`               | `appId`               | Positional #1                                             |
| `<version>` / `--version`   | `CAPGO_VERSION`              | `version`             | Positional #2                                             |
| `<dist-dir>` / `--dist-dir` | `CAPGO_DIST_DIR`             | `distDir`             | Positional #3                                             |
| `--server-url`              | `CAPGO_SERVER_URL`           | `serverUrl`           | OTA server base URL                                       |
| `--admin-token`             | `CAPGO_ADMIN_TOKEN`          | `adminToken`          | Bearer token; required unless `--dry-run`                 |
| `--channel`                 | `CAPGO_CHANNEL`              | `channel`             | Default `production`                                      |
| `--platforms`               | `CAPGO_PLATFORMS`            | `platforms`           | `ios,android,electron` (comma-separated on CLI/env)       |
| `--link`                    | `CAPGO_LINK`                 | `link`                | Release notes / changelog URL                             |
| `--comment`                 | `CAPGO_COMMENT`              | `comment`             | Operator-authored note                                    |
| `--activate` / `--no-activate` | `CAPGO_ACTIVATE`          | `activate`            | Default `true`; env accepts `true`/`false`/`1`/`0`/`yes`/`no` |
| `--dry-run`                 | `CAPGO_DRY_RUN`              | `dryRun`              | Run preflight + zip, skip all server writes               |
| `--skip-preflight`          | `CAPGO_SKIP_PREFLIGHT`       | `skipPreflight`       | Bypass preflight checks (escape hatch)                    |
| `--config`                  | `CAPGO_CONFIG`               | —                     | Config file path (default `./capgo-update.json`)          |
| `--package-json`            | `CAPGO_PACKAGE_JSON`         | `packageJson`         | Override auto-detection of `package.json`                 |
| `--capacitor-config`        | `CAPGO_CAPACITOR_CONFIG`     | `capacitorConfig`     | Override auto-detection of `capacitor.config.(ts\|js\|json)` |
| `-h`, `--help`              | —                            | —                     | Show help                                                 |

## Preflight checks

Every check can be bypassed via `--skip-preflight`. Individual checks that rely on files auto-detect from the current working directory — they silently skip if the file is absent.

- **Semver validity** — rejects malformed `<version>`.
- **`package.json` alignment** — if `package.json` is present, `<version>` must be `>=` `package.json` version. Major bumps emit a warning (confirm the native shell supports the new bundle).
- **`capacitor.config.(ts|js|json)` alignment** — if found, its `appId` must match `<app-id>`, and its `CapacitorUpdater.updateUrl` should start with the server URL (warn only).
- **Server ping** — `GET /` with a 5s timeout.
- **App registered** — `GET /admin/apps` must include `<app-id>` (requires `CAPGO_ADMIN_TOKEN`).
- **Version progress** — the new version must be strictly greater than the currently-active bundle on the channel (duplicate or downgrade → fail).
- **Dist validation** — `<dist-dir>/index.html` must exist; Cloudflare adapter artifacts (`_worker.js`, `_routes.json`) must not (catches accidental web builds).
- **Zip integrity** — the generated ZIP is re-parsed to verify structural validity.
- **Size bounds** — `< 1 KB` → fail (likely empty build); `> 50 MB` → warn (slow on cellular); `> 500 MB` → fail.

## Flow

1. Resolve config from CLI + env + file.
2. Run preflight.
3. Zip `<dist-dir>` in memory with DEFLATE compression (cross-platform, no `zip` binary required).
4. `POST /admin/bundles/init` → receive presigned R2 URL.
5. `PUT` the zip directly to R2.
6. `POST /admin/bundles/commit` with `{bundle_id, checksum, activate}`.

On `--dry-run`, steps 4–6 are printed as a preview and skipped.

## Exit codes

- `0` — success
- `1` — any error (missing config, preflight failure, non-2xx response, IO failure, etc.)
