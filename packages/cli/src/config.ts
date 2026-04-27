/**
 * Single source of truth for configuration resolution.
 *
 * Precedence (highest → lowest):
 *   1. CLI flags
 *   2. Environment variables (CAPGO_*)
 *   3. JSON config file (./capgo-update.config.json by default, or --config <path>)
 *   4. Built-in defaults (channel=production, activate=true, codeCheck=true)
 *
 * Each subcommand passes a `requires` list so the shared validator can fail
 * fast with a clear message when something mandatory is missing.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { PLATFORMS, type Platform } from './api.js';
import { readAppIdFromCapacitorConfig } from './capacitor-config.js';
import { fail } from './output.js';

export type FileConfig = {
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
    codeCheck?: boolean;
    minAndroidBuild?: string;
    minIosBuild?: string;
    autoMinUpdateBuild?: boolean;
    androidProject?: string;
    iosProject?: string;
    sessionKey?: string;
};

export type ResolvedConfig = {
    appId: string | undefined;
    version: string | undefined;
    distDir: string | undefined;
    serverUrl: string | undefined;
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
    codeCheck: boolean;
    versionExistsOk: boolean;
    minAndroidBuild: string | undefined;
    minIosBuild: string | undefined;
    autoMinUpdateBuild: boolean;
    androidProject: string;
    iosProject: string;
    sessionKey: string | undefined;
    // Populated by preflightNativeBuild; serialised into the /admin/bundles/init body.
    nativePackages: Record<string, string> | undefined;
};

export type Requirement = 'serverUrl' | 'adminToken' | 'appId' | 'version' | 'distDir';

const DEFAULT_CHANNEL = 'production';
const DEFAULT_CONFIG_FILENAMES = ['capgo-update.config.json'];

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
    if (parts.length === 0) {
        fail(`--platforms must list at least one of ${PLATFORMS.join(', ')}`);
    }
    for (const p of parts) {
        if (!PLATFORMS.includes(p as Platform)) {
            fail(`invalid platform "${p}" (expected one of ${PLATFORMS.join(', ')})`);
        }
    }
    return parts as Platform[];
}

function validatePlatformsArray(arr: unknown, source: string): Platform[] | undefined {
    if (arr === undefined) return undefined;
    if (!Array.isArray(arr)) fail(`${source}: "platforms" must be an array`);
    if (arr.length === 0) fail(`${source}: "platforms" must list at least one of ${PLATFORMS.join(', ')}`);
    for (const p of arr) {
        if (typeof p !== 'string' || !PLATFORMS.includes(p as Platform)) {
            fail(`${source}: invalid platform "${String(p)}" (expected one of ${PLATFORMS.join(', ')})`);
        }
    }
    return arr as Platform[];
}

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

function optStr(opts: Record<string, unknown>, key: string): string | undefined {
    const v = opts[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function resolveConfig(cmd: Command, requires: readonly Requirement[] = []): Promise<ResolvedConfig> {
    const opts = cmd.optsWithGlobals() as Record<string, unknown>;
    const configPath = optStr(opts, 'config') ?? envStr('CAPGO_CONFIG');
    const file = await loadConfigFile(configPath);
    validatePlatformsArray(file.platforms, 'config file');

    const activateCli = opts.activate === true ? true : opts.activate === false ? false : undefined;
    const platformsCli = parsePlatformList(optStr(opts, 'platforms'));
    const platformsEnv = parsePlatformList(envStr('CAPGO_PLATFORMS'));
    const serverRaw = optStr(opts, 'serverUrl') ?? envStr('CAPGO_SERVER_URL') ?? file.serverUrl ?? '';
    const serverClean = serverRaw.replace(/\/+$/, '');

    const cfg: ResolvedConfig = {
        appId: optStr(opts, 'appId') ?? envStr('CAPGO_APP_ID') ?? file.appId,
        version: optStr(opts, 'version') ?? envStr('CAPGO_VERSION') ?? file.version,
        distDir: optStr(opts, 'distDir') ?? envStr('CAPGO_DIST_DIR') ?? file.distDir,
        serverUrl: serverClean || undefined,
        adminToken: optStr(opts, 'adminToken') ?? envStr('CAPGO_ADMIN_TOKEN') ?? file.adminToken,
        channel: optStr(opts, 'channel') ?? envStr('CAPGO_CHANNEL') ?? file.channel ?? DEFAULT_CHANNEL,
        platforms: platformsCli ?? platformsEnv ?? file.platforms,
        link: optStr(opts, 'link') ?? envStr('CAPGO_LINK') ?? file.link,
        comment: optStr(opts, 'comment') ?? envStr('CAPGO_COMMENT') ?? file.comment,
        activate: activateCli ?? envBool('CAPGO_ACTIVATE') ?? file.activate ?? true,
        packageJson: optStr(opts, 'packageJson') ?? envStr('CAPGO_PACKAGE_JSON') ?? file.packageJson,
        capacitorConfig: optStr(opts, 'capacitorConfig') ?? envStr('CAPGO_CAPACITOR_CONFIG') ?? file.capacitorConfig,
        skipPreflight: opts.skipPreflight === true || envBool('CAPGO_SKIP_PREFLIGHT') === true || file.skipPreflight === true,
        dryRun: opts.dryRun === true || envBool('CAPGO_DRY_RUN') === true || file.dryRun === true,
        // commander's --no-code-check sets opts.codeCheck = false; default true.
        codeCheck: opts.codeCheck === false ? false : file.codeCheck !== false,
        versionExistsOk: opts.versionExistsOk === true,
        minAndroidBuild: optStr(opts, 'minAndroidBuild') ?? envStr('CAPGO_MIN_ANDROID_BUILD') ?? file.minAndroidBuild,
        minIosBuild: optStr(opts, 'minIosBuild') ?? envStr('CAPGO_MIN_IOS_BUILD') ?? file.minIosBuild,
        autoMinUpdateBuild:
            opts.autoMinUpdateBuild === true ||
            envBool('CAPGO_AUTO_MIN_UPDATE_BUILD') === true ||
            file.autoMinUpdateBuild === true,
        androidProject:
            optStr(opts, 'androidProject') ?? envStr('CAPGO_ANDROID_PROJECT') ?? file.androidProject ?? './android',
        iosProject: optStr(opts, 'iosProject') ?? envStr('CAPGO_IOS_PROJECT') ?? file.iosProject ?? './ios',
        sessionKey: optStr(opts, 'sessionKey') ?? envStr('CAPGO_SESSION_KEY') ?? file.sessionKey,
        nativePackages: undefined
    };

    for (const req of requires) {
        if (req === 'appId' && !cfg.appId) fail('missing app-id (--app-id, positional, CAPGO_APP_ID, or "appId" in config)');
        if (req === 'version' && !cfg.version) fail('missing version (--version, positional, CAPGO_VERSION, or "version" in config)');
        if (req === 'distDir' && !cfg.distDir) fail('missing dist-dir (--dist-dir, positional, CAPGO_DIST_DIR, or "distDir" in config)');
        if (req === 'serverUrl' && !cfg.serverUrl) fail('missing server-url (--server-url, CAPGO_SERVER_URL, or "serverUrl" in config)');
        if (req === 'adminToken' && !cfg.adminToken) fail('missing admin token (--admin-token, CAPGO_ADMIN_TOKEN, or "adminToken" in config)');
    }

    return cfg;
}

export type CompletionConfig = {
    serverUrl?: string;
    adminToken?: string;
    appId?: string;
    channel?: string;
};

/**
 * Slim, never-throwing config resolver for the shell-completion path.
 *
 * `resolveConfig` reads parsed CLI flags via `cmd.optsWithGlobals()`, but at
 * TAB time the user is mid-typing — there's no parsed Command. Worse, the
 * existing `loadConfigFile` calls `fail()` (which `process.exit`s) on a
 * missing/unreadable file, which would silently kill the user's shell prompt.
 * This helper walks env → JSON config file → capacitor.config.* and returns
 * `{}` on any failure. Completion handlers fall back to "no completions"
 * when fields are missing.
 */
