import { defineRoute } from '$lib/server/defineRoute.js';
import { AdminTokenIdParamsSchema } from '$lib/server/validation/admin.js';
import { AdminTokenSummarySchema } from '$lib/server/validation/entities.js';
import { revokeToken } from '$lib/server/services/adminTokens.js';

export const DELETE = defineRoute(
    {
        auth: 'admin',
        params: AdminTokenIdParamsSchema,
        response: AdminTokenSummarySchema,
        meta: {
            operationId: 'revokeAdminToken',
            summary: 'Revoke an admin token',
            description:
                'Soft-revoke: the row stays for audit, but the token is no longer accepted on /admin/* or as a dashboard login. Idempotent.',
            tags: ['admin']
        }
    },
    async ({ params, db }) => revokeToken(db, params.id)
);
