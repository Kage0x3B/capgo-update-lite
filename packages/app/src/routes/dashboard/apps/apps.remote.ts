import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { platformEnv, withDb } from '$lib/server/remote-helpers.js';
import { getApp, listApps, patchApp, upsertApp } from '$lib/server/services/apps.js';
import { appsNeedingAttention, type BundleHealthEnv } from '$lib/server/services/bundleHealth.js';
import { AppCreateSchema, AppIdParamsSchema, AppPatchSchema } from '$lib/server/validation/admin.js';

export const getApps = query(async () => {
    requireAdminSession();
    return withDb((db) => listApps(db));
});

/**
 * App list + per-app health summary in one round trip. The list table renders
 * `auto-disabled / at-risk / warnings` badges based on this payload — empty
 * map for an app means "everything healthy" and no badge is shown.
 */
export const getAppsWithHealth = query(async () => {
    requireAdminSession();
    const env = platformEnv() as unknown as BundleHealthEnv;
    return withDb(async (db) => {
        const [list, attention] = await Promise.all([listApps(db), appsNeedingAttention(db, env)]);
        const byId = new Map(attention.map((a) => [a.appId, a]));
        return list.map((app) => ({
            ...app,
            attention: byId.get(app.id) ?? null
        }));
    });
});

export const getAppById = query(AppIdParamsSchema, async ({ id }) => {
    requireAdminSession();
    return withDb((db) => getApp(db, id));
});

export const createApp = command(AppCreateSchema, async (input) => {
    requireAdminSession();
    return withDb((db) => upsertApp(db, input));
});

const PatchAppInputSchema = v.object({
    id: AppIdParamsSchema.entries.id,
    patch: AppPatchSchema
});
export const patchAppCommand = command(PatchAppInputSchema, async ({ id, patch }) => {
    requireAdminSession();
    return withDb((db) => patchApp(db, id, patch));
});
