import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleDeleteQuerySchema, BundleIdParamsSchema, BundlePatchSchema } from '$lib/server/validation/admin.js';
import { BundleDeleteResponseSchema, BundleSchema } from '$lib/server/validation/entities.js';
import { deleteBundle, getBundle, patchBundle } from '$lib/server/services/bundles.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        params: BundleIdParamsSchema,
        response: BundleSchema,
        meta: {
            operationId: 'getBundle',
            summary: 'Fetch a single bundle',
            description: 'Returns one bundle row including native package fingerprint and R2 key.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => getBundle(db, params.id)
);

export const PATCH = defineRoute(
    {
        auth: 'publisher',
        params: BundleIdParamsSchema,
        body: BundlePatchSchema,
        response: BundleSchema,
        meta: {
            operationId: 'patchBundle',
            summary: 'Update a bundle',
            description:
                'Patch activation, channel, platforms, link, or comment. Multiple bundles may be active on the same (app_id, channel) — the /updates resolver picks the newest one each device qualifies for, so siblings are not auto-deactivated.',
            tags: ['admin']
        }
    },
    async ({ params, body, db }) => patchBundle(db, params.id, body)
);

export const DELETE = defineRoute(
    {
        auth: 'publisher',
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
