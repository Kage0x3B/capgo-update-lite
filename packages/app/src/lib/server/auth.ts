import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';

export function requireAdmin(request: Request): void {
    const header = request.headers.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token || !PRIVATE_ADMIN_TOKEN || !timingSafeEquals(token, PRIVATE_ADMIN_TOKEN)) {
        throw error(401, 'unauthorized');
    }
}

/**
 * For remote functions (`.remote.ts`). Reads the active request event and
 * relies on `hooks.server.ts` having already populated `locals.admin` from
 * the session cookie. Throws 401 if unauthenticated.
 */
export function requireAdminSession(): void {
    const event = getRequestEvent();
    if (!event.locals.admin) throw error(401, 'unauthorized');
}

function timingSafeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}
