import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { apps, bundles, statsEvents, updateChecks } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { compareSemver, compareVersionsDesc, parseSemver } from '$lib/server/semver.js';
import type { AnalyticsFilters } from '$lib/server/validation/analytics.js';

// Action taxonomy drawn from ALLOWED_STATS_ACTIONS. Kept local so the service
// doesn't depend on the plugin-facing input schema.
const FAILURE_ACTIONS = [
    'set_fail',
    'update_fail',
    'download_fail',
    'windows_path_fail',
    'canonical_path_fail',
    'directory_path_fail',
    'unzip_fail',
    'low_mem_fail',
    'decrypt_fail',
    'checksum_fail',
    'download_manifest_file_fail',
    'download_manifest_checksum_fail',
    'download_manifest_brotli_fail'
] as const;

/**
 * Subset of FAILURE_ACTIONS that the bundle is responsible for (the bundle
 * itself is broken/corrupt). Excludes network failures (`download_fail`) and
 * device-environment failures (`low_mem_fail`, `*_path_fail`,
 * `download_manifest_*`) which are not the bundle's fault.
 *
 * Used by services/bundleHealth.ts and routes/{stats,updates}/+server.ts. The
 * partial-index predicates in drizzle/0003_graceful_reptil.sql MUST stay in
 * sync with this list — if you change one, change them all.
 */
export const BUNDLE_BREAKING_ACTIONS = [
    'set_fail',
    'update_fail',
    'decrypt_fail',
    'checksum_fail',
    'unzip_fail'
] as const;
export type BundleBreakingAction = (typeof BUNDLE_BREAKING_ACTIONS)[number];

/** Events emitted as a device takes an update — used for the rollout funnel. */
const FUNNEL_ACTIONS = {
    downloadStart: 'download_zip_start',
    downloadComplete: 'download_complete',
    set: 'set'
} as const;

/** Events that mean "this device tried to take an update" (failure-rate denominator). */
const ATTEMPT_ACTIONS = ['download_zip_start', 'set'] as const;

/** Max versions drawn individually in the adoption chart; the rest fold into "other". */
const ADOPTION_TOP_VERSIONS = 7;
export const OTHER_VERSIONS = 'other';

const failureList = sql.raw(FAILURE_ACTIONS.map((a) => `'${a}'`).join(','));
const attemptList = sql.raw(ATTEMPT_ACTIONS.map((a) => `'${a}'`).join(','));

// --- helpers -----------------------------------------------------------------
//
// Device ids are compared with COLLATE "C" in every DISTINCT / DISTINCT ON.
// They are lowercase UUIDs, so byte order is all we need, and it sorts
// 30-45% faster than the database's locale collation on large windows.

function windowFilter(f: AnalyticsFilters) {
    const base = [gte(statsEvents.receivedAt, f.since), lt(statsEvents.receivedAt, f.until)];
    if (f.app_id) base.push(eq(statsEvents.appId, f.app_id));
    return and(...base);
}

function checksWindow(f: AnalyticsFilters) {
    const base = [gte(updateChecks.receivedAt, f.since), lt(updateChecks.receivedAt, f.until)];
    if (f.app_id) base.push(eq(updateChecks.appId, f.app_id));
    return and(...base);
}

/** Same window as SQL text, for the raw CTE queries below. */
function rawWindow(table: 'stats_events' | 'update_checks', f: AnalyticsFilters) {
    const t = sql.raw(table);
    const app = f.app_id ? sql` AND ${t}.app_id = ${f.app_id}` : sql``;
    // postgres.js can't bind a raw Date in hand-written SQL; pass ISO text.
    return sql`${t}.received_at >= ${f.since.toISOString()}::timestamptz AND ${t}.received_at < ${f.until.toISOString()}::timestamptz${app}`;
}

function bucketSql(f: AnalyticsFilters, column: 'stats_events' | 'update_checks') {
    const unit = sql.raw(f.bucket === 'hour' ? `'hour'` : `'day'`);
    return sql`date_trunc(${unit}, ${sql.raw(column)}.received_at)`;
}

