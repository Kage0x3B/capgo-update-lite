import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '$lib/server/defineRoute.js';
import { apps, type App } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { isValidSemver } from '$lib/server/semver.js';

/** WHERE clause for apps that are not soft-deleted. */
export const appIsLive = isNull(apps.deletedAt);

export async function listApps(db: Db): Promise<App[]> {
    return db.select().from(apps).where(appIsLive);
}

/**
 * Create an app, or rename an existing one. Re-adding a deleted app restores
 * it with its old settings, bundles and history.
 */
export async function upsertApp(db: Db, input: { id: string; name: string }): Promise<App> {
    const [row] = await db
        .insert(apps)
        .values({ id: input.id, name: input.name })
        .onConflictDoUpdate({ target: apps.id, set: { name: input.name, deletedAt: null } })
        .returning();
    return row;
}

export async function getApp(db: Db, id: string): Promise<App> {
    const [row] = await db
        .select()
        .from(apps)
        .where(and(eq(apps.id, id), appIsLive))
        .limit(1);
    if (!row) throw new ApiError(404, 'not_found', `Unknown app_id: ${id}`);
    return row;
}

/**
 * Delete an app. Always a soft delete: the row gets a deleted_at stamp and
 * drops out of every list and lookup. Devices asking /updates for it get
 * "unknown app", and new /stats events for it are discarded. Bundles, R2
 * objects and recorded stats are left as they are.
 */
export async function deleteApp(db: Db, id: string): Promise<App> {
    const [row] = await db
        .update(apps)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(apps.id, id), appIsLive))
        .returning();
    if (!row) throw new ApiError(404, 'not_found', `Unknown app_id: ${id}`);
    return row;
}

export type PatchAppInput = {
    name?: string;
    disable_auto_update?: 'none' | 'major' | 'minor' | 'patch';
    disable_auto_update_under_native?: boolean;
    min_plugin_version?: string | null;
    fail_min_devices?: number | null;
    fail_warn_rate?: number | null;
    fail_risk_rate?: number | null;
    fail_rate_threshold?: number | null;
};

export async function patchApp(db: Db, id: string, patch: PatchAppInput): Promise<App> {
    if (
        patch.min_plugin_version !== undefined &&
        patch.min_plugin_version !== null &&
        !isValidSemver(patch.min_plugin_version)
    ) {
        throw new ApiError(
            400,
            'invalid_request',
            `min_plugin_version is not valid semver: ${patch.min_plugin_version}`
        );
    }

    const current = await getApp(db, id);

    // Effective values after applying the patch — used to enforce the
    // warn <= risk <= disable invariant on overrides. Undefined override means
    // "fall back to env / default", which can't conflict with a sibling so we
    // skip the comparison for any pair where at least one side is unset.
    const eff = {
        warn: patch.fail_warn_rate !== undefined ? patch.fail_warn_rate : current.failWarnRate,
        risk: patch.fail_risk_rate !== undefined ? patch.fail_risk_rate : current.failRiskRate,
        disable: patch.fail_rate_threshold !== undefined ? patch.fail_rate_threshold : current.failRateThreshold
    };
    if (eff.warn !== null && eff.risk !== null && eff.warn > eff.risk) {
        throw new ApiError(
            400,
            'invalid_request',
            `fail_warn_rate (${eff.warn}) must be ≤ fail_risk_rate (${eff.risk})`
        );
    }
    if (eff.risk !== null && eff.disable !== null && eff.risk > eff.disable) {
        throw new ApiError(
            400,
            'invalid_request',
            `fail_risk_rate (${eff.risk}) must be ≤ fail_rate_threshold (${eff.disable})`
        );
    }
    if (eff.warn !== null && eff.disable !== null && eff.warn > eff.disable) {
        throw new ApiError(
            400,
            'invalid_request',
            `fail_warn_rate (${eff.warn}) must be ≤ fail_rate_threshold (${eff.disable})`
        );
    }

    const set: Partial<typeof apps.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.disable_auto_update !== undefined) set.disableAutoUpdate = patch.disable_auto_update;
    if (patch.disable_auto_update_under_native !== undefined) {
        set.disableAutoUpdateUnderNative = patch.disable_auto_update_under_native;
    }
    if (patch.min_plugin_version !== undefined) set.minPluginVersion = patch.min_plugin_version;
    if (patch.fail_min_devices !== undefined) set.failMinDevices = patch.fail_min_devices;
    if (patch.fail_warn_rate !== undefined) set.failWarnRate = patch.fail_warn_rate;
    if (patch.fail_risk_rate !== undefined) set.failRiskRate = patch.fail_risk_rate;
    if (patch.fail_rate_threshold !== undefined) set.failRateThreshold = patch.fail_rate_threshold;
    if (Object.keys(set).length === 0) return current;

    const [row] = await db.update(apps).set(set).where(eq(apps.id, id)).returning();
    return row;
}
