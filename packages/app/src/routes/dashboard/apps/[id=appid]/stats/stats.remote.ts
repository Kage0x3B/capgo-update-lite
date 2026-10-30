import { query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import {
    adoptionByVersion,
    autoRollbacks,
    channelSplit,
    failureBreakdown,
    kpisForWindow,
    nativeVersionSpread,
    platformSplit,
    pluginVersionSpread,
    recentActivity,
    rolloutFunnels,
    updateOutcomeTable,
    updateOutcomesOverTime,
    bucketStarts
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
        const [
            kpis,
            adoption,
            outcomes,
            outcomeTable,
            funnels,
            failures,
            platform,
            plugins,
            native,
            channels,
            rollbacks,
            recent
        ] = await Promise.all([
            kpisForWindow(db, f),
            adoptionByVersion(db, f),
            updateOutcomesOverTime(db, f),
            updateOutcomeTable(db, f),
            rolloutFunnels(db, f),
            failureBreakdown(db, f),
            platformSplit(db, f),
            pluginVersionSpread(db, f),
            nativeVersionSpread(db, f),
            channelSplit(db, f),
            autoRollbacks(db, f),
            recentActivity(db, f, 8)
        ]);
        return {
            kpis,
            adoption,
            outcomes: { buckets: bucketStarts(f), points: outcomes },
            outcomeTable,
            funnels,
            failures,
            platform,
            plugins,
            native,
            channels,
            rollbacks,
            recent
        };
    });
});
