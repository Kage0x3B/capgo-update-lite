/**
 * SQL behind the stats explorer (/dashboard/stats). Reads stats_events
 * (plugin telemetry) and update_checks (what /updates answered) through one
 * filter model, see `$lib/util/explorer.ts`.
 *
 * Every query is bounded by the time window, which the (app_id, received_at)
 * btree and the received_at BRIN serve. Filters on other columns are applied
 * on top of that scan.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '$lib/server/db/index.js';
import { ACTION_GROUPS, actionGroupByKey } from '$lib/util/statsActions.js';
import { CATEGORY_ORDER, isResultCategory, resultCodesIn } from '$lib/util/updateResults.js';
import {
    APP_STATE_ACTIONS,
    bucketSeconds,
    DIMENSIONS,
    NONE,
    resolveRange,
    type DimFilter,
    type DimKey,
    type ExplorerQuery,
    type ExplorerRow,
    type Facets,
    type FacetValue,
    type GroupRow,
    type Histogram,
    type HistogramPoint,
    type RowsPage,
    type Summary
} from '$lib/util/explorer.js';

export type Table = 'events' | 'checks';

const TABLE_NAME: Record<Table, string> = { events: 'stats_events', checks: 'update_checks' };

const COLUMNS: Record<Table, Partial<Record<DimKey, string>>> = {
    events: {
        app: 'app_id',
        action: 'action',
        device: 'device_id',
        platform: 'platform',
        channel: 'channel',
        version: 'version_name',
        native: 'version_build',
        plugin: 'plugin_version',
        os: 'version_os',
        country: 'country'
    },
    checks: {
        app: 'app_id',
        result: 'result',
        device: 'device_id',
        platform: 'platform',
        channel: 'channel',
        version: 'version_name',
        native: 'version_build',
        plugin: 'plugin_version',
        os: 'version_os',
        country: 'country',
        bundle: 'bundle_version'
    }
};

/** Tie-break order between the two tables when timestamps are equal. */
const KIND_ORD: Record<Table, number> = { events: 1, checks: 0 };

const FAILURE_ACTIONS = actionGroupByKey('failure')!.actions as string[];

// --- filter building ---------------------------------------------------------

function list(values: string[]): SQL {
    return sql.join(
        values.map((v) => sql`${v}`),
        sql`, `
    );
}

/** Expand `@group` tokens to concrete values. */
function expand(dim: DimKey, values: string[]): string[] {
    const out: string[] = [];
    for (const v of values) {
        if (v.startsWith('@') && dim === 'action') {
            out.push(...(actionGroupByKey(v.slice(1))?.actions ?? []));
        } else if (v.startsWith('@') && dim === 'result') {
            const c = v.slice(1);
            if (isResultCategory(c)) out.push(...resultCodesIn(c));
        } else if (dim === 'device') {
            out.push(v.toLowerCase());
        } else {
            out.push(v);
        }
    }
    return out;
}

function dimCondition(col: SQL, f: DimFilter, dim: DimKey): SQL | undefined {
    const parts: SQL[] = [];
    if (f.in.length) {
        const vals = expand(
            dim,
            f.in.filter((v) => v !== NONE)
        );
        const ors: SQL[] = [];
        if (vals.length) ors.push(sql`${col} IN (${list(vals)})`);
        if (f.in.includes(NONE)) ors.push(sql`(${col} IS NULL OR ${col} = '')`);
        // An unknown group token expands to nothing: match nothing, not everything.
        parts.push(ors.length ? sql`(${sql.join(ors, sql` OR `)})` : sql`FALSE`);
    }
    if (f.out.length) {
        const vals = expand(
            dim,
            f.out.filter((v) => v !== NONE)
        );
        if (vals.length) parts.push(sql`(${col} IS NULL OR ${col} NOT IN (${list(vals)}))`);
        if (f.out.includes(NONE)) parts.push(sql`(${col} IS NOT NULL AND ${col} <> '')`);
    }
    return parts.length ? sql.join(parts, sql` AND `) : undefined;
}

/**
 * Tables the query reads. A dimension filter that includes values limits the
 * query to tables that have that column (filtering by action means "events").
 */
export function tablesFor(q: ExplorerQuery, skip?: DimKey): Table[] {
    const base: Table[] = q.source === 'all' ? ['events', 'checks'] : [q.source];
    return base.filter((t) =>
        Object.entries(q.dims).every(([dim, f]) => dim === skip || !f?.in.length || COLUMNS[t][dim as DimKey])
    );
}

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

type Window = { since: Date; until: Date };

