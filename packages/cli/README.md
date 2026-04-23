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
export CAPGO_UPDATE_URL=https://ota.example.com
export CAPGO_ADMIN_TOKEN=<bearer-token>

pnpm dlx capgo-update-lite-cli com.example.app 1.4.2 ./build
```

## Configuration layers

Values are resolved in this order (highest wins):

1. **CLI flags** (`--server-url`, `--channel`, …) and positional args
2. **Environment variables** (`CAPGO_UPDATE_URL`, `CAPGO_ADMIN_TOKEN`)
3. **JSON config file** — `./capgo-update.json` (auto-loaded) or `--config <path>`
4. **Built-in defaults** — `channel=production`, `activate=true`

The admin token is read **only from the environment**. It is intentionally not supported in the config file to avoid accidentally committing secrets.

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

### Environment variables

| Variable             | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `CAPGO_ADMIN_TOKEN`  | Bearer token matching the server's `ADMIN_TOKEN` secret. Required unless `--dry-run`. |
| `CAPGO_UPDATE_URL`   | Server base URL. Overridden by `--server-url` or config `serverUrl`.     |

## Options

### Positionals

| Order | Name         | Alternative flag  |
| ----- | ------------ | ----------------- |
| 1     | `<app-id>`   | `--app-id <id>`   |
| 2     | `<version>`  | `--version <s>`   |
| 3     | `<dist-dir>` | `--dist-dir <p>`  |

### Flags

| Flag                            | Purpose                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `--server-url <url>`            | OTA server base URL                                      |
| `--channel <name>`              | Release channel (default `production`)                   |
| `--platforms <list>`            | Comma-separated platform list: `ios,android,electron`    |
| `--link <url>`                  | Release notes / changelog URL                            |
| `--comment <text>`              | Operator-authored note stored with the bundle row        |
| `--activate` / `--no-activate`  | Activate after commit (default activate)                 |
| `--dry-run`                     | Run preflight + zip checks; skip all server writes       |
| `--skip-preflight`              | Bypass all preflight checks (escape hatch)               |
| `--config <path>`               | JSON config file (default `./capgo-update.json`)         |
| `--package-json <path>`         | Path to `package.json` for the version check             |
| `--capacitor-config <path>`     | Path to `capacitor.config.(ts\|js\|json)`                |
| `-h`, `--help`                  | Show help                                                |

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
