/**
 * Pure compatibility-guard logic for POST /updates.
 *
 * Extracted from routes/updates/+server.ts so it can be unit-tested without
 * standing up Postgres, R2, or a request context. The route handler remains
 * responsible for semver parsing, the app/bundle DB fetches, the isNewer
 * guard (which throws), the presign, and response building.
 *
 * evaluateUpdate runs, in order:
 *   1. Plugin-version floor against app.minPluginVersion.
 *   2. Platform-split min native build (skipped on electron).
 *   3. No-downgrade-under-native toggle.
 *   4. Upgrade-class ceiling (disable_auto_update).
 *
 * Steps that must happen *before* this function (in the route):
 *   - Parse body.plugin_version as semver; return unsupported_plugin_version
 *     on parse failure.
 *   - Parse body.version_build as semver; return invalid_version_build on
 *     parse failure.
 *   - Look up the app row; return no_app when missing.
 *   - Look up the active bundle; return no_bundle when missing.
 *   - Run isNewer(bundle.version, body.version_name); short-circuit with
 *     no_new_version_available or semver_error.
 *
 * When this function returns { kind: 'deliver' }, the route may still emit
 * no_bundle_url if bundle.r2Key is missing — that's an orthogonal storage
 * integrity concern handled in the route, not here.
 */

import type { App, Bundle } from '$lib/server/db/schema.js';
import { compareSemver, isUpgradeBlocked, parseSemver, upgradeClass, type ParsedSemver } from '$lib/server/semver.js';
import type { UpdatesRequest } from '$lib/server/validation/updates.js';

export type UpdatesErrorCode =
    | 'unsupported_plugin_version'
    | 'below_min_native_build'
    | 'disable_auto_update_under_native'
    | 'disable_auto_update_to_major'
    | 'disable_auto_update_to_minor'
    | 'disable_auto_update_to_patch'
    | 'server_misconfigured';

export type UpdateDecision =
    | { kind: 'deliver' }
    | { kind: 'error'; code: UpdatesErrorCode; message: string; extra?: Record<string, unknown> };

export interface EvaluateUpdateInput {
    app: App;
    bundle: Bundle;
    body: UpdatesRequest;
    /** Already-parsed plugin_version semver; caller guarantees it's valid. */
    pluginSv: ParsedSemver;
    /** Already-parsed version_build semver; caller guarantees it's valid. */
    buildSv: ParsedSemver;
}

export function evaluateUpdate(input: EvaluateUpdateInput): UpdateDecision {
    const { app, bundle, body, pluginSv, buildSv } = input;

    // 1. Plugin-version floor.
    if (app.minPluginVersion) {
        const floor = parseSemver(app.minPluginVersion);
        if (floor && compareSemver(pluginSv, floor) < 0) {
            return {
                kind: 'error',
                code: 'unsupported_plugin_version',
                message: `plugin_version ${body.plugin_version} is below the configured floor ${app.minPluginVersion}`
            };
        }
    }

    // 2. Platform-split min native build. Electron bundles skip this guard
    //    because no min_electron_build column exists yet.
    const minBuildStr =
        body.platform === 'android' ? bundle.minAndroidBuild : body.platform === 'ios' ? bundle.minIosBuild : null;
    if (minBuildStr) {
        const minBuild = parseSemver(minBuildStr);
        if (!minBuild) {
            // NOT NULL columns should never carry non-semver strings; when they
            // do, fail closed so a corrupt row doesn't leak past the guard.
            return {
                kind: 'error',
                code: 'server_misconfigured',
                message: `bundle ${bundle.id} has non-semver min_${body.platform}_build: ${minBuildStr}`
            };
        }
        if (compareSemver(buildSv, minBuild) < 0) {
            return {
                kind: 'error',
                code: 'below_min_native_build',
                message: `native version_build ${body.version_build} is below min required ${minBuildStr} for this bundle`,
                extra: { min_required: minBuildStr, current: body.version_build }
            };
        }
    }

    // 3. No-downgrade-under-native: refuse bundles whose web semver is lower
    //    than the device's native shell version.
    if (app.disableAutoUpdateUnderNative) {
        const bundleSv = parseSemver(bundle.version);
        if (bundleSv && compareSemver(bundleSv, buildSv) < 0) {
            return {
                kind: 'error',
                code: 'disable_auto_update_under_native',
                message: `bundle ${bundle.version} is older than native ${body.version_build}; refusing to downgrade`
            };
        }
    }

    // 4. Upgrade-class ceiling. 'none' disables the guard. Unparseable version
    //    fields (e.g. version_name = 'builtin' sentinel) silently skip so we
    //    don't penalise devices that never had an OTA yet.
    if (app.disableAutoUpdate !== 'none') {
        const bundleSv = parseSemver(bundle.version);
        const runningSv = parseSemver(body.version_name);
        if (bundleSv && runningSv) {
            const actual = upgradeClass(bundleSv, runningSv);
            if (isUpgradeBlocked(actual, app.disableAutoUpdate)) {
                return {
                    kind: 'error',
                    code: `disable_auto_update_to_${actual as 'major' | 'minor' | 'patch'}` as const,
                    message: `auto-update blocked: ${body.version_name} → ${bundle.version} is a ${actual} upgrade; ceiling is ${app.disableAutoUpdate}`
                };
            }
        }
    }

    return { kind: 'deliver' };
}
