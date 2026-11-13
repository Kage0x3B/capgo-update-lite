import { defineRoute } from '$lib/server/defineRoute.js';
import { AppIdParamsSchema, AppPatchSchema } from '$lib/server/validation/admin.js';
import { AppSchema } from '$lib/server/validation/entities.js';
import { deleteApp, getApp, patchApp } from '$lib/server/services/apps.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        params: AppIdParamsSchema,
        response: AppSchema,
        meta: {
            operationId: 'getApp',
            summary: 'Fetch a single app',
            description: 'Returns one app row including per-app compatibility policy.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => getApp(db, params.id)
);

export const PATCH = defineRoute(
    {
        auth: 'admin',
        params: AppIdParamsSchema,
        body: AppPatchSchema,
        response: AppSchema,
        meta: {
            operationId: 'patchApp',
            summary: 'Update an app',
            description:
                'Patch display name or per-app compatibility policy (disable_auto_update ceiling, disable_auto_update_under_native, min_plugin_version).',
            tags: ['admin']
        }
    },
    async ({ params, body, db }) => patchApp(db, params.id, body)
);

export const DELETE = defineRoute(
    {
        auth: 'admin',
        params: AppIdParamsSchema,
        response: AppSchema,
        meta: {
            operationId: 'deleteApp',
            summary: 'Delete an app',
            description:
                'Soft delete: the app disappears from lists and lookups, /updates answers "unknown app" for it and new /stats events for it are dropped. Bundles, stored files and recorded stats stay. Re-adding the same id with POST /admin/apps restores it. Returns the deleted row.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => deleteApp(db, params.id)
);
