import { query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import { listStatsEvents } from '$lib/server/services/stats.js';

const FiltersSchema = v.object({
    app_id: v.optional(v.string()),
    action: v.optional(v.string()),
    since: v.optional(v.string()),
    until: v.optional(v.string()),
    limit: v.optional(v.number())
});

export const getStatsEvents = query(FiltersSchema, async (f) => {
    requireAdminSession();
    return withDb((db) =>
        listStatsEvents(db, {
            app_id: f.app_id || undefined,
            action: f.action || undefined,
            since: f.since ? new Date(f.since) : undefined,
            until: f.until ? new Date(f.until) : undefined,
            limit: f.limit ?? 200
        })
    );
});
