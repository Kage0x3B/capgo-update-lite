/**
 * Filter model for the stats explorer (/dashboard/stats). Client-safe: the
 * page parses and writes it from the URL, and the server parses the same query
 * string, so the URL is the single source of truth for what is shown.
 *
 * URL shape (every key optional, defaults omitted):
 *
 *   src=events|checks|all      which table(s) to read          (default events)
 *   range=15m|1h|…|90d|custom  relative window ending now      (default 24h)
 *   from=ISO&to=ISO            only with range=custom
 *   q=text                     device id prefix or custom id prefix
 *   appstate=1                 include foreground/background events
 *   prod=yes|no, emu=yes|no    release build / emulator flags
 *   <dim>=a,b,!c,@group        per-dimension include/exclude lists
 *
 * In a dimension list, `!value` excludes, `@key` expands to an action group
 * (action) or a result category (result), and `~` stands for "no value".
 */
import { ACTION_GROUPS, actionGroupByKey, actionLabel } from './statsActions.js';
import { CATEGORY_LABELS, isResultCategory, resultLabel } from './updateResults.js';

export type Source = 'events' | 'checks' | 'all';
export const SOURCES: { key: Source; label: string }[] = [
    { key: 'events', label: 'Plugin events' },
    { key: 'checks', label: 'Update checks' },
    { key: 'all', label: 'Both' }
];

export const RANGE_PRESETS = ['15m', '1h', '6h', '24h', '7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type Range = RangePreset | 'custom';

const PRESET_MS: Record<RangePreset, number> = {
    '15m': 15 * 60_000,
    '1h': 3_600_000,
    '6h': 6 * 3_600_000,
    '24h': 24 * 3_600_000,
    '7d': 7 * 86_400_000,
    '30d': 30 * 86_400_000,
    '90d': 90 * 86_400_000
};

/** Cookie holding the app last picked in the stats app picker ('' = all apps). */
export const LAST_APP_COOKIE = 'explorer_app';

/** Longest custom window the server accepts. Retention is 90d by default. */
export const MAX_SPAN_MS = 400 * 86_400_000;

export type DimKey =
    | 'app'
    | 'action'
    | 'result'
    | 'device'
    | 'platform'
    | 'channel'
    | 'version'
    | 'native'
    | 'plugin'
    | 'os'
    | 'country'
    | 'bundle';

export type DimInfo = {
    key: DimKey;
    label: string;
    /** Tables that have this column. A filter including values limits the query to them. */
    sources: Array<'events' | 'checks'>;
    /** Offer a facet (top values) for it. */
    facet: boolean;
};

export const DIMENSIONS: DimInfo[] = [
    // No facet: the app picker at the top of the page owns this dimension.
    { key: 'app', label: 'App', sources: ['events', 'checks'], facet: false },
    { key: 'action', label: 'Action', sources: ['events'], facet: true },
    { key: 'result', label: 'Answer', sources: ['checks'], facet: true },
    { key: 'version', label: 'Bundle', sources: ['events', 'checks'], facet: true },
    { key: 'platform', label: 'Platform', sources: ['events', 'checks'], facet: true },
    { key: 'channel', label: 'Channel', sources: ['events', 'checks'], facet: true },
    { key: 'native', label: 'Native version', sources: ['events', 'checks'], facet: true },
    { key: 'plugin', label: 'Plugin', sources: ['events', 'checks'], facet: true },
    { key: 'os', label: 'OS', sources: ['events', 'checks'], facet: true },
    { key: 'country', label: 'Country', sources: ['events', 'checks'], facet: true },
    { key: 'bundle', label: 'Served bundle', sources: ['checks'], facet: true },
    { key: 'device', label: 'Device', sources: ['events', 'checks'], facet: true }
];

export const DIM_BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));

/** Token for "column is NULL / empty". */
export const NONE = '~';

export type DimFilter = { in: string[]; out: string[] };
export type Flag = 'any' | 'yes' | 'no';

