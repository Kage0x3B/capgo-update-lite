import { defineRoute } from '$lib/server/defineRoute.js';
import { StatsListQuerySchema } from '$lib/server/validation/admin.js';
import { StatsEventListResponseSchema } from '$lib/server/validation/entities.js';
import { listStatsEvents } from '$lib/server/services/stats.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        query: StatsListQuerySchema,
        response: StatsEventListResponseSchema,
        meta: {
            operationId: 'listStatsEvents',
            summary: 'List recent plugin stats events',
            description:
                'Read-only view of stats_events rows, filterable by app_id, action, and received_at window. Ordered newest-first; capped at 1000 rows.',
            tags: ['admin']
        }
    },
    async ({ query, db }) => listStatsEvents(db, query)
);