export async function loadCompletionConfig(): Promise<CompletionConfig> {
    const file = await tryLoadConfigFile(envStr('CAPGO_CONFIG'));
    let detectedAppId: string | undefined;
    try {
        const detected = await readAppIdFromCapacitorConfig();
        detectedAppId = detected?.appId;
    } catch {
        detectedAppId = undefined;
    }
    const serverRaw = envStr('CAPGO_SERVER_URL') ?? file.serverUrl;
    return {
        serverUrl: serverRaw?.replace(/\/+$/, '') || undefined,
        adminToken: envStr('CAPGO_ADMIN_TOKEN') ?? file.adminToken,
        appId: envStr('CAPGO_APP_ID') ?? file.appId ?? detectedAppId,
        channel: envStr('CAPGO_CHANNEL') ?? file.channel
    };
}

/** Like `loadConfigFile`, but never calls `fail()`. */
async function tryLoadConfigFile(explicit: string | undefined): Promise<FileConfig> {
    const candidates = explicit
        ? [explicit]
        : DEFAULT_CONFIG_FILENAMES.map((name) => path.resolve(process.cwd(), name));
    for (const candidate of candidates) {
        if (!existsSync(candidate)) continue;
        try {
            const raw = await readFile(candidate, 'utf8');
            return JSON.parse(raw) as FileConfig;
        } catch {
            return {};
        }
    }
    return {};
}