export type ExplorerQuery = {
    source: Source;
    range: Range;
    /** ISO, only for range=custom. */
    from?: string;
    to?: string;
    q: string;
    appState: boolean;
    prod: Flag;
    emulator: Flag;
    dims: Partial<Record<DimKey, DimFilter>>;
};

export const DEFAULT_QUERY: ExplorerQuery = {
    source: 'events',
    range: '24h',
    q: '',
    appState: false,
    prod: 'any',
    emulator: 'any',
    dims: {}
};

const MAX_VALUES = 50;
const MAX_VALUE_LEN = 128;

function flag(v: string | null): Flag {
    return v === 'yes' || v === 'no' ? v : 'any';
}

function validIso(v: string | null): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseQuery(params: URLSearchParams): ExplorerQuery {
    const src = params.get('src');
    const range = params.get('range');
    const out: ExplorerQuery = {
        source: src === 'checks' || src === 'all' ? src : 'events',
        range:
            range === 'custom' || (RANGE_PRESETS as readonly string[]).includes(range ?? '') ? (range as Range) : '24h',
        q: (params.get('q') ?? '').trim().slice(0, 64),
        appState: params.get('appstate') === '1',
        prod: flag(params.get('prod')),
        emulator: flag(params.get('emu')),
        dims: {}
    };
    if (out.range === 'custom') {
        out.from = validIso(params.get('from'));
        out.to = validIso(params.get('to'));
        if (!out.from) out.range = '24h';
    }
    for (const d of DIMENSIONS) {
        const raw = params.get(d.key);
        if (!raw) continue;
        const f: DimFilter = { in: [], out: [] };
        for (const tok of raw.split(',').slice(0, MAX_VALUES)) {
            const t = tok.trim().slice(0, MAX_VALUE_LEN);
            if (!t || t === '!') continue;
            if (t.startsWith('!')) f.out.push(t.slice(1));
            else f.in.push(t);
        }
        if (f.in.length || f.out.length) out.dims[d.key] = f;
    }
    return out;
}

export function toParams(q: ExplorerQuery): URLSearchParams {
    const p = new URLSearchParams();
    if (q.source !== 'events') p.set('src', q.source);
    if (q.range !== '24h') p.set('range', q.range);
    if (q.range === 'custom') {
        if (q.from) p.set('from', q.from);
        if (q.to) p.set('to', q.to);
    }
    if (q.q) p.set('q', q.q);
    if (q.appState) p.set('appstate', '1');
    if (q.prod !== 'any') p.set('prod', q.prod);
    if (q.emulator !== 'any') p.set('emu', q.emulator);
    for (const d of DIMENSIONS) {
        const f = q.dims[d.key];
        if (!f || (!f.in.length && !f.out.length)) continue;
        p.set(d.key, [...f.in, ...f.out.map((v) => '!' + v)].join(','));
    }
    return p;
}

export function toQueryString(q: ExplorerQuery): string {
    return toParams(q).toString();
}

/** Resolve the time window. `now` is injectable for tests. */
export function resolveRange(q: ExplorerQuery, now = new Date()): { since: Date; until: Date } {
    if (q.range === 'custom' && q.from) {
        const since = new Date(q.from);
        let until = q.to ? new Date(q.to) : now;
        if (until <= since) until = new Date(since.getTime() + 60_000);
        if (until.getTime() - since.getTime() > MAX_SPAN_MS) until = new Date(since.getTime() + MAX_SPAN_MS);
        return { since, until };
    }
    const preset: RangePreset = q.range === 'custom' ? '24h' : q.range;
    return { since: new Date(now.getTime() - PRESET_MS[preset]), until: now };
}

const BUCKET_STEPS = [60, 300, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86_400, 7 * 86_400];

/** Histogram bucket size in seconds: the smallest step giving at most ~120 bars. */
export function bucketSeconds(since: Date, until: Date): number {
    const span = (until.getTime() - since.getTime()) / 1000;
    return BUCKET_STEPS.find((s) => span / s <= 120) ?? BUCKET_STEPS.at(-1)!;
}

