import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    // Load `.env` into process.env so the @sveltejs/adapter-cloudflare platform
    // proxy sees CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
    // during local dev. `pnpm dev` runs vite, not wrangler — so wrangler's
    // built-in .env auto-loading doesn't apply here.
    const env = loadEnv(mode, process.cwd(), '');

    for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
    }

    return {
        plugins: [tailwindcss(), sveltekit()],
        server: {
            host: true,
            port: 8765
        },
        preview: {
            host: true,
            port: 8765
        }
    };
});