function priorWindow(f: AnalyticsFilters): AnalyticsFilters {
    const span = f.until.getTime() - f.since.getTime();
    return { ...f, since: new Date(f.since.getTime() - span), until: new Date(f.since.getTime()) };
}

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
    return (await db.execute(query)) as unknown as T[];
}

function iso(v: unknown): string {
    return new Date(v as string | Date).toISOString();
}

/** Every bucket start in the window, so charts get a full x axis. */
export function bucketStarts(f: AnalyticsFilters): string[] {
    const out: string[] = [];
    const cur = new Date(f.since);
    if (f.bucket === 'hour') cur.setUTCMinutes(0, 0, 0);
    else cur.setUTCHours(0, 0, 0, 0);
    while (cur < f.until) {
        out.push(cur.toISOString());
        if (f.bucket === 'hour') cur.setUTCHours(cur.getUTCHours() + 1);
        else cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

// --- latest bundle per channel ----------------------------------------------

export type ChannelBundle = { channel: string; version: string; releasedAt: string | null };

/**
 * Newest (by semver) live bundle on each channel. With several active bundles
 * per channel this is the one a fully-updated device ends up on.
 */
export async function latestBundlePerChannel(db: Db, app_id?: string): Promise<ChannelBundle[]> {
    const live = await db
        .select({ channel: bundles.channel, version: bundles.version, releasedAt: bundles.releasedAt })
        .from(bundles)
        .where(
            and(app_id ? eq(bundles.appId, app_id) : undefined, eq(bundles.active, true), eq(bundles.state, 'active'))
        );
    const best = new Map<string, (typeof live)[number]>();
    for (const b of live) {
        const cur = best.get(b.channel);
        if (!cur || compareVersionsDesc(b.version, cur.version) < 0) best.set(b.channel, b);
    }
    return [...best.values()]
        .map((b) => ({
            channel: b.channel,
            version: b.version,
            releasedAt: b.releasedAt ? b.releasedAt.toISOString() : null
        }))
        .sort((a, b) => a.channel.localeCompare(b.channel));
}

// --- 1. KPI strip ------------------------------------------------------------

export type Kpis = {
    activeDevices: number;
    activeDevicesPrev: number;
    updateChecks: number;
    updateChecksPrev: number;
    /** Distinct devices that installed a bundle (`set`) in the window. */
    devicesUpdated: number;
    devicesUpdatedPrev: number;
    /** Devices with a failure ÷ devices that tried an update. */
    failureRate: number;
    failureRatePrev: number;
    /** Share of checking devices whose latest check said "up to date". null without check data. */
    upToDate: number | null;
    latestBundles: ChannelBundle[];
};

export async function kpisForWindow(db: Db, f: AnalyticsFilters): Promise<Kpis> {
    const prev = priorWindow(f);

    async function eventStats(w: AnalyticsFilters) {
        const [row] = await db
            .select({
                activeDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int`,
                devicesUpdated: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} = 'set')::int`,
                failedDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} IN (${failureList}))::int`,
                attemptDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} IN (${attemptList}) OR ${statsEvents.action} IN (${failureList}))::int`
            })
            .from(statsEvents)
            .where(windowFilter(w));
        return row;
    }

    async function checkCount(w: AnalyticsFilters) {
        const [row] = await db
            .select({ c: sql<number>`COUNT(*)::int` })
            .from(updateChecks)
            .where(checksWindow(w));
        return row?.c ?? 0;
    }

    const upToDateQuery = rows<{ total: number; current: number }>(
        db,
        sql`WITH latest AS (
                SELECT DISTINCT ON (device_id COLLATE "C") result
                FROM update_checks
                WHERE ${rawWindow('update_checks', f)}
                ORDER BY device_id COLLATE "C", received_at DESC
            )
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE result = 'no_new_version_available')::int AS current
            FROM latest`
    );

    const [cur, prior, checks, checksPrev, upToDate, latestBundles] = await Promise.all([
        eventStats(f),
        eventStats(prev),
        checkCount(f),
        checkCount(prev),
        upToDateQuery,
        latestBundlePerChannel(db, f.app_id)
    ]);

    const rate = (r: typeof cur) => (r.attemptDevices > 0 ? r.failedDevices / r.attemptDevices : 0);
    const utd = upToDate[0];
    return {
        activeDevices: cur.activeDevices ?? 0,
        activeDevicesPrev: prior.activeDevices ?? 0,
        updateChecks: checks,
        updateChecksPrev: checksPrev,
        devicesUpdated: cur.devicesUpdated ?? 0,
        devicesUpdatedPrev: prior.devicesUpdated ?? 0,
        failureRate: rate(cur),
        failureRatePrev: rate(prior),
        upToDate: utd && utd.total > 0 ? utd.current / utd.total : null,
        latestBundles
    };
}

