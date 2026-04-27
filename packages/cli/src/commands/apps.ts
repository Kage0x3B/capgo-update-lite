import type { Command } from 'commander';
import { apiJson, type AppRow } from '../api.js';
import { resolveConfig } from '../config.js';
import { done, enterJsonMode, fail, kv, printJson, start, table } from '../output.js';
import { completionCache } from '../completion.js';
import { appIdError } from '../validators.js';

export const CEILINGS = ['none', 'patch', 'minor', 'major'] as const;
type Ceiling = (typeof CEILINGS)[number];

export function registerApps(program: Command): void {
    const apps = program.command('apps').description('Manage apps registered on the server.');

    apps.command('list')
        .description('List all apps.')
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command): Promise<void> {
            if (this.opts().json) enterJsonMode();
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
            start('capgo-update-lite apps list');
            table(
                ['ID', 'NAME', 'CEILING', 'UNDER-NATIVE', 'MIN-PLUGIN', 'CREATED'],
                rows.map((r) => [
                    r.id,
                    r.name,
                    r.disableAutoUpdate,
                    r.disableAutoUpdateUnderNative ? 'on' : 'off',
                    r.minPluginVersion ?? '—',
                    new Date(r.createdAt).toISOString().slice(0, 10)
                ])
            );
            done(`${rows.length} app${rows.length === 1 ? '' : 's'}`);
        });

    apps.command('get <app-id>')
        .description('Fetch a single app, including its compatibility policy.')
        .option('--json', 'Output raw JSON instead of a list')
        .action(async function action(this: Command, appId: string): Promise<void> {
            const { json } = this.opts<{ json?: boolean }>();
            if (json) enterJsonMode();
            const err = appIdError(appId);
            if (err) fail(err);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const row = await apiJson<AppRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'GET',
                `/admin/apps/${encodeURIComponent(appId)}`
            );
            if (json) {
                printJson(row);
                return;
            }
            start(`capgo-update-lite apps get ${appId}`);
            kv('id', row.id);
            kv('name', row.name);
            kv('disable_auto_update', row.disableAutoUpdate);
            kv('disable_auto_update_under_native', row.disableAutoUpdateUnderNative ? 'on' : 'off');
            kv('min_plugin_version', row.minPluginVersion ?? '—');
            kv('created', row.createdAt);
            done(`${row.id}`);
        });

    apps.command('add <app-id>')
        .description('Register a new app on the server.')
        .requiredOption('-n, --name <name>', 'Display name')
        .action(async function action(this: Command, appId: string): Promise<void> {
            const err = appIdError(appId);
            if (err) fail(err);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const { name } = this.opts<{ name: string }>();
            start('capgo-update-lite apps add');
            const row = await apiJson<AppRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'POST',
                '/admin/apps',
                { id: appId, name }
            );
            await completionCache.invalidateApps().catch(() => {});
            done(`Registered ${row.id} ("${row.name}")`);
        });

    apps.command('set-policy <app-id>')
        .description('Update per-app compatibility policy.')
        .option('--name <name>', 'Rename the app')
        .option(
            '--disable-auto-update <ceiling>',
            `Upgrade-class ceiling: ${CEILINGS.join('|')}`
        )
        .option(
            '--disable-auto-update-under-native',
            'Refuse OTA bundles older than device native (default for new apps)'
        )
        .option(
            '--no-disable-auto-update-under-native',
            'Allow serving OTA bundles whose semver is below the device native version'
        )
        .option(
            '--min-plugin-version <semver>',
            'Minimum @capgo/capacitor-updater version (use "null" to clear)'
        )
        .action(async function action(this: Command, appId: string): Promise<void> {
            const err = appIdError(appId);
            if (err) fail(err);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const opts = this.opts<{
                name?: string;
                disableAutoUpdate?: string;
                disableAutoUpdateUnderNative?: boolean;
                minPluginVersion?: string;
            }>();

            const patch: Record<string, unknown> = {};
            if (opts.name !== undefined) patch.name = opts.name;
            if (opts.disableAutoUpdate !== undefined) {
                if (!CEILINGS.includes(opts.disableAutoUpdate as Ceiling)) {
                    fail(
                        `--disable-auto-update must be one of: ${CEILINGS.join(', ')} (got "${opts.disableAutoUpdate}")`
                    );
                }
                patch.disable_auto_update = opts.disableAutoUpdate;
            }
            if (opts.disableAutoUpdateUnderNative !== undefined) {
                patch.disable_auto_update_under_native = opts.disableAutoUpdateUnderNative;
            }
            if (opts.minPluginVersion !== undefined) {
                patch.min_plugin_version =
                    opts.minPluginVersion === 'null' ? null : opts.minPluginVersion;
            }

            if (Object.keys(patch).length === 0) {
                fail('nothing to update — pass at least one of --name, --disable-auto-update, --disable-auto-update-under-native / --no-…, --min-plugin-version');
            }

            start(`capgo-update-lite apps set-policy ${appId}`);
            const row = await apiJson<AppRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'PATCH',
                `/admin/apps/${encodeURIComponent(appId)}`,
                patch
            );
            await completionCache.invalidateApps().catch(() => {});
            done(
                `Updated ${row.id}: ceiling=${row.disableAutoUpdate}, under-native=${row.disableAutoUpdateUnderNative ? 'on' : 'off'}, min-plugin=${row.minPluginVersion ?? '—'}`
            );
        });
}
