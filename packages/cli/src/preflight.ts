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
import { fail, ok, warn } from './output.js';
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
