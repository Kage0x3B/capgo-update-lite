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
import { dispatchCompletionCallback, isCompletionCallback, registerCompletions } from './completion.js';
import { fail, isJsonMode } from './output.js';

type Pkg = { name: string; version: string };

async function readPackageJson(): Promise<Pkg> {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as Pkg;
}

/**
 * Commander's root --version handler fires even inside subcommand scope, so
 * `publish --version 1.2.3` would silently print the CLI version instead of
 * validating the bundle semver. Catch that pattern early with a clear message.
 */
function guardPublishVersionCollision(argv: readonly string[]): void {
    const publishIdx = argv.indexOf('publish');
    if (publishIdx === -1) return;
    const tail = argv.slice(publishIdx + 1);
    const versionIdx = tail.indexOf('--version');
    if (versionIdx === -1) return;
    const next = tail[versionIdx + 1];
    if (next && !next.startsWith('-')) {
        fail(
            '`publish --version <semver>` collides with the root --version flag. Use --bundle-version <semver> or CAPGO_VERSION instead.'
        );
    }
}

async function main(): Promise<void> {
    guardPublishVersionCollision(process.argv.slice(2));
    const pkg = await readPackageJson();
    const program = new Command();
    program
        .name('capgo-update')
        .description('CLI for a capgo-update-lite OTA server.')
        .version(pkg.version, '-V, --version', 'print CLI version')
        .option('--server-url <url>', 'OTA server base URL (env CAPGO_SERVER_URL)')
        .option('--admin-token <token>', 'Bearer token for /admin/* (env CAPGO_ADMIN_TOKEN)')
        .option('--config <path>', 'JSON config path (default: ./capgo-update.config.json, env CAPGO_CONFIG)')
        .showHelpAfterError('(run with --help for usage)');

    registerPublish(program);
    registerApps(program);
    registerBundles(program);
    registerProbe(program);
    registerStats(program);
    registerInit(program);

    // Must run AFTER every register*() call so tab() walks the final command
    // tree. Adds the `complete` subcommand and per-option/argument handlers.
    registerCompletions(program);

    // The shell calls back with `<bin> complete -- <subcommand-args>` for
    // live completions. tab patches `program.parse` to handle that, but our
    // main path uses parseAsync which bypasses the patch — so we route
    // completion callbacks through the synchronous parse here.
    if (isCompletionCallback(process.argv)) {
        dispatchCompletionCallback(program, process.argv);
        return;
    }

    await program.parseAsync();
}

main().catch((e) => {
    // In JSON mode emit just the message — a multi-line stack would still
    // round-trip through JSON.stringify safely, but it's noisy in a piped
    // consumer. Non-JSON mode keeps the stack for human debugging.
    const msg = e instanceof Error ? e.message : String(e);
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
    fail(isJsonMode() ? msg : detail);
});
