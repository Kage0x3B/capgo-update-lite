/**
 * Publish-time preflight checks. Each function assumes the caller has already
 * populated the required ResolvedConfig fields.
 */

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { apiJson, type AppRow, type BundleRow } from './api.js';
import type { ResolvedConfig } from './config.js';
import { cmpSemver, parseSemver, type Semver } from './semver.js';
import { collectNativePackages, fingerprintDiff, readAndroidVersionName, readIosShortVersion, sameNativeFingerprint } from './native.js';
import { fail, kv, ok, warn } from './output.js';
import { collectFiles } from './zip.js';

const PREFLIGHT_PING_TIMEOUT_MS = 5000;
const CLOUDFLARE_ARTIFACTS = ['_worker.js', '_routes.json'];
const NOTIFY_APP_READY_DOC = 'https://capgo.app/docs/plugin/api/#notifyappready';

export type RegisteredCheck = 'ok' | 'exists-active';

export async function preflightPackageJson(cfg: ResolvedConfig, target: Semver): Promise<void> {
    let p: string | null;
    if (cfg.packageJson) {
        if (!existsSync(cfg.packageJson)) fail(`package.json not found: ${cfg.packageJson}`);
        p = cfg.packageJson;
    } else {
        const candidate = path.resolve(process.cwd(), 'package.json');
        p = existsSync(candidate) ? candidate : null;
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

export async function preflightCapacitorConfig(cfg: ResolvedConfig): Promise<void> {
    let p: string | null;
    if (cfg.capacitorConfig) {
        if (!existsSync(cfg.capacitorConfig)) fail(`capacitor config not found: ${cfg.capacitorConfig}`);
        p = cfg.capacitorConfig;
    } else {
        const candidates = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'].map((f) =>
            path.resolve(process.cwd(), f)
        );
        p = candidates.find((c) => existsSync(c)) ?? null;
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
    if (updateUrl && cfg.serverUrl && !updateUrl.startsWith(cfg.serverUrl)) {
        warn(
            `${path.basename(p)} CapacitorUpdater.updateUrl "${updateUrl}" does not start with server URL "${cfg.serverUrl}" — clients may check in to a different server`
        );
    }
}

export async function preflightServerPing(serverUrl: string): Promise<void> {
    try {
        const res = await fetch(`${serverUrl}/`, { signal: AbortSignal.timeout(PREFLIGHT_PING_TIMEOUT_MS) });
        if (!res.ok) fail(`server ${serverUrl} returned HTTP ${res.status}`);
    } catch (e) {
        fail(`server ${serverUrl} unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    ok(`server reachable: ${serverUrl}`);
}

/**
 * Confirms the app is registered and the target version doesn't collide / downgrade.
 * Returns 'exists-active' when cfg.version is already live on cfg.channel AND
 * cfg.versionExistsOk is true — lets the publish action short-circuit with exit 0.
 */
export async function preflightAppRegistered(cfg: ResolvedConfig, target: Semver): Promise<RegisteredCheck> {
    const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };
    const apps = await apiJson<AppRow[]>(ctx, 'GET', '/admin/apps');
    if (!apps.some((a) => a.id === cfg.appId)) {
        fail(
            `app "${cfg.appId}" is not registered — run \`capgo-update apps add ${cfg.appId} --name "..."\` first`
        );
    }
    const qs = new URLSearchParams({ app_id: cfg.appId!, channel: cfg.channel, active: 'true' });
    const activeList = await apiJson<BundleRow[]>(ctx, 'GET', `/admin/bundles?${qs.toString()}`);
    if (activeList.length === 0) {
        ok(`no active bundle on "${cfg.channel}" yet — this will be the first`);
        return 'ok';
    }
    const current = activeList[0];
    const currentSv = parseSemver(current.version);
    if (currentSv) {
        const c = cmpSemver(target, currentSv);
        if (c === 0) {
            if (cfg.versionExistsOk) {
                warn(
                    `version ${cfg.version} is already active on "${cfg.channel}" (bundle_id=${current.id}) — exiting 0 per --version-exists-ok`
                );
                return 'exists-active';
            }
            fail(`version ${cfg.version} is already active on channel "${cfg.channel}" (bundle_id=${current.id})`);
        }
        if (c < 0) {
            fail(`version ${cfg.version} would downgrade active ${current.version} on channel "${cfg.channel}"`);
        }
    }
    ok(`current active on "${cfg.channel}": ${current.version} (bundle_id=${current.id})`);
    return 'ok';
}

/**
 * Resolves cfg.minAndroidBuild, cfg.minIosBuild, and cfg.nativePackages.
 *
 * Order of operations:
 *   1. If both min-*-build flags are explicit, validate them as semver and stop.
 *   2. Otherwise read native versions off the Android / iOS project directories
 *      and use those as defaults.
 *   3. Collect the native-package fingerprint from package.json.
 *   4. If --auto-min-update-build is set, compare the fingerprint against the
 *      previously-active bundle on (appId, channel). Unchanged fingerprint +
 *      previous bundle ⇒ inherit its min builds. Changed fingerprint ⇒ bump to
 *      the detected native versions and log what changed.
 *
 * Mutates `cfg` in place. Fails loudly when a required value can't be resolved.
 */
export async function preflightNativeBuild(cfg: ResolvedConfig): Promise<void> {
    const pkgPath = resolvePackageJsonPath(cfg);
    const currentNativePkgs = pkgPath ? await collectNativePackages(pkgPath) : {};
    cfg.nativePackages = currentNativePkgs;

    let explicitAndroid = cfg.minAndroidBuild;
    let explicitIos = cfg.minIosBuild;

    if (explicitAndroid) {
        if (!parseSemver(explicitAndroid)) fail(`--min-android-build "${explicitAndroid}" is not valid semver`);
    }
    if (explicitIos) {
        if (!parseSemver(explicitIos)) fail(`--min-ios-build "${explicitIos}" is not valid semver`);
    }

    // Auto-detect from native projects when either flag is missing, or when
    // --auto-min-update-build is on (we need the current native versions to
    // know what to bump min_*_build to if the fingerprint changed).
    let detectedAndroid: string | null = null;
    let detectedIos: string | null = null;
    if (!explicitAndroid || !explicitIos || cfg.autoMinUpdateBuild) {
        const androidRoot = path.resolve(process.cwd(), cfg.androidProject);
        const iosRoot = path.resolve(process.cwd(), cfg.iosProject);
        detectedAndroid = await readAndroidVersionName(androidRoot);
        detectedIos = await readIosShortVersion(iosRoot);
        if (detectedAndroid) kv('android versionName', `${detectedAndroid} (${cfg.androidProject})`);
        if (detectedIos) kv('ios CFBundleShortVersionString', `${detectedIos} (${cfg.iosProject})`);
    }

    if (cfg.autoMinUpdateBuild) {
        if (!cfg.adminToken) {
            fail('--auto-min-update-build needs an admin token to fetch the previous bundle');
        }
        const prev = await fetchLastActiveBundle(cfg);
        if (!prev) {
            ok('no previous bundle on this channel — using detected native versions as min builds');
            explicitAndroid = explicitAndroid ?? requireDetected(detectedAndroid, 'android');
            explicitIos = explicitIos ?? requireDetected(detectedIos, 'ios');
        } else {
            const diff = fingerprintDiff(prev.nativePackages ?? {}, currentNativePkgs);
            const changed = !sameNativeFingerprint(prev.nativePackages ?? {}, currentNativePkgs);
            if (!changed) {
                ok(`native deps unchanged vs bundle #${prev.id} — inheriting min builds`);
                explicitAndroid = explicitAndroid ?? prev.minAndroidBuild;
                explicitIos = explicitIos ?? prev.minIosBuild;
            } else {
                const msgParts: string[] = [];
                if (diff.added.length) msgParts.push(`+${diff.added.join(', ')}`);
                if (diff.removed.length) msgParts.push(`-${diff.removed.join(', ')}`);
                if (diff.changed.length) msgParts.push(`~${diff.changed.join(', ')}`);
                warn(`native deps changed vs bundle #${prev.id}: ${msgParts.join(' · ')}`);
                explicitAndroid = explicitAndroid ?? requireDetected(detectedAndroid, 'android');
                explicitIos = explicitIos ?? requireDetected(detectedIos, 'ios');
            }
        }
    } else {
        explicitAndroid = explicitAndroid ?? requireDetected(detectedAndroid, 'android');
        explicitIos = explicitIos ?? requireDetected(detectedIos, 'ios');
    }

    cfg.minAndroidBuild = explicitAndroid;
    cfg.minIosBuild = explicitIos;
    ok(`min_android_build: ${cfg.minAndroidBuild} · min_ios_build: ${cfg.minIosBuild}`);
    const pkgCount = Object.keys(currentNativePkgs).length;
    ok(`native packages: ${pkgCount === 0 ? '(none)' : `${pkgCount} tracked`}`);
}

function requireDetected(value: string | null, platform: 'android' | 'ios'): string {
    if (!value) {
        fail(
            `could not detect native ${platform} version — pass --min-${platform}-build, set CAPGO_MIN_${platform.toUpperCase()}_BUILD, or point --${platform}-project at the native project root`
        );
    }
    if (!parseSemver(value)) {
        fail(`detected native ${platform} version "${value}" is not valid semver — pass --min-${platform}-build explicitly`);
    }
    return value;
}

function resolvePackageJsonPath(cfg: ResolvedConfig): string | null {
    if (cfg.packageJson) {
        return existsSync(cfg.packageJson) ? cfg.packageJson : null;
    }
    const cwdPkg = path.resolve(process.cwd(), 'package.json');
    return existsSync(cwdPkg) ? cwdPkg : null;
}

async function fetchLastActiveBundle(cfg: ResolvedConfig): Promise<BundleRow | null> {
    const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };
    const qs = new URLSearchParams({ app_id: cfg.appId!, channel: cfg.channel, active: 'true' });
    const list = await apiJson<BundleRow[]>(ctx, 'GET', `/admin/bundles?${qs.toString()}`);
    return list[0] ?? null;
}

export async function validateDist(cfg: ResolvedConfig): Promise<void> {
    const distDir = cfg.distDir!;
    const s = await stat(distDir).catch(() => null);
    if (!s?.isDirectory()) fail(`dist-dir is not a directory: ${distDir}`);
    try {
        await stat(path.join(distDir, 'index.html'));
    } catch {
        fail(`${distDir}/index.html not found — Capacitor bundles must contain index.html at the root`);
    }
    for (const artifact of CLOUDFLARE_ARTIFACTS) {
        try {
            await stat(path.join(distDir, artifact));
            fail(
                `found Cloudflare adapter artifact "${artifact}" in ${distDir} — looks like a web build, not a Capacitor build`
            );
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
    }
    if (cfg.codeCheck) {
        await notifyAppReadyCheck(distDir);
    } else {
        warn('--no-code-check set — skipping notifyAppReady() source scan');
    }
}

async function notifyAppReadyCheck(distDir: string): Promise<void> {
    const files = await collectFiles(distDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    if (jsFiles.length === 0) {
        warn(`no .js files found under ${distDir} — skipping notifyAppReady() check`);
        return;
    }
    for (const file of jsFiles) {
        const content = await readFile(file, 'utf8');
        if (content.includes('notifyAppReady')) {
            ok(`notifyAppReady() found in ${path.relative(distDir, file)}`);
            return;
        }
    }
    fail(
        `notifyAppReady() not found in any .js file under ${distDir}. Without it, the plugin rolls back after 10s. See ${NOTIFY_APP_READY_DOC}. Pass --no-code-check to skip.`
    );
}
