import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { statsEvents, type StatsEvent } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';

export type StatsListFilters = {
    app_id?: string;
    action?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
};

export type StatsEventView = Omit<StatsEvent, 'id'> & { id: string };

export async function listStatsEvents(db: Db, filters: StatsListFilters): Promise<StatsEventView[]> {
    const where = [
        filters.app_id ? eq(statsEvents.appId, filters.app_id) : undefined,
        filters.action ? eq(statsEvents.action, filters.action) : undefined,
        filters.since ? gte(statsEvents.receivedAt, filters.since) : undefined,
        filters.until ? lte(statsEvents.receivedAt, filters.until) : undefined
    ].filter((x): x is Exclude<typeof x, undefined> => x !== undefined);

    const rows = await db
        .select()
        .from(statsEvents)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(statsEvents.receivedAt))
        .limit(Math.min(filters.limit ?? 200, 1000))
        .offset(filters.offset ?? 0);

    // Bigint doesn't serialize to JSON; coerce to string for wire compat.
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
}
