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

# 4. publish a bundle (version sourced from package.json)
pnpx capgo-update-lite-cli publish
```

With a `capgo-update.config.json` in place, the only thing the publish flow needs at runtime is the admin token (env). The bundle version is read from `package.json`; if it matches the active bundle on the channel, the CLI prompts for a `patch`/`minor`/`major` bump and writes the result back.

## Shell completions

The CLI ships a `complete <shell>` subcommand that emits a tab-completion script for `bash`, `zsh`, `fish`, and `powershell`. The `init` wizard offers to install completions automatically; to install or re-install manually:

```sh
# bash
echo 'eval "$(capgo-update-lite complete bash)"' >> ~/.bashrc

# zsh
echo 'eval "$(capgo-update-lite complete zsh)"' >> ~/.zshrc

# fish
capgo-update-lite complete fish > ~/.config/fish/completions/capgo-update-lite.fish

# powershell
capgo-update-lite complete powershell >> $PROFILE
```

What gets completed:

- **Static enums** — `--platforms`, `--platform`, `--state`, `--disable-auto-update`.
- **App IDs** — `--app` / `--app-id` (and the positional on `apps get` / `apps set-policy`) hit `GET /admin/apps`.
- **Channels** — `--channel` enumerates distinct channels seen on the resolved app's bundles.
- **Bundle versions** — the positional on `bundles promote <version>` lists `state=active` rows for the resolved `(appId, channel)` scope.

Dynamic completions need `CAPGO_SERVER_URL` + `CAPGO_ADMIN_TOKEN` available at TAB time (env or in `capgo-update.config.json` in the cwd). They use a 5-minute on-disk cache at `${XDG_CACHE_HOME:-~/.cache}/capgo-update-lite/`; CLI write commands (`apps add` / `set-policy`, `bundles delete` / `edit` / `promote`, `publish`) invalidate the matching entries automatically. Each completion fetch has a 1.5 s timeout and falls back silently to "no completions" on any error — TAB never hangs the shell prompt.

## Subcommands

Every subcommand inherits the three global flags (`--server-url`, `--admin-token`, `--config`). They also honour the matching `CAPGO_*` env vars and the keys in the config file.

### `publish`

Zip a dist directory and upload it as a new bundle.

```sh
pnpx capgo-update-lite-cli publish [options]
```

The bundle version defaults to `package.json`'s `version` field. If it matches the active bundle on the target channel, the CLI prompts for a `patch`/`minor`/`major` bump and writes the new value back to `package.json` before publishing. Pass `--bundle-version` (or set `CAPGO_VERSION`) to override.

Options specific to `publish`:

| Flag                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `--app-id <id>`                 | Reverse-domain app identifier (or set in config / `CAPGO_APP_ID`)       |
| `--bundle-version <semver>`     | Bundle version (defaults to `package.json` version)                     |
| `--dist-dir <path>`             | Built web bundle directory (or set in config / `CAPGO_DIST_DIR`)        |
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

Interactive wizard that scaffolds `capgo-update.config.json` in the current directory.

```sh
pnpx capgo-update-lite-cli init [--force] [--path <path>] \
  [--app-id <id>] [--server-url <url>] [--channel <name>] [--dist-dir <path>] \
  [--no-validate]
