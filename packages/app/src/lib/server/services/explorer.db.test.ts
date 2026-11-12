/**
 * Integration tests for the stats explorer SQL. Same setup as
 * analytics.db.test.ts: needs TEST_DATABASE_URL pointing at a throwaway
 * Postgres (it runs migrations and truncates every table). Skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { parseQuery } from '$lib/util/explorer.js';
import {
    explorerFacets,
    explorerGroups,
    explorerHistogram,
    explorerRowContext,
    explorerRows,
    explorerSummaryWithPrior
} from './explorer.js';

const url = process.env.TEST_DATABASE_URL;
const APP = 'com.example.app';
const OTHER = 'com.other.app';
const D1 = '00000000-0000-4000-8000-000000000001';
const D2 = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-12T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const q = (s: string) => parseQuery(new URLSearchParams(s));

describe.skipIf(!url)('explorer SQL (Postgres)', () => {
    let client: postgres.Sql;
    let db: Db;

    beforeAll(async () => {
        client = postgres(url!, { max: 2, fetch_types: false, onnotice: () => {} });
        db = drizzle(client, { schema }) as unknown as Db;
        await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)) });
        await db.execute(
            sql`TRUNCATE apps, bundles, stats_events, update_checks, admin_tokens RESTART IDENTITY CASCADE`
        );
        const ev = (m: number, deviceId: string, action: string, extra: Partial<schema.NewStatsEvent> = {}) => ({
            receivedAt: minsAgo(m),
            appId: APP,
            deviceId,
            action,
            versionName: '1.0.0',
            platform: 'ios',
            channel: 'production',
            isProd: true,
            isEmulator: false,
            ...extra
        });
        await db.insert(schema.statsEvents).values([
            ev(5, D1, 'set', { versionName: '1.1.0', oldVersionName: '1.0.0' }),
            ev(6, D1, 'download_complete', { versionName: '1.1.0' }),
            ev(7, D1, 'app_moved_to_foreground'),
            ev(8, D2, 'set_fail', { platform: 'android', versionName: '1.1.0' }),
            ev(9, D2, 'download_fail', { platform: 'android', versionName: '1.1.0', customId: 'Alice' }),
            ev(10, D2, 'app_moved_to_background', { platform: 'android' }),
            ev(70, D1, 'set', { channel: 'beta' }), // 70 minutes ago: outside 1h
            ev(4, D1, 'set', { appId: OTHER })
        ]);
        const ck = (m: number, deviceId: string, result: string, extra: Partial<schema.NewUpdateCheck> = {}) => ({
            receivedAt: minsAgo(m),
            appId: APP,
            deviceId,
            result,
            versionName: '1.0.0',
            platform: 'ios',
            channel: 'production',
            ...extra
        });
        await db
            .insert(schema.updateChecks)
            .values([
                ck(5.5, D1, 'update', { bundleVersion: '1.1.0', bundleId: 1, candidates: 1 }),
                ck(8.5, D2, 'below_min_native_build', { platform: 'android', detail: 'min 2.0.0' }),
                ck(20, D2, 'no_new_version_available', { platform: 'android' })
            ]);
    });

    afterAll(async () => {
        await client?.end({ timeout: 5 });
    });

    const opts = { now: NOW };

    it('lists events newest first and hides app open/close by default', async () => {
        const page = await explorerRows(db, q('range=1h&app=' + APP), opts);
        expect(page.rows.map((r) => r.action)).toEqual(['set', 'download_complete', 'set_fail', 'download_fail']);
        expect(page.next).toBeNull();
        expect(page.rows[0]).toMatchObject({ kind: 'event', oldVersionName: '1.0.0', versionName: '1.1.0' });
    });

    it('shows app state when asked, or when the action is picked explicitly', async () => {
        const all = await explorerRows(db, q('range=1h&appstate=1&app=' + APP), opts);
        expect(all.rows).toHaveLength(6);
        const picked = await explorerRows(db, q('range=1h&action=app_moved_to_foreground'), opts);
        expect(picked.rows).toHaveLength(1);
    });

    it('merges both sources in time order', async () => {
        const page = await explorerRows(db, q('src=all&range=1h&app=' + APP), opts);
        expect(page.rows.map((r) => r.action ?? r.result)).toEqual([
            'set',
            'update',
            'download_complete',
            'set_fail',
            'below_min_native_build',
            'download_fail',
            'no_new_version_available'
        ]);
    });

    it('pages with a cursor without gaps or duplicates', async () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await explorerRows(db, q('src=all&range=1h&appstate=1'), { ...opts, cursor, limit: 2 });
            seen.push(...page.rows.map((r) => r.kind + r.id));
            cursor = page.next ?? undefined;
        } while (cursor);
        const full = await explorerRows(db, q('src=all&range=1h&appstate=1'), { ...opts, limit: 100 });
        expect(seen).toEqual(full.rows.map((r) => r.kind + r.id));
    });

    it('expands groups, excludes values and limits sources by column', async () => {
        const fails = await explorerRows(db, q('src=all&range=1h&action=@failure'), opts);
        // Filtering by action means "events": checks have no action column.
        expect(fails.rows.map((r) => r.action)).toEqual(['set_fail', 'download_fail']);

        const blocked = await explorerRows(db, q('src=all&range=1h&result=@blocked'), opts);
        expect(blocked.rows.map((r) => r.result)).toEqual(['below_min_native_build']);

        const notIos = await explorerRows(db, q('range=1h&platform=!ios'), opts);
        expect(new Set(notIos.rows.map((r) => r.platform))).toEqual(new Set(['android']));
    });

    it('searches device id and custom id by prefix', async () => {
        const byCustom = await explorerRows(db, q('range=1h&q=ali'), opts);
        expect(byCustom.rows.map((r) => r.action)).toEqual(['download_fail']);
        const byDevice = await explorerRows(db, q('range=1h&q=00000000-0000-4000-8000-000000000002'), opts);
        expect(byDevice.rows.every((r) => r.deviceId === D2)).toBe(true);
        // LIKE wildcards in the search are literal.
        const wild = await explorerRows(db, q('range=1h&q=%25'), opts);
        expect(wild.rows).toHaveLength(0);
    });

    it('summarises the window and the one before it', async () => {
        const { current, prior } = await explorerSummaryWithPrior(db, q('src=all&range=1h&app=' + APP), NOW);
        expect(current).toEqual({ events: 4, checks: 3, devices: 2, failures: 2, served: 1, blocked: 1 });
        expect(prior.events).toBe(1); // the beta install 70 minutes ago
    });

    it('buckets the histogram by action group', async () => {
        const h = await explorerHistogram(db, q('range=1h&app=' + APP), NOW);
        expect(h.bucketSeconds).toBe(60);
        expect(h.buckets).toHaveLength(60);
        const byKey: Record<string, number> = {};
        for (const p of h.points) byKey[p.key] = (byKey[p.key] ?? 0) + p.n;
        expect(byKey).toEqual({ lifecycle: 1, download: 1, failure: 2 });
    });

    it('computes facets ignoring their own filter', async () => {
        const f = await explorerFacets(db, q('range=1h&platform=android'), NOW);
        // Platform facet still offers ios even though android is selected.
        expect(f.platform?.map((x) => x.value).sort()).toEqual(['android', 'ios']);
        // Other facets respect the platform filter.
        expect(f.action?.map((x) => x.value).sort()).toEqual(['download_fail', 'set_fail']);
        expect(f.result).toBeUndefined();
    });

    it('groups rows by a dimension', async () => {
        const g = await explorerGroups(db, q('src=all&range=1h&app=' + APP), 'device', opts);
        expect(g.map((x) => [x.value, x.n])).toEqual([
            [D2, 4],
            [D1, 3]
        ]);
    });

    it('loads one row with the same device around it', async () => {
        const page = await explorerRows(db, q('range=1h&action=set_fail'), opts);
        const ctx = await explorerRowContext(db, 'event', page.rows[0].id);
        expect(ctx.row?.action).toBe('set_fail');
        expect(ctx.around.every((r) => r.deviceId === D2)).toBe(true);
        expect(ctx.around.map((r) => r.action ?? r.result)).toContain('below_min_native_build');
    });
});
