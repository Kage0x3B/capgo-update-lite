import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { PLATFORMS, type Platform, type PluginError, type UpdateAvailable, type UpdatesResponse } from '../api.js';
import { resolveConfig } from '../config.js';
import { done, fail, kv, step, warn } from '../output.js';

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
            'Version the synthetic device claims to be running (default: 0.0.0 — forces update-available)'
        )
        .option('--device-id <uuid>', `Device UUID (default: ${FAKE_DEVICE_ID})`)
        .option('-c, --channel <name>', 'Channel override sent as defaultChannel')
        .action(async function action(this: Command): Promise<void> {
            const cfg = await resolveConfig(this, ['serverUrl']);
            const opts = this.opts<{
                app?: string;
                platform?: string;
                currentVersion?: string;
                deviceId?: string;
                channel?: string;
            }>();

            let appId = opts.app ?? cfg.appId;
            if (!appId) {
                const fromConfig = await readAppIdFromCapacitorConfig();
                if (fromConfig) appId = fromConfig;
            }
            if (!appId) {
                fail('could not resolve app id — pass --app, set "appId" in config, or run inside a Capacitor project');
            }

            const platform = (opts.platform ?? 'ios') as Platform;
            if (!PLATFORMS.includes(platform)) {
                fail(`invalid platform "${platform}" (expected one of ${PLATFORMS.join(', ')})`);
            }
            const deviceId = opts.deviceId ?? FAKE_DEVICE_ID;
            const versionName = opts.currentVersion ?? '0.0.0';
            const defaultChannel = opts.channel ?? cfg.channel;

            const body = {
                app_id: appId,
                device_id: deviceId,
                version_name: versionName,
                version_build: versionName,
                is_emulator: false,
                is_prod: true,
                platform,
                plugin_version: DEFAULT_PLUGIN_VERSION,
                defaultChannel
            };

            step(`POST ${cfg.serverUrl}/updates`);
            kv('app_id', appId);
            kv('device_id', deviceId);
            kv('platform', platform);
            kv('version_name', versionName);
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

async function readAppIdFromCapacitorConfig(): Promise<string | null> {
    for (const f of ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']) {
        const p = path.resolve(process.cwd(), f);
        if (!existsSync(p)) continue;
        try {
            const raw = await readFile(p, 'utf8');
            const m = raw.match(/appId\s*:\s*['"`]([^'"`]+)['"`]/);
            if (m) return m[1];
        } catch {
            // fall through
        }
    }
    return null;
}
