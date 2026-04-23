#!/usr/bin/env node
/**
 * capgo-update: CLI for a capgo-update-lite OTA server.
 *
 * Global options (--server-url, --admin-token, --config) cascade into every
 * subcommand via Command#optsWithGlobals(). Precedence everywhere:
 *   CLI flag  >  CAPGO_* env var  >  JSON config file  >  built-in default.
 */

import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { registerApps } from './commands/apps.js';
import { registerBundles } from './commands/bundles.js';
import { registerInit } from './commands/init.js';
import { registerProbe } from './commands/probe.js';
import { registerPublish } from './commands/publish.js';
import { registerStats } from './commands/stats.js';
import { fail } from './output.js';

type Pkg = { name: string; version: string };

async function readPackageJson(): Promise<Pkg> {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as Pkg;
}

async function main(): Promise<void> {
    const pkg = await readPackageJson();
    const program = new Command();
    program
        .name('capgo-update')
        .description('CLI for a capgo-update-lite OTA server.')
        .version(pkg.version, '-V, --version', 'print CLI version')
        .option('--server-url <url>', 'OTA server base URL (env CAPGO_SERVER_URL)')
        .option('--admin-token <token>', 'Bearer token for /admin/* (env CAPGO_ADMIN_TOKEN)')
        .option('--config <path>', 'JSON config path (default: ./capgo-update.json, env CAPGO_CONFIG)')
        .showHelpAfterError('(run with --help for usage)');

    registerPublish(program);
    registerApps(program);
    registerBundles(program);
    registerProbe(program);
    registerStats(program);
    registerInit(program);

    await program.parseAsync();
}

main().catch((e) => {
    fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
