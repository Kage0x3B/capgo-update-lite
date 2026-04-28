import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { defineRoute } from '$lib/server/defineRoute.js';
import { pruneStats } from '$lib/server/cron/pruneStats.js';
import { pruneOrphanedBundles } from '$lib/server/cron/pruneOrphanedBundles.js';

/**
 * Internal cron-job entrypoint. Invoked by `worker_default.scheduled` (see
 * cron/job.js) via `worker_default.fetch(syntheticReq, env, ctx)` — the request
 * never leaves the worker, the hostname is a placeholder.
 *
 * Auth: Bearer `CRON_SECRET` env var. The endpoint is otherwise unreachable.
 * If `CRON_SECRET` isn't set, every request 401s — fail-closed by design.
 *
 * Returns plain text (the SvelteKit error helper handles failures); the cron
 * dispatcher just logs non-2xx responses.
 */
export const POST = defineRoute(
    {
        auth: ({ request, platform }) => {
            const expected = platform?.env.CRON_SECRET;
            if (!expected) throw error(401, 'CRON_SECRET not configured');
            const header = request.headers.get('authorization') ?? '';
            const [scheme, token] = header.split(' ');
            if (scheme !== 'Bearer' || !token || !timingSafeEquals(token, expected)) {
                throw error(401, 'unauthorized');
            }
        },
        params: v.object({ job: v.picklist(['prune-stats', 'prune-orphans']) }),
        response: v.object({ deleted: v.number() })
    },
    async ({ params, db, platform }) => {
        const env = platform.env;
        switch (params.job) {
            case 'prune-stats': {
                const deleted = await pruneStats(db, env);
                return { deleted };
            }
            case 'prune-orphans': {
                const deleted = await pruneOrphanedBundles(db, env);
                return { deleted };
            }
        }
    }
);

function timingSafeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}