```

Prompts (each is skipped when the matching value is already provided via flag, env, or an existing config file):

- **App ID** — reverse-domain identifier (`com.example.app`).
- **Server URL** — public URL of your deployed worker.
- **Channel** — defaults to `production`.
- **Dist directory** — auto-detects `./build`, `./dist`, `./www`, `./out`, `./public` in the cwd; each option's hint says whether it contains `index.html`. Falls back to a free-form path prompt if no candidates exist.

Then verifies the configuration against the server:

- Asks for an admin token at a hidden password prompt. **Leave empty** to fall back to a public health check only — `GET /health`, no admin endpoints touched.
- **With a token:** pings `/health`, then `GET /admin/apps` with the bearer token to verify auth. If your `appId` isn't registered yet, the wizard offers to register it inline (same path as `apps add`) — confirm + display-name prompt + `POST /admin/apps`. The display-name default is derived from the appId's last segment (`com.example.member_app` → `Member App`), editable.
- The token is used once and discarded; it is **never** written to `capgo-update.config.json`. If `CAPGO_ADMIN_TOKEN` (or `--admin-token`) is already set, the wizard reuses that and skips the password prompt.
- Pass `--no-validate` to skip the verification step entirely (e.g. when scripting init in a context with no network access).

The template includes `appId`, `serverUrl`, `channel`, `distDir`, `platforms` (default `["ios", "android"]`), and `autoMinUpdateBuild: true`. The admin token is intentionally absent — keep it in `CAPGO_ADMIN_TOKEN`.

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

1. CLI flag
2. Environment variable (`CAPGO_*`)
3. JSON config file (`./capgo-update.config.json` auto-loaded, or `--config <path>`)
4. Built-in defaults (`channel=production`, `activate=true`, `codeCheck=true`)

For `publish` specifically, when `--bundle-version` / `CAPGO_VERSION` / `version` are all absent, the bundle version is sourced from `package.json`'s `version` field. If that version matches the bundle currently active on the channel, the CLI prompts (`Cancel` / `Increase patch version` / `Increase minor version` / `Increase major version`) and writes the bumped value back to `package.json` before publishing. In non-interactive contexts (no TTY, e.g. CI), the prompt is replaced by a hard fail — bump `package.json` ahead of time or pass `--bundle-version` / `--version-exists-ok` explicitly.

The admin token follows the same three-route rule. Prefer the environment variable:

- `--admin-token` on the command line is visible in `ps` output.
- `"adminToken"` in the config file is fine if the file is gitignored.
- `CAPGO_ADMIN_TOKEN` is the safest default.

### Config file example

Drop `capgo-update.config.json` in the directory where you run the CLI (typically your mobile app's project root). The CLI auto-loads it; pass `--config <path>` to point at a different file.

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

With the config file present and `CAPGO_ADMIN_TOKEN` exported, `publish` shortens to:

```sh
pnpx capgo-update-lite-cli publish
```

The bundle version is sourced from `package.json` automatically; the bump prompt handles the case where it matches the active bundle.

### Full option reference

Rows marked "publish-only" are only read by the `publish` subcommand. Everything else is global.

| CLI flag                      | Env var                   | Config key        | Scope        | Notes                                                     |
| ----------------------------- | ------------------------- | ----------------- | ------------ | --------------------------------------------------------- |
| `--server-url <url>`          | `CAPGO_SERVER_URL`        | `serverUrl`       | global       | OTA server base URL                                       |
| `--admin-token <token>`       | `CAPGO_ADMIN_TOKEN`       | `adminToken`      | global       | Bearer token for `/admin/*`                               |
| `--config <path>`             | `CAPGO_CONFIG`            | n/a               | global       | JSON config path                                          |
| `--app-id <id>`               | `CAPGO_APP_ID`            | `appId`           | publish-only | Reverse-domain app identifier                             |
| `--bundle-version <semver>`   | `CAPGO_VERSION`           | `version`         | publish-only | Bundle version. Defaults to `package.json` version. Named to avoid commander's reserved root `--version` flag. |
| `--dist-dir <path>`           | `CAPGO_DIST_DIR`          | `distDir`         | publish-only | Built web bundle directory (must contain `index.html`)   |
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

- **Version autoresolve.** When `--bundle-version` is absent, sources the version from `package.json`. Compares against the active bundle on the channel: newer ⇒ continue; older ⇒ fail (downgrade); equal + sourced ⇒ prompt for `patch`/`minor`/`major` bump and write back to `package.json`; equal + explicit ⇒ fail unless `--version-exists-ok`.
- **Version validity.** The resolved version must parse as `MAJOR[.MINOR[.PATCH]]` (Apple's `CFBundleShortVersionString` rules — `110`, `110.0`, `1.2.3` are all accepted; missing segments default to `0`).
- **`package.json` alignment.** Bundle version must be `>=` the `package.json` version. Major bumps emit a warning so you can confirm the native shell supports the new bundle.
- **`capacitor.config.(ts|js|json)` alignment.** Its `appId` must match the configured `appId`. The `CapacitorUpdater.updateUrl`, if set, should start with the server URL (warning only).
- **Native build resolution.** Reads `versionName` from `android/app/build.gradle(.kts)` to default `min_android_build`. For iOS, walks Info.plist → `project.pbxproj` → `.xcconfig` → `xcodebuild` (macOS only) to resolve `CFBundleShortVersionString`, even when it's a `$(MARKETING_VERSION)` placeholder. Explicit `--min-android-build` / `--min-ios-build` override. Fails if neither explicit value nor a native project is available, with a layer-by-layer trace of what was tried.
- **Server ping.** `GET /` with a 5s timeout.
- **App registered.** `GET /admin/apps` must include the configured `appId` (requires an admin token).
- **Dist validation.** `distDir/index.html` must exist. Cloudflare adapter artifacts (`_worker.js`, `_routes.json`) must not, which catches accidental web builds.
- **`notifyAppReady()` source scan.** At least one `.js` file under `distDir` must reference `notifyAppReady`. Without that call the plugin rolls back after 10 seconds. Disable with `--no-code-check` if your build minifies the symbol away.
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
