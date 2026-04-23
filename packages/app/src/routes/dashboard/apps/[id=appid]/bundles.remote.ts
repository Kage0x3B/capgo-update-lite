import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { platformEnv, withDb } from '$lib/server/remote-helpers.js';
import * as svc from '$lib/server/services/bundles.js';
import { BundleCommitSchema, BundleInitSchema, BundlePatchSchema } from '$lib/server/validation/admin.js';

const AppIdSchema = v.object({
    app_id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(\.[\w-]+)+$/i), v.maxLength(128))
});

export const getBundles = query(AppIdSchema, async ({ app_id }) => {
    requireAdminSession();
    return withDb((db) => svc.listBundles(db, { app_id }));
});

export const initBundle = command(BundleInitSchema, async (input) => {
    requireAdminSession();
    return withDb((db) => svc.initBundle(db, platformEnv(), input));
});

export const commitBundle = command(BundleCommitSchema, async (input) => {
    requireAdminSession();
    return withDb((db) => svc.commitBundle(db, platformEnv(), input));
});

const PatchInputSchema = v.object({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    patch: BundlePatchSchema
});
export const patchBundle = command(PatchInputSchema, async ({ id, patch }) => {
    requireAdminSession();
    return withDb((db) => svc.patchBundle(db, id, patch));
});

const DeleteInputSchema = v.object({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    purge: v.optional(v.boolean())
});
export const deleteBundle = command(DeleteInputSchema, async ({ id, purge }) => {
    requireAdminSession();
    return withDb((db) => svc.deleteBundle(db, platformEnv(), id, purge ?? false));
});
