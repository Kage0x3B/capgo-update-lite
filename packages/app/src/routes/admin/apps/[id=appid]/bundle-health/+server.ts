import { defineRoute } from '$lib/server/defineRoute.js';
import { AppIdParamsSchema } from '$lib/server/validation/admin.js';
import { BundleHealthRowListSchema } from '$lib/server/validation/entities.js';
import { bundleHealthForApp, type BundleHealthEnv } from '$lib/server/services/bundleHealth.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        params: AppIdParamsSchema,
        response: BundleHealthRowListSchema,
        meta: {
            operationId: 'getAppBundleHealth',
            summary: 'Per-bundle health for one app',
            description:
                'Returns each bundle of the given app classified into the broken-bundle severity ladder, alongside the resolved per-app thresholds.',
            tags: ['admin']
        }
    },
    async ({ params, db, platform }) => bundleHealthForApp(db, platform.env as unknown as BundleHealthEnv, params.id)
);
