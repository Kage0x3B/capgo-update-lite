import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { bundles, statsEvents } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { compareSemver, parseSemver } from '$lib/server/semver.js';
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

/** All events emitted as a device resolves an update — used for the rollout funnel. */
const FUNNEL_ACTIONS = {
    downloadStart: 'download_zip_start',
    downloadComplete: 'download_complete',
    set: 'set',
    foreground: 'app_moved_to_foreground'
} as const;

// --- filter helpers ----------------------------------------------------------

function windowFilter(f: AnalyticsFilters) {
    const base = [gte(statsEvents.receivedAt, f.since), lt(statsEvents.receivedAt, f.until)];
    if (f.app_id) base.push(eq(statsEvents.appId, f.app_id));
    return and(...base);
}

function priorWindow(f: AnalyticsFilters): AnalyticsFilters {
    const span = f.until.getTime() - f.since.getTime();
    return { ...f, since: new Date(f.since.getTime() - span), until: new Date(f.since.getTime()) };
}

// --- 1. KPI strip ------------------------------------------------------------

export type Kpis = {
    activeDevices: number;
    activeDevicesPrev: number;
    updatesDelivered: number;
    updatesDeliveredPrev: number;
    failureRate: number;
    failureRatePrev: number;
    pendingFailedBundles: number;
    currentBundle: { version: string; releasedAt: string | null } | null;
};

export async function kpisForWindow(db: Db, f: AnalyticsFilters): Promise<Kpis> {
    const prev = priorWindow(f);
    const failureList = sql.raw(FAILURE_ACTIONS.map((a) => `'${a}'`).join(','));

    async function windowStats(w: AnalyticsFilters) {
        const [row] = await db
            .select({
                activeDevices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`,
                updatesDelivered: sql<number>`COUNT(*) FILTER (WHERE ${statsEvents.action} = 'set')::int`,
                failures: sql<number>`COUNT(*) FILTER (WHERE ${statsEvents.action} IN (${failureList}))::int`,
                totalOutcomes: sql<number>`COUNT(*) FILTER (WHERE ${statsEvents.action} = 'set' OR ${statsEvents.action} IN (${failureList}))::int`
            })
            .from(statsEvents)
            .where(windowFilter(w));
        return row;
    }

    const [cur, prior, pendingFailed, current] = await Promise.all([
        windowStats(f),
        windowStats(prev),
        db
            .select({ c: sql<number>`COUNT(*)::int` })
            .from(bundles)
            .where(
                and(f.app_id ? eq(bundles.appId, f.app_id) : undefined, sql`${bundles.state} IN ('pending','failed')`)
            )
            .then((r) => r[0]?.c ?? 0),
        currentActiveBundle(db, f.app_id)
    ]);

    return {
        activeDevices: cur.activeDevices ?? 0,
        activeDevicesPrev: prior.activeDevices ?? 0,
        updatesDelivered: cur.updatesDelivered ?? 0,
        updatesDeliveredPrev: prior.updatesDelivered ?? 0,
        failureRate: cur.totalOutcomes > 0 ? cur.failures / cur.totalOutcomes : 0,
        failureRatePrev: prior.totalOutcomes > 0 ? prior.failures / prior.totalOutcomes : 0,
        pendingFailedBundles: pendingFailed,
        currentBundle: current
    };
}

/** Most-recently-released bundle that is `active=true` and `state='active'`. */
async function currentActiveBundle(
    db: Db,
    app_id?: string
): Promise<{ version: string; releasedAt: string | null } | null> {
    const [row] = await db
        .select({ version: bundles.version, releasedAt: bundles.releasedAt })
        .from(bundles)
        .where(
            and(app_id ? eq(bundles.appId, app_id) : undefined, eq(bundles.active, true), eq(bundles.state, 'active'))
        )
        .orderBy(sql`${bundles.releasedAt} DESC NULLS LAST`)
        .limit(1);
    if (!row) return null;
    return {
        version: row.version,
        releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null
    };
}

// --- 2. Adoption by version --------------------------------------------------

export type AdoptionPoint = { t: string; version: string; devices: number };

export async function adoptionByVersion(db: Db, f: AnalyticsFilters): Promise<AdoptionPoint[]> {
    const bucketExpr =
        f.bucket === 'hour'
            ? sql`date_trunc('hour', ${statsEvents.receivedAt})`
            : sql`date_trunc('day', ${statsEvents.receivedAt})`;

    const rows = await db
        .select({
            t: sql<string>`${bucketExpr}`.as('t'),
            version: sql<string>`COALESCE(${statsEvents.versionName}, 'unknown')`.as('version'),
            devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`.as('devices')
        })
        .from(statsEvents)
        .where(and(windowFilter(f), eq(statsEvents.action, 'set')))
        .groupBy(sql`1, 2`)
        .orderBy(sql`1 ASC`);

    return rows.map((r) => ({ t: new Date(r.t).toISOString(), version: r.version, devices: r.devices }));
}

// --- 3. Rollout funnel -------------------------------------------------------

export type FunnelStage = { action: string; devices: number };

export type RolloutFunnel = {
    /** Currently-active bundle this funnel is measured against. `null` if none. */
    target: { version: string } | null;
    /**
     * Rolling estimate of installed devices: distinct device_ids that emitted
     * any event in the last 7 days, regardless of the dashboard window. Used
     * to derive the "haven't started this update yet" count.
     */
    activeDevices: number;
    /**
     * Each stage holds the raw stats action code (e.g. `download_zip_start`) so
     * the UI can map it through `actionLabel` consistently.
     */
    stages: FunnelStage[];
};

export async function rolloutFunnel(db: Db, f: AnalyticsFilters): Promise<RolloutFunnel> {
    const target = await currentActiveBundle(db, f.app_id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const activeFilter = and(
        gte(statsEvents.receivedAt, sevenDaysAgo),
        f.app_id ? eq(statsEvents.appId, f.app_id) : undefined
    );

    if (!target) {
        const [activeRow] = await db
            .select({ c: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int` })
            .from(statsEvents)
            .where(activeFilter);
        return { target: null, activeDevices: activeRow?.c ?? 0, stages: [] };
    }

    const [row, activeRow] = await Promise.all([
        db
            .select({
                downloadStart: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId}) FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.downloadStart})::int`,
                downloadComplete: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId}) FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.downloadComplete})::int`,
                set: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId}) FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.set})::int`,
                foreground: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId}) FILTER (WHERE ${statsEvents.action} = ${FUNNEL_ACTIONS.foreground})::int`
            })
            .from(statsEvents)
            .where(and(windowFilter(f), eq(statsEvents.versionName, target.version)))
            .then((r) => r[0]),
        db
            .select({ c: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int` })
            .from(statsEvents)
            .where(activeFilter)
            .then((r) => r[0])
    ]);

    return {
        target: { version: target.version },
        activeDevices: activeRow?.c ?? 0,
        stages: [
            { action: FUNNEL_ACTIONS.downloadStart, devices: row?.downloadStart ?? 0 },
            { action: FUNNEL_ACTIONS.downloadComplete, devices: row?.downloadComplete ?? 0 },
            { action: FUNNEL_ACTIONS.set, devices: row?.set ?? 0 },
            { action: FUNNEL_ACTIONS.foreground, devices: row?.foreground ?? 0 }
        ]
    };
}

