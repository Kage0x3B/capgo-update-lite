import { and, eq, sql } from 'drizzle-orm';
import { defineRoute } from '$lib/server/defineRoute.js';
import { apps, bundles, statsEvents, type Bundle } from '$lib/server/db/schema.js';
import { err200, resToVersion } from '$lib/server/responses.js';
import { compareSemver, isNewer, parseSemver } from '$lib/server/semver.js';
import { presignGet } from '$lib/server/r2.js';
import { evaluateUpdate, type UpdatesErrorCode } from '$lib/server/services/updateDecision.js';
import { BUNDLE_BREAKING_ACTIONS } from '$lib/server/services/analytics.js';
import { UpdatesRequestSchema } from '$lib/server/validation/updates.js';
import { UpdateAvailableSchema, UPDATES_ERROR_CODES } from '$lib/server/validation/entities.js';

// Pre-rendered SQL fragment listing the actions that count as "this device
// failed this bundle" — kept in sync with the partial-index predicate in
// drizzle/0003_graceful_reptil.sql via BUNDLE_BREAKING_ACTIONS.
const BUNDLE_BREAKING_SQL = sql.raw(BUNDLE_BREAKING_ACTIONS.map((a) => `'${a}'`).join(','));

/**
 * POST /updates — called by @capgo/capacitor-updater on every app launch.
 *
 * Every response is HTTP 200. Any 4xx/5xx would be treated by the native
 * plugin as a network failure and trigger rollback — see handoff §4
 * and the `err200` helper in responses.ts.
 */
