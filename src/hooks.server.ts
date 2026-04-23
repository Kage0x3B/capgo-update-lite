import { redirect, type Handle } from '@sveltejs/kit';
import { PRIVATE_ADMIN_TOKEN } from '$env/static/private';
import { SESSION_COOKIE, verifySession } from '$lib/server/session.js';

const LOGIN_PATH = '/dashboard/login';
const LOGOUT_PATH = '/dashboard/logout';

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.admin = false;

    if (event.url.pathname.startsWith('/dashboard')) {
        if (PRIVATE_ADMIN_TOKEN) {
            const cookie = event.cookies.get(SESSION_COOKIE);
            event.locals.admin = await verifySession(cookie, PRIVATE_ADMIN_TOKEN);
        }

        const onLogin = event.url.pathname === LOGIN_PATH;
        const onLogout = event.url.pathname === LOGOUT_PATH;

        if (!event.locals.admin && !onLogin && !onLogout) {
            const next = event.url.pathname + event.url.search;
            redirect(303, `${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
        }
        if (event.locals.admin && onLogin) {
            redirect(303, '/dashboard/apps');
        }
    }

    return resolve(event);
};
