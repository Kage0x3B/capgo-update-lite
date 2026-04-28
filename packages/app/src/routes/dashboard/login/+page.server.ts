import { error, fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';
import { LoginSchema } from '$lib/server/validation/admin.js';
import { SESSION_COOKIE, issueSession } from '$lib/server/session.js';
import { hashToken, lookupTokenByHash, touchTokenUsage } from '$lib/server/services/adminTokens.js';
import { createDb } from '$lib/server/db/index.js';
import type { AdminRole } from '$lib/server/roles.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ url }) => {
    return { next: url.searchParams.get('next') ?? '/dashboard' };
};

export const actions: Actions = {
    default: async ({ request, cookies, url, platform }) => {
        if (!PRIVATE_ADMIN_TOKEN) throw error(500, 'PRIVATE_ADMIN_TOKEN not configured');
        if (!platform) throw error(500, 'platform bindings unavailable');

        const formData = await request.formData();
        const parsed = v.safeParse(LoginSchema, {
            password: formData.get('password') ?? ''
        });
        if (!parsed.success) return fail(400, { error: 'missing password' });

        const role = await resolveLoginRole(parsed.output.password, platform);
        if (!role) return fail(401, { error: 'invalid password' });

        const secure = url.protocol === 'https:';
        const session = await issueSession(PRIVATE_ADMIN_TOKEN, role, { secure });
        cookies.set(SESSION_COOKIE, session.value, session.options);

        const next = url.searchParams.get('next');
        redirect(303, safeNext(next) ?? '/dashboard');
    }
};

/**
 * Login accepts either the bootstrap super-admin (build-time
 * PRIVATE_ADMIN_TOKEN) or any non-revoked admin_tokens row. Returns the role
 * to bake into the session, or null on no match.
 */
async function resolveLoginRole(password: string, platform: App.Platform): Promise<AdminRole | null> {
    if (timingSafeEquals(password, PRIVATE_ADMIN_TOKEN)) {
        return 'admin';
    }
    const handle = createDb(platform.env.HYPERDRIVE);
    try {
        const hash = await hashToken(password);
        const row = await lookupTokenByHash(handle.db, hash);
        if (!row) return null;
        // Best-effort usage bump; safe to fire-and-forget on the same connection
        // since defineRoute isn't in play here — we await close() below.
        await touchTokenUsage(handle.db, row.id).catch(() => {
            /* ignore */
        });
        return row.role;
    } finally {
        platform.ctx.waitUntil(handle.close());
    }
}

function timingSafeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}

function safeNext(next: string | null): string | null {
    if (!next) return null;
    // Only allow same-origin redirects under /dashboard/*.
    if (!next.startsWith('/dashboard/')) return null;
    return next;
}
