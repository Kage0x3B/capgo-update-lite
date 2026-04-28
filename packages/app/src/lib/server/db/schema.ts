import { sql } from 'drizzle-orm';
import {
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    real,
    serial,
    text,
    timestamp,
    uniqueIndex
} from 'drizzle-orm/pg-core';

// Upgrade-class ceiling applied per-app on POST /updates. Mirrors upstream
// capgo's channels.disable_auto_update enum without the 'version_number' value
// (we use per-bundle min_*_build for that semantic instead).
export const disableAutoUpdateEnum = pgEnum('disable_auto_update_kind', ['none', 'major', 'minor', 'patch']);

export const apps = pgTable('apps', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // Refuse major/minor/patch auto-updates. 'none' disables the guard.
    disableAutoUpdate: disableAutoUpdateEnum('disable_auto_update').notNull().default('none'),
    // Refuse to deliver a bundle whose semver is lower than the device's native
    // version_build. Default on because it matches the safest policy.
    disableAutoUpdateUnderNative: boolean('disable_auto_update_under_native').notNull().default(true),
    // Minimum @capgo/capacitor-updater plugin version the server will serve.
    // NULL = no floor. Semver string (e.g. '6.25.0').
    minPluginVersion: text('min_plugin_version'),
    // Per-app override for the broken-bundle auto-disable noise floor: a bundle
    // must have been tried by at least this many unique devices before its fail
    // rate is allowed to trip the kill-switch. NULL falls back to env / constant.
    // 0 disables auto-disable for this app.
    failMinDevices: integer('fail_min_devices'),
    // Per-app overrides for the three fail-rate thresholds the dashboard uses
    // (0..1, fraction of unique devices that hit a bundle-integrity failure).
    // Order is enforced: warn <= risk <= disable. NULL on any falls back to
    // env / constant. 0 on disable disables auto-disable for this app.
    failWarnRate: real('fail_warn_rate'),
    failRiskRate: real('fail_risk_rate'),
    failRateThreshold: real('fail_rate_threshold'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const bundles = pgTable(
    'bundles',
    {
        id: serial('id').primaryKey(),
        appId: text('app_id')
            .notNull()
            .references(() => apps.id),
        channel: text('channel').notNull().default('production'),
        version: text('version').notNull(),
        platforms: text('platforms')
            .array()
            .notNull()
            .default(sql`ARRAY['ios','android']::text[]`),
        r2Key: text('r2_key').notNull(),
        checksum: text('checksum').notNull().default(''),
        sessionKey: text('session_key').notNull().default(''),
        link: text('link'),
        comment: text('comment'),
        // Minimum native-shell version (versionName / CFBundleShortVersionString)
        // required to run this bundle. Semver. Compared against device.version_build
        // on the matching platform at /updates time.
        minAndroidBuild: text('min_android_build').notNull(),
        minIosBuild: text('min_ios_build').notNull(),
        // Fingerprint of native-code dependencies from the publishing project's
        // package.json (filtered to @capacitor/*, @capacitor-community/*, etc.).
        // Used by the CLI's --auto-min-update-build to bump the min builds when
        // native deps change between publishes.
        nativePackages: jsonb('native_packages').$type<Record<string, string>>().notNull(),
        active: boolean('active').notNull().default(false),
        state: text('state').notNull().default('pending'),
        releasedAt: timestamp('released_at', { withTimezone: true }),
        // Cutoff for the per-device blacklist gate in /updates: stats_events
        // before this timestamp don't count toward the NOT EXISTS check.
        // Set to now() when an operator reactivates an auto-disabled bundle so
        // previously-failed devices get to try the (presumably-fixed) bundle
        // again, without losing the underlying event history.
        blacklistResetAt: timestamp('blacklist_reset_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
    },
    (t) => [
        uniqueIndex('bundles_app_channel_version_uq').on(t.appId, t.channel, t.version),
        index('bundles_resolver_idx').on(t.appId, t.channel, t.active, t.releasedAt)
    ]
);

export const statsEvents = pgTable(
    'stats_events',
    {
        id: bigserial('id', { mode: 'bigint' }).primaryKey(),
        receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
        appId: text('app_id').notNull(),
        deviceId: text('device_id').notNull(),
        action: text('action'),
        versionName: text('version_name'),
        oldVersionName: text('old_version_name'),
        platform: text('platform'),
        pluginVersion: text('plugin_version'),
        isEmulator: boolean('is_emulator'),
        isProd: boolean('is_prod')
    },
    (t) => [
        index('stats_events_app_time_idx').on(t.appId, t.receivedAt),
        index('stats_events_app_action_time_idx').on(t.appId, t.action, t.receivedAt),
        // For global failure-breakdown / action-time queries that don't filter by app.
        index('stats_events_action_time_idx').on(t.action, t.receivedAt)
    ]
);

export type App = typeof apps.$inferSelect;
export type Bundle = typeof bundles.$inferSelect;
export type NewBundle = typeof bundles.$inferInsert;
export type StatsEvent = typeof statsEvents.$inferSelect;
export type NewStatsEvent = typeof statsEvents.$inferInsert;
