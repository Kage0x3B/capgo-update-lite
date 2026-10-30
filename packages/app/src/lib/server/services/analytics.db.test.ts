/**
 * Integration tests for the SQL behind the dashboard. They need a real
 * Postgres: set TEST_DATABASE_URL to an empty database you don't mind being
 * wiped (migrations run on it, every table is truncated). Skipped otherwise.
 *
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:18-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import {
    adoptionByVersion,
    appSummaries,
    channelSplit,
    failureBreakdown,
    kpisForWindow,
    latestBundlePerChannel,
    nativeVersionSpread,
    pluginVersionSpread,
    recentActivity,
    rolloutFunnels,
    updateOutcomeTable,
    updateOutcomesOverTime
} from './analytics.js';
import { appsNeedingAttention, bundleHealthForApp } from './bundleHealth.js';
import { deviceDetail, listDevices } from './devices.js';
import { listBundles } from './bundles.js';
import { pruneStats } from '../cron/pruneStats.js';
import { recordUpdateCheck } from './updateChecks.js';
import type { AnalyticsFilters } from '$lib/server/validation/analytics.js';

const url = process.env.TEST_DATABASE_URL;
const APP = 'com.example.app';
const D1 = '00000000-0000-4000-8000-000000000001';
const D2 = '00000000-0000-4000-8000-000000000002';
const D3 = '00000000-0000-4000-8000-000000000003';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe.skipIf(!url)('analytics SQL (Postgres)', () => {
    let client: postgres.Sql;
    let db: Db;
    const f = (): AnalyticsFilters => ({
        app_id: APP,
        since: hoursAgo(24 * 7),
        until: new Date(Date.now() + 60_000),
        bucket: 'day'
    });

    beforeAll(async () => {
        // Same options as createDb() so type handling matches production.
        client = postgres(url!, { max: 2, fetch_types: false, onnotice: () => {} });
        db = drizzle(client, { schema }) as unknown as Db;
        await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)) });
        await db.execute(
            sql`TRUNCATE apps, bundles, stats_events, update_checks, admin_tokens RESTART IDENTITY CASCADE`
        );

        await db.insert(schema.apps).values({ id: APP, name: 'Example' });
        const bundle = (version: string, channel = 'production', active = true) => ({
            appId: APP,
            channel,
            version,
            r2Key: `${APP}/${version}.zip`,
            minAndroidBuild: '1.0.0',
            minIosBuild: '1.0.0',
            nativePackages: {},
            active,
            state: 'active',
            releasedAt: hoursAgo(48)
        });
        // 1.10.0 must sort above 1.9.0 (semver, not string order).
        await db
            .insert(schema.bundles)
            .values([bundle('1.9.0'), bundle('1.10.0'), bundle('1.2.0', 'beta'), bundle('1.0.0', 'production', false)]);

        const ev = (deviceId: string, action: string, versionName: string, h: number, extra = {}) => ({
            appId: APP,
            deviceId,
            action,
            versionName,
            platform: 'ios',
            pluginVersion: '8.45.0',
            isEmulator: false,
            isProd: true,
            receivedAt: hoursAgo(h),
            ...extra
        });
        await db.insert(schema.statsEvents).values([
            ev(D1, 'app_moved_to_foreground', '1.9.0', 30),
            ev(D1, 'download_zip_start', '1.10.0', 5),
            ev(D1, 'download_complete', '1.10.0', 5),
            ev(D1, 'set', '1.10.0', 4, { oldVersionName: '1.9.0' }),
            ev(D2, 'download_zip_start', '1.10.0', 3, { platform: 'android', pluginVersion: '8.40.0' }),
            ev(D2, 'download_fail', '1.10.0', 3, { platform: 'android', pluginVersion: '8.40.0' }),
            ev(D2, 'download_fail', '1.10.0', 2, { platform: 'android', pluginVersion: '8.40.0' }),
            ev(D3, 'update_fail', '1.10.0', 1),
            // Older than the retention used below; must be pruned.
            ev(D3, 'app_moved_to_foreground', '1.9.0', 24 * 40)
        ]);

        const body = (deviceId: string, versionName: string, versionBuild: string, channel?: string) => ({
            app_id: APP,
            device_id: deviceId,
            version_name: versionName,
            version_build: versionBuild,
            platform: 'ios',
            plugin_version: '8.45.0',
            is_emulator: false,
            is_prod: true,
            defaultChannel: channel
        });
        await recordUpdateCheck(db, body(D1, '1.9.0', '2.0.0'), 'DE', {
            result: 'update',
            bundleId: 2,
            bundleVersion: '1.10.0',
            candidates: 2
        });
        await recordUpdateCheck(db, body(D1, '1.10.0', '2.0.0'), 'DE', { result: 'no_new_version_available' });
        await recordUpdateCheck(db, body(D2, '1.9.0', '0.9.0'), null, {
            result: 'below_min_native_build',
            detail: 'native 0.9.0 < 1.0.0'
        });
        await recordUpdateCheck(db, body(D3, '1.0.0', '2.0.0', 'beta'), null, { result: 'update' });
        // Unknown app: must not be stored.
        await recordUpdateCheck(db, { ...body(D1, '1', '1'), app_id: 'com.nope.app' }, null, {
            result: 'invalid_request'
        });
    });

    afterAll(async () => {
        await client?.end();
    });

    it('drops update checks for unknown apps', async () => {
        const [row] = await db.execute(sql`SELECT COUNT(*)::int AS n FROM update_checks`);
        expect((row as { n: number }).n).toBe(4);
    });

    it('picks the newest semver per channel', async () => {
        const latest = await latestBundlePerChannel(db, APP);
        expect(latest.map((b) => [b.channel, b.version])).toEqual([
            ['beta', '1.2.0'],
            ['production', '1.10.0']
        ]);
    });

    it('sorts bundle lists by channel, then semver', async () => {
        const list = await listBundles(db, { app_id: APP });
        expect(list.map((b) => `${b.channel}:${b.version}`)).toEqual([
            'beta:1.2.0',
            'production:1.10.0',
            'production:1.9.0',
            'production:1.0.0'
        ]);
    });

    it('computes KPIs from devices, not events', async () => {
        const k = await kpisForWindow(db, f());
        expect(k.activeDevices).toBe(3);
        expect(k.devicesUpdated).toBe(1);
        // D2 (download_fail) and D3 (update_fail) failed; all three attempted.
        expect(k.failureRate).toBeCloseTo(2 / 3);
        expect(k.updateChecks).toBe(4);
        // Latest check per device: D1 up to date, D2 blocked, D3 served.
        expect(k.upToDate).toBeCloseTo(1 / 3);
    });

    it('counts each device once per bucket in adoption', async () => {
        const a = await adoptionByVersion(db, { ...f(), bucket: 'hour', since: hoursAgo(6) });
        expect(a.versions).toEqual(['1.10.0']);
        // Hourly: D1 spans two buckets (two events share one), D2 two, D3 one.
        expect(a.points.reduce((s, p) => s + p.devices, 0)).toBe(5);
        expect(a.buckets.length).toBeGreaterThanOrEqual(6);
    });

    it('breaks down update outcomes', async () => {
        const over = await updateOutcomesOverTime(db, f());
        expect(over.reduce((s, p) => s + p.checks, 0)).toBe(4);
        const table = await updateOutcomeTable(db, f());
        const blocked = table.find((r) => r.result === 'below_min_native_build');
        expect(blocked).toMatchObject({ devices: 1, checks: 1, nativeVersions: ['0.9.0'] });
        // D1's first check served an update but its latest says up to date.
        expect(table.find((r) => r.result === 'update' && r.channel === 'production')?.devices).toBe(0);
    });

    it('builds one funnel per channel', async () => {
        const funnels = await rolloutFunnels(db, f());
        const prod = funnels.find((x) => x.channel === 'production')!;
        expect(prod.target.version).toBe('1.10.0');
        expect(prod.stages.map((s) => s.devices)).toEqual([2, 1, 1]);
        expect(prod.activeDevices).toBe(2);
    });

    it('splits devices by their latest value', async () => {
        expect(await pluginVersionSpread(db, f())).toEqual(
            expect.arrayContaining([
                { plugin_version: '8.45.0', devices: 2 },
                { plugin_version: '8.40.0', devices: 1 }
            ])
        );
        expect(await channelSplit(db, f())).toEqual(
            expect.arrayContaining([
                { value: 'production', devices: 2 },
                { value: 'beta', devices: 1 }
            ])
        );
        const native = await nativeVersionSpread(db, f());
        expect(native.map((r) => r.version)).toEqual(['2.0.0', '0.9.0']);
    });

    it('reports failures per device', async () => {
        const rows = await failureBreakdown(db, f());
        expect(rows[0]).toMatchObject({ version: '1.10.0', devices: 2, count: 3 });
    });

    it('summarises apps and recent activity', async () => {
        const [s] = await appSummaries(db, f());
        expect(s).toMatchObject({ appId: APP, activeDevices: 3, updateChecks: 4, failedDevices: 2 });
        const recent = await recentActivity(db, f(), 3);
        expect(recent[0].action).toBe('update_fail');
        const global = await recentActivity(db, { ...f(), app_id: undefined }, 1);
        expect(global).toHaveLength(1);
    });

    it('lists devices and builds a timeline', async () => {
        const devices = await listDevices(db, APP);
        expect(devices).toHaveLength(3);
        const blocked = await listDevices(db, APP, { result: 'below_min_native_build' });
        expect(blocked.map((d) => d.deviceId)).toEqual([D2]);
        const byPrefix = await listDevices(db, APP, { search: '00000000-0000-4000-8000-00000000000' });
        expect(byPrefix).toHaveLength(3);

        const d = await deviceDetail(db, APP, D1.toUpperCase());
        expect(d.versionBuild).toBe('2.0.0');
        expect(d.country).toBe('DE');
        expect(d.timeline.filter((t) => t.kind === 'check')).toHaveLength(2);
        expect(d.timeline.filter((t) => t.kind === 'event')).toHaveLength(4);
        expect(d.firstSeen).not.toBeNull();
    });

    it('computes bundle health in one pass', async () => {
        const rows = await bundleHealthForApp(db, {}, APP);
        const latest = rows.find((r) => r.version === '1.10.0')!;
        // Attempts count set + breaking failures: D1 (set) and D3 (update_fail).
        expect(latest).toMatchObject({ attemptedDevices: 2, failedDevices: 1 });
        expect(rows.map((r) => r.version)).toEqual(['1.2.0', '1.10.0', '1.9.0', '1.0.0']);
        const attention = await appsNeedingAttention(db, {});
        expect(attention[0]?.appId).toBe(APP);
    });

    it('prunes both event tables', async () => {
        const deleted = await pruneStats(db, { STATS_RETENTION_DAYS: '30' });
        expect(deleted).toBe(1);
    });
});
