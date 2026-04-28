import { error, redirect, type Handle } from '@sveltejs/kit';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';
import { SESSION_COOKIE, verifySession } from '$lib/server/session.js';

const LOGIN_PATH = '/dashboard/login';
const LOGOUT_PATH = '/dashboard/logout';

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.auth = null;

    const isDashboard = event.url.pathname.startsWith('/dashboard');
    const isAdminApi = event.url.pathname.startsWith('/admin');

    // Fail closed and loud when the build-time admin secret is missing.
    // Without this, dashboard requests redirect-loop into login (which 500s)
    // and admin API requests get a generic 401 — both obscure the real cause.
    if ((isDashboard || isAdminApi) && !PRIVATE_ADMIN_TOKEN) {
        error(
            500,
            'PRIVATE_ADMIN_TOKEN is not set. It must be provided at build time (see README → "Quickstart: one-click deploy") before the dashboard or admin API can be used.'
        );
    }

    if (isDashboard) {
        const cookie = event.cookies.get(SESSION_COOKIE);
        const verified = await verifySession(cookie, PRIVATE_ADMIN_TOKEN);
        // tokenId in the session is intentionally unrecoverable: the cookie
        // doesn't carry it, and we don't hit the DB on every dashboard request.
        // Revoking a DB-backed token doesn't kill live sessions — see session.ts.
        event.locals.auth = verified ? { role: verified.role, tokenId: null } : null;

        const onLogin = event.url.pathname === LOGIN_PATH;
        const onLogout = event.url.pathname === LOGOUT_PATH;

        if (!event.locals.auth && !onLogin && !onLogout) {
            const next = event.url.pathname + event.url.search;
            redirect(303, `${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
        }
        if (event.locals.auth && onLogin) {
            redirect(303, '/dashboard');
        }
    }

    return resolve(event);
};
