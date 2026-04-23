import { query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import {
    adoptionByVersion,
    autoRollbacks,
    bundleStateSummary,
    failureBreakdown,
    kpisForWindow,
    platformSplit,
    pluginVersionSpread,
    recentActivity,
    rolloutFunnel,
    updateCheckRate
} from '$lib/server/services/analytics.js';
import { DashboardWindow, windowToFilters } from '$lib/server/validation/analytics.js';

const PerAppSchema = v.object({
    window: DashboardWindow,
    app_id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(\.[\w-]+)+$/i), v.maxLength(128))
});

export const getAppDashboard = query(PerAppSchema, async (input) => {
    requireAdminSession();
    const f = { ...windowToFilters(input.window), app_id: input.app_id };
    return withDb(async (db) => {
        const [kpis, adoption, funnel, failures, platform, plugins, rollbacks, checks, bundles, recent] =
            await Promise.all([
                kpisForWindow(db, f),
                adoptionByVersion(db, f),
                rolloutFunnel(db, f),
                failureBreakdown(db, f),
                platformSplit(db, f),
                pluginVersionSpread(db, f),
                autoRollbacks(db, f),
                updateCheckRate(db, f),
                bundleStateSummary(db, f.app_id),
                recentActivity(db, f, 8)
            ]);
        return { kpis, adoption, funnel, failures, platform, plugins, rollbacks, checks, bundles, recent };
    });
});