// --- 2. Adoption by version --------------------------------------------------

export type Adoption = {
    /** Bucket starts, oldest first. */
    buckets: string[];
    /** Series order for stacking and legend: newest version first, `other` last. */
    versions: string[];
    points: { t: string; version: string; devices: number }[];
};

/**
 * Devices per bucket by the bundle version they were running: each device
 * counts once per bucket, under the last version it reported in that bucket.
 * Any event counts, so devices that open the app without updating still show.
 */
export async function adoptionByVersion(db: Db, f: AnalyticsFilters): Promise<Adoption> {
    const raw = await rows<{ t: string; version: string; devices: number }>(
        db,
        sql`WITH per AS (
                SELECT DISTINCT ON (1, device_id COLLATE "C")
                       ${bucketSql(f, 'stats_events')} AS t, device_id, version_name
                FROM stats_events
                WHERE ${rawWindow('stats_events', f)} AND version_name IS NOT NULL
                ORDER BY 1, device_id COLLATE "C", received_at DESC
            )
            SELECT t, version_name AS version, COUNT(*)::int AS devices
            FROM per GROUP BY 1, 2`
    );

    // Pick the versions with the most device-buckets; fold the long tail.
    const weight = new Map<string, number>();
    for (const r of raw) weight.set(r.version, (weight.get(r.version) ?? 0) + r.devices);
    const top = new Set(
        [...weight.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, ADOPTION_TOP_VERSIONS)
            .map(([v]) => v)
    );
    const merged = new Map<string, number>();
    for (const r of raw) {
        const version = top.has(r.version) ? r.version : OTHER_VERSIONS;
        const key = `${iso(r.t)}|${version}`;
        merged.set(key, (merged.get(key) ?? 0) + r.devices);
    }
    const points = [...merged.entries()].map(([key, devices]) => {
        const [t, version] = key.split('|');
        return { t, version, devices };
    });
    const versions = [...top].sort(compareVersionsDesc);
    if (weight.size > top.size) versions.push(OTHER_VERSIONS);
    return { buckets: bucketStarts(f), versions, points };
}

// --- 3. Update-check outcomes -----------------------------------------------

export type OutcomePoint = { t: string; result: string; checks: number };

/** Checks per bucket by result code. */
export async function updateOutcomesOverTime(db: Db, f: AnalyticsFilters): Promise<OutcomePoint[]> {
    const raw = await rows<{ t: string; result: string; checks: number }>(
        db,
        sql`SELECT ${bucketSql(f, 'update_checks')} AS t, result, COUNT(*)::int AS checks
            FROM update_checks
            WHERE ${rawWindow('update_checks', f)}
            GROUP BY 1, 2`
    );
    return raw.map((r) => ({ t: iso(r.t), result: r.result, checks: r.checks }));
}

export type OutcomeRow = {
    result: string;
    channel: string | null;
    checks: number;
    devices: number;
    lastSeen: string;
    /** One example err200 message, for codes whose message carries specifics. */
    sampleDetail: string | null;
    /** Example native versions reporting this result (helps with min-build blocks). */
    nativeVersions: string[];
};

