import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';
import { hashToken, lookupTokenByHash, touchTokenUsage } from '$lib/server/services/adminTokens.js';
import type { ResolvedAuth } from '$lib/server/roles.js';
import type { Db } from '$lib/server/db/index.js';

/**
 * Resolve a Bearer token from the request to a {role, tokenId} tuple.
 *
 *   1. If `PRIVATE_ADMIN_TOKEN` is set and matches (timing-safe), the request
 *      gets `role: 'admin', tokenId: null` — the bootstrap super-admin path.
 *      No DB hit.
 *   2. Otherwise we hash the bearer token and probe `admin_tokens` (unique
 *      hash index, partial on `revoked_at IS NULL`). Match → role from row.
 *      Best-effort `last_used_at` bump runs after.
 *
 * Returns null on every failure; callers map null → 401. Never tells the
 * client which step failed.
 */
export async function authenticateBearer(request: Request, db: Db): Promise<ResolvedAuth | null> {
    const header = request.headers.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return null;

    if (PRIVATE_ADMIN_TOKEN && timingSafeEquals(token, PRIVATE_ADMIN_TOKEN)) {
        return { role: 'admin', tokenId: null };
    }

    const hash = await hashToken(token);
    const row = await lookupTokenByHash(db, hash);
    if (!row) return null;

    // Fire-and-forget the usage bump. We don't await it on the hot path; the
    // caller's defineRoute wrapper schedules the close on a finally so this
    // promise gets to settle on its own.
    void touchTokenUsage(db, row.id).catch(() => {
        /* swallow — non-critical */
    });

    return { role: row.role, tokenId: row.id };
}

/**
 * Pull the resolved auth out of the active request event. Used by remote
 * functions (`.remote.ts`) where there's no defineRoute wrapper. Throws 401
 * if the dashboard middleware didn't populate it.
 */
export function requireAdminSession(): ResolvedAuth {
    const event = getRequestEvent();
    const auth = event.locals.auth;
    if (!auth) throw error(401, 'unauthorized');
    return auth;
}

function timingSafeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}
