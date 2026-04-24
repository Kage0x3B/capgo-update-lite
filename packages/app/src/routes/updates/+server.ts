import { and, eq, sql } from 'drizzle-orm';
import { defineRoute } from '$lib/server/defineRoute.js';
import { apps, bundles } from '$lib/server/db/schema.js';
import { err200, resToVersion } from '$lib/server/responses.js';
import { isNewer, parseSemver } from '$lib/server/semver.js';
import { presignGet } from '$lib/server/r2.js';
import { evaluateUpdate } from '$lib/server/services/updateDecision.js';
import { UpdatesRequestSchema } from '$lib/server/validation/updates.js';
import { UpdateAvailableSchema, UPDATES_ERROR_CODES } from '$lib/server/validation/entities.js';

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
        void deviceId; // referenced by /stats; no DB write on /updates itself yet

        const [app] = await db.select().from(apps).where(eq(apps.id, body.app_id)).limit(1);
        if (!app) return err200('no_app', `Unknown app_id: ${body.app_id}`);

        const rows = await db
            .select()
            .from(bundles)
            .where(
                and(
                    eq(bundles.appId, body.app_id),
                    eq(bundles.channel, body.defaultChannel ?? 'production'),
                    eq(bundles.active, true),
                    eq(bundles.state, 'active'),
                    sql`${body.platform} = ANY(${bundles.platforms})`
                )
            )
            .orderBy(sql`${bundles.releasedAt} DESC NULLS LAST`)
            .limit(1);

        const bundle = rows[0];
        if (!bundle) return err200('no_bundle', 'Cannot get bundle');

        let shouldUpdate: boolean;
        try {
            shouldUpdate = isNewer(bundle.version, body.version_name);
        } catch (e) {
            return err200('semver_error', e instanceof Error ? e.message : 'semver error');
        }

        if (!shouldUpdate) return err200('no_new_version_available', 'No new version available');

        // All remaining compatibility logic (plugin floor, min native build,
        // no-downgrade-under-native, upgrade-class ceiling) lives in the pure
        // evaluateUpdate() so it's unit-testable without a DB. Mirror the
        // function's step order in services/updateDecision.ts if you add cases.
        const decision = evaluateUpdate({ app, bundle, body, pluginSv, buildSv });
        if (decision.kind === 'error') {
            return err200(decision.code, decision.message, decision.extra);
        }

        if (!bundle.r2Key) return err200('no_bundle_url', 'Cannot get bundle url');

        const url = await presignGet(platform.env, bundle.r2Key);
        return resToVersion(bundle, url);
    }
);
