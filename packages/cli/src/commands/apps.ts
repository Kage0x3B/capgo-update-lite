import type { Command } from 'commander';
import { apiJson, type AppRow } from '../api.js';
import { resolveConfig } from '../config.js';
import { done, printJson, table } from '../output.js';

export function registerApps(program: Command): void {
    const apps = program.command('apps').description('Manage apps registered on the server.');

    apps.command('list')
        .description('List all apps.')
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const rows = await apiJson<AppRow[]>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'GET',
                '/admin/apps'
            );
            if (this.opts().json) {
                printJson(rows);
                return;
            }
            table(
                ['ID', 'NAME', 'CREATED'],
                rows.map((r) => [r.id, r.name, new Date(r.createdAt).toISOString().slice(0, 10)])
            );
        });

    apps.command('add <app-id>')
        .description('Register a new app on the server.')
        .requiredOption('-n, --name <name>', 'Display name')
        .action(async function action(this: Command, appId: string): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const { name } = this.opts<{ name: string }>();
            const row = await apiJson<AppRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'POST',
                '/admin/apps',
                { id: appId, name }
            );
            done(`Registered ${row.id} ("${row.name}")`);
        });
}
