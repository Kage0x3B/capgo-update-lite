import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { apps, bundles, statsEvents, type Bundle } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { BUNDLE_BREAKING_ACTIONS } from './analytics.js';

/**
 * Defaults for the broken-bundle severity ladder. Resolution order is always:
 * per-app override (apps.fail_*) → env var → these constants.
 *
 * Order is enforced: warnRate <= riskRate <= disableRate. A per-app value of 0
 * on disableRate (or 0 on minDevices) disables auto-disable entirely; the
 * bundle is still classified for UI purposes.
 */
export const DEFAULT_FAIL_MIN_DEVICES = 10;
export const DEFAULT_FAIL_WARN_RATE = 0.2;
export const DEFAULT_FAIL_RISK_RATE = 0.35;
export const DEFAULT_FAIL_RATE_THRESHOLD = 0.5;

/** Env vars consumed by the bundle-health pipeline. All optional. */
export interface BundleHealthEnv {
    FAIL_MIN_DEVICES?: string;
    FAIL_WARN_RATE?: string;
    FAIL_RISK_RATE?: string;
    FAIL_RATE_THRESHOLD?: string;
}

export type BundleHealthSeverity = 'healthy' | 'noisy' | 'warning' | 'at_risk' | 'auto_disabled' | 'manually_disabled';

/** Resolved per-app thresholds. Always all four values, post-fallback. */
export interface ResolvedThresholds {
    minDevices: number;
    warnRate: number;
    riskRate: number;
    disableRate: number;
}

interface AppOverrides {
    failMinDevices: number | null;
    failWarnRate: number | null;
    failRiskRate: number | null;
    failRateThreshold: number | null;
}

