import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleListQuerySchema } from '$lib/server/validation/admin.js';
import { BundleListResponseSchema } from '$lib/server/validation/entities.js';
import { listBundles } from '$lib/server/services/bundles.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        query: BundleListQuerySchema,
        response: BundleListResponseSchema,
        meta: {
            operationId: 'listBundles',
            summary: 'List bundles',
            description: 'Returns bundles filtered by app_id, channel, state, and/or active flag.',
            tags: ['admin']
        }
    },
    async ({ query, db }) => listBundles(db, query)
);
