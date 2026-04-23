import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { done, fail, kv, step, warn } from '../output.js';

const DEFAULT_FILENAME = 'capgo-update.json';

const TEMPLATE = {
    appId: 'com.example.app',
    serverUrl: 'https://ota.example.com',
    channel: 'production',
    distDir: 'dist',
    platforms: ['ios', 'android']
};

export function registerInit(program: Command): void {
    program
        .command('init')
        .description(`Scaffold a ${DEFAULT_FILENAME} config file in the current directory.`)
        .option('-f, --force', 'Overwrite an existing file')
        .option('--path <path>', `Custom target path (default: ./${DEFAULT_FILENAME})`)
        .action(async function action(this: Command): Promise<void> {
            const { force, path: customPath } = this.opts<{ force?: boolean; path?: string }>();
            const target = customPath
                ? path.resolve(process.cwd(), customPath)
                : path.resolve(process.cwd(), DEFAULT_FILENAME);
            if (existsSync(target) && !force) {
                fail(`${target} already exists — pass --force to overwrite`);
            }
            step(`Writing ${target}`);
            await writeFile(target, `${JSON.stringify(TEMPLATE, null, 2)}\n`, 'utf8');
            kv('appId', TEMPLATE.appId);
            kv('serverUrl', TEMPLATE.serverUrl);
            kv('channel', TEMPLATE.channel);
            kv('distDir', TEMPLATE.distDir);
            warn('put your adminToken in CAPGO_ADMIN_TOKEN env, not in this file (or gitignore it).');
            done('Config scaffolded — edit the placeholders and provide admin token via env');
        });
}
