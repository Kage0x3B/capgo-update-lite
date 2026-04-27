import type { Command } from 'commander';
import { PLATFORMS, type Platform, type PluginError, type UpdateAvailable, type UpdatesResponse } from '../api.js';
import { readAppIdFromCapacitorConfig } from '../capacitor-config.js';
import { resolveConfig } from '../config.js';
import { done, fail, kv, start, step, warn } from '../output.js';
import { appIdError, isUuidLike } from '../validators.js';

const FAKE_DEVICE_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_PLUGIN_VERSION = '7.4.0';

export function registerProbe(program: Command): void {
    program
        .command('probe')
        .description('Smoke-test POST /updates with a synthetic device request.')
        .option('--app <id>', 'App id (falls back to capacitor.config appId)')
        .option('--platform <p>', `One of: ${PLATFORMS.join(', ')} (default: ios)`)
        .option(
            '--current-version <semver>',
            'Bundle (JS) version the synthetic device claims to be running (default: 0.0.0 — forces update-available)'
        )
        .option(
            '--native-version <semver>',
            'Native shell version (versionName / CFBundleShortVersionString). Defaults to --current-version, which simulates a fresh install'
        )
        .option('--device-id <uuid>', `Device UUID (default: ${FAKE_DEVICE_ID})`)
        .option(
            '--plugin-version <semver>',
            `@capgo/capacitor-updater version on the synthetic device (default: ${DEFAULT_PLUGIN_VERSION})`
        )
        .option('--emulator', 'Mark the device as an emulator/simulator (default: off)')
        .option('--no-emulator', 'Mark the device as physical (default)')
        .option('--prod', 'Mark the build as a release/prod build (default)')
        .option('--no-prod', 'Mark the build as a debug build')
        .option('-c, --channel <name>', 'Channel override sent as defaultChannel')
        .action(async function action(this: Command): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl']);
            const opts = this.opts<{
                app?: string;
                platform?: string;
                currentVersion?: string;
                nativeVersion?: string;
                deviceId?: string;
                pluginVersion?: string;
                emulator?: boolean;
                prod?: boolean;
                channel?: string;
            }>();

            let appId = opts.app ?? cfg.appId;
            if (!appId) {
                const fromConfig = await readAppIdFromCapacitorConfig();
                if (fromConfig) appId = fromConfig.appId;
            }
            if (!appId) {
                fail('could not resolve app id — pass --app, set "appId" in config, or run inside a Capacitor project');
            }
            const appErr = appIdError(appId);
            if (appErr) fail(appErr);

            const platform = (opts.platform ?? 'ios') as Platform;
            if (!PLATFORMS.includes(platform)) {
                fail(`invalid platform "${platform}" (expected one of ${PLATFORMS.join(', ')})`);
            }
            const deviceId = opts.deviceId ?? FAKE_DEVICE_ID;
            if (!isUuidLike(deviceId)) {
                fail(`--device-id "${deviceId}" is not a UUID (expected 8-4-4-4-12 hex)`);
            }
            const versionName = opts.currentVersion ?? '0.0.0';
            const versionBuild = opts.nativeVersion ?? versionName;
            const pluginVersion = opts.pluginVersion ?? DEFAULT_PLUGIN_VERSION;
            // Commander stores --foo / --no-foo on the same key (boolean). When
            // neither is passed, the key is undefined → fall back to default.
            const isEmulator = opts.emulator === true;
            const isProd = opts.prod !== false;
            const defaultChannel = opts.channel ?? cfg.channel;

            const body = {
                app_id: appId,
                device_id: deviceId,
                version_name: versionName,
                version_build: versionBuild,
                is_emulator: isEmulator,
                is_prod: isProd,
                platform,
                plugin_version: pluginVersion,
                defaultChannel
            };

            start('capgo-update-lite probe');
            step(`POST ${cfg.serverUrl}/updates`);
            kv('app_id', appId);
            kv('device_id', deviceId);
            kv('platform', platform);
            kv('version_name', versionName);
            kv('version_build', versionBuild);
            kv('plugin_version', pluginVersion);
            kv('is_emulator', String(isEmulator));
            kv('is_prod', String(isProd));
            kv('defaultChannel', defaultChannel);

            const res = await fetch(`${cfg.serverUrl}/updates`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) fail(`HTTP ${res.status}: ${await res.text()}`);
            const data = (await res.json()) as UpdatesResponse;

            step('Response');
            if ('error' in data) {
                const err = data as PluginError;
                kv('error', err.error);
                kv('message', err.message);
                warn(`server returned "${err.error}" — plugin would receive no update`);
                done('No update available');
                return;
            }
            const upd = data as UpdateAvailable;
            kv('version', upd.version);
            kv('checksum', upd.checksum);
            if (upd.link) kv('link', upd.link);
            if (upd.comment) kv('comment', upd.comment);
            kv('url', upd.url.length > 80 ? `${upd.url.slice(0, 77)}...` : upd.url);
            done(`Update available — plugin would install ${upd.version}`);
        });
}