function envNumber(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

export function resolveThresholds(overrides: AppOverrides, env: BundleHealthEnv): ResolvedThresholds {
    const minDevices = overrides.failMinDevices ?? envNumber(env.FAIL_MIN_DEVICES, DEFAULT_FAIL_MIN_DEVICES);
    const warnRate = overrides.failWarnRate ?? envNumber(env.FAIL_WARN_RATE, DEFAULT_FAIL_WARN_RATE);
    const riskRate = overrides.failRiskRate ?? envNumber(env.FAIL_RISK_RATE, DEFAULT_FAIL_RISK_RATE);
    const disableRate = overrides.failRateThreshold ?? envNumber(env.FAIL_RATE_THRESHOLD, DEFAULT_FAIL_RATE_THRESHOLD);
    return { minDevices, warnRate, riskRate, disableRate };
}

const ACTION_LIST = BUNDLE_BREAKING_ACTIONS.map((a) => `'${a}'`).join(',');
const ATTEMPT_LIST = `'set',${ACTION_LIST}`;
const ACTION_LIST_SQL = sql.raw(ACTION_LIST);
const ATTEMPT_LIST_SQL = sql.raw(ATTEMPT_LIST);

/** Classify a bundle given its current counters and the resolved thresholds. */
export function classifySeverity(
    bundle: { active: boolean; state: string },
    counts: { attemptedDevices: number; failedDevices: number },
    thr: ResolvedThresholds
): BundleHealthSeverity {
    const { attemptedDevices, failedDevices } = counts;
    const rate = attemptedDevices > 0 ? failedDevices / attemptedDevices : 0;

    // state='failed' overrides everything: it means the bundle is out of
    // rotation. Distinguish auto- from manual based on whether the rate
    // crossed (or could have crossed) the configured disable threshold.
    if (bundle.state === 'failed') {
        const tripped =
            thr.minDevices > 0 && thr.disableRate > 0 && attemptedDevices >= thr.minDevices && rate >= thr.disableRate;
        return tripped ? 'auto_disabled' : 'manually_disabled';
    }

    if (failedDevices === 0) return 'healthy';
    if (attemptedDevices < thr.minDevices) return 'noisy';
    if (rate >= thr.riskRate) return 'at_risk';
    if (rate >= thr.warnRate) return 'warning';
    return 'noisy';
}

// ---------------------------------------------------------------------------
// Auto-disable trigger (called from /stats)
// ---------------------------------------------------------------------------

export interface EvaluateBundleHealthInput {
    db: Db;
    env: BundleHealthEnv;
    appId: string;
    versionName: string;
}

/**
 * Trigger auto-disable for a bundle when its unique-device fail rate crosses
 * the disable threshold. Called from /stats after a failure event lands.
 *
 * Steady-state cost: one SELECT (covered by stats_events_bundle_health_idx)
 * + one UPDATE that no-ops if the bundle is already inactive. Skips entirely
 * if the bundle isn't currently `active=true, state='active'`.
 */
export async function evaluateBundleHealth({ db, env, appId, versionName }: EvaluateBundleHealthInput): Promise<void> {
    if (!versionName || versionName === 'builtin' || versionName === 'unknown') return;

    const [row] = await db
        .select({
            bundleId: bundles.id,
            bundleActive: bundles.active,
            bundleState: bundles.state,
            blacklistResetAt: bundles.blacklistResetAt,
            failMinDevices: apps.failMinDevices,
            failWarnRate: apps.failWarnRate,
            failRiskRate: apps.failRiskRate,
            failRateThreshold: apps.failRateThreshold
        })
        .from(bundles)
        .innerJoin(apps, eq(apps.id, bundles.appId))
        .where(and(eq(bundles.appId, appId), eq(bundles.version, versionName)))
        .limit(1);
    if (!row) return;
    if (!row.bundleActive || row.bundleState !== 'active') return;

    const thr = resolveThresholds(row, env);
    if (thr.minDevices <= 0 || thr.disableRate <= 0) return;

    const counts = await aggregateBundleCounts(db, appId, versionName, row.blacklistResetAt);
    if (counts.attemptedDevices < thr.minDevices) return;
    if (counts.attemptedDevices === 0 || counts.failedDevices / counts.attemptedDevices < thr.disableRate) return;

    // Idempotent under concurrent failure events: the active=true guard means
    // only the first transition through the threshold actually writes.
    await db
        .update(bundles)
        .set({ active: false, state: 'failed' })
        .where(and(eq(bundles.id, row.bundleId), eq(bundles.active, true)));
}

// ---------------------------------------------------------------------------
// Dashboard read helpers
// ---------------------------------------------------------------------------

export interface BundleHealthRow {
    bundleId: number;
    appId: string;
    version: string;
    channel: string;
    state: string;
    active: boolean;
    releasedAt: string | null;
    attemptedDevices: number;
    failedDevices: number;
    failRate: number;
    severity: BundleHealthSeverity;
    thresholds: ResolvedThresholds;
}

/**
 * Return the per-bundle health rows for one app, suitable for the per-app
 * overview / stats / settings pages. One SELECT + one aggregation per app.
 *
 * The aggregation respects each bundle's blacklist_reset_at: events received
 * before a reset don't contribute to attempts/failures, so the dashboard sees
 * the same numbers /updates uses to decide whether to skip the bundle.
 */
export async function bundleHealthForApp(db: Db, env: BundleHealthEnv, appId: string): Promise<BundleHealthRow[]> {
    const [appRow] = await db
        .select({
            failMinDevices: apps.failMinDevices,
            failWarnRate: apps.failWarnRate,
            failRiskRate: apps.failRiskRate,
            failRateThreshold: apps.failRateThreshold
        })
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);
    if (!appRow) return [];

    const thr = resolveThresholds(appRow, env);

    const bundleRows = await db
        .select()
        .from(bundles)
        .where(eq(bundles.appId, appId))
        .orderBy(desc(bundles.releasedAt), asc(bundles.id));
    if (bundleRows.length === 0) return [];

    const out: BundleHealthRow[] = [];
    for (const b of bundleRows) {
        const counts = await aggregateBundleCounts(db, appId, b.version, b.blacklistResetAt);
        out.push(buildHealthRow(b, counts, thr));
    }
    return out;
}