// --- 4. Failure breakdown ----------------------------------------------------

/** Per-version failure totals plus the failure actions reported against that version. */
export type FailureRow = {
    version: string;
    count: number;
    actions: { action: string; count: number }[];
};

const FAILURE_ACTIONS_PER_VERSION = 8;

export async function failureBreakdown(db: Db, f: AnalyticsFilters): Promise<FailureRow[]> {
    const failureList = sql.raw(FAILURE_ACTIONS.map((a) => `'${a}'`).join(','));
    const rows = await db
        .select({
            version: sql<string>`COALESCE(${statsEvents.versionName}, 'unknown')`.as('version'),
            action: sql<string>`${statsEvents.action}`.as('action'),
            count: sql<number>`COUNT(*)::int`.as('count')
        })
        .from(statsEvents)
        .where(and(windowFilter(f), sql`${statsEvents.action} IN (${failureList})`))
        .groupBy(sql`1`, statsEvents.action)
        .orderBy(sql`COUNT(*) DESC`);

    const byVersion = new Map<string, FailureRow>();
    for (const r of rows) {
        let row = byVersion.get(r.version);
        if (!row) {
            row = { version: r.version, count: 0, actions: [] };
            byVersion.set(r.version, row);
        }
        row.count += r.count;
        row.actions.push({ action: r.action, count: r.count });
    }
    return [...byVersion.values()]
        .map((r) => ({
            ...r,
            actions: r.actions.sort((a, b) => b.count - a.count).slice(0, FAILURE_ACTIONS_PER_VERSION)
        }))
        .sort((a, b) => b.count - a.count);
}

// --- 5. Platform split -------------------------------------------------------

