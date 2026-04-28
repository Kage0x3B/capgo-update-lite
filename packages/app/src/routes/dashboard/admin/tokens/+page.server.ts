import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

/**
 * Admin-only page. Viewer/publisher sessions get a clean 403 instead of a
 * blank-data flicker — the remote functions also enforce the role, but
 * checking here keeps the bad-experience case off the network entirely.
 */
export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.auth) error(401, 'unauthorized');
    if (locals.auth.role !== 'admin') error(403, 'admin role required to manage tokens');
    return {};
};
