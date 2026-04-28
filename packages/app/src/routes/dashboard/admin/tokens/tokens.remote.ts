import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import { createToken, listTokens, revokeToken } from '$lib/server/services/adminTokens.js';
import { AdminTokenCreateSchema, AdminTokenIdParamsSchema } from '$lib/server/validation/admin.js';

export const getTokens = query(async () => {
    const auth = requireAdminSession();
    if (auth.role !== 'admin') error(403, 'admin role required');
    return withDb((db) => listTokens(db));
});

export const createTokenCommand = command(AdminTokenCreateSchema, async (input) => {
    const auth = requireAdminSession();
    if (auth.role !== 'admin') error(403, 'admin role required');
    return withDb((db) => createToken(db, { ...input, createdBy: auth.tokenId }));
});

export const revokeTokenCommand = command(AdminTokenIdParamsSchema, async ({ id }) => {
    const auth = requireAdminSession();
    if (auth.role !== 'admin') error(403, 'admin role required');
    return withDb((db) => revokeToken(db, id));
});
