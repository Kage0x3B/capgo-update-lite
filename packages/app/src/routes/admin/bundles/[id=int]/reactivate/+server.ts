import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleIdParamsSchema } from '$lib/server/validation/admin.js';
import { BundleSchema } from '$lib/server/validation/entities.js';
import { reactivateBundle } from '$lib/server/services/bundles.js';

export const POST = defineRoute(
    {
        auth: 'publisher',
        params: BundleIdParamsSchema,
        response: BundleSchema,
        meta: {
            operationId: 'reactivateBundle',
            summary: 'Restore an auto-disabled bundle',
            description:
                'Flips state=active + active=true and stamps blacklist_reset_at=now() so previously-failed devices get another shot at the bundle. Sibling bundles in the same channel are left active — the /updates resolver picks per device.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => reactivateBundle(db, params.id)
);