/**
 * "Why isn't my fleet updating?" — one row per (result, channel), counting
 * each device once under its latest result in the window.
 */
export async function updateOutcomeTable(db: Db, f: AnalyticsFilters): Promise<OutcomeRow[]> {
    const raw = await rows<{
        result: string;
        channel: string | null;
        checks: number;
        devices: number;
        last_seen: string;
        sample_detail: string | null;
        native_versions: string | null;
    }>(
        db,
        sql`WITH latest AS (
                SELECT DISTINCT ON (device_id COLLATE "C") device_id, result, channel
                FROM update_checks
                WHERE ${rawWindow('update_checks', f)}
                ORDER BY device_id COLLATE "C", received_at DESC
            ),
            totals AS (
                SELECT result, channel, COUNT(*)::int AS checks, MAX(received_at) AS last_seen,
                       MAX(detail) AS sample_detail,
                       -- Text, not an array: createDb() sets fetch_types=false, so
                       -- postgres.js would hand back raw '{...}' array literals.
                       STRING_AGG(DISTINCT version_build, E'\n') AS native_versions
                FROM update_checks
                WHERE ${rawWindow('update_checks', f)}
                GROUP BY 1, 2
            )
            SELECT t.result, t.channel, t.checks, t.last_seen, t.sample_detail, t.native_versions,
                   COALESCE(l.devices, 0)::int AS devices
            FROM totals t
            LEFT JOIN (SELECT result, channel, COUNT(*) AS devices FROM latest GROUP BY 1, 2) l
              ON l.result = t.result AND l.channel IS NOT DISTINCT FROM t.channel
            ORDER BY devices DESC, t.checks DESC`
    );
    return raw.map((r) => ({
        result: r.result,
        channel: r.channel,
        checks: r.checks,
        devices: r.devices,
        lastSeen: iso(r.last_seen),
        sampleDetail: r.sample_detail,
        nativeVersions: (r.native_versions ? r.native_versions.split('\n') : []).sort(compareVersionsDesc).slice(0, 5)
    }));
}

// --- 4. Rollout funnel -------------------------------------------------------

export type FunnelStage = { action: string; devices: number };

export type RolloutFunnel = {
    channel: string;
    target: { version: string };
    /**
     * Devices seen on this channel in the last 7 days (from update checks), or
     * all devices of the app when there's no check data yet. Used to derive
     * the "haven't started this update yet" count.
     */
    activeDevices: number;
    /** Raw stats action codes, mapped through `actionLabel` in the UI. */
    stages: FunnelStage[];
};

/** One funnel per channel, measured against that channel's newest live bundle. */
export async function rolloutFunnels(db: Db, f: AnalyticsFilters): Promise<RolloutFunnel[]> {
    const targets = await latestBundlePerChannel(db, f.app_id);
    if (targets.length === 0) return [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const appFilter = f.app_id ? eq(statsEvents.appId, f.app_id) : undefined;

    const [stageRows, perChannel, allDevices] = await Promise.all([
        db
            .select({
                version: statsEvents.versionName,
                downloadStart: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.downloadStart})::int`,
                downloadComplete: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.downloadComplete})::int`,
                set: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.set})::int`
            })
            .from(statsEvents)
            .where(
                and(
                    windowFilter(f),
                    sql`${statsEvents.versionName} IN (${sql.join(
                        targets.map((t) => sql`${t.version}`),
                        sql`, `
                    )})`
                )
            )
            .groupBy(statsEvents.versionName),
        db
            .select({
                channel: updateChecks.channel,
                c: sql<number>`COUNT(DISTINCT ${updateChecks.deviceId} COLLATE "C")::int`
            })
            .from(updateChecks)
            .where(
                and(gte(updateChecks.receivedAt, sevenDaysAgo), f.app_id ? eq(updateChecks.appId, f.app_id) : undefined)
            )
            .groupBy(updateChecks.channel),
        db
            .select({ c: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int` })
            .from(statsEvents)
            .where(and(gte(statsEvents.receivedAt, sevenDaysAgo), appFilter))
            .then((r) => r[0]?.c ?? 0)
    ]);

    const byVersion = new Map(stageRows.map((r) => [r.version, r]));
    const channelDevices = new Map(perChannel.map((r) => [r.channel ?? 'production', r.c]));
    return targets.map((t) => {
        const row = byVersion.get(t.version);
        return {
            channel: t.channel,
            target: { version: t.version },
            activeDevices: channelDevices.size > 0 ? (channelDevices.get(t.channel) ?? 0) : allDevices,
            stages: [
                { action: FUNNEL_ACTIONS.downloadStart, devices: row?.downloadStart ?? 0 },
                { action: FUNNEL_ACTIONS.downloadComplete, devices: row?.downloadComplete ?? 0 },
                { action: FUNNEL_ACTIONS.set, devices: row?.set ?? 0 }
            ]
        };
    });
}