/** WHERE clause for one table. `skip` leaves one dimension out (for its own facet). */
export function whereFor(table: Table, q: ExplorerQuery, w: Window, skip?: DimKey): SQL {
    const parts: SQL[] = [
        sql`received_at >= ${w.since.toISOString()}::timestamptz`,
        sql`received_at < ${w.until.toISOString()}::timestamptz`
    ];
    for (const [dim, f] of Object.entries(q.dims) as [DimKey, DimFilter][]) {
        if (dim === skip || !f) continue;
        const col = COLUMNS[table][dim];
        if (!col) continue; // only reachable for exclude-only filters; tablesFor drops the rest
        const c = dimCondition(sql.raw(col), f, dim);
        if (c) parts.push(c);
    }
    // Foreground/background events are ~75% of all traffic and rarely what
    // anyone is looking for. Hidden unless asked for, or picked explicitly.
    const pickedActions = skip !== 'action' && !!q.dims.action?.in.length;
    if (table === 'events' && !q.appState && !pickedActions) {
        parts.push(sql`(action IS NULL OR action NOT IN (${list(APP_STATE_ACTIONS)}))`);
    }
    if (q.q) {
        const p = escapeLike(q.q) + '%';
        parts.push(sql`(device_id LIKE ${p.toLowerCase()} OR custom_id ILIKE ${p})`);
    }
    if (q.prod !== 'any') parts.push(sql`is_prod = ${q.prod === 'yes'}`);
    if (q.emulator !== 'any') parts.push(sql`is_emulator = ${q.emulator === 'yes'}`);
    return sql.join(parts, sql` AND `);
}

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
    return (await db.execute(query)) as unknown as T[];
}

// --- rows ----------------------------------------------------------------------

