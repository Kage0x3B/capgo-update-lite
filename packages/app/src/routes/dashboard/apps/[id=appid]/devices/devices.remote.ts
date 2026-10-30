import { query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import { deviceDetail, listDevices } from '$lib/server/services/devices.js';

const AppId = v.pipe(v.string(), v.regex(/^[a-z0-9]+(\.[\w-]+)+$/i), v.maxLength(128));

export const getDevices = query(
    v.object({
        app_id: AppId,
        search: v.optional(v.pipe(v.string(), v.maxLength(64))),
        result: v.optional(v.pipe(v.string(), v.maxLength(64)))
    }),
    async ({ app_id, search, result }) => {
        requireAdminSession();
        return withDb((db) => listDevices(db, app_id, { search: search || undefined, result: result || undefined }));
    }
);

export const getDevice = query(
    v.object({
        app_id: AppId,
        device_id: v.pipe(v.string(), v.minLength(1), v.maxLength(64))
    }),
    async ({ app_id, device_id }) => {
        requireAdminSession();
        return withDb((db) => deviceDetail(db, app_id, device_id));
    }
);
