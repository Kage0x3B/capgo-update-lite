import { lt } from 'drizzle-orm';
import { statsEvents } from '../db/schema.js';
import type { Db } from '../db/index.js';

export const DEFAULT_STATS_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650; // 10 years; sanity ceiling

export interface PruneStatsEnv {
    /** Days of stats history to retain. Default 90. Set to 0 or empty to disable pruning. */
    STATS_RETENTION_DAYS?: string;
}

export function resolveRetentionDays(env: PruneStatsEnv): number | null {
    const raw = env.STATS_RETENTION_DAYS;
    if (raw === undefined || raw === '') return DEFAULT_STATS_RETENTION_DAYS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.floor(n)));
}

/**
 * Delete stats_events older than the configured retention window. Returns the
 * number of rows deleted. Skips work entirely when retention is disabled.
 */
export async function pruneStats(db: Db, env: PruneStatsEnv): Promise<number> {
    const days = resolveRetentionDays(env);
    if (days === null) return 0;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await db
        .delete(statsEvents)
        .where(lt(statsEvents.receivedAt, cutoff))
        .returning({ id: statsEvents.id });
    const count = result.length;
    if (count > 0) {
        console.log(`[cron] prune-stats: deleted ${count} stats_events rows older than ${days}d`);
    }
    return count;
}
