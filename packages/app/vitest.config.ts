import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Separate from vite.config.ts so tests don't pull in the @sveltejs/kit plugin
// stack (which needs .svelte-kit/ sync and pretends to be a browser runtime).
// Everything tested here is pure server-side TypeScript; a bare Node env is
// enough.
export default defineConfig({
    resolve: {
        alias: {
            $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
            // SvelteKit virtual modules that the @sveltejs/kit Vite plugin
            // would normally inject. Tests stub them so $lib/server/* files
            // importing them don't blow up at module resolution time.
            '$app/server': fileURLToPath(new URL('./src/__test-stubs__/sveltekit-virtuals.ts', import.meta.url)),
            '$env/static/private': fileURLToPath(new URL('./src/__test-stubs__/sveltekit-virtuals.ts', import.meta.url))
        }
    },
    test: {
        environment: 'node',
        globals: false,
        include: ['src/lib/**/*.test.ts']
    }
});
