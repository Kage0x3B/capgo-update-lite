import type { Command } from 'commander';
import { apiJson, type BundlePurgeResponse, type BundleRow } from '../api.js';
import { resolveConfig } from '../config.js';
import { done, fail, kv, printJson, table } from '../output.js';

export function registerBundles(program: Command): void {
    const bundles = program.command('bundles').description('Manage bundles on the server.');

    bundles
        .command('list')
        .description('List bundles, optionally filtered.')
        .option('--app <id>', 'Filter by app id')
        .option('-c, --channel <name>', 'Filter by channel')
        .option('-s, --state <state>', 'Filter by lifecycle state (e.g. active, pending)')
        .option('--active', 'Only rows where active=true')
        .option('--no-active', 'Only rows where active=false')
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const opts = this.opts<{
                app?: string;
                channel?: string;
                state?: string;
                active?: boolean;
                json?: boolean;
            }>();
            const qs = new URLSearchParams();
            if (opts.app) qs.set('app_id', opts.app);
            if (opts.channel) qs.set('channel', opts.channel);
            if (opts.state) qs.set('state', opts.state);
            if (opts.active === true) qs.set('active', 'true');
            if (opts.active === false) qs.set('active', 'false');
            const qsStr = qs.toString();
            const rows = await apiJson<BundleRow[]>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'GET',
                `/admin/bundles${qsStr ? `?${qsStr}` : ''}`
            );
            if (opts.json) {
                printJson(rows);
                return;
            }
            table(
                ['ID', 'APP', 'CHANNEL', 'VERSION', 'STATE', 'ACTIVE', 'CREATED'],
                rows.map((r) => [
                    String(r.id),
                    r.appId,
                    r.channel,
                    r.version,
                    r.state,
                    r.active ? 'yes' : 'no',
                    new Date(r.createdAt).toISOString().slice(0, 10)
                ])
            );
        });

    bundles
        .command('delete <bundle-id>')
        .description('Delete a bundle. Soft-delete by default; --purge hard-deletes + removes the R2 object.')
        .option('--purge', 'Hard-delete (unrecoverable — removes R2 object + DB row)')
        .action(async function action(this: Command, bundleIdArg: string): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const bundleId = Number(bundleIdArg);
            if (!Number.isInteger(bundleId) || bundleId < 1) {
                fail(`bundle-id must be a positive integer, got "${bundleIdArg}"`);
            }
            const { purge } = this.opts<{ purge?: boolean }>();
            const p = `/admin/bundles/${bundleId}${purge ? '?purge=1' : ''}`;
            const res = await apiJson<BundleRow | BundlePurgeResponse>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'DELETE',
                p
            );
            if ('purged' in res && res.purged) {
                done(`Purged bundle #${res.deleted} (row + R2 object removed)`);
            } else {
                done(`Soft-deleted bundle #${(res as BundleRow).id}`);
            }
        });

    bundles
        .command('promote <version>')
        .description('Activate an existing bundle for (app, channel) — no re-upload.')
        .requiredOption('--app <id>', 'App id')
        .option('-c, --channel <name>', 'Channel (default: production)')
        .action(async function action(this: Command, versionArg: string): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const { app, channel } = this.opts<{ app: string; channel?: string }>();
            const ch = channel ?? cfg.channel;
            const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };
            const qs = new URLSearchParams({ app_id: app, channel: ch });
            const rows = await apiJson<BundleRow[]>(ctx, 'GET', `/admin/bundles?${qs.toString()}`);
            const matches = rows.filter((r) => r.version === versionArg);
            if (matches.length === 0) {
                fail(`no bundle with version ${versionArg} for app "${app}" channel "${ch}"`);
            }
            if (matches.length > 1) {
                fail(
                    `multiple bundles with version ${versionArg} — ambiguous; delete duplicates first. IDs: ${matches
                        .map((r) => r.id)
                        .join(', ')}`
                );
            }
            const bundle = matches[0];
            if (bundle.active) {
                kv('bundle_id', String(bundle.id));
                done(`Already active — ${bundle.appId}@${versionArg} on "${ch}"`);
                return;
            }
            const updated = await apiJson<BundleRow>(ctx, 'PATCH', `/admin/bundles/${bundle.id}`, { active: true });
            done(`Activated ${updated.appId}@${updated.version} on "${updated.channel}" (bundle_id=${updated.id})`);
        });
}
