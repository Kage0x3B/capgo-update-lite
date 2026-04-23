import type { Command } from 'commander';
import { apiJson, type StatsEventRow } from '../api.js';
import { resolveConfig } from '../config.js';
import { printJson, table } from '../output.js';

export function registerStats(program: Command): void {
    program
        .command('stats')
        .description('List recent stats events (telemetry from clients).')
        .option('--app <id>', 'Filter by app id')
        .option('--action <name>', 'Filter by action name (e.g. update, set)')
        .option('--since <iso>', 'Include events received at or after this ISO-8601 timestamp')
        .option('--until <iso>', 'Include events received strictly before this ISO-8601 timestamp')
        .option('--limit <n>', 'Max rows (1..1000, default 100)')
        .option('--offset <n>', 'Skip rows (pagination)')
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const opts = this.opts<{
                app?: string;
                action?: string;
                since?: string;
                until?: string;
                limit?: string;
                offset?: string;
                json?: boolean;
            }>();
            const qs = new URLSearchParams();
            if (opts.app) qs.set('app_id', opts.app);
            if (opts.action) qs.set('action', opts.action);
            if (opts.since) qs.set('since', opts.since);
            if (opts.until) qs.set('until', opts.until);
            if (opts.limit) qs.set('limit', opts.limit);
            if (opts.offset) qs.set('offset', opts.offset);
            const qsStr = qs.toString();
            const rows = await apiJson<StatsEventRow[]>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'GET',
                `/admin/stats${qsStr ? `?${qsStr}` : ''}`
            );
            if (opts.json) {
                printJson(rows);
                return;
            }
            table(
                ['RECEIVED', 'APP', 'DEVICE', 'ACTION', 'PLATFORM', 'VERSION'],
                rows.map((r) => [
                    new Date(r.receivedAt).toISOString().replace('T', ' ').slice(0, 19),
                    r.appId,
                    `${r.deviceId.slice(0, 8)}…`,
                    r.action ?? '-',
                    r.platform ?? '-',
                    r.versionName ?? '-'
                ])
            );
        });
}
