import type { Command } from 'commander';
import chalk from 'chalk';
import {
    apiJson,
    PLATFORMS,
    type AppNeedingAttention,
    type BundleHealthRow,
    type BundleHealthSeverity,
    type BundlePurgeResponse,
    type BundleRow,
    type Platform
} from '../api.js';
import { resolveConfig } from '../config.js';
import { done, enterJsonMode, fail, kv, printJson, start, table } from '../output.js';
import { invalidateMatching } from '../completion-cache.js';
import { completionCache } from '../completion.js';
import { appIdError, isCanonicalBundleId } from '../validators.js';

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
            const opts = this.opts<{
                app?: string;
                channel?: string;
                state?: string;
                active?: boolean;
                json?: boolean;
            }>();
            if (opts.json) enterJsonMode();
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            if (opts.app) {
                const err = appIdError(opts.app);
                if (err) fail(err);
            }
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
            start('capgo-update-lite bundles list');
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
            done(`${rows.length} bundle${rows.length === 1 ? '' : 's'}`);
        });

    bundles
        .command('delete <bundle-id>')
        .description('Delete a bundle. Soft-delete by default; --purge hard-deletes + removes the R2 object.')
        .option('--purge', 'Hard-delete (unrecoverable — removes R2 object + DB row)')
        .action(async function action(this: Command, bundleIdArg: string): Promise<void> {
            if (!isCanonicalBundleId(bundleIdArg)) {
                fail(`bundle-id must be a positive integer with no leading zeros, got "${bundleIdArg}"`);
            }
            const bundleId = Number(bundleIdArg);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const { purge } = this.opts<{ purge?: boolean }>();
            start(`capgo-update-lite bundles delete ${bundleId}${purge ? ' (purge)' : ''}`);
            const p = `/admin/bundles/${bundleId}${purge ? '?purge=1' : ''}`;
            const res = await apiJson<BundleRow | BundlePurgeResponse>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'DELETE',
                p
            );
            // Bundle id alone doesn't carry app/channel scope, so wipe every
            // bundles-* cache entry to be safe. Apps cache stays intact.
            await invalidateMatching('bundles-').catch(() => {});
            if ('purged' in res && res.purged) {
                done(`Purged bundle #${res.deleted} (row + R2 object removed)`);
            } else {
                done(`Soft-deleted bundle #${(res as BundleRow).id}`);
            }
        });

    bundles
        .command('get <bundle-id>')
        .description('Fetch a single bundle by id.')
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command, bundleIdArg: string): Promise<void> {
            const { json } = this.opts<{ json?: boolean }>();
            if (json) enterJsonMode();
            if (!isCanonicalBundleId(bundleIdArg)) {
                fail(`bundle-id must be a positive integer with no leading zeros, got "${bundleIdArg}"`);
            }
            const bundleId = Number(bundleIdArg);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const row = await apiJson<BundleRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'GET',
                `/admin/bundles/${bundleId}`
            );
            if (json) {
                printJson(row);
                return;
            }
            start(`capgo-update-lite bundles get ${bundleId}`);
            kv('id', String(row.id));
            kv('app', row.appId);
            kv('channel', row.channel);
            kv('version', row.version);
            kv('state', row.state);
            kv('active', row.active ? 'yes' : 'no');
            kv('platforms', row.platforms.join(', '));
            kv('min_android_build', row.minAndroidBuild);
            kv('min_ios_build', row.minIosBuild);
            kv('checksum', row.checksum.slice(0, 16) + '…');
            kv('r2_key', row.r2Key);
            if (row.link) kv('link', row.link);
            if (row.comment) kv('comment', row.comment);
            const pkgs = Object.keys(row.nativePackages);
            kv('native_packages', pkgs.length === 0 ? '(none)' : `${pkgs.length} tracked`);
            kv('created', row.createdAt);
            if (row.releasedAt) kv('released', row.releasedAt);
            done(`Bundle #${row.id} (${row.appId}@${row.version})`);
        });

    bundles
        .command('edit <bundle-id>')
        .description("Patch a bundle's channel, link, comment, or platforms (no re-upload).")
        .option('-c, --channel <name>', 'Move the bundle to this channel')
        .option('--link <url>', 'Set release notes URL (use "null" to clear)')
        .option('--comment <text>', 'Set operator comment (use "null" to clear)')
        .option('-p, --platforms <list>', `Comma-separated platforms (${PLATFORMS.join(',')})`)
        .action(async function action(this: Command, bundleIdArg: string): Promise<void> {
            if (!isCanonicalBundleId(bundleIdArg)) {
                fail(`bundle-id must be a positive integer with no leading zeros, got "${bundleIdArg}"`);
            }
            const bundleId = Number(bundleIdArg);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const opts = this.opts<{
                channel?: string;
                link?: string;
                comment?: string;
                platforms?: string;
            }>();

            const patch: Record<string, unknown> = {};
            if (opts.channel !== undefined) patch.channel = opts.channel;
            // Treat the literal string "null" as a clear-the-field signal so
            // a CI script can erase a field with a single static argument.
            if (opts.link !== undefined) patch.link = opts.link === 'null' ? null : opts.link;
            if (opts.comment !== undefined) patch.comment = opts.comment === 'null' ? null : opts.comment;
            if (opts.platforms !== undefined) {
                const parts = opts.platforms
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                if (parts.length === 0) {
                    fail(`--platforms must list at least one of ${PLATFORMS.join(', ')}`);
                }
                for (const p of parts) {
                    if (!PLATFORMS.includes(p as Platform)) {
                        fail(`invalid platform "${p}" (expected one of ${PLATFORMS.join(', ')})`);
                    }
                }
                patch.platforms = parts;
            }

            if (Object.keys(patch).length === 0) {
                fail('nothing to update — pass at least one of --channel, --link, --comment, --platforms');
            }

            start(`capgo-update-lite bundles edit ${bundleId}`);
            const updated = await apiJson<BundleRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'PATCH',
                `/admin/bundles/${bundleId}`,
                patch
            );
            // Same scope-unknown problem as `bundles delete` — channel may
            // even have moved as part of the patch, so wipe broadly.
            await invalidateMatching('bundles-').catch(() => {});
            done(
                `Updated bundle #${updated.id}: channel=${updated.channel}, platforms=[${updated.platforms.join(', ')}], link=${updated.link ?? '—'}, comment=${updated.comment ?? '—'}`
            );
        });

    bundles
        .command('promote <version>')
        .description('Activate an existing bundle for (app, channel) — no re-upload.')
        .requiredOption('--app <id>', 'App id')
        .option('-c, --channel <name>', 'Channel (default: production)')
        .action(async function action(this: Command, versionArg: string): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const { app, channel } = this.opts<{ app: string; channel?: string }>();
            const appErr = appIdError(app);
            if (appErr) fail(appErr);
            const ch = channel ?? cfg.channel;
            start(`capgo-update-lite bundles promote ${versionArg}`);
            const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };
            // state=active narrows to bundles whose upload + checksum verified.
            // The server refuses to activate a pending/failed bundle with a 409
            // (services/bundles.ts:patchBundle). Filtering here points the
            // error at the real problem instead of round-tripping for it.
            const qs = new URLSearchParams({ app_id: app, channel: ch, state: 'active' });
            const rows = await apiJson<BundleRow[]>(ctx, 'GET', `/admin/bundles?${qs.toString()}`);
            const matches = rows.filter((r) => r.version === versionArg);
            if (matches.length === 0) {
                fail(
                    `no committed bundle with version ${versionArg} for app "${app}" channel "${ch}" — only state=active rows are promotable`
                );
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
            await completionCache.invalidateBundlesFor(app, ch).catch(() => {});
            done(`Activated ${updated.appId}@${updated.version} on "${updated.channel}" (bundle_id=${updated.id})`);
        });

    bundles
        .command('health [app-id]')
        .description(
            'Show the broken-bundle severity ladder. With <app-id>, lists each bundle of that app; without, summarises apps that need attention.'
        )
        .option('--json', 'Output raw JSON instead of a table')
        .action(async function action(this: Command, appIdArg?: string): Promise<void> {
            const { json } = this.opts<{ json?: boolean }>();
            if (json) enterJsonMode();
            if (appIdArg !== undefined) {
                const err = appIdError(appIdArg);
                if (err) fail(err);
            }
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            const ctx = { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken };

            if (appIdArg === undefined) {
                const rows = await apiJson<AppNeedingAttention[]>(ctx, 'GET', '/admin/bundle-health');
                if (json) {
                    printJson(rows);
                    return;
                }
                start('capgo-update-lite bundles health');
                if (rows.length === 0) {
                    done('All apps healthy — no bundles need attention.');
                    return;
                }
                table(
                    ['APP', 'NAME', 'AUTO-DISABLED', 'AT-RISK', 'WARN', 'NOISY'],
                    rows.map((r) => [
                        r.appId,
                        r.appName,
                        formatCount(r.autoDisabled, 'auto_disabled'),
                        formatCount(r.atRisk, 'at_risk'),
                        formatCount(r.warnings, 'warning'),
                        formatCount(r.noisy, 'noisy')
                    ])
                );
                done(`${rows.length} app${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} attention`);
                return;
            }

            const rows = await apiJson<BundleHealthRow[]>(
                ctx,
                'GET',
                `/admin/apps/${encodeURIComponent(appIdArg)}/bundle-health`
            );
            if (json) {
                printJson(rows);
                return;
            }
            start(`capgo-update-lite bundles health ${appIdArg}`);
            if (rows.length === 0) {
                done(`No bundles registered for ${appIdArg}.`);
                return;
            }
            // Surface the active thresholds once at the top — the per-row
            // severity is a function of these, so showing them prevents the
            // "why is 19% only a warning" question.
            const thr = rows[0].thresholds;
            kv(
                'thresholds',
                `min_devices=${thr.minDevices}, warn=${thr.warnRate.toFixed(2)}, risk=${thr.riskRate.toFixed(2)}, disable=${thr.disableRate.toFixed(2)}`
            );
            table(
                ['ID', 'VERSION', 'CHANNEL', 'STATE', 'ACTIVE', 'SEVERITY', 'FAIL/ATTEMPT', 'RATE'],
                rows.map((r) => [
                    String(r.bundleId),
                    r.version,
                    r.channel,
                    r.state,
                    r.active ? 'yes' : 'no',
                    formatSeverity(r.severity),
                    `${r.failedDevices}/${r.attemptedDevices}`,
                    r.attemptedDevices === 0 ? '—' : (r.failRate * 100).toFixed(1) + '%'
                ])
            );
            const flagged = rows.filter(
                (r) => r.severity !== 'healthy' && r.severity !== 'manually_disabled'
            ).length;
            done(
                flagged === 0
                    ? `${rows.length} bundle${rows.length === 1 ? '' : 's'}, all healthy`
                    : `${flagged}/${rows.length} bundle${rows.length === 1 ? '' : 's'} flagged`
            );
        });

    bundles
        .command('reactivate <bundle-id>')
        .description(
            'Restore an auto-disabled bundle: flip state=active + active=true, deactivate siblings, reset the per-device blacklist gate.'
        )
        .action(async function action(this: Command, bundleIdArg: string): Promise<void> {
            if (!isCanonicalBundleId(bundleIdArg)) {
                fail(`bundle-id must be a positive integer with no leading zeros, got "${bundleIdArg}"`);
            }
            const bundleId = Number(bundleIdArg);
            const cfg = await resolveConfig(this, ['serverUrl', 'adminToken']);
            start(`capgo-update-lite bundles reactivate ${bundleId}`);
            const row = await apiJson<BundleRow>(
                { serverUrl: cfg.serverUrl!, adminToken: cfg.adminToken },
                'POST',
                `/admin/bundles/${bundleId}/reactivate`
            );
            await invalidateMatching('bundles-').catch(() => {});
            done(`Reactivated ${row.appId}@${row.version} on "${row.channel}" (bundle_id=${row.id})`);
        });
}

function colorBySeverity(severity: BundleHealthSeverity, text: string): string {
    // Stick to single-SGR colours so every cell carries the same ANSI overhead;
    // table() pads on byte length, so chained styles (chalk.bold.red) or RGB
    // hexes would knock columns out of alignment.
    switch (severity) {
        case 'healthy':
            return chalk.green(text);
        case 'noisy':
            return chalk.dim(text);
        case 'warning':
            return chalk.yellow(text);
        case 'at_risk':
            return chalk.red(text);
        case 'auto_disabled':
            return chalk.redBright(text);
        case 'manually_disabled':
            return chalk.dim(text);
    }
}

function formatSeverity(severity: BundleHealthSeverity): string {
    return colorBySeverity(severity, severity);
}

function formatCount(n: number, severity: BundleHealthSeverity): string {
    if (n === 0) return chalk.dim('0');
    return colorBySeverity(severity, String(n));
}
