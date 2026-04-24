import { error, fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';
import { LoginSchema } from '$lib/server/validation/admin.js';
import { SESSION_COOKIE, issueSession } from '$lib/server/session.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ url }) => {
    return { next: url.searchParams.get('next') ?? '/dashboard' };
};

export const actions: Actions = {
    default: async ({ request, cookies, url }) => {
        if (!PRIVATE_ADMIN_TOKEN) throw error(500, 'PRIVATE_ADMIN_TOKEN not configured');

        const formData = await request.formData();
        const parsed = v.safeParse(LoginSchema, {
            password: formData.get('password') ?? ''
        });
        if (!parsed.success) return fail(400, { error: 'missing password' });

        if (!timingSafeEquals(parsed.output.password, PRIVATE_ADMIN_TOKEN)) {
            return fail(401, { error: 'invalid password' });
        }

        const secure = url.protocol === 'https:';
        const session = await issueSession(PRIVATE_ADMIN_TOKEN, { secure });
        cookies.set(SESSION_COOKIE, session.value, session.options);

        const next = url.searchParams.get('next');
        redirect(303, safeNext(next) ?? '/dashboard');
    }
};

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
