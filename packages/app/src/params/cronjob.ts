import type { ParamMatcher } from '@sveltejs/kit';

/** Allow-list for /cron/[job] route. Keep in sync with the dispatcher in
 * cron/job.js — every entry here must have a corresponding case there. */
const JOBS = new Set(['prune-stats', 'prune-orphans']);

export const match: ParamMatcher = (param) => JOBS.has(param);
