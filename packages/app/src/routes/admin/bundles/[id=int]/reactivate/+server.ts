import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleIdParamsSchema } from '$lib/server/validation/admin.js';
import { BundleSchema } from '$lib/server/validation/entities.js';
import { reactivateBundle } from '$lib/server/services/bundles.js';

export const POST = defineRoute(
    {
        auth: 'admin',
        params: BundleIdParamsSchema,
        response: BundleSchema,
        meta: {
            operationId: 'reactivateBundle',
            summary: 'Restore an auto-disabled bundle',
            description:
                'Atomically flips state=active + active=true (deactivating siblings in the same channel) and stamps blacklist_reset_at=now() so previously-failed devices get another shot at the bundle.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => reactivateBundle(db, params.id)
);
