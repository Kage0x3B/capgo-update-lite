import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import { getApp, listApps, patchApp, upsertApp } from '$lib/server/services/apps.js';
import { AppCreateSchema, AppIdParamsSchema, AppPatchSchema } from '$lib/server/validation/admin.js';

export const getApps = query(async () => {
    requireAdminSession();
    return withDb((db) => listApps(db));
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
