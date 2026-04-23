import * as v from 'valibot';

const REVERSE_DOMAIN = /^[a-z0-9]+(\.[\w-]+)+$/i;

export const DashboardWindow = v.picklist(['24h', '7d', '30d'] as const);
export type DashboardWindow = v.InferOutput<typeof DashboardWindow>;

export const DashboardFiltersSchema = v.object({
    window: DashboardWindow,
    app_id: v.optional(v.pipe(v.string(), v.regex(REVERSE_DOMAIN), v.maxLength(128)))
});
export type DashboardFilters = v.InferOutput<typeof DashboardFiltersSchema>;

export type AnalyticsFilters = {
    app_id?: string;
    since: Date;
    until: Date;
    bucket: 'hour' | 'day';
};

/** Map a UI window preset → concrete date range + bucket unit. */
export function windowToFilters(win: DashboardWindow, now = new Date()): AnalyticsFilters {
    const until = now;
    const since = new Date(now);
    let bucket: 'hour' | 'day';
    if (win === '24h') {
        since.setUTCHours(since.getUTCHours() - 24);
        bucket = 'hour';
    } else if (win === '7d') {
        since.setUTCDate(since.getUTCDate() - 7);
        bucket = 'day';
    } else {
        since.setUTCDate(since.getUTCDate() - 30);
        bucket = 'day';
    }
    return { since, until, bucket };
}