const AT = sql.raw(`to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

const COMMON = sql.raw(`app_id AS "appId", device_id AS "deviceId", platform, channel,
    version_name AS "versionName", version_build AS "versionBuild", version_code AS "versionCode",
    version_os AS "versionOs", plugin_version AS "pluginVersion", custom_id AS "customId", country,
    is_prod AS "isProd", is_emulator AS "isEmulator"`);

function selectRows(table: Table): SQL {
    if (table === 'events') {
        return sql`SELECT 'event' AS kind, id::text AS id, ${AT} AS at, ${COMMON},
            action, old_version_name AS "oldVersionName", NULL::text AS result, NULL::text AS detail,
            NULL::int AS candidates, NULL::int AS "bundleId", NULL::text AS "bundleVersion"
            FROM stats_events`;
    }
    return sql`SELECT 'check' AS kind, id::text AS id, ${AT} AS at, ${COMMON},
        NULL::text AS action, NULL::text AS "oldVersionName", result, detail, candidates,
        bundle_id AS "bundleId", bundle_version AS "bundleVersion"
        FROM update_checks`;
}

type Cursor = { at: string; kind: number; id: bigint };

export function encodeCursor(r: Pick<ExplorerRow, 'at' | 'kind' | 'id'>): string {
    return `${r.at}|${r.kind === 'event' ? 1 : 0}|${r.id}`;
}

export function decodeCursor(s: string | undefined): Cursor | undefined {
    if (!s) return undefined;
    const [at, kind, id] = s.split('|');
    if (!at || Number.isNaN(new Date(at).getTime()) || !/^\d+$/.test(id ?? '') || (kind !== '0' && kind !== '1')) {
        return undefined;
    }
    return { at, kind: Number(kind), id: BigInt(id) };
}

/** Rows strictly after the cursor in (received_at, kind, id) DESC order. */
function cursorCondition(table: Table, c: Cursor): SQL {
    const at = sql`${c.at}::timestamptz`;
    const k = KIND_ORD[table];
    if (k < c.kind) return sql`received_at <= ${at}`;
    if (k > c.kind) return sql`received_at < ${at}`;
    return sql`(received_at < ${at} OR (received_at = ${at} AND id < ${c.id.toString()}::bigint))`;
}

function compareRows(a: ExplorerRow, b: ExplorerRow): number {
    // ISO strings with fixed width sort lexically.
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
    const ai = BigInt(a.id);
    const bi = BigInt(b.id);
    return ai === bi ? 0 : ai < bi ? 1 : -1;
}

export async function explorerRows(
    db: Db,
    q: ExplorerQuery,
    opts: { cursor?: string; limit?: number; now?: Date } = {}
): Promise<RowsPage> {
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
    const w = resolveRange(q, opts.now);
    const cursor = decodeCursor(opts.cursor);
    const tables = tablesFor(q);
    const pages = await Promise.all(
        tables.map((t) => {
            const where = cursor ? sql`${whereFor(t, q, w)} AND ${cursorCondition(t, cursor)}` : whereFor(t, q, w);
            return rows<ExplorerRow>(
                db,
                sql`${selectRows(t)} WHERE ${where} ORDER BY received_at DESC, id DESC LIMIT ${limit + 1}`
            );
        })
    );
    const merged = pages.flat().sort(compareRows);
    const page = merged.slice(0, limit);
    return {
        rows: page,
        next: merged.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null
    };
}

// --- summary -----------------------------------------------------------------

const BLOCKED_RESULTS = resultCodesIn('blocked');

export async function explorerSummary(db: Db, q: ExplorerQuery, w: Window): Promise<Summary> {
    const tables = tablesFor(q);
    const out: Summary = { events: 0, checks: 0, devices: 0, failures: 0, served: 0, blocked: 0 };
    if (!tables.length) return out;

    const tasks: Promise<void>[] = [];
    if (tables.includes('events')) {
        tasks.push(
            rows<{ n: number; failures: number }>(
                db,
                sql`SELECT COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE action IN (${list(FAILURE_ACTIONS)}))::int AS failures
                    FROM stats_events WHERE ${whereFor('events', q, w)}`
            ).then(([r]) => {
                out.events = r.n;
                out.failures = r.failures;
            })
        );
    }
    if (tables.includes('checks')) {
        tasks.push(
            rows<{ n: number; served: number; blocked: number }>(
                db,
                sql`SELECT COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE result = 'update')::int AS served,
                        COUNT(*) FILTER (WHERE result IN (${list(BLOCKED_RESULTS)}))::int AS blocked
                    FROM update_checks WHERE ${whereFor('checks', q, w)}`
            ).then(([r]) => {
                out.checks = r.n;
                out.served = r.served;
                out.blocked = r.blocked;
            })
        );
    }
    const unionDevices = sql.join(
        tables.map((t) => sql`SELECT device_id FROM ${sql.raw(TABLE_NAME[t])} WHERE ${whereFor(t, q, w)}`),
        sql` UNION ALL `
    );
    tasks.push(
        rows<{ n: number }>(
            db,
            sql`SELECT COUNT(DISTINCT device_id COLLATE "C")::int AS n FROM (${unionDevices}) d`
        ).then(([r]) => {
            out.devices = r.n;
        })
    );
    await Promise.all(tasks);
    return out;
}

/** Summary for the window and for the window of the same length right before it. */
export async function explorerSummaryWithPrior(
    db: Db,
    q: ExplorerQuery,
    now?: Date
): Promise<{ current: Summary; prior: Summary }> {
    const w = resolveRange(q, now);
    const span = w.until.getTime() - w.since.getTime();
    const prior = { since: new Date(w.since.getTime() - span), until: w.since };
    const [current, before] = await Promise.all([explorerSummary(db, q, w), explorerSummary(db, q, prior)]);
    return { current, prior: before };
}

// --- histogram ---------------------------------------------------------------

function actionCategorySql(): SQL {
    const whens = ACTION_GROUPS.map((g) => sql`WHEN action IN (${list(g.actions)}) THEN ${g.key}`);
    return sql`CASE ${sql.join(whens, sql` `)} ELSE 'other' END`;
}

function resultCategorySql(): SQL {
    const whens = CATEGORY_ORDER.filter((c) => c !== 'invalid').map(
        (c) => sql`WHEN result IN (${list(resultCodesIn(c))}) THEN ${'check:' + c}`
    );
    return sql`CASE ${sql.join(whens, sql` `)} ELSE 'check:invalid' END`;
}

/**
 * Event counts per time bucket, split by action group (events) or answer
 * category (checks). With both sources, checks collapse into one series so
 * the legend stays readable.
 */
export async function explorerHistogram(db: Db, q: ExplorerQuery, now?: Date): Promise<Histogram> {
    const w = resolveRange(q, now);
    const step = bucketSeconds(w.since, w.until);
    const tables = tablesFor(q);
    const bucket = sql`to_char(to_timestamp(floor(extract(epoch FROM received_at) / ${step}) * ${step}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

    const parts = await Promise.all(
        tables.map((t) => {
            const key = t === 'events' ? actionCategorySql() : tables.length > 1 ? sql`'checks'` : resultCategorySql();
            return rows<HistogramPoint>(
                db,
                sql`SELECT ${bucket} AS t, ${key} AS key, COUNT(*)::int AS n
                    FROM ${sql.raw(TABLE_NAME[t])} WHERE ${whereFor(t, q, w)}
                    GROUP BY 1, 2`
            );
        })
    );

    const buckets: string[] = [];
    const first = Math.floor(w.since.getTime() / 1000 / step) * step;
    for (let s = first; s * 1000 < w.until.getTime(); s += step) {
        buckets.push(new Date(s * 1000).toISOString().replace('.000Z', 'Z'));
    }
    return { bucketSeconds: step, buckets, points: parts.flat() };
}

// --- facets ------------------------------------------------------------------

const FACET_LIMIT = 8;

/** Top values of one dimension under every filter except its own. */
export async function explorerFacet(db: Db, q: ExplorerQuery, dim: DimKey, w: Window): Promise<FacetValue[]> {
    const tables = tablesFor(q, dim).filter((t) => COLUMNS[t][dim]);
    if (!tables.length) return [];
    const union = sql.join(
        tables.map((t) => {
            const col = sql.raw(COLUMNS[t][dim]!);
            return sql`SELECT COALESCE(NULLIF(${col}, ''), ${NONE}) AS value, device_id
                FROM ${sql.raw(TABLE_NAME[t])} WHERE ${whereFor(t, q, w, dim)}`;
        }),
        sql` UNION ALL `
    );
    return rows<FacetValue>(
        db,
        sql`SELECT value, COUNT(*)::int AS n, COUNT(DISTINCT device_id COLLATE "C")::int AS devices
            FROM (${union}) u GROUP BY value ORDER BY n DESC, value LIMIT ${FACET_LIMIT}`
    );
}

/** Dimensions that have a column in at least one table the source reads. */
export function facetDims(q: ExplorerQuery): DimKey[] {
    const base: Table[] = q.source === 'all' ? ['events', 'checks'] : [q.source];
    return DIMENSIONS.filter((d) => d.facet && base.some((t) => COLUMNS[t][d.key])).map((d) => d.key);
}

export async function explorerFacets(db: Db, q: ExplorerQuery, now?: Date): Promise<Facets> {
    const w = resolveRange(q, now);
    const dims = facetDims(q);
    const values = await Promise.all(dims.map((d) => explorerFacet(db, q, d, w)));
    return Object.fromEntries(dims.map((d, i) => [d, values[i]]));
}

// --- group by ----------------------------------------------------------------

export async function explorerGroups(
    db: Db,
    q: ExplorerQuery,
    dim: DimKey,
    opts: { limit?: number; now?: Date } = {}
): Promise<GroupRow[]> {
    const w = resolveRange(q, opts.now);
    const tables = tablesFor(q).filter((t) => COLUMNS[t][dim]);
    if (!tables.length) return [];
    const union = sql.join(
        tables.map((t) => {
            const col = sql.raw(COLUMNS[t][dim]!);
            return sql`SELECT COALESCE(NULLIF(${col}, ''), ${NONE}) AS value, device_id, received_at
                FROM ${sql.raw(TABLE_NAME[t])} WHERE ${whereFor(t, q, w)}`;
        }),
        sql` UNION ALL `
    );
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 500));
    return rows<GroupRow>(
        db,
        sql`SELECT value, COUNT(*)::int AS n, COUNT(DISTINCT device_id COLLATE "C")::int AS devices,
                to_char(MIN(received_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS first,
                to_char(MAX(received_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last
            FROM (${union}) u GROUP BY value ORDER BY n DESC, value LIMIT ${limit}`
    );
}

