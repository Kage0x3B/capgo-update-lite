import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, clearSessionOptions } from '$lib/server/session.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
    redirect(303, '/dashboard/login');
};

export const actions: Actions = {
    default: async ({ cookies, url }) => {
        cookies.set(SESSION_COOKIE, '', clearSessionOptions(url.protocol === 'https:'));
        redirect(303, '/dashboard/login');
    }
};
