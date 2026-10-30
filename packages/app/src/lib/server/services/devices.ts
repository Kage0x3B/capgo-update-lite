import { and, desc, eq, sql } from 'drizzle-orm';
import { statsEvents, updateChecks } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';

/** How far back the device list looks. */
const DEVICE_LIST_DAYS = 7;

export type DeviceListRow = {
    deviceId: string;
    lastSeen: string;
    platform: string | null;
    channel: string | null;
    versionName: string | null;
    versionBuild: string | null;
    pluginVersion: string | null;
    customId: string | null;
    lastResult: string;
    checks: number;
};

/**
 * Devices that called /updates recently, newest first, with the result of
 * their latest check. `search` matches a device id prefix or a custom_id.
 */
export async function listDevices(
    db: Db,
    appId: string,
    opts: { search?: string; result?: string; limit?: number } = {}
): Promise<DeviceListRow[]> {
    const since = new Date(Date.now() - DEVICE_LIST_DAYS * 24 * 60 * 60 * 1000);
    const search = opts.search?.trim().toLowerCase();
    const searchSql = search
        ? sql` AND (device_id LIKE ${search.replace(/[%_\\]/g, '\\$&') + '%'} OR LOWER(custom_id) = ${search})`
        : sql``;
    const resultSql = opts.result ? sql` WHERE result = ${opts.result}` : sql``;
    const limit = Math.min(opts.limit ?? 100, 500);

    const rows = (await db.execute(sql`
        WITH latest AS (
            SELECT DISTINCT ON (device_id COLLATE "C")
                   device_id, received_at, platform, channel, version_name, version_build,
                   plugin_version, custom_id, result,
                   COUNT(*) OVER (PARTITION BY device_id)::int AS checks
            FROM update_checks
            WHERE app_id = ${appId} AND received_at >= ${since.toISOString()}::timestamptz${searchSql}
            ORDER BY device_id COLLATE "C", received_at DESC
        )
        SELECT * FROM latest${resultSql}
        ORDER BY received_at DESC
        LIMIT ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
        deviceId: r.device_id as string,
        lastSeen: new Date(r.received_at as string).toISOString(),
        platform: (r.platform as string | null) ?? null,
        channel: (r.channel as string | null) ?? null,
        versionName: (r.version_name as string | null) ?? null,
        versionBuild: (r.version_build as string | null) ?? null,
        pluginVersion: (r.plugin_version as string | null) ?? null,
        customId: (r.custom_id as string | null) ?? null,
        lastResult: r.result as string,
        checks: r.checks as number
    }));
}

export type TimelineEntry =
    | {
          kind: 'check';
          id: string;
          at: string;
          result: string;
          detail: string | null;
          channel: string | null;
          versionName: string | null;
          versionBuild: string | null;
          bundleVersion: string | null;
          candidates: number | null;
      }
    | {
          kind: 'event';
          id: string;
          at: string;
          action: string | null;
          versionName: string | null;
          oldVersionName: string | null;
      };

export type DeviceDetail = {
    deviceId: string;
    firstSeen: string | null;
    lastSeen: string | null;
    platform: string | null;
    channel: string | null;
    versionName: string | null;
    versionBuild: string | null;
    versionCode: string | null;
    versionOs: string | null;
    pluginVersion: string | null;
    customId: string | null;
    country: string | null;
    isEmulator: boolean | null;
    isProd: boolean | null;
    timeline: TimelineEntry[];
};

/**
 * Everything we know about one device: its latest reported context plus a
 * merged timeline of update checks and plugin events, newest first.
 */
export async function deviceDetail(db: Db, appId: string, deviceId: string, limit = 300): Promise<DeviceDetail> {
    const id = deviceId.toLowerCase();
    const [checks, events, span] = await Promise.all([
        db
            .select()
            .from(updateChecks)
            .where(and(eq(updateChecks.appId, appId), eq(updateChecks.deviceId, id)))
            .orderBy(desc(updateChecks.receivedAt))
            .limit(limit),
        db
            .select()
            .from(statsEvents)
            .where(and(eq(statsEvents.appId, appId), eq(statsEvents.deviceId, id)))
            .orderBy(desc(statsEvents.receivedAt))
            .limit(limit),
        db
            .execute(
                sql`SELECT LEAST(
                    (SELECT MIN(received_at) FROM update_checks WHERE app_id = ${appId} AND device_id = ${id}),
                    (SELECT MIN(received_at) FROM stats_events WHERE app_id = ${appId} AND device_id = ${id})
                ) AS first`
            )
            .then((r) => (r as unknown as Array<{ first: string | Date | null }>)[0]?.first ?? null)
    ]);

    const lastCheck = checks[0];
    const lastEvent = events[0];
    const timeline: TimelineEntry[] = [
        ...checks.map(
            (c): TimelineEntry => ({
                kind: 'check',
                id: `c${c.id}`,
                at: c.receivedAt.toISOString(),
                result: c.result,
                detail: c.detail,
                channel: c.channel,
                versionName: c.versionName,
                versionBuild: c.versionBuild,
                bundleVersion: c.bundleVersion,
                candidates: c.candidates
            })
        ),
        ...events.map(
            (e): TimelineEntry => ({
                kind: 'event',
                id: `e${e.id}`,
                at: e.receivedAt.toISOString(),
                action: e.action,
                versionName: e.versionName,
                oldVersionName: e.oldVersionName
            })
        )
    ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);

    const newest = [lastCheck?.receivedAt, lastEvent?.receivedAt]
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
        deviceId: id,
        firstSeen: span ? new Date(span).toISOString() : null,
        lastSeen: newest ? newest.toISOString() : null,
        platform: lastCheck?.platform ?? lastEvent?.platform ?? null,
        channel: lastCheck?.channel ?? lastEvent?.channel ?? null,
        versionName: lastCheck?.versionName ?? lastEvent?.versionName ?? null,
        versionBuild: lastCheck?.versionBuild ?? lastEvent?.versionBuild ?? null,
        versionCode: lastCheck?.versionCode ?? lastEvent?.versionCode ?? null,
        versionOs: lastCheck?.versionOs ?? lastEvent?.versionOs ?? null,
        pluginVersion: lastCheck?.pluginVersion ?? lastEvent?.pluginVersion ?? null,
        customId: lastCheck?.customId ?? lastEvent?.customId ?? null,
        country: lastCheck?.country ?? lastEvent?.country ?? null,
        isEmulator: lastCheck?.isEmulator ?? lastEvent?.isEmulator ?? null,
        isProd: lastCheck?.isProd ?? lastEvent?.isProd ?? null,
        timeline
    };
}
