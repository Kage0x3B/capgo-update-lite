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
import {
    collectNativePackages,
    fingerprintDiff,
    readAndroidVersionName,
    resolveIosShortVersion,
    sameNativeFingerprint,
    type IosVersionResult
} from './native.js';
import { fail, kv, ok, warn } from './output.js';
import { confirmBump, isInteractive, selectBumpLevel } from './prompt.js';
import { checkServerVersion, compatWarningMessage } from './server-version.js';
import { bumpVersion, writePackageJsonVersion, type BumpLevel } from './version-bump.js';
import { collectFiles } from './zip.js';

const PREFLIGHT_PING_TIMEOUT_MS = 5000;
const CLOUDFLARE_ARTIFACTS = ['_worker.js', '_routes.json'];
const NOTIFY_APP_READY_DOC = 'https://capgo.app/docs/plugin/api/#notifyappready';

export type RegisteredCheck = 'ok' | 'exists-active';

export type AutoresolveOutcome =
    | { kind: 'explicit'; version: string }
    | { kind: 'fromPackageJson'; version: string; pkgPath: string }
    | { kind: 'bumped'; version: string; previous: string; level: BumpLevel; pkgPath: string };

/**
 * Resolves cfg.version when it wasn't passed explicitly, then ensures the
 * resolved value won't conflict with the active bundle on cfg.channel:
 *
 *   - newer than active   ⇒ keep, publish.
 *   - equal to active     ⇒ prompt the user to bump patch/minor/major and
 *                            write the bumped version back to package.json.
 *   - older than active   ⇒ fail (we'd downgrade clients).
 *   - no active bundle    ⇒ keep (first publish on this channel).
 *
 * The bump-prompt path requires a TTY plus an admin token. In headless mode
 * we surface the conflict as a hard fail rather than guess at the user's
 * intent — CI scripts can pre-bump package.json or pass --version.
 */
export async function preflightVersionAutoresolve(cfg: ResolvedConfig): Promise<AutoresolveOutcome> {
    let outcome: AutoresolveOutcome;
    if (cfg.version) {
        if (!parseSemver(cfg.version)) fail(`version "${cfg.version}" is not valid semver`);
        outcome = { kind: 'explicit', version: cfg.version };
    } else {
        const pkgPath = resolvePackageJsonPath(cfg);
        if (!pkgPath) {
            fail('missing version: no --version, env, config entry, or package.json with a "version" field found');
        }
        const pkgVersion = await readPackageJsonVersion(pkgPath);
        if (!pkgVersion) {
            fail(`${pkgPath} has no top-level "version" field — pass --version explicitly`);
        }
        if (!parseSemver(pkgVersion)) {
            fail(`${path.basename(pkgPath)} version "${pkgVersion}" is not valid semver`);
        }
        cfg.version = pkgVersion;
        outcome = { kind: 'fromPackageJson', version: pkgVersion, pkgPath };
        kv('version sourced from', `${path.relative(process.cwd(), pkgPath) || pkgPath} → ${pkgVersion}`);
    }

    // Without an admin token we can't reach /admin/bundles to compare. Skip
    // the autoresolve check; the regular preflight will surface auth issues.
    if (!cfg.adminToken) return outcome;

    const active = await fetchLastActiveBundle(cfg);
    if (!active) {
        ok(`no active bundle on "${cfg.channel}" yet — ${cfg.version} will be the first`);
        return outcome;
    }
    const targetSv = parseSemver(cfg.version!)!;
    const activeSv = parseSemver(active.version);
    if (!activeSv) {
        warn(`active bundle version "${active.version}" is not valid semver — skipping autoresolve compare`);
        return outcome;
    }

    const cmp = cmpSemver(targetSv, activeSv);
    if (cmp > 0) {
        ok(`active on "${cfg.channel}": ${active.version} · publishing: ${cfg.version}`);
        return outcome;
    }
    if (cmp < 0) {
        fail(
            `version ${cfg.version} would downgrade active ${active.version} on channel "${cfg.channel}" — bump package.json or pass --version`
        );
    }

    // Equal versions. If --version-exists-ok is set, fall through and let
    // preflightAppRegistered take its early-exit path so CI scripts get the
    // same idempotent "skip if already published" behavior they had before.
    if (cfg.versionExistsOk) return outcome;

    // If the user passed --version explicitly, treat as a hard error — they
    // had every chance to set the right value. The bump prompt is only
    // offered when we sourced from package.json.
    if (outcome.kind === 'explicit') {
        fail(
            `version ${cfg.version} is already active on channel "${cfg.channel}" (bundle_id=${active.id}) — pass a higher --version`
        );
    }
    if (!isInteractive()) {
        fail(
            `version ${cfg.version} is already active on channel "${cfg.channel}" — bump package.json or pass --version (non-interactive: cannot prompt)`
        );
    }

    const level = await selectBumpLevel(cfg.version!, cfg.channel);
    if (!level) fail('aborted by user');
    const bumped = bumpVersion(cfg.version!, level);
    const confirmed = await confirmBump(cfg.version!, bumped);
    if (!confirmed) fail('aborted by user');

    const { previous } = await writePackageJsonVersion(outcome.pkgPath, bumped);
    ok(`updated ${path.basename(outcome.pkgPath)}: ${previous} → ${bumped}`);
    cfg.version = bumped;
    return { kind: 'bumped', version: bumped, previous, level, pkgPath: outcome.pkgPath };
}

