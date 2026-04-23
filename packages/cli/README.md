# capgo-update-lite-cli

CLI for publishing Capacitor bundles to a [`capgo-update-lite`](https://github.com/kage0x3b/capgo-update-lite) OTA server.

## Usage

```sh
pnpm dlx capgo-update-lite-cli <app-id> <version> <dist-dir> [--activate]
```

Also works with `npx` / `bunx`:

```sh
npx capgo-update-lite-cli my-app 1.2.3 ./dist --activate
```

### Environment variables

| Variable       | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `OTA_BASE_URL` | Base URL of your `capgo-update-lite` worker.                |
| `ADMIN_TOKEN`  | Bearer token matching the server's `ADMIN_TOKEN` secret.    |

### Example

```sh
export OTA_BASE_URL=https://ota.example.com
export ADMIN_TOKEN=…

pnpm dlx capgo-update-lite-cli my-app 1.2.3 ./www --activate
```

## What it does

1. Zips the given `<dist-dir>` in memory (warns if there's no `index.html` at the root).
2. Asks the OTA server for a presigned R2 upload URL.
3. Uploads the zip directly to R2.
4. Commits the bundle, optionally activating it for rollout.

## Exit codes

- `0` — success
- `1` — any error (missing env vars, non-2xx response, IO failure, etc.)
