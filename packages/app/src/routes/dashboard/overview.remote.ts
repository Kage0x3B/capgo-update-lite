import { query } from '$app/server';
import { requireAdminSession } from '$lib/server/auth.js';
import { platformEnv, withDb } from '$lib/server/remote-helpers.js';
import {
    autoRollbacks,
    bundleStateSummary,
    platformSplit,
    recentActivity,
    updateCheckRate
} from '$lib/server/services/analytics.js';
import { appsNeedingAttention, type BundleHealthEnv } from '$lib/server/services/bundleHealth.js';
import { DashboardFiltersSchema, windowToFilters } from '$lib/server/validation/analytics.js';

/**
 * Overview dashboard — cross-app panels only. Version-specific panels
 * (adoption-by-version, plugin versions, rollout funnel, failure breakdown,
 * KPI strip) live on the per-app stats page where `app_id` scopes them.
 */
export const getDashboard = query(DashboardFiltersSchema, async (input) => {
    requireAdminSession();
    const f = { ...windowToFilters(input.window), app_id: input.app_id };
    const env = platformEnv() as unknown as BundleHealthEnv;
    return withDb(async (db) => {
        const [platform, rollbacks, checks, bundles, recent, attention] = await Promise.all([
            platformSplit(db, f),
            autoRollbacks(db, f),
            updateCheckRate(db, f),
            bundleStateSummary(db, f.app_id),
            recentActivity(db, f, 8),
            appsNeedingAttention(db, env)
        ]);
        return { platform, rollbacks, checks, bundles, recent, attention };
    });
});
