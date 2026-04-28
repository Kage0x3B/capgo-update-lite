// Appended to .svelte-kit/cloudflare/_worker.js by cron/append.mjs (postbuild).
// SvelteKit's Cloudflare adapter only emits a `fetch` handler; this snippet
// adds `scheduled` so Cloudflare Cron Triggers can invoke us. Pattern from
// https://github.com/sveltejs/kit/issues/4841#issuecomment-3290611044
//
// Each cron tick fires an internal Request through worker_default.fetch — the
// hostname is fake (the request never leaves the worker), only the path matters.
// The handler at /cron/[job] runs the actual prune logic, gated by CRON_SECRET.
//
// Cron expressions must match wrangler.jsonc `triggers.crons`. Update both
// places together.

worker_default.scheduled = async (event, env, ctx) => {
    const path =
        event.cron === '0 3 * * *' ? '/cron/prune-stats' : event.cron === '0 * * * *' ? '/cron/prune-orphans' : null;
    if (!path) {
        console.warn('[cron] no handler registered for', event.cron);
        return;
    }
    if (!env.CRON_SECRET) {
        console.error('[cron] CRON_SECRET not set — refusing to run', path);
        return;
    }
    const req = new Request(`https://internal${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CRON_SECRET}` }
    });
    const res = await worker_default.fetch(req, env, ctx);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[cron] ${path} returned ${res.status}: ${body}`);
    }
};
