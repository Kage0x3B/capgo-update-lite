# capgo-update-lite-cli

CLI for publishing Capacitor OTA bundles to a [`capgo-update-lite`](https://github.com/Kage0x3B/capgo-update-lite) server, plus admin commands to inspect apps, bundles, and client telemetry.

It runs a full set of preflight checks before touching the server: semver sanity, `package.json` alignment, `capacitor.config` match, server reachability, duplicate/downgrade detection, `notifyAppReady()` source scan, dist-dir validation, and zip size/integrity.

## Install-free usage

```sh
pnpx capgo-update-lite-cli <subcommand> [...args]
# or
npx capgo-update-lite-cli <subcommand> [...args]
```

The package name on npm is `capgo-update-lite-cli`. If you install it globally, the installed binary is `capgo-update-lite`.

## Quick start

```sh
# 1. scaffold a config file in your Capacitor project root
pnpx capgo-update-lite-cli init

# 2. set the admin token once per shell
export CAPGO_ADMIN_TOKEN=<bearer-token>

# 3. register the app (one-time)
pnpx capgo-update-lite-cli apps add com.example.app --name "Example"

# 4. publish a bundle
pnpx capgo-update-lite-cli publish 1.4.2 ./build
```

With a `capgo-update.json` in place, positionals collapse to whatever you haven't already configured.

## Subcommands

Every subcommand inherits the three global flags (`--server-url`, `--admin-token`, `--config`). They also honour the matching `CAPGO_*` env vars and the keys in the config file.

### `publish`

Zip a dist directory and upload it as a new bundle.

```sh
pnpx capgo-update-lite-cli publish [app-id] [version] [dist-dir] [options]
```

Positionals map to `--app-id`, `--bundle-version`, and `--dist-dir`. Any positional can be omitted if the value is set via flag, env, or config file.

Options specific to `publish`:

| Flag                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `--app-id <id>`                 | Override positional `<app-id>`                                          |
| `--bundle-version <semver>`     | Override positional `<version>` (avoids collision with root `--version`) |
| `--dist-dir <path>`             | Override positional `<dist-dir>`                                        |
| `-c, --channel <name>`          | Release channel (default `production`)                                  |
| `-p, --platforms <list>`        | Comma-separated list of `ios,android,electron`                          |
| `--link <url>`                  | Release notes / changelog URL                                           |
| `--comment <text>`              | Operator-authored note                                                  |
| `--activate` / `--no-activate`  | Activate on commit (default: activate)                                  |
| `--dry-run`                     | Run preflight and build the zip, skip all server writes                 |
| `--skip-preflight`              | Bypass preflight checks (escape hatch)                                  |
| `--no-code-check`               | Skip the `notifyAppReady()` source scan                                 |
| `--version-exists-ok`           | Exit 0 if the version is already published (CI-friendly)                |
| `--package-json <path>`         | Override auto-detection of `package.json`                               |
| `--capacitor-config <path>`     | Override auto-detection of `capacitor.config.(ts\|js\|json)`            |
| `--min-android-build <semver>`  | Minimum native Android versionName required by this bundle              |
| `--min-ios-build <semver>`      | Minimum native iOS CFBundleShortVersionString required by this bundle   |
| `--auto-min-update-build`       | Inherit min builds from the previous bundle when native deps are unchanged; bump to detected native versions when they changed |
| `--android-project <path>`      | Path to Android project root (default `./android`)                      |
| `--ios-project <path>`          | Path to iOS project root (default `./ios`)                              |

### `init`

Scaffold a `capgo-update.json` file in the current directory.

```sh
pnpx capgo-update-lite-cli init [--force] [--path <path>]
```

The template includes `appId`, `serverUrl`, `channel`, `distDir`, and `platforms`. The admin token is intentionally absent; keep it in `CAPGO_ADMIN_TOKEN` or gitignore the config file.

### `apps list`

List apps registered on the server.

```sh
pnpx capgo-update-lite-cli apps list [--json]
```

### `apps add`

Register a new app.

```sh
pnpx capgo-update-lite-cli apps add <app-id> --name <display-name>
```

### `apps set-policy`

Update an app's compatibility policy. Only the flags you pass are changed; omit a flag to leave that field untouched.

```sh
pnpx capgo-update-lite-cli apps set-policy <app-id> \
  [--name <display-name>] \
  [--disable-auto-update none|patch|minor|major] \
  [--disable-auto-update-under-native | --no-disable-auto-update-under-native] \
  [--min-plugin-version <semver>|null]
```

`--min-plugin-version null` clears the floor. Without `--no-disable-auto-update-under-native` the under-native guard stays at whatever value the server holds.

### `bundles list`

List bundles, optionally filtered.

```sh
pnpx capgo-update-lite-cli bundles list [--app <id>] [-c <channel>] [-s <state>] [--active | --no-active] [--json]
```

### `bundles delete`

Delete a bundle. Soft-delete by default (row stays, marked deleted). Pass `--purge` to also remove the R2 object. Purge is unrecoverable.

```sh
pnpx capgo-update-lite-cli bundles delete <bundle-id> [--purge]
```

### `bundles promote`

Activate an existing bundle for an (app, channel) pair, with no re-upload.

```sh
pnpx capgo-update-lite-cli bundles promote <version> --app <id> [-c <channel>]
```

Errors if zero or multiple bundles match the version on the channel.

### `stats`

List recent client telemetry events.

```sh
pnpx capgo-update-lite-cli stats [--app <id>] [--action <name>] [--since <iso>] [--until <iso>] [--limit <n>] [--offset <n>] [--json]
```

Actions include `update`, `set`, and other events the plugin reports. `--limit` accepts 1..1000 (default 100).

### `probe`

Send a synthetic `POST /updates` to smoke-test the server end-to-end from the client perspective.

```sh
pnpx capgo-update-lite-cli probe [--app <id>] [--platform ios|android|electron] [--current-version <semver>] [--device-id <uuid>] [-c <channel>]
```

Defaults to platform `ios` and current version `0.0.0` (which forces an `update-available` response if a bundle exists). When `--app` is absent, the command falls back to the config or reads `appId` out of `capacitor.config.*`.

## Configuration layers

Every value resolves via four routes. Precedence, highest wins:

1. CLI flag (and positional arguments for `publish`)
2. Environment variable (`CAPGO_*`)
3. JSON config file (`./capgo-update.json` auto-loaded, or `--config <path>`)
4. Built-in defaults (`channel=production`, `activate=true`, `codeCheck=true`)

The admin token follows the same three-route rule. Prefer the environment variable:

- `--admin-token` on the command line is visible in `ps` output.
- `"adminToken"` in the config file is fine if the file is gitignored.
- `CAPGO_ADMIN_TOKEN` is the safest default.

### Config file example

Drop `capgo-update.json` in the directory where you run the CLI (typically your mobile app's project root). `capgo-update.config.json` is also auto-loaded.

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

With the config file present, `publish` shortens to:

```sh
pnpx capgo-update-lite-cli publish 1.4.2
```

### Full option reference

Rows marked "publish-only" are only read by the `publish` subcommand. Everything else is global.

| CLI flag                      | Env var                   | Config key        | Scope        | Notes                                                     |
| ----------------------------- | ------------------------- | ----------------- | ------------ | --------------------------------------------------------- |
| `--server-url <url>`          | `CAPGO_SERVER_URL`        | `serverUrl`       | global       | OTA server base URL                                       |
| `--admin-token <token>`       | `CAPGO_ADMIN_TOKEN`       | `adminToken`      | global       | Bearer token for `/admin/*`                               |
| `--config <path>`             | `CAPGO_CONFIG`            | n/a               | global       | JSON config path                                          |
| `<app-id>` / `--app-id <id>`  | `CAPGO_APP_ID`            | `appId`           | publish-only | Positional #1                                             |
| `<version>` / `--bundle-version <semver>` | `CAPGO_VERSION` | `version`       | publish-only | Positional #2; `--bundle-version` avoids the `--version` collision |
| `<dist-dir>` / `--dist-dir <path>` | `CAPGO_DIST_DIR`     | `distDir`         | publish-only | Positional #3                                             |
| `-c, --channel <name>`        | `CAPGO_CHANNEL`           | `channel`         | most         | Default `production`                                      |
| `-p, --platforms <list>`      | `CAPGO_PLATFORMS`         | `platforms`       | publish-only | `ios,android,electron` (comma-separated on CLI and env)   |
| `--link <url>`                | `CAPGO_LINK`              | `link`            | publish-only | Release notes / changelog URL                             |
| `--comment <text>`            | `CAPGO_COMMENT`           | `comment`         | publish-only | Operator-authored note                                    |
| `--activate` / `--no-activate`| `CAPGO_ACTIVATE`          | `activate`        | publish-only | Default `true`; env accepts `true/false/1/0/yes/no/on/off` |
| `--dry-run`                   | `CAPGO_DRY_RUN`           | `dryRun`          | publish-only | Run preflight and zip, skip all server writes             |
| `--skip-preflight`            | `CAPGO_SKIP_PREFLIGHT`    | `skipPreflight`   | publish-only | Bypass preflight checks                                   |
| `--no-code-check`             | n/a                       | `codeCheck`       | publish-only | Skip `notifyAppReady()` source scan (config key defaults to `true`) |
| `--version-exists-ok`         | n/a                       | n/a               | publish-only | Exit 0 if the version is already published                |
| `--package-json <path>`       | `CAPGO_PACKAGE_JSON`      | `packageJson`     | publish-only | Override auto-detection of `package.json`                 |
| `--capacitor-config <path>`   | `CAPGO_CAPACITOR_CONFIG`  | `capacitorConfig` | publish-only | Override auto-detection of `capacitor.config.(ts\|js\|json)` |
| `--min-android-build <semver>`| `CAPGO_MIN_ANDROID_BUILD` | `minAndroidBuild` | publish-only | Minimum native Android versionName required by this bundle |
| `--min-ios-build <semver>`    | `CAPGO_MIN_IOS_BUILD`     | `minIosBuild`     | publish-only | Minimum native iOS CFBundleShortVersionString required by this bundle |
| `--auto-min-update-build`     | `CAPGO_AUTO_MIN_UPDATE_BUILD` | `autoMinUpdateBuild` | publish-only | Inherit min builds from prev bundle if native deps unchanged; bump otherwise |
| `--android-project <path>`    | `CAPGO_ANDROID_PROJECT`   | `androidProject`  | publish-only | Native Android project root (default `./android`)         |
| `--ios-project <path>`        | `CAPGO_IOS_PROJECT`       | `iosProject`      | publish-only | Native iOS project root (default `./ios`)                 |
| `-V, --version`               | n/a                       | n/a               | global       | Print CLI version                                         |
| `-h, --help`                  | n/a                       | n/a               | global       | Show help (supported on every subcommand)                 |

## Preflight checks (publish only)

All of these can be bypassed with `--skip-preflight`. Checks that rely on local files auto-detect from the current working directory and silently skip if the file is absent.

- **Semver validity.** Rejects malformed `<version>`.
- **`package.json` alignment.** `<version>` must be `>=` the `package.json` version. Major bumps emit a warning so you can confirm the native shell supports the new bundle.
- **`capacitor.config.(ts|js|json)` alignment.** Its `appId` must match `<app-id>`. The `CapacitorUpdater.updateUrl`, if set, should start with the server URL (warning only).
- **Native build resolution.** Reads `versionName` from `android/app/build.gradle(.kts)` and `CFBundleShortVersionString` from `ios/App/App/Info.plist` to default `min_android_build` and `min_ios_build`. Explicit `--min-android-build` / `--min-ios-build` override. Fails if neither explicit value nor a native project is available.
- **Server ping.** `GET /` with a 5s timeout.
- **App registered.** `GET /admin/apps` must include `<app-id>` (requires an admin token).
- **Version progression.** The new version must be strictly greater than the currently-active bundle on the channel. Duplicates and downgrades fail; `--version-exists-ok` converts "already active" to exit 0 for CI.
- **Dist validation.** `<dist-dir>/index.html` must exist. Cloudflare adapter artifacts (`_worker.js`, `_routes.json`) must not, which catches accidental web builds.
- **`notifyAppReady()` source scan.** At least one `.js` file under `<dist-dir>` must reference `notifyAppReady`. Without that call the plugin rolls back after 10 seconds. Disable with `--no-code-check` if your build minifies the symbol away.
- **Zip integrity.** The generated ZIP is re-parsed to verify structural validity.
- **Size bounds.** Less than 1 KB fails (likely an empty build). Over 50 MB warns (slow on cellular). Over 500 MB fails.

## Compatibility guards

Every uploaded bundle carries three pieces of native-compatibility metadata. The server uses them to decide whether a given device should receive the bundle:

- `min_android_build`: minimum Android `versionName` the native shell must report.
- `min_ios_build`: minimum iOS `CFBundleShortVersionString` the native shell must report.
- `native_packages`: fingerprint of `@capacitor/*`, `@capacitor-community/*`, `@ionic-enterprise/*`, `cordova-plugin-*`, and `capacitor-*` / `capacitor-plugin-*` deps from `package.json`, with resolved versions at publish time.

If the device's `version_build` (what the plugin reports from the native project) is lower than the matching `min_*_build`, `/updates` returns `below_min_native_build` and the plugin keeps its current bundle.

### How `--auto-min-update-build` decides

With `--auto-min-update-build` (or `autoMinUpdateBuild: true` in config), the CLI queries the previously-active bundle on `(appId, channel)` and compares its `native_packages` fingerprint with the current one:

- Fingerprint unchanged: inherit `min_android_build` / `min_ios_build` from the previous bundle. No native shell reship needed.
- Fingerprint changed (added, removed, or version-bumped native dep): set the min builds to the detected native versions (`android/app/build.gradle` and `ios/App/App/Info.plist`) and print which packages changed.
- No previous bundle: use the detected native versions.

### Per-app policies

The server also enforces three per-app policies stored on the `apps` row. Configure them via `PATCH /admin/apps/<app-id>`:

- `disable_auto_update`: `none` (default), `patch`, `minor`, or `major`. Blocks auto-updates at or above the configured class.
- `disable_auto_update_under_native`: boolean (default `true`). Refuses to serve a bundle whose semver is lower than the device's native `version_build`.
- `min_plugin_version`: semver string or null. Devices running an older `@capgo/capacitor-updater` plugin are rejected with `unsupported_plugin_version`.

## Publish flow

1. Resolve config from CLI, env, and file.
2. Run preflight.
3. Zip `<dist-dir>` in memory with DEFLATE compression (cross-platform, no `zip` binary required).
4. `POST /admin/bundles/init`, receive a presigned R2 URL.
5. `PUT` the zip directly to R2.
6. `POST /admin/bundles/commit` with `{ bundle_id, checksum, activate }`.

On `--dry-run`, steps 4 through 6 are printed as a preview and skipped.

## Exit codes

- `0` on success, or when `--version-exists-ok` short-circuits a duplicate.
- `1` on any error: missing config, preflight failure, non-2xx response, IO failure, and so on.