// --- 5. Failure breakdown ----------------------------------------------------

/** Per-version failure totals plus the failure actions reported against that version. */
export type FailureRow = {
    version: string;
    count: number;
    devices: number;
    actions: { action: string; count: number; devices: number }[];
};

const FAILURE_ACTIONS_PER_VERSION = 8;

export async function failureBreakdown(db: Db, f: AnalyticsFilters): Promise<FailureRow[]> {
    const [perAction, perVersion] = await Promise.all([
        db
            .select({
                version: sql<string>`COALESCE(${statsEvents.versionName}, 'unknown')`.as('version'),
                action: sql<string>`${statsEvents.action}`.as('action'),
                count: sql<number>`COUNT(*)::int`.as('count'),
                devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int`.as('devices')
            })
            .from(statsEvents)
            .where(and(windowFilter(f), sql`${statsEvents.action} IN (${failureList})`))
            .groupBy(sql`1`, statsEvents.action),
        db
            .select({
                version: sql<string>`COALESCE(${statsEvents.versionName}, 'unknown')`.as('version'),
                devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int`.as('devices')
            })
            .from(statsEvents)
            .where(and(windowFilter(f), sql`${statsEvents.action} IN (${failureList})`))
            .groupBy(sql`1`)
    ]);

    const deviceTotals = new Map(perVersion.map((r) => [r.version, r.devices]));
    const byVersion = new Map<string, FailureRow>();
    for (const r of perAction) {
        let row = byVersion.get(r.version);
        if (!row) {
            row = { version: r.version, count: 0, devices: deviceTotals.get(r.version) ?? 0, actions: [] };
            byVersion.set(r.version, row);
        }
        row.count += r.count;
        row.actions.push({ action: r.action, count: r.count, devices: r.devices });
    }
    return [...byVersion.values()]
        .map((r) => ({
            ...r,
            actions: r.actions.sort((a, b) => b.devices - a.devices).slice(0, FAILURE_ACTIONS_PER_VERSION)
        }))
        .sort((a, b) => b.devices - a.devices || b.count - a.count);
}

// --- 6. Device breakdowns ----------------------------------------------------

export type SplitRow = { value: string; devices: number };

/**
 * Devices by one attribute, counting each device once under its latest value
 * in the window (a device that upgraded its plugin mid-window counts under the
 * new version only).
 */
async function latestSplit(
    db: Db,
    f: AnalyticsFilters,
    table: 'stats_events' | 'update_checks',
    column: string,
    limit = 10
): Promise<SplitRow[]> {
    const col = sql.raw(column);
    const t = sql.raw(table);
    return rows<SplitRow>(
        db,
        sql`WITH latest AS (
                SELECT DISTINCT ON (device_id COLLATE "C") COALESCE(${col}, 'unknown') AS value
                FROM ${t}
                WHERE ${rawWindow(table, f)}
                ORDER BY device_id COLLATE "C", received_at DESC
            )
            SELECT value, COUNT(*)::int AS devices FROM latest
            GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`
    );
}