export interface AppNeedingAttention {
    appId: string;
    appName: string;
    autoDisabled: number;
    atRisk: number;
    warnings: number;
    noisy: number;
}

/**
 * Cross-app summary for the top-level dashboard banner. Only returns apps with
 * at least one non-healthy / non-manually-disabled bundle.
 */
export async function appsNeedingAttention(db: Db, env: BundleHealthEnv): Promise<AppNeedingAttention[]> {
    const allApps = await db
        .select({
            id: apps.id,
            name: apps.name,
            failMinDevices: apps.failMinDevices,
            failWarnRate: apps.failWarnRate,
            failRiskRate: apps.failRiskRate,
            failRateThreshold: apps.failRateThreshold
        })
        .from(apps);
    if (allApps.length === 0) return [];

    const out: AppNeedingAttention[] = [];
    for (const a of allApps) {
        const thr = resolveThresholds(a, env);
        const bundleRows = await db.select().from(bundles).where(eq(bundles.appId, a.id));
        let autoDisabled = 0;
        let atRisk = 0;
        let warnings = 0;
        let noisy = 0;
        for (const b of bundleRows) {
            const counts = await aggregateBundleCounts(db, a.id, b.version, b.blacklistResetAt);
            const sev = classifySeverity(b, counts, thr);
            if (sev === 'auto_disabled') autoDisabled++;
            else if (sev === 'at_risk') atRisk++;
            else if (sev === 'warning') warnings++;
            else if (sev === 'noisy') noisy++;
        }
        if (autoDisabled + atRisk + warnings + noisy > 0) {
            out.push({ appId: a.id, appName: a.name, autoDisabled, atRisk, warnings, noisy });
        }
    }
    // Most-urgent apps first.
    out.sort(
        (x, y) =>
            y.autoDisabled - x.autoDisabled ||
            y.atRisk - x.atRisk ||
            y.warnings - x.warnings ||
            x.appName.localeCompare(y.appName)
    );
    return out;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function buildHealthRow(b: Bundle, counts: BundleCounts, thr: ResolvedThresholds): BundleHealthRow {
    const failRate = counts.attemptedDevices > 0 ? counts.failedDevices / counts.attemptedDevices : 0;
    return {
        bundleId: b.id,
        appId: b.appId,
        version: b.version,
        channel: b.channel,
        state: b.state,
        active: b.active,
        releasedAt: b.releasedAt ? b.releasedAt.toISOString() : null,
        attemptedDevices: counts.attemptedDevices,
        failedDevices: counts.failedDevices,
        failRate,
        severity: classifySeverity(b, counts, thr),
        thresholds: thr
    };
}

interface BundleCounts {
    attemptedDevices: number;
    failedDevices: number;
}

async function aggregateBundleCounts(
    db: Db,
    appId: string,
    versionName: string,
    blacklistResetAt: Date | null
): Promise<BundleCounts> {
    const [row] = await db
        .select({
            failed: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId}) FILTER (WHERE ${statsEvents.action} IN (${ACTION_LIST_SQL}))::int`,
            attempted: sql<number>`COUNT(DISTINCT ${statsEvents.deviceId})::int`
        })
        .from(statsEvents)
        .where(
            and(
                eq(statsEvents.appId, appId),
                eq(statsEvents.versionName, versionName),
                sql`${statsEvents.action} IN (${ATTEMPT_LIST_SQL})`,
                blacklistResetAt ? sql`${statsEvents.receivedAt} > ${blacklistResetAt}` : sql`true`
            )
        );
    return {
        attemptedDevices: row?.attempted ?? 0,
        failedDevices: row?.failed ?? 0
    };
}
