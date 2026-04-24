/**
 * `publish`: zip <dist-dir> → /admin/bundles/init → PUT R2 → /admin/bundles/commit.
 *
 * All three positionals are interchangeable with flags / env / config file —
 * the user picks the route that suits the environment.
 */

import type { Command } from 'commander';
import { apiCall, apiJson, type BundleInitResponse, type BundleRow } from '../api.js';
import { resolveConfig } from '../config.js';
import { done, fail, kv, ok, step, warn } from '../output.js';
import {
    preflightAppRegistered,
    preflightCapacitorConfig,
    preflightNativeBuild,
    preflightPackageJson,
    preflightServerPing,
    validateDist
} from '../preflight.js';
import { parseSemver } from '../semver.js';
import { sha256Hex, verifyZipIntegrity, zipDir } from '../zip.js';

const MIN_ZIP_BYTES = 1024;
const WARN_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;

export function registerPublish(program: Command): void {
    program
        .command('publish')
        .description('Zip a dist directory and publish it as a new OTA bundle.')
        .argument('[app-id]', 'Reverse-domain app identifier (e.g. com.example.app)')
        .argument('[version]', 'Semver string for the bundle (e.g. 1.4.2)')
        .argument('[dist-dir]', 'Path to built web bundle (must contain index.html)')
        .option('--app-id <id>', 'Override positional <app-id>')
        .option(
            '--bundle-version <semver>',
            'Override positional <version>. Named to avoid collision with the root --version flag.'
        )
        .option('--dist-dir <path>', 'Override positional <dist-dir>')
        .option('-c, --channel <name>', 'Release channel (default: production)')
        .option('-p, --platforms <list>', 'Comma-separated: ios,android,electron')
        .option('--link <url>', 'Release notes / changelog URL')
        .option('--comment <text>', 'Operator-authored note')
        .option('--activate', 'Activate on commit (default)')
        .option('--no-activate', 'Upload but leave active=false')
        .option('--dry-run', 'Run preflight + zip; skip writes')
        .option('--skip-preflight', 'Bypass preflight checks (escape hatch)')
        .option('--no-code-check', 'Skip notifyAppReady() source scan')
        .option('--version-exists-ok', 'Exit 0 if the version is already published (CI-friendly)')
        .option('--package-json <path>', 'Override auto-detection of package.json')
        .option('--capacitor-config <path>', 'Override auto-detection of capacitor.config')
        .option('--min-android-build <semver>', 'Minimum native Android versionName required by this bundle')
        .option('--min-ios-build <semver>', 'Minimum native iOS CFBundleShortVersionString required by this bundle')
        .option(
            '--auto-min-update-build',
            'Inherit min builds from the previously-active bundle if native deps unchanged; bump to detected native versions if they changed'
        )
        .option('--android-project <path>', 'Path to Android project root (default: ./android)')
        .option('--ios-project <path>', 'Path to iOS project root (default: ./ios)')
        .action(async function action(
            this: Command,
            appIdArg: string | undefined,
            versionArg: string | undefined,
            distDirArg: string | undefined
        ): Promise<void> {
            // Positionals feed the same opts bag resolveConfig reads from — one
            // source of truth keeps the CLI > env > file > default ladder intact.
            const opts = this.opts<Record<string, unknown>>();
            if (appIdArg && !opts.appId) opts.appId = appIdArg;
            if (versionArg && !opts.version) opts.version = versionArg;
            if (distDirArg && !opts.distDir) opts.distDir = distDirArg;
            // --version collides with the root CLI's built-in version flag (commander parses it at root level
            // before dispatching to the subcommand). --bundle-version is the scripted override.
            if (!opts.version && typeof opts.bundleVersion === 'string') opts.version = opts.bundleVersion;

            const cfg = await resolveConfig(this, ['serverUrl', 'appId', 'version', 'distDir']);
            if (!cfg.adminToken && !cfg.dryRun) {
                fail('missing admin token (--admin-token, CAPGO_ADMIN_TOKEN, or "adminToken" in config — or use --dry-run)');
            }

            step(`Preflight checks${cfg.dryRun ? ' (dry-run)' : ''}`);
            const target = parseSemver(cfg.version!);
            if (!target) fail(`version "${cfg.version}" is not valid semver`);
            ok(`target: ${cfg.appId}@${cfg.version} · channel: ${cfg.channel}`);

            if (cfg.skipPreflight) {
                warn('--skip-preflight set — bypassing preflight checks');
                // Even with --skip-preflight we still need min builds + native
                // fingerprint to populate the init payload; the server rejects
                // a bundle without them.
                await preflightNativeBuild(cfg);
            } else {
                await preflightPackageJson(cfg, target);
                await preflightCapacitorConfig(cfg);
                await preflightNativeBuild(cfg);
                await preflightServerPing(cfg.serverUrl!);
                if (cfg.adminToken) {
                    const result = await preflightAppRegistered(cfg, target);
                    if (result === 'exists-active') {
                        done(`Nothing to publish — ${cfg.appId}@${cfg.version} already active on "${cfg.channel}"`);
                        return;
                    }
                } else {
                    warn('no admin token — skipping server-side app/version preflight');
                }
            }

            await validateDist(cfg);

            const zipped = await zipDir(cfg.distDir!);
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

            const initPayload: Record<string, unknown> = {
                app_id: cfg.appId,
                version: cfg.version,
                channel: cfg.channel,
                min_android_build: cfg.minAndroidBuild,
                min_ios_build: cfg.minIosBuild,
                native_packages: cfg.nativePackages ?? {}
            };
            if (cfg.platforms) initPayload.platforms = cfg.platforms;
            if (cfg.link) initPayload.link = cfg.link;
            if (cfg.comment) initPayload.comment = cfg.comment;

            if (cfg.dryRun) {
                step('[dry-run] would publish:');
                kv('POST', `${cfg.serverUrl}/admin/bundles/init`);
                kv('body', JSON.stringify(initPayload));
                kv('PUT', '<presigned R2 url>');
                kv('POST', `${cfg.serverUrl}/admin/bundles/commit`);
                kv('body', JSON.stringify({ bundle_id: '<from init>', checksum, activate: cfg.activate }));
                done('Dry run OK — all preflight checks passed');
                return;
            }

            const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };

            step(`POST ${cfg.serverUrl}/admin/bundles/init`);
            const initResult = await apiCall<BundleInitResponse>(ctx, 'POST', '/admin/bundles/init', initPayload);
            if (!initResult.ok) {
                if (initResult.status === 409 && cfg.versionExistsOk) {
                    warn('init returned 409 (duplicate) — exiting 0 per --version-exists-ok');
                    done(`Skipped ${cfg.appId}@${cfg.version} (already present)`);
                    return;
                }
                fail(`POST /admin/bundles/init → ${initResult.status}: ${initResult.body}`);
            }
            const init = initResult.data;
            ok(`bundle_id: ${init.bundle_id} · r2_key: ${init.r2_key}`);

            step('PUT presigned R2 upload');
            const putRes = await fetch(init.upload_url, {
                method: 'PUT',
                body: zipped,
                headers: { 'content-type': 'application/zip' }
            });
            if (!putRes.ok) fail(`R2 PUT failed: ${putRes.status} ${await putRes.text()}`);

            step(`POST ${cfg.serverUrl}/admin/bundles/commit`);
            const bundle = await apiJson<BundleRow>(ctx, 'POST', '/admin/bundles/commit', {
                bundle_id: init.bundle_id,
                checksum,
                activate: cfg.activate
            });

            done(`Published ${cfg.appId}@${cfg.version} to channel "${bundle.channel}"`);
            ok(`state: ${bundle.state} · active: ${bundle.active} · bundle_id: ${bundle.id}`);
        });
}
