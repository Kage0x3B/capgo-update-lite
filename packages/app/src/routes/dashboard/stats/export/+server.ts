import { error } from '@sveltejs/kit';
import { createDb } from '$lib/server/db/index.js';
import { explorerRows } from '$lib/server/services/explorer.js';
import { parseQuery, type ExplorerRow } from '$lib/util/explorer.js';
import type { RequestHandler } from './$types.js';

const MAX_ROWS = 50_000;
const PAGE = 1000;

const COLUMNS: (keyof ExplorerRow)[] = [
    'kind',
    'id',
    'at',
    'appId',
    'deviceId',
    'customId',
    'action',
    'result',
    'versionName',
    'oldVersionName',
    'bundleVersion',
    'versionBuild',
    'versionCode',
    'versionOs',
    'platform',
    'channel',
    'pluginVersion',
    'country',
    'isProd',
    'isEmulator',
    'candidates',
    'detail'
];

function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Download what the explorer shows (same query string), newest first, up to
 * 50k rows. Dashboard session auth comes from hooks.server.ts.
 */
export const GET: RequestHandler = async ({ url, locals, platform }) => {
    if (!locals.auth) error(401, 'unauthorized');
    if (!platform) error(500, 'platform bindings missing');
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    const params = new URLSearchParams(url.searchParams);
    params.delete('format');
    const q = parseQuery(params);
    // Pin "now" so paging through a relative window stays consistent.
    const now = new Date();

    const handle = createDb(platform.env.HYPERDRIVE);
    const all: ExplorerRow[] = [];
    try {
        let cursor: string | undefined;
        while (all.length < MAX_ROWS) {
            const page = await explorerRows(handle.db, q, { cursor, limit: PAGE, now });
            all.push(...page.rows);
            if (!page.next) break;
            cursor = page.next;
        }
    } finally {
        platform.ctx.waitUntil(handle.close());
    }

    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const body =
        format === 'json'
            ? JSON.stringify(all.slice(0, MAX_ROWS))
            : [
                  COLUMNS.join(','),
                  ...all.slice(0, MAX_ROWS).map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))
              ].join('\n') + '\n';
    return new Response(body, {
        headers: {
            'content-type': format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="stats-${stamp}.${format}"`
        }
    });
};