// --- one row with its context ------------------------------------------------

export type RowContext = { row: ExplorerRow | null; around: ExplorerRow[] };

const CONTEXT_MINUTES = 30;
const CONTEXT_ROWS = 25;

/** One row plus the same device's events and checks shortly before and after it. */
export async function explorerRowContext(db: Db, kind: 'event' | 'check', id: string): Promise<RowContext> {
    if (!/^\d+$/.test(id)) return { row: null, around: [] };
    const table: Table = kind === 'event' ? 'events' : 'checks';
    const [row] = await rows<ExplorerRow>(db, sql`${selectRows(table)} WHERE id = ${id}::bigint`);
    if (!row) return { row: null, around: [] };

    const from = sql`${row.at}::timestamptz - make_interval(mins => ${CONTEXT_MINUTES})`;
    const to = sql`${row.at}::timestamptz + make_interval(mins => ${CONTEXT_MINUTES})`;
    const parts = await Promise.all(
        (['events', 'checks'] as Table[]).map((t) =>
            rows<ExplorerRow>(
                db,
                sql`${selectRows(t)} WHERE app_id = ${row.appId} AND device_id = ${row.deviceId}
                    AND received_at BETWEEN ${from} AND ${to}
                    ORDER BY received_at DESC, id DESC LIMIT ${CONTEXT_ROWS * 2}`
            )
        )
    );
    // Keep the rows closest to the selected one.
    const all = parts.flat().sort(compareRows);
    const idx = all.findIndex((r) => r.kind === row.kind && r.id === row.id);
    const start = Math.max(0, idx - Math.floor(CONTEXT_ROWS / 2));
    return { row, around: all.slice(start, start + CONTEXT_ROWS) };
}