async function readPackageJsonVersion(pkgPath: string): Promise<string | null> {
    try {
        const parsed = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: unknown };
        return typeof parsed.version === 'string' ? parsed.version : null;
    } catch (e) {
        fail(`could not parse ${pkgPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

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
    if (updateUrl && cfg.serverUrl) {
        // Plugin POSTs to <updateUrl> as an absolute URL — the only valid value
        // is `${serverUrl}/updates` (with or without a trailing slash). A bare
        // serverUrl, or some other path, will hit a 404 and the device rolls
        // back. Catch the misconfiguration here.
        const expected = `${cfg.serverUrl}/updates`;
        const normalized = updateUrl.replace(/\/+$/, '');
        if (normalized !== expected) {
            warn(
                `${path.basename(p)} CapacitorUpdater.updateUrl "${updateUrl}" should be "${expected}" — clients posting to a different path will not receive updates`
            );
        }
    }
}

export async function preflightServerPing(serverUrl: string): Promise<void> {
    // Hit /health rather than /. The root URL serves a static HTML index that
    // 200s no matter what — useless for catching a broken DB or R2 binding.
    // /health probes both dependencies and 503s when degraded.
    let res: Response;
    try {
        res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(PREFLIGHT_PING_TIMEOUT_MS) });
    } catch (e) {
        fail(`server ${serverUrl} unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    type HealthBody = {
        version?: unknown;
        checks?: Array<{ name: string; ok: boolean; error?: string }>;
    };
    let body: HealthBody | null = null;
    try {
        body = (await res.clone().json()) as HealthBody;
    } catch {
        // non-JSON response — handle status-only path below
    }
    if (!res.ok) {
        let detail = '';
        const failed = body?.checks?.filter((c) => !c.ok) ?? [];
        if (failed.length > 0) {
            detail = ` (${failed.map((c) => `${c.name}: ${c.error ?? 'failed'}`).join(', ')})`;
        }
        fail(`server ${serverUrl} health check returned HTTP ${res.status}${detail}`);
    }
    const serverVersion = typeof body?.version === 'string' ? body.version : null;
    const compat = checkServerVersion(serverVersion);
    const versionLabel = serverVersion ?? '(unreported)';
    if (compat.status === 'ok') {
        ok(`server reachable: ${serverUrl} · v${versionLabel}`);
    } else {
        ok(`server reachable: ${serverUrl} · v${versionLabel}`);
        const msg = compatWarningMessage(compat);
        if (msg) warn(msg);
    }
}

/**
 * Confirms the app is registered and the target version doesn't collide / downgrade.
 * Returns 'exists-active' when cfg.version is already live on cfg.channel AND
 * cfg.versionExistsOk is true — lets the publish action short-circuit with exit 0.
 *
 * Also surfaces the app's compatibility policy (disable-auto-update ceiling,
 * minPluginVersion floor) so the operator sees what their devices need to run
 * before they ship the bundle.
 */
export async function preflightAppRegistered(cfg: ResolvedConfig, target: Semver): Promise<RegisteredCheck> {
    const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };
    const apps = await apiJson<AppRow[]>(ctx, 'GET', '/admin/apps');
    const app = apps.find((a) => a.id === cfg.appId);
    if (!app) {
        fail(`app "${cfg.appId}" is not registered — run \`capgo-update apps add ${cfg.appId} --name "..."\` first`);
    }
    const policyParts: string[] = [`ceiling=${app.disableAutoUpdate}`];
    if (app.disableAutoUpdateUnderNative) policyParts.push('under-native=on');
    if (app.minPluginVersion) policyParts.push(`min-plugin=${app.minPluginVersion}`);
    if (policyParts.length > 1 || app.disableAutoUpdate !== 'none') {
        ok(`policy for ${app.id}: ${policyParts.join(', ')}`);
    }
    if (app.minPluginVersion) {
        warn(
            `${app.id} requires @capgo/capacitor-updater >= ${app.minPluginVersion} — devices on older plugin versions won't receive this bundle`
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
    let iosResolution: IosVersionResult | null = null;
    if (!explicitAndroid || !explicitIos || cfg.autoMinUpdateBuild) {
        const androidRoot = path.resolve(process.cwd(), cfg.androidProject);
        const iosRoot = path.resolve(process.cwd(), cfg.iosProject);
        detectedAndroid = await readAndroidVersionName(androidRoot);
        iosResolution = await resolveIosShortVersion(iosRoot);
        if (detectedAndroid) kv('android versionName', `${detectedAndroid} (${cfg.androidProject})`);
        if (iosResolution?.ok) {
            detectedIos = iosResolution.version;
            const layers = iosResolution.trace.map((t) => t.layer);
            const via = layers.length > 1 ? ` via ${layers.join(' → ')}` : '';
            kv('ios CFBundleShortVersionString', `${iosResolution.version} (${cfg.iosProject})${via}`);
        }
    }

    if (cfg.autoMinUpdateBuild) {
        if (!cfg.adminToken) {
            fail('--auto-min-update-build needs an admin token to fetch the previous bundle');
        }
        const prev = await fetchLastActiveBundle(cfg);
        if (!prev) {
            ok('no previous bundle on this channel — using detected native versions as min builds');
            explicitAndroid = explicitAndroid ?? requireDetected(detectedAndroid, 'android');
            explicitIos = explicitIos ?? requireIosDetected(detectedIos, iosResolution);
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
                explicitIos = explicitIos ?? requireIosDetected(detectedIos, iosResolution);
            }
        }
    } else {
        explicitAndroid = explicitAndroid ?? requireDetected(detectedAndroid, 'android');
        explicitIos = explicitIos ?? requireIosDetected(detectedIos, iosResolution);
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
        fail(
            `detected native ${platform} version "${value}" is not valid semver — pass --min-${platform}-build explicitly`
        );
    }
    return value;
}

function requireIosDetected(value: string | null, resolution: IosVersionResult | null): string {
    // If we have a resolution that failed, surface the trace so the user knows
    // exactly which layers were tried. Generic "not valid semver" sends users
    // to GitHub issues; explicit traces let them fix it locally.
    if (resolution && !resolution.ok) {
        const traceLines = resolution.trace.map((t) => `    ${t.layer.padEnd(11)} ${t.detail}`).join('\n');
        fail(
            `could not resolve iOS CFBundleShortVersionString to a literal — got "${resolution.partial}"\n` +
                `  reason: ${resolution.reason}\n` +
                `  layers tried:\n${traceLines}\n` +
                `  fix one of:\n` +
                `    • set the missing variable(s) in ios/App/App.xcodeproj/project.pbxproj\n` +
                `    • replace $(VAR) in Info.plist with a literal version\n` +
                `    • pass --min-ios-build <version> explicitly to bypass detection`
        );
    }
    return requireDetected(value, 'ios');
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