export const POST = defineRoute(
    {
        auth: 'none',
        body: UpdatesRequestSchema,
        response: UpdateAvailableSchema,
        errorMode: 'err200',
        errorCodes: UPDATES_ERROR_CODES,
        meta: {
            operationId: 'checkForUpdate',
            summary: 'Check for an OTA bundle update',
            description:
                'Called by @capgo/capacitor-updater on every app launch. Returns the newest active bundle for the (app_id, channel, platform) tuple — or a business-error 200 response.',
            tags: ['plugin'],
            externalDocs: {
                url: 'https://capgo.app/docs/plugin/self-hosted/custom-server/',
                description: 'Capgo custom-server contract (upstream reference).'
            }
        },
        examples: {
            body: {
                app_id: 'com.example.notes',
                device_id: '8b1c7b5c-1b2a-4f0b-9a74-3e3d6ad2d2fa',
                version_name: '1.4.1',
                version_build: '104',
                is_emulator: false,
                is_prod: true,
                platform: 'ios',
                plugin_version: '6.3.0',
                defaultChannel: 'production'
            },
            response: {
                version: '1.4.2',
                url: 'https://r2.example.com/presigned/com.example.notes/1.4.2/abc.zip',
                session_key: '',
                checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            }
        }
    },
    async ({ body, platform, db }) => {
        const pluginSv = parseSemver(body.plugin_version);
        if (!pluginSv) {
            return err200('unsupported_plugin_version', `plugin_version is not valid semver: ${body.plugin_version}`);
        }
        // version_build carries the native shell's user-facing version string
        // (versionName on Android, CFBundleShortVersionString on iOS) and gates
        // every per-platform min-build and no-downgrade-under-native comparison
        // below. The plugin sentinels 'builtin' / 'unknown' never appear here —
        // those only show up in version_name.
        const buildSv = parseSemver(body.version_build);
        if (!buildSv) {
            return err200('invalid_version_build', `version_build is not valid semver: ${body.version_build}`);
        }

        // device_id is lowercased server-side before any DB I/O — parity with
        // capgo-backend/.../plugins/stats.ts:186-195 so that mixed-case IDs don't
        // appear as duplicates across endpoints.
        const deviceId = body.device_id.toLowerCase();

        // Single round-trip: LEFT JOIN apps→bundles so app-existence and bundle
        // resolution land in one query. If the app doesn't exist we get zero
        // rows; if the app exists but no bundle matches we get a single row
        // with a null bundle; if multiple bundles are active on the channel
        // (e.g. one per native-major lane via min_*_build guards) we get one
        // row per candidate. SQL doesn't impose an order — candidates are
        // sorted by bundle.version semver (descending) in JS below, so a
        // hotfix on an older lane (e.g. v1.2.5 published after v2.1.0) still
        // ranks below the newer lane's bundle on its own ordering axis.
        //
        // Per-device blacklist: skip bundles that this device has already
        // failed on. Backed by the partial index
        // stats_events_device_failure_idx so this is an index-only probe per
        // candidate.
        const rows = await db
            .select({ app: apps, bundle: bundles })
            .from(apps)
            .leftJoin(
                bundles,
                and(
                    eq(bundles.appId, apps.id),
                    eq(bundles.channel, body.defaultChannel ?? 'production'),
                    eq(bundles.active, true),
                    eq(bundles.state, 'active'),
                    sql`${body.platform} = ANY(${bundles.platforms})`,
                    // Events received before bundles.blacklist_reset_at are
                    // ignored — that's how operator-driven reactivation gives
                    // previously-failed devices another shot at the bundle
                    // without losing the underlying event history.
                    sql`NOT EXISTS (
                        SELECT 1 FROM ${statsEvents}
                        WHERE ${statsEvents.appId} = ${bundles.appId}
                          AND ${statsEvents.deviceId} = ${deviceId}
                          AND ${statsEvents.versionName} = ${bundles.version}
                          AND ${statsEvents.action} IN (${BUNDLE_BREAKING_SQL})
                          AND (${bundles.blacklistResetAt} IS NULL OR ${statsEvents.receivedAt} > ${bundles.blacklistResetAt})
                    )`
                )
            )
            .where(eq(apps.id, body.app_id));

        if (rows.length === 0) return err200('no_app', `Unknown app_id: ${body.app_id}`);
        const app = rows[0].app;
        const candidates = rows.map((r) => r.bundle).filter((b): b is Bundle => b !== null);
        if (candidates.length === 0) return err200('no_bundle', 'Cannot get bundle');

        // Sort by bundle.version semver, newest first. bundle.version is
        // validated as semver on insert (initBundle), so parseSemver should
        // always succeed; if it ever doesn't, push that row to the end so a
        // single corrupt row can't strand the channel.
        candidates.sort((a, b) => {
            const av = parseSemver(a.version);
            const bv = parseSemver(b.version);
            if (av && bv) return compareSemver(bv, av);
            if (av) return -1;
            if (bv) return 1;
            return 0;
        });

        // Walk candidates newest-first and pick the first one this device
        // qualifies for. With multiple active bundles per channel (the
        // native-major lane model), older lanes stay deliverable to devices
        // whose native build can't satisfy the newest lane's min_*_build.
        //
        // Resolution priority when no candidate delivers:
        //   1. no_new_version_available — at least one candidate matched but
        //      the device is already at-or-above its version. The device is
        //      up to date in its lane; don't surface a guard error.
        //   2. first guard error — preserves diagnostic value for the
        //      single-active-bundle case where the only candidate is blocked.
        //   3. semver_error — fell back from isNewer throwing on every
        //      candidate (rare; usually means body.version_name is corrupt).
        let chosen: Bundle | null = null;
        let firstBlocked:
            | { code: UpdatesErrorCode; message: string; extra?: Record<string, unknown> }
            | null = null;
        let firstSemverError: string | null = null;
        let sawNotNewer = false;
        for (const bundle of candidates) {
            let shouldUpdate: boolean;
            try {
                shouldUpdate = isNewer(bundle.version, body.version_name);
            } catch (e) {
                if (firstSemverError === null) {
                    firstSemverError = e instanceof Error ? e.message : 'semver error';
                }
                continue;
            }
            if (!shouldUpdate) {
                sawNotNewer = true;
                continue;
            }
            // All remaining compatibility logic (plugin floor, min native
            // build, no-downgrade-under-native, upgrade-class ceiling) lives
            // in the pure evaluateUpdate() so it's unit-testable without a DB.
            // Mirror the function's step order in
            // services/updateDecision.ts if you add cases.
            const decision = evaluateUpdate({ app, bundle, body, pluginSv, buildSv });
            if (decision.kind === 'error') {
                if (firstBlocked === null) {
                    firstBlocked = { code: decision.code, message: decision.message, extra: decision.extra };
                }
                continue;
            }
            chosen = bundle;
            break;
        }

        if (!chosen) {
            if (sawNotNewer) return err200('no_new_version_available', 'No new version available');
            if (firstBlocked) return err200(firstBlocked.code, firstBlocked.message, firstBlocked.extra);
            if (firstSemverError) return err200('semver_error', firstSemverError);
            return err200('no_bundle', 'Cannot get bundle');
        }

        if (!chosen.r2Key) return err200('no_bundle_url', 'Cannot get bundle url');

        const url = await presignGet(platform.env, chosen.r2Key);
        return resToVersion(chosen, url);
    }
);
