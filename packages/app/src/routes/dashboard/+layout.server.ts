import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    return {
        auth: locals.auth,
        pathname: url.pathname
    };
};
