import { redirect } from '@sveltejs/kit';
import { LAST_APP_COOKIE } from '$lib/util/explorer.js';
import type { PageServerLoad } from './$types.js';

/**
 * A bare /dashboard/stats reopens the app picked last (remembered in a cookie
 * by the app picker). Done here rather than on the client so the page never
 * renders "all apps" first and then jumps.
 */
export const load: PageServerLoad = ({ url, cookies }) => {
    if (url.search) return;
    const app = cookies.get(LAST_APP_COOKIE);
    if (app && /^[\w.-]{1,200}$/.test(app)) redirect(307, `${url.pathname}?app=${encodeURIComponent(app)}`);
};