export type PlatformRow = { platform: string; devices: number };

export async function platformSplit(db: Db, f: AnalyticsFilters): Promise<PlatformRow[]> {
    const rows = await db
        .select({
            platform: sql<string>`COALESCE(${statsEvents.platform}, 'unknown')`.as('platform'),
            devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`.as('devices')
        })
        .from(statsEvents)
        .where(windowFilter(f))
        .groupBy(sql`1`)
        .orderBy(sql`2 DESC`);
    return rows;
}

// --- 6. Plugin-version spread -----------------------------------------------

export type PluginRow = { plugin_version: string; devices: number };

export async function pluginVersionSpread(db: Db, f: AnalyticsFilters): Promise<PluginRow[]> {
    const rows = await db
        .select({
            plugin_version: sql<string>`COALESCE(${statsEvents.pluginVersion}, 'unknown')`.as('plugin_version'),
            devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`.as('devices')
        })
        .from(statsEvents)
        .where(windowFilter(f))
        .groupBy(sql`1`)
        .orderBy(sql`2 DESC`)
        .limit(10);
    return rows;
}

// --- 7. Auto-rollback incidents ---------------------------------------------

export type RollbackRow = {
    from_v: string;
    to_v: string;
    devices: number;
    last_seen: string;
};

export async function autoRollbacks(db: Db, f: AnalyticsFilters): Promise<RollbackRow[]> {
    const rows = await db
        .select({
            from_v: sql<string>`${statsEvents.oldVersionName}`.as('from_v'),
            to_v: sql<string>`${statsEvents.versionName}`.as('to_v'),
            devices: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`.as('devices'),
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
    return rows
        .filter((r) => {
            const a = parseSemver(r.from_v);
            const b = parseSemver(r.to_v);
            if (!a || !b) return false;
            return compareSemver(a, b) > 0;
        })
        .map((r) => ({ ...r, last_seen: new Date(r.last_seen).toISOString() }))
        .sort((a, b) => b.devices - a.devices);
}

// --- 8. Update-check rate sparkline -----------------------------------------

export type CheckRatePoint = { t: string; count: number };

export async function updateCheckRate(db: Db, f: AnalyticsFilters): Promise<CheckRatePoint[]> {
    // Proxy: `set` + `noNew` + `missingBundle` events are emitted per /updates response.
    const bucketExpr =
        f.bucket === 'hour'
            ? sql`date_trunc('hour', ${statsEvents.receivedAt})`
            : sql`date_trunc('day', ${statsEvents.receivedAt})`;
    const rows = await db
        .select({
            t: sql<string>`${bucketExpr}`.as('t'),
            count: sql<number>`COUNT(*)::int`.as('count')
        })
        .from(statsEvents)
        .where(and(windowFilter(f), sql`${statsEvents.action} IN ('set','noNew','missingBundle')`))
        .groupBy(sql`1`)
        .orderBy(sql`1 ASC`);

    // Zero-fill every bucket in the window so the sparkline always has a full
    // baseline — without this, a window with 1 active bucket renders a single
    // moveto and nothing visible.
    const byBucket = new Map(rows.map((r) => [new Date(r.t).getTime(), r.count]));
    const out: CheckRatePoint[] = [];
    const cur = new Date(f.since);
    if (f.bucket === 'hour') cur.setUTCMinutes(0, 0, 0);
    else cur.setUTCHours(0, 0, 0, 0);
    while (cur < f.until) {
        out.push({ t: cur.toISOString(), count: byBucket.get(cur.getTime()) ?? 0 });
        if (f.bucket === 'hour') cur.setUTCHours(cur.getUTCHours() + 1);
        else cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

// --- 9. Bundle state summary -------------------------------------------------

export type BundleStateRow = { app_id: string; state: string; count: number };

export async function bundleStateSummary(db: Db, app_id?: string): Promise<BundleStateRow[]> {
    const rows = await db
        .select({
            app_id: bundles.appId,
            state: bundles.state,
            count: sql<number>`COUNT(*)::int`.as('count')
        })
        .from(bundles)
        .where(app_id ? eq(bundles.appId, app_id) : undefined)
        .groupBy(bundles.appId, bundles.state)
        .orderBy(bundles.appId, bundles.state);
    return rows;
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
    const rows = await db
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
        .orderBy(sql`${statsEvents.receivedAt} DESC`)
        .limit(limit);
    return rows.map((r) => ({
        ...r,
        id: r.id.toString(),
        receivedAt: r.receivedAt.toISOString()
    }));
}
