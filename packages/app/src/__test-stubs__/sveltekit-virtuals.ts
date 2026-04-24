// Stubs for SvelteKit virtual modules that would otherwise be supplied by the
// @sveltejs/kit Vite plugin. Vitest config aliases the $app/server and
// $env/static/private imports to this file so server-side unit tests can
// import $lib/server/* without booting the SvelteKit runtime.

export function getRequestEvent(): never {
    throw new Error('getRequestEvent() is not available in vitest unit tests');
}

// $env/static/private values don't have to match at runtime because every
// unit-test path that reads them also stubs the call site. An empty string is
// fine; failing tests that rely on a specific value should mock the value
// where it's consumed.
export const PRIVATE_ADMIN_TOKEN = '';
