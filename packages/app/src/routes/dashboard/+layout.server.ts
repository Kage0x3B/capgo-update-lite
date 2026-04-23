import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    return {
        admin: locals.admin,
        pathname: url.pathname
    };
};