export type PlatformRow = { platform: string; devices: number };

export async function platformSplit(db: Db, f: AnalyticsFilters): Promise<PlatformRow[]> {
    const r = await latestSplit(db, f, 'stats_events', 'platform');
    return r.map((x) => ({ platform: x.value, devices: x.devices }));
}

export type PluginRow = { plugin_version: string; devices: number };

export async function pluginVersionSpread(db: Db, f: AnalyticsFilters): Promise<PluginRow[]> {
    const r = await latestSplit(db, f, 'stats_events', 'plugin_version');
    return r.map((x) => ({ plugin_version: x.value, devices: x.devices }));
}

export type NativeRow = { platform: string; version: string; devices: number };

/** Native app versions (version_build) in the field, per platform. From update checks. */
export async function nativeVersionSpread(db: Db, f: AnalyticsFilters): Promise<NativeRow[]> {
    const raw = await rows<NativeRow>(
        db,
        sql`WITH latest AS (
                SELECT DISTINCT ON (device_id COLLATE "C") COALESCE(platform, 'unknown') AS platform,
                       COALESCE(version_build, 'unknown') AS version
                FROM update_checks
                WHERE ${rawWindow('update_checks', f)}
                ORDER BY device_id COLLATE "C", received_at DESC
            )
            SELECT platform, version, COUNT(*)::int AS devices FROM latest GROUP BY 1, 2`
    );
    return raw.sort((a, b) => a.platform.localeCompare(b.platform) || compareVersionsDesc(a.version, b.version));
}

export async function channelSplit(db: Db, f: AnalyticsFilters): Promise<SplitRow[]> {
    return latestSplit(db, f, 'update_checks', 'channel');
}

// --- 7. Auto-rollback incidents ---------------------------------------------

export type RollbackRow = {
    from_v: string;
    to_v: string;
    devices: number;
    last_seen: string;
};