/** Return a copy with one value added to (or moved into) a dimension's include or exclude list. */
export function withValue(q: ExplorerQuery, dim: DimKey, value: string, mode: 'in' | 'out' | 'only'): ExplorerQuery {
    const cur = q.dims[dim] ?? { in: [], out: [] };
    let next: DimFilter;
    if (mode === 'only') next = { in: [value], out: [] };
    else if (mode === 'in')
        next = { in: [...cur.in.filter((v) => v !== value), value], out: cur.out.filter((v) => v !== value) };
    else next = { in: cur.in.filter((v) => v !== value), out: [...cur.out.filter((v) => v !== value), value] };
    return { ...q, dims: { ...q.dims, [dim]: next } };
}

export function withoutValue(q: ExplorerQuery, dim: DimKey, value: string): ExplorerQuery {
    const cur = q.dims[dim];
    if (!cur) return q;
    const next = { in: cur.in.filter((v) => v !== value), out: cur.out.filter((v) => v !== value) };
    const dims = { ...q.dims };
    if (next.in.length || next.out.length) dims[dim] = next;
    else delete dims[dim];
    return { ...q, dims };
}

/** Human label for one dimension value or token. */
export function valueLabel(dim: DimKey, value: string): string {
    if (value === NONE) return '(none)';
    if (dim === 'action') {
        if (value.startsWith('@')) return `${actionGroupByKey(value.slice(1))?.label ?? value} (all)`;
        return actionLabel(value);
    }
    if (dim === 'result') {
        if (value.startsWith('@')) {
            const c = value.slice(1);
            return isResultCategory(c) ? `${CATEGORY_LABELS[c]} (all)` : value;
        }
        return resultLabel(value);
    }
    if (dim === 'device') return value.length > 13 ? value.slice(0, 8) + '…' : value;
    return value;
}

/** Number of active filters, for badges. Time range and source don't count. */
export function activeFilterCount(q: ExplorerQuery): number {
    let n = 0;
    for (const f of Object.values(q.dims)) n += (f?.in.length ?? 0) + (f?.out.length ?? 0);
    if (q.q) n++;
    if (q.prod !== 'any') n++;
    if (q.emulator !== 'any') n++;
    return n;
}

/** Group tokens the action filter menu offers. */
export const ACTION_GROUP_TOKENS = ACTION_GROUPS.map((g) => ({ token: '@' + g.key, label: g.label, color: g.color }));

export const APP_STATE_ACTIONS = ['app_moved_to_foreground', 'app_moved_to_background'];

// --- wire types shared by the remote functions and the page ------------------

export type ExplorerRow = {
    kind: 'event' | 'check';
    id: string;
    /** ISO with microseconds, UTC. */
    at: string;
    appId: string;
    deviceId: string;
    platform: string | null;
    channel: string | null;
    versionName: string | null;
    versionBuild: string | null;
    versionCode: string | null;
    versionOs: string | null;
    pluginVersion: string | null;
    customId: string | null;
    country: string | null;
    isProd: boolean | null;
    isEmulator: boolean | null;
    // events only
    action: string | null;
    oldVersionName: string | null;
    // checks only
    result: string | null;
    detail: string | null;
    candidates: number | null;
    bundleId: number | null;
    bundleVersion: string | null;
};

export type RowsPage = { rows: ExplorerRow[]; next: string | null };

export type Summary = {
    events: number;
    checks: number;
    devices: number;
    failures: number;
    served: number;
    blocked: number;
};

export type HistogramPoint = { t: string; key: string; n: number };
export type Histogram = { bucketSeconds: number; buckets: string[]; points: HistogramPoint[] };

export type FacetValue = { value: string; n: number; devices: number };
export type Facets = Partial<Record<DimKey, FacetValue[]>>;

export type GroupRow = { value: string; n: number; devices: number; first: string; last: string };

/** URLSearchParams.toString() with `,` `@` `!` `:` left readable, for shareable links. */
export function readableQuery(p: URLSearchParams): string {
    return p.toString().replace(/%2C/gi, ',').replace(/%40/gi, '@').replace(/%21/gi, '!').replace(/%3A/gi, ':');
}
