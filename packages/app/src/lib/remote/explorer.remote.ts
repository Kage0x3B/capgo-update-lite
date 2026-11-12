import { query } from '$app/server';
import * as v from 'valibot';
import { requireAdminSession } from '$lib/server/auth.js';
import { withDb } from '$lib/server/remote-helpers.js';
import {
    explorerFacets,
    explorerGroups,
    explorerHistogram,
    explorerRowContext,
    explorerRows,
    explorerSummaryWithPrior
} from '$lib/server/services/explorer.js';
import { DIMENSIONS, parseQuery, type DimKey } from '$lib/util/explorer.js';

// The page sends its URL query string; the server parses it with the same
// parser, so what the URL says is exactly what gets queried.
const Qs = v.pipe(v.string(), v.maxLength(8000));
const parse = (qs: string) => parseQuery(new URLSearchParams(qs));

export const getExplorerRows = query(
    v.object({
        qs: Qs,
        cursor: v.optional(v.pipe(v.string(), v.maxLength(200))),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)))
    }),
    async ({ qs, cursor, limit }) => {
        requireAdminSession();
        return withDb((db) => explorerRows(db, parse(qs), { cursor, limit }));
    }
);

export const getExplorerSummary = query(v.object({ qs: Qs }), async ({ qs }) => {
    requireAdminSession();
    return withDb((db) => explorerSummaryWithPrior(db, parse(qs)));
});

export const getExplorerHistogram = query(v.object({ qs: Qs }), async ({ qs }) => {
    requireAdminSession();
    return withDb((db) => explorerHistogram(db, parse(qs)));
});

export const getExplorerFacets = query(v.object({ qs: Qs }), async ({ qs }) => {
    requireAdminSession();
    return withDb((db) => explorerFacets(db, parse(qs)));
});

export const getExplorerGroups = query(
    v.object({ qs: Qs, dim: v.picklist(DIMENSIONS.map((d) => d.key) as [DimKey, ...DimKey[]]) }),
    async ({ qs, dim }) => {
        requireAdminSession();
        return withDb((db) => explorerGroups(db, parse(qs), dim));
    }
);

export const getExplorerRow = query(
    v.object({ kind: v.picklist(['event', 'check']), id: v.pipe(v.string(), v.regex(/^\d{1,20}$/)) }),
    async ({ kind, id }) => {
        requireAdminSession();
        return withDb((db) => explorerRowContext(db, kind, id));
    }
);
