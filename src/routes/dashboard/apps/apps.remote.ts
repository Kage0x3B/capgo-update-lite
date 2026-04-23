import { command, query } from '$app/server';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import { listApps, upsertApp } from '$lib/server/services/apps.js';
import { AppCreateSchema } from '$lib/server/validation/admin.js';

export const getApps = query(async () => {
    requireAdminSession();
    return withDb((db) => listApps(db));
});

export const createApp = command(AppCreateSchema, async (input) => {
    requireAdminSession();
    return withDb((db) => upsertApp(db, input));
});
