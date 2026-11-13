/**
 * Integration tests for app soft delete. Same setup as analytics.db.test.ts:
 * needs TEST_DATABASE_URL pointing at a throwaway Postgres (it runs
 * migrations and truncates every table). Skipped otherwise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { deleteApp, getApp, listApps, patchApp, upsertApp } from './apps.js';
import { appsNeedingAttention } from './bundleHealth.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app soft delete (Postgres)', () => {
    let client: postgres.Sql;
    let db: Db;

    beforeAll(async () => {
        client = postgres(url!, { max: 2, fetch_types: false, onnotice: () => {} });
        db = drizzle(client, { schema }) as unknown as Db;
        await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)) });
        await db.execute(
            sql`TRUNCATE apps, bundles, stats_events, update_checks, admin_tokens RESTART IDENTITY CASCADE`
        );
        await upsertApp(db, { id: 'com.keep.app', name: 'Keep' });
        await upsertApp(db, { id: 'com.gone.app', name: 'Gone' });
        await patchApp(db, 'com.gone.app', { min_plugin_version: '6.0.0' });
    });

    afterAll(async () => {
        await client?.end({ timeout: 5 });
    });

    it('hides a deleted app from lists and lookups but keeps the row', async () => {
        const row = await deleteApp(db, 'com.gone.app');
        expect(row.deletedAt).toBeInstanceOf(Date);

        expect((await listApps(db)).map((a) => a.id)).toEqual(['com.keep.app']);
        await expect(getApp(db, 'com.gone.app')).rejects.toMatchObject({ status: 404 });
        await expect(patchApp(db, 'com.gone.app', { name: 'x' })).rejects.toMatchObject({ status: 404 });
        expect((await appsNeedingAttention(db, {})).map((a) => a.appId)).not.toContain('com.gone.app');

        const [stored] = await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM apps WHERE id = 'com.gone.app'`
        );
        expect(stored.n).toBe(1);
    });

    it('refuses to delete twice or delete an unknown app', async () => {
        await expect(deleteApp(db, 'com.gone.app')).rejects.toMatchObject({ status: 404 });
        await expect(deleteApp(db, 'com.never.app')).rejects.toMatchObject({ status: 404 });
    });

    it('restores the app with its settings when the id is added again', async () => {
        const row = await upsertApp(db, { id: 'com.gone.app', name: 'Back' });
        expect(row).toMatchObject({ name: 'Back', deletedAt: null, minPluginVersion: '6.0.0' });
        expect((await listApps(db)).map((a) => a.id).sort()).toEqual(['com.gone.app', 'com.keep.app']);
    });
});
