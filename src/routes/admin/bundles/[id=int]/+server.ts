import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleDeleteQuerySchema, BundleIdParamsSchema, BundlePatchSchema } from '$lib/server/validation/admin.js';
import { BundleDeleteResponseSchema, BundleSchema } from '$lib/server/validation/entities.js';
import { deleteBundle, patchBundle } from '$lib/server/services/bundles.js';

export const PATCH = defineRoute(
    {
        auth: 'admin',
        params: BundleIdParamsSchema,
        body: BundlePatchSchema,
        response: BundleSchema,
        meta: {
            operationId: 'patchBundle',
            summary: 'Update a bundle',
            description:
                'Patch activation, channel, platforms, link, or comment. Activating a bundle atomically deactivates siblings in the same (app_id, channel).',
            tags: ['admin']
        }
    },
    async ({ params, body, db }) => patchBundle(db, params.id, body)
);

export const DELETE = defineRoute(
    {
        auth: 'admin',
        params: BundleIdParamsSchema,
        query: BundleDeleteQuerySchema,
        response: BundleDeleteResponseSchema,
        meta: {
            operationId: 'deleteBundle',
            summary: 'Delete or soft-fail a bundle',
            description:
                'Without `purge=1` the bundle is soft-deleted (state=failed, active=false). With `purge=1` the R2 object and DB row are removed.',
            tags: ['admin']
        }
    },
    async ({ params, query, db, platform }) => deleteBundle(db, platform.env, params.id, query.purge === '1')
);