export async function autoRollbacks(db: Db, f: AnalyticsFilters): Promise<RollbackRow[]> {
    const raw = await db
        .select({
            from_v: sql<string>`${statsEvents.oldVersionName}`.as('from_v'),
            to_v: sql<string>`${statsEvents.versionName}`.as('to_v'),
            devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int`.as('devices'),
            last_seen: sql<string>`MAX(${statsEvents.receivedAt})`.as('last_seen')
        })
        .from(statsEvents)
        .where(
            and(
                windowFilter(f),
                eq(statsEvents.action, 'set'),
                sql`${statsEvents.oldVersionName} IS NOT NULL`,
                sql`${statsEvents.versionName} IS NOT NULL`
            )
        )
        .groupBy(statsEvents.oldVersionName, statsEvents.versionName);

    // Filter in JS: from > to (the device downgraded).
    return raw
        .filter((r) => {
            const a = parseSemver(r.from_v);
            const b = parseSemver(r.to_v);
            if (!a || !b) return false;
            return compareSemver(a, b) > 0;
        })
        .map((r) => ({ ...r, last_seen: iso(r.last_seen) }))
        .sort((a, b) => b.devices - a.devices);
}

// --- 8. Bundle state summary -------------------------------------------------

export type BundleStateRow = { app_id: string; state: string; count: number };

export async function bundleStateSummary(db: Db, app_id?: string): Promise<BundleStateRow[]> {
    return db
        .select({
            app_id: bundles.appId,
            state: bundles.state,
            count: sql<number>`COUNT(*)::int`.as('count')
        })
        .from(bundles)
        .where(app_id ? eq(bundles.appId, app_id) : undefined)
        .groupBy(bundles.appId, bundles.state)
        .orderBy(bundles.appId, bundles.state);
}

// --- 9. Per-app summary (overview) ------------------------------------------

export type AppSummary = {
    appId: string;
    activeDevices: number;
    updateChecks: number;
    devicesUpdated: number;
    failedDevices: number;
    upToDate: number | null;
    lastSeen: string | null;
};

/** One row per registered app that sent anything in the window. */
export async function appSummaries(db: Db, f: AnalyticsFilters): Promise<AppSummary[]> {
    const noApp = { ...f, app_id: undefined };
    const [events, checks] = await Promise.all([
        db
            .select({
                appId: statsEvents.appId,
                activeDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C")::int`,
                devicesUpdated: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} = 'set')::int`,
                failedDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId} COLLATE "C") FILTER (WHERE ${statsEvents.action} IN (${failureList}))::int`,
                lastSeen: sql<string>`MAX(${statsEvents.receivedAt})`
            })
            .from(statsEvents)
            .where(windowFilter(noApp))
            .groupBy(statsEvents.appId),
        rows<{ app_id: string; checks: number; total: number; current: number }>(
            db,
            sql`WITH latest AS (
                    SELECT DISTINCT ON (app_id, device_id COLLATE "C") app_id, result
                    FROM update_checks
                    WHERE ${rawWindow('update_checks', noApp)}
                    ORDER BY app_id, device_id COLLATE "C", received_at DESC
                ),
                counts AS (
                    SELECT app_id, COUNT(*)::int AS checks FROM update_checks
                    WHERE ${rawWindow('update_checks', noApp)} GROUP BY 1
                )
                SELECT c.app_id, c.checks,
                       COUNT(l.*)::int AS total,
                       COUNT(l.*) FILTER (WHERE l.result = 'no_new_version_available')::int AS current
                FROM counts c LEFT JOIN latest l ON l.app_id = c.app_id
                GROUP BY 1, 2`
        )
    ]);

    const byApp = new Map<string, AppSummary>();
    for (const e of events) {
        byApp.set(e.appId, {
            appId: e.appId,
            activeDevices: e.activeDevices,
            updateChecks: 0,
            devicesUpdated: e.devicesUpdated,
            failedDevices: e.failedDevices,
            upToDate: null,
            lastSeen: e.lastSeen ? iso(e.lastSeen) : null
        });
    }
    for (const c of checks) {
        const row =
            byApp.get(c.app_id) ??
            ({
                appId: c.app_id,
                activeDevices: 0,
                updateChecks: 0,
                devicesUpdated: 0,
                failedDevices: 0,
                upToDate: null,
                lastSeen: null
            } satisfies AppSummary);
        row.updateChecks = c.checks;
        row.upToDate = c.total > 0 ? c.current / c.total : null;
        byApp.set(c.app_id, row);
    }
    // Rows written before /stats started rejecting unknown app ids can still
    // be in the window; only show registered apps.
    const registered = new Set((await db.select({ id: apps.id }).from(apps)).map((a) => a.id));
    return [...byApp.values()].filter((r) => registered.has(r.appId)).sort((a, b) => b.activeDevices - a.activeDevices);
}

// --- 10. Recent activity -----------------------------------------------------

export type RecentRow = {
    id: string;
    receivedAt: string;
    appId: string;
    deviceId: string;
    action: string | null;
    versionName: string | null;
    platform: string | null;
};

export async function recentActivity(db: Db, f: AnalyticsFilters, limit = 10): Promise<RecentRow[]> {
    const raw = await db
        .select({
            id: statsEvents.id,
            receivedAt: statsEvents.receivedAt,
            appId: statsEvents.appId,
            deviceId: statsEvents.deviceId,
            action: statsEvents.action,
            versionName: statsEvents.versionName,
            platform: statsEvents.platform
        })
        .from(statsEvents)
        .where(f.app_id ? eq(statsEvents.appId, f.app_id) : undefined)
        // Per app, (app_id, received_at) serves the order. Across apps, id
        // follows insert order, so the primary key does it without a
        // received_at btree.
        .orderBy(f.app_id ? desc(statsEvents.receivedAt) : desc(statsEvents.id))
        .limit(limit);
    return raw.map((r) => ({
        ...r,
        id: r.id.toString(),
        receivedAt: r.receivedAt.toISOString()
    }));
}
