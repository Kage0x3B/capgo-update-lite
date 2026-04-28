import { defineRoute } from '$lib/server/defineRoute.js';
import { AdminTokenCreateSchema } from '$lib/server/validation/admin.js';
import { AdminTokenCreateResponseSchema, AdminTokenListResponseSchema } from '$lib/server/validation/entities.js';
import { createToken, listTokens } from '$lib/server/services/adminTokens.js';

export const GET = defineRoute(
    {
        auth: 'admin',
        response: AdminTokenListResponseSchema,
        meta: {
            operationId: 'listAdminTokens',
            summary: 'List admin tokens',
            description:
                'Returns every admin_tokens row (revoked included). The plaintext token and its hash are never exposed.',
            tags: ['admin']
        }
    },
    async ({ db }) => listTokens(db)
);

export const POST = defineRoute(
    {
        auth: 'admin',
        body: AdminTokenCreateSchema,
        response: AdminTokenCreateResponseSchema,
        successStatus: 201,
        meta: {
            operationId: 'createAdminToken',
            summary: 'Create an admin token',
            description:
                'Generates a 256-bit random token, stores `sha256(plaintext)`, and returns the plaintext exactly once. Save it — it cannot be retrieved later.',
            tags: ['admin']
        },
        examples: {
            body: { name: 'CI publish', role: 'publisher' }
        }
    },
    async ({ body, db, auth }) => createToken(db, { ...body, createdBy: auth?.tokenId ?? null })
);
