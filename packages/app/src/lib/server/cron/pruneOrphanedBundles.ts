import { and, eq, lt } from 'drizzle-orm';
import { bundles } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { deleteObject, type R2Env } from '../r2.js';

const ORPHAN_AGE_HOURS = 24;

/**
 * Delete bundles still in `state = 'pending'` that were initialised more than
 * 24 hours ago. These are bundle slots reserved by `POST /admin/bundles/init`
 * whose `commit` call never landed (CLI crashed, network died, user gave up).
 *
 * R2 deletes are best-effort: if the upload never happened the object simply
 * doesn't exist and DELETE returns 404 (which `deleteObject` swallows). DB
 * row deletion happens regardless so the (app, channel, version) slot frees up.
 */
export async function pruneOrphanedBundles(db: Db, env: R2Env): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_AGE_HOURS * 60 * 60 * 1000);
    const stale = await db
        .select({ id: bundles.id, r2Key: bundles.r2Key })
        .from(bundles)
        .where(and(eq(bundles.state, 'pending'), lt(bundles.createdAt, cutoff)));

    if (stale.length === 0) return 0;

    for (const row of stale) {
        try {
            await deleteObject(env, row.r2Key);
        } catch (e) {
            // R2 failures shouldn't block DB cleanup — the row is the source of
            // truth for bundle resolution. Log and continue.
            console.warn(
                `[cron] prune-orphans: R2 delete failed for ${row.r2Key}: ${e instanceof Error ? e.message : e}`
            );
        }
    }

    const ids = stale.map((r) => r.id);
    const deleted = await db
        .delete(bundles)
        .where(and(eq(bundles.state, 'pending'), lt(bundles.createdAt, cutoff)))
        .returning({ id: bundles.id });
    console.log(`[cron] prune-orphans: deleted ${deleted.length} orphaned pending bundles (ids: ${ids.join(',')})`);
    return deleted.length;
}
