#!/usr/bin/env node
/**
 * capgo-update: publish Capacitor OTA bundles to a capgo-update-lite server.
 *
 * Every value has three interchangeable routes. Precedence (highest first):
 *   1. CLI flags (--server-url, --channel, …) and positional args
 *   2. Environment variables (CAPGO_*)
 *   3. JSON config file (./capgo-update.json by default, or --config <path>)
 *   4. Built-in defaults (channel=production, activate=true)
 *
 * The admin token is *not* special — it accepts all three routes. Take care:
 * if you put `adminToken` in the config file, gitignore the file.
 *
 * Flow: preflight → zip <dist-dir> → init → PUT to R2 → commit [with activate].
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';

// --- types ------------------------------------------------------------------

type Platform = 'ios' | 'android' | 'electron';
const PLATFORMS: readonly Platform[] = ['ios', 'android', 'electron'];

type Semver = { major: number; minor: number; patch: number };

type FileConfig = {
    appId?: string;
    version?: string;
    distDir?: string;
    serverUrl?: string;
    adminToken?: string;
    channel?: string;
    platforms?: Platform[];
    link?: string;
    comment?: string;
    activate?: boolean;
    packageJson?: string;
    capacitorConfig?: string;
    skipPreflight?: boolean;
    dryRun?: boolean;
};

type ResolvedConfig = {
    appId: string;
    version: string;
    distDir: string;
    serverUrl: string;
    adminToken: string | undefined;
    channel: string;
    platforms: Platform[] | undefined;
    link: string | undefined;
    comment: string | undefined;
    activate: boolean;
    packageJson: string | undefined;
    capacitorConfig: string | undefined;
    skipPreflight: boolean;
    dryRun: boolean;
};

type InitResponse = { bundle_id: number; r2_key: string; upload_url: string; expires_at: string };
type BundleRow = { id: number; appId: string; channel: string; version: string; state: string; active: boolean };
type AppRow = { id: string; name: string };

// --- constants --------------------------------------------------------------

const MIN_ZIP_BYTES = 1024;
const WARN_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
const CLOUDFLARE_ARTIFACTS = ['_worker.js', '_routes.json'];
const PREFLIGHT_PING_TIMEOUT_MS = 5000;
const DEFAULT_CHANNEL = 'production';
const DEFAULT_CONFIG_FILENAMES = ['capgo-update.json', 'capgo-update.config.json'];

// --- output helpers ---------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function fail(msg: string, code = 1): never {
    console.error(`${RED}✗${RESET} ${msg}`);
    process.exit(code);
}

function warn(msg: string) {
    console.warn(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function ok(msg: string) {
    console.log(`  ${msg}`);
}

function step(msg: string) {
    console.log(`${CYAN}»${RESET} ${msg}`);
}

// --- semver (pragmatic — matches the style of our server-side parser) -------

function parseSemver(v: string): Semver | null {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?(?:\+[\w.]+)?$/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function cmpSemver(a: Semver, b: Semver): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}

// --- help -------------------------------------------------------------------

function printHelp(): void {
    console.log(`Usage: capgo-update [<app-id> <version> <dist-dir>] [options]

Positional arguments are a shorthand for --app-id, --version, --dist-dir
and may be omitted if the values come from a config file or flags.

Arguments:
  <app-id>             Reverse-domain app identifier (e.g. com.example.app)
  <version>            Semver string for the bundle (e.g. 1.4.2)
  <dist-dir>           Path to the built web bundle (must contain index.html)

Every value below can come from a CLI flag, a CAPGO_* env var, or the
JSON config file — you pick. Precedence: CLI > env > file > default.

Core options:
  --app-id <id>        Override positional <app-id>         (env CAPGO_APP_ID)
  --version <semver>   Override positional <version>        (env CAPGO_VERSION)
  --dist-dir <path>    Override positional <dist-dir>       (env CAPGO_DIST_DIR)
  --server-url <url>   OTA server base URL                  (env CAPGO_SERVER_URL)
  --admin-token <tok>  Bearer token for /admin/* routes     (env CAPGO_ADMIN_TOKEN)
  --channel <name>     Release channel (default: ${DEFAULT_CHANNEL})  (env CAPGO_CHANNEL)
  --platforms <list>   Comma-separated: ${PLATFORMS.join(',')}         (env CAPGO_PLATFORMS)
  --link <url>         Release notes / changelog URL        (env CAPGO_LINK)
  --comment <text>     Operator-authored note               (env CAPGO_COMMENT)

Behavior:
  --activate           Activate on commit (default)         (env CAPGO_ACTIVATE=true)
  --no-activate        Upload but leave active=false        (env CAPGO_ACTIVATE=false)
  --dry-run            Run preflight + zip; skip writes     (env CAPGO_DRY_RUN=true)
  --skip-preflight     Bypass preflight (escape hatch)      (env CAPGO_SKIP_PREFLIGHT=true)

Config layer:
  --config <path>      JSON config (default ./capgo-update.json)  (env CAPGO_CONFIG)
  --package-json <p>   Override auto-detection              (env CAPGO_PACKAGE_JSON)
  --capacitor-config <p>   Override auto-detection          (env CAPGO_CAPACITOR_CONFIG)

Misc:
  -h, --help           Show this help

Security: prefer CAPGO_ADMIN_TOKEN via env over --admin-token on the CLI.
Tokens on the command line appear in 'ps' listings. If you put "adminToken"
in the config file, make sure that file is gitignored.

Preflight checks (all skippable with --skip-preflight):
  • version is valid semver
  • if package.json found: version >= package.json version
  • if capacitor.config.(ts|js|json) found: appId matches, updateUrl starts with server
  • server is reachable
  • app is registered on the server (requires token)
  • new version is higher than the currently-active bundle on the channel
  • dist-dir contains index.html and no Cloudflare adapter artifacts
  • zip integrity and size bounds (min 1KB, warn 50MB, max 500MB)
`);
}

// --- config layer -----------------------------------------------------------

async function readConfigFile(p: string): Promise<FileConfig> {
    try {
        const raw = await readFile(p, 'utf8');
        return JSON.parse(raw) as FileConfig;
    } catch (e) {
        fail(`failed to read/parse config file ${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function loadConfigFile(explicit: string | undefined): Promise<FileConfig> {
    if (explicit) {
        if (!existsSync(explicit)) fail(`config file not found: ${explicit}`);
        return readConfigFile(explicit);
    }
    for (const name of DEFAULT_CONFIG_FILENAMES) {
        const candidate = path.resolve(process.cwd(), name);
        if (existsSync(candidate)) return readConfigFile(candidate);
    }
    return {};
}

function envStr(name: string): string | undefined {
    const v = process.env[name];
    return v === undefined || v === '' ? undefined : v;
}

function envBool(name: string): boolean | undefined {
    const v = process.env[name];
    if (v === undefined || v === '') return undefined;
    const lower = v.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
    fail(`env ${name}: expected "true" or "false", got "${v}"`);
}

function parsePlatformList(s: string | undefined): Platform[] | undefined {
    if (!s) return undefined;
    const parts = s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    for (const p of parts) {
        if (!PLATFORMS.includes(p as Platform)) fail(`invalid platform "${p}" (expected one of ${PLATFORMS.join(', ')})`);
    }
    return parts as Platform[];
}

function validatePlatformsArray(arr: unknown, source: string): Platform[] | undefined {
    if (arr === undefined) return undefined;
    if (!Array.isArray(arr)) fail(`${source}: "platforms" must be an array`);
    for (const p of arr) {
        if (typeof p !== 'string' || !PLATFORMS.includes(p as Platform)) {
            fail(`${source}: invalid platform "${String(p)}" (expected one of ${PLATFORMS.join(', ')})`);
        }
    }
    return arr as Platform[];
}

async function resolveConfig(): Promise<ResolvedConfig> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            'app-id': { type: 'string' },
            version: { type: 'string' },
            'dist-dir': { type: 'string' },
            'server-url': { type: 'string' },
            'admin-token': { type: 'string' },
            channel: { type: 'string' },
            platforms: { type: 'string' },
            link: { type: 'string' },
            comment: { type: 'string' },
            activate: { type: 'boolean' },
            'no-activate': { type: 'boolean' },
            'dry-run': { type: 'boolean' },
            'skip-preflight': { type: 'boolean' },
            config: { type: 'string' },
            'package-json': { type: 'string' },
            'capacitor-config': { type: 'string' },
            help: { type: 'boolean', short: 'h' }
        }
    });

    if (values.help) {
        printHelp();
        process.exit(0);
    }

    // Config file path itself resolves via CLI > env > default-search
    const configPath = values.config ?? envStr('CAPGO_CONFIG');
    const file = await loadConfigFile(configPath);
    validatePlatformsArray(file.platforms, 'config file');

    const activateCli = values.activate === true ? true : values['no-activate'] === true ? false : undefined;
    const platformsCli = parsePlatformList(values.platforms);
    const platformsEnv = parsePlatformList(envStr('CAPGO_PLATFORMS'));

    // Generic three-route resolution: CLI > env > file > default.
    // Positionals count as CLI for the three that accept them.
    const appId = values['app-id'] ?? positionals[0] ?? envStr('CAPGO_APP_ID') ?? file.appId ?? '';
    const version = values.version ?? positionals[1] ?? envStr('CAPGO_VERSION') ?? file.version ?? '';
    const distDir = values['dist-dir'] ?? positionals[2] ?? envStr('CAPGO_DIST_DIR') ?? file.distDir ?? '';
    const serverUrlRaw = values['server-url'] ?? envStr('CAPGO_SERVER_URL') ?? file.serverUrl ?? '';

    const cfg: ResolvedConfig = {
        appId,
        version,
        distDir,
        serverUrl: serverUrlRaw.replace(/\/+$/, ''),
        adminToken: values['admin-token'] ?? envStr('CAPGO_ADMIN_TOKEN') ?? file.adminToken,
        channel: values.channel ?? envStr('CAPGO_CHANNEL') ?? file.channel ?? DEFAULT_CHANNEL,
        platforms: platformsCli ?? platformsEnv ?? file.platforms,
        link: values.link ?? envStr('CAPGO_LINK') ?? file.link,
        comment: values.comment ?? envStr('CAPGO_COMMENT') ?? file.comment,
        activate: activateCli ?? envBool('CAPGO_ACTIVATE') ?? file.activate ?? true,
        packageJson: values['package-json'] ?? envStr('CAPGO_PACKAGE_JSON') ?? file.packageJson,
        capacitorConfig: values['capacitor-config'] ?? envStr('CAPGO_CAPACITOR_CONFIG') ?? file.capacitorConfig,
        skipPreflight:
            values['skip-preflight'] === true || envBool('CAPGO_SKIP_PREFLIGHT') === true || file.skipPreflight === true,
        dryRun: values['dry-run'] === true || envBool('CAPGO_DRY_RUN') === true || file.dryRun === true
    };

    if (!cfg.appId) {
        printHelp();
        fail('missing app-id (--app-id, positional, CAPGO_APP_ID, or "appId" in config)');
    }
    if (!cfg.version) fail('missing version (--version, positional, CAPGO_VERSION, or "version" in config)');
    if (!cfg.distDir) fail('missing dist-dir (--dist-dir, positional, CAPGO_DIST_DIR, or "distDir" in config)');
    if (!cfg.serverUrl) fail('missing server-url (--server-url, CAPGO_SERVER_URL, or "serverUrl" in config)');
    if (!cfg.adminToken && !cfg.dryRun) {
        fail('missing admin token (--admin-token, CAPGO_ADMIN_TOKEN, or "adminToken" in config — or use --dry-run)');
    }

    return cfg;
}

// --- main flow --------------------------------------------------------------

async function main(): Promise<void> {
    const cfg = await resolveConfig();

    step(`Preflight checks${cfg.dryRun ? ' (dry-run)' : ''}`);
    const target = parseSemver(cfg.version);
    if (!target) fail(`version "${cfg.version}" is not valid semver`);
    ok(`target: ${cfg.appId}@${cfg.version} · channel: ${cfg.channel}`);

    if (cfg.skipPreflight) {
        warn('--skip-preflight set — bypassing preflight checks');
    } else {
        await preflightPackageJson(cfg, target);
        await preflightCapacitorConfig(cfg);
        await preflightServerPing(cfg);
        if (cfg.adminToken) await preflightAppRegistered(cfg, target);
        else warn('no admin token — skipping server-side app/version preflight');
    }

    await validateDist(cfg);

    const zipped = await zipDir(cfg.distDir);
    await verifyZipIntegrity(zipped);
    const checksum = sha256Hex(zipped);
    const sizeMb = (zipped.byteLength / 1024 / 1024).toFixed(2);

    if (zipped.byteLength < MIN_ZIP_BYTES) {
        fail(`zip is suspiciously small (${zipped.byteLength} bytes) — build may be incomplete`);
    }
    if (zipped.byteLength > MAX_ZIP_BYTES) {
        fail(`zip is too large (${sizeMb} MB > ${MAX_ZIP_BYTES / 1024 / 1024} MB)`);
    }
    if (zipped.byteLength > WARN_ZIP_BYTES) {
        warn(`zip is large (${sizeMb} MB) — OTA download will be slow on cellular`);
    }
    ok(`zip: ${sizeMb} MB · sha256: ${checksum.slice(0, 16)}…`);

    if (cfg.dryRun) {
        const initPayload: Record<string, unknown> = {
            app_id: cfg.appId,
            version: cfg.version,
            channel: cfg.channel
        };
        if (cfg.platforms) initPayload.platforms = cfg.platforms;
        if (cfg.link) initPayload.link = cfg.link;
        if (cfg.comment) initPayload.comment = cfg.comment;
        console.log('\n[dry-run] would publish:');
        console.log(`  POST ${cfg.serverUrl}/admin/bundles/init`);
        console.log(`       ${JSON.stringify(initPayload)}`);
        console.log(`  PUT  <presigned R2 url>  (body: ${sizeMb} MB zip)`);
        console.log(`  POST ${cfg.serverUrl}/admin/bundles/commit`);
        console.log(`       ${JSON.stringify({ bundle_id: '<from init>', checksum, activate: cfg.activate })}`);
        console.log(`\n${GREEN}✓${RESET} Dry run OK — all preflight checks passed`);
        return;
    }

    step(`POST ${cfg.serverUrl}/admin/bundles/init`);
    const initPayload: Record<string, unknown> = {
        app_id: cfg.appId,
        version: cfg.version,
        channel: cfg.channel
    };
    if (cfg.platforms) initPayload.platforms = cfg.platforms;
    if (cfg.link) initPayload.link = cfg.link;
    if (cfg.comment) initPayload.comment = cfg.comment;
    const init = await apiJson<InitResponse>(cfg, 'POST', '/admin/bundles/init', initPayload);
    ok(`bundle_id: ${init.bundle_id} · r2_key: ${init.r2_key}`);

    step('PUT presigned R2 upload');
    const putRes = await fetch(init.upload_url, {
        method: 'PUT',
        body: zipped,
        headers: { 'content-type': 'application/zip' }
    });
    if (!putRes.ok) fail(`R2 PUT failed: ${putRes.status} ${await putRes.text()}`);

    step(`POST ${cfg.serverUrl}/admin/bundles/commit`);
    const bundle = await apiJson<BundleRow>(cfg, 'POST', '/admin/bundles/commit', {
        bundle_id: init.bundle_id,
        checksum,
        activate: cfg.activate
    });

    console.log(`\n${GREEN}✓${RESET} Published ${cfg.appId}@${cfg.version} to channel "${bundle.channel}"`);
    ok(`state: ${bundle.state} · active: ${bundle.active} · bundle_id: ${bundle.id}`);
}

// --- preflight --------------------------------------------------------------

async function findFirstExisting(candidates: string[]): Promise<string | null> {
    for (const p of candidates) if (existsSync(p)) return p;
    return null;
}

async function preflightPackageJson(cfg: ResolvedConfig, target: Semver): Promise<void> {
    let p: string | null;
    if (cfg.packageJson) {
        if (!existsSync(cfg.packageJson)) fail(`package.json not found: ${cfg.packageJson}`);
        p = cfg.packageJson;
    } else {
        p = await findFirstExisting([path.resolve(process.cwd(), 'package.json')]);
    }
    if (!p) return;
    try {
        const pkg = JSON.parse(await readFile(p, 'utf8')) as { version?: string };
        if (!pkg.version) return;
        const pkgSv = parseSemver(pkg.version);
        if (!pkgSv) {
            warn(`${path.basename(p)} version "${pkg.version}" is not valid semver — skipping comparison`);
            return;
        }
        const c = cmpSemver(target, pkgSv);
        if (c < 0) {
            fail(
                `version ${cfg.version} is lower than ${path.basename(p)} ${pkg.version} — publishing an older bundle would downgrade clients`
            );
        }
        if (target.major !== pkgSv.major) {
            warn(
                `major version bump vs ${path.basename(p)} (${pkg.version} → ${cfg.version}) — confirm the native binary supports this bundle`
            );
        }
        ok(`${path.basename(p)}: ${pkg.version} · publishing: ${cfg.version}`);
    } catch (e) {
        warn(`could not parse ${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function preflightCapacitorConfig(cfg: ResolvedConfig): Promise<void> {
    let p: string | null;
    if (cfg.capacitorConfig) {
        if (!existsSync(cfg.capacitorConfig)) fail(`capacitor config not found: ${cfg.capacitorConfig}`);
        p = cfg.capacitorConfig;
    } else {
        p = await findFirstExisting([
            path.resolve(process.cwd(), 'capacitor.config.ts'),
            path.resolve(process.cwd(), 'capacitor.config.js'),
            path.resolve(process.cwd(), 'capacitor.config.json')
        ]);
    }
    if (!p) return;
    let raw: string;
    try {
        raw = await readFile(p, 'utf8');
    } catch (e) {
        warn(`could not read ${p}: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    const appId = raw.match(/appId\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    const updateUrl = raw.match(/updateUrl\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    if (!appId) {
        warn(`could not extract appId from ${path.basename(p)}`);
    } else if (appId !== cfg.appId) {
        fail(`${path.basename(p)} appId "${appId}" does not match --app-id "${cfg.appId}"`);
    } else {
        ok(`${path.basename(p)} appId: ${appId}`);
    }
    if (updateUrl && !updateUrl.startsWith(cfg.serverUrl)) {
        warn(
            `${path.basename(p)} CapacitorUpdater.updateUrl "${updateUrl}" does not start with server URL "${cfg.serverUrl}" — clients may check in to a different server`
        );
    }
}

async function preflightServerPing(cfg: ResolvedConfig): Promise<void> {
    try {
        const res = await fetch(`${cfg.serverUrl}/`, { signal: AbortSignal.timeout(PREFLIGHT_PING_TIMEOUT_MS) });
        if (!res.ok) fail(`server ${cfg.serverUrl} returned HTTP ${res.status}`);
    } catch (e) {
        fail(`server ${cfg.serverUrl} unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    ok(`server reachable: ${cfg.serverUrl}`);
}

async function preflightAppRegistered(cfg: ResolvedConfig, target: Semver): Promise<void> {
    const apps = await apiJson<AppRow[]>(cfg, 'GET', '/admin/apps');
    if (!apps.some((a) => a.id === cfg.appId)) {
        fail(`app "${cfg.appId}" is not registered — POST /admin/apps with {id, name} first`);
    }
    const qs = new URLSearchParams({ app_id: cfg.appId, channel: cfg.channel, active: 'true' });
    const activeList = await apiJson<BundleRow[]>(cfg, 'GET', `/admin/bundles?${qs.toString()}`);
    if (activeList.length === 0) {
        ok(`no active bundle on "${cfg.channel}" yet — this will be the first`);
        return;
    }
    const current = activeList[0];
    const currentSv = parseSemver(current.version);
    if (currentSv) {
        const c = cmpSemver(target, currentSv);
        if (c === 0) {
            fail(`version ${cfg.version} is already active on channel "${cfg.channel}" (bundle_id=${current.id})`);
        }
        if (c < 0) {
            fail(`version ${cfg.version} would downgrade active ${current.version} on channel "${cfg.channel}"`);
        }
    }
    ok(`current active on "${cfg.channel}": ${current.version} (bundle_id=${current.id})`);
}

async function validateDist(cfg: ResolvedConfig): Promise<void> {
    const s = await stat(cfg.distDir).catch(() => null);
    if (!s?.isDirectory()) fail(`dist-dir is not a directory: ${cfg.distDir}`);
    try {
        await stat(path.join(cfg.distDir, 'index.html'));
    } catch {
        fail(`${cfg.distDir}/index.html not found — Capacitor bundles must contain index.html at the root`);
    }
    for (const artifact of CLOUDFLARE_ARTIFACTS) {
        try {
            await stat(path.join(cfg.distDir, artifact));
            fail(
                `found Cloudflare adapter artifact "${artifact}" in ${cfg.distDir} — looks like a web build, not a Capacitor build`
            );
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
    }
}

// --- zip --------------------------------------------------------------------

async function collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) out.push(full);
        }
    }
    await walk(root);
    return out;
}

async function zipDir(root: string): Promise<Uint8Array> {
    const files = await collectFiles(root);
    if (files.length === 0) fail(`no files found under: ${root}`);
    step(`Zipping ${root} (${files.length} files)`);
    const zip = new JSZip();
    for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        zip.file(rel, await readFile(file));
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function verifyZipIntegrity(bytes: Uint8Array): Promise<void> {
    try {
        await new JSZip().loadAsync(bytes);
    } catch (e) {
        fail(`zip integrity check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

// --- api --------------------------------------------------------------------

async function apiJson<T>(cfg: ResolvedConfig, method: string, p: string, body?: unknown): Promise<T> {
    const res = await fetch(`${cfg.serverUrl}${p}`, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(cfg.adminToken ? { authorization: `Bearer ${cfg.adminToken}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) fail(`${method} ${p} → ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

void main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
