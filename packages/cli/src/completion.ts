/**
 * Shell tab-completion wiring built on @bomb.sh/tab's commander integration.
 *
 * `tab(program)` walks the commander tree and registers every subcommand +
 * its options into a parallel structure. For each option / positional we
 * care about, we attach a handler that emits `(value, description)` pairs
 * via the `complete()` callback the library hands us at TAB time.
 *
 * Three flavours of handler:
 *   - static enums (--platforms, --platform, --state, --disable-auto-update)
 *   - dynamic --app/--app-id from GET /admin/apps with disk cache
 *   - dynamic --channel and `bundles promote <version>` scoped by the appId
 *     we can resolve from env / config / capacitor.config.* at TAB time
 *
 * Every dynamic handler is best-effort: missing token, unreachable server,
 * non-2xx, or timeout collapses into "no completions". Anything more would
 * print to stderr and corrupt the completion menu in some shells.
 */

import type { Command as CommanderCommand } from 'commander';
import tab from '@bomb.sh/tab/commander';
import type { Argument, Command as TabCommand, Complete, Option, RootCommand } from '@bomb.sh/tab';
import { PLATFORMS, type AppRow, type BundleRow } from './api.js';
import { loadCompletionConfig } from './config.js';
import { CEILINGS } from './commands/apps.js';
import { invalidate, readCache, writeCache } from './completion-cache.js';

const FETCH_TIMEOUT_MS = 1500;
const APPS_CACHE = 'apps';
const bundlesCacheKey = (appId: string, channel: string): string => `bundles-${appId}-${channel}`;
const BUNDLE_STATES = ['active', 'pending', 'failed', 'deleted'] as const;

type CompleteFn = Complete;

/**
 * Returns true and forwards to tab's completion-callback path when the shell
 * is invoking us for live completions (the canonical shape is
 * `<bin> complete -- <subcommand-args...>`). Tab patches `program.parse` to
 * intercept this, but our main uses `parseAsync` which bypasses the patch —
 * so we route the call here before parseAsync runs.
 */
export function isCompletionCallback(argv: readonly string[] = process.argv): boolean {
    const completeIdx = argv.indexOf('complete');
    if (completeIdx === -1) return false;
    const dashIdx = argv.indexOf('--');
    return dashIdx !== -1 && dashIdx > completeIdx;
}

export function dispatchCompletionCallback(
    program: CommanderCommand,
    argv: readonly string[] = process.argv
): void {
    // tab.commander.mjs replaces program.parse with a function that detects
    // `complete --` and emits completions to stdout. We call the patched
    // synchronous parse directly; tab's handlers may be async but the lib
    // awaits them internally before flushing stdout.
    program.parse([...argv]);
}

/**
 * Hook tab into commander, then attach all completion handlers. Must run
 * AFTER every `registerX(program)` call so the subcommand tree is final.
 */
export function registerCompletions(program: CommanderCommand): RootCommand {
    const completion = tab(program);

    // --- option handlers ----
    type OptionTarget = readonly [path: string, optionName: string];

    const APP_OPTIONS: readonly OptionTarget[] = [
        ['publish', 'app-id'],
        ['bundles list', 'app'],
        ['bundles promote', 'app'],
        ['probe', 'app'],
        ['stats', 'app'],
        ['init', 'app-id']
    ];
    for (const [p, name] of APP_OPTIONS) {
        attachOption(completion, p, name, completeAppId);
    }

    const CHANNEL_OPTIONS: readonly OptionTarget[] = [
        ['publish', 'channel'],
        ['bundles list', 'channel'],
        ['bundles promote', 'channel'],
        ['bundles edit', 'channel'],
        ['probe', 'channel'],
        ['init', 'channel']
    ];
    for (const [p, name] of CHANNEL_OPTIONS) {
        attachOption(completion, p, name, completeChannel);
    }

    attachOption(completion, 'publish', 'platforms', completeFromList(PLATFORMS));
    attachOption(completion, 'bundles edit', 'platforms', completeFromList(PLATFORMS));
    attachOption(completion, 'probe', 'platform', completeFromList(PLATFORMS));
    attachOption(completion, 'bundles list', 'state', completeFromList(BUNDLE_STATES));
    attachOption(completion, 'apps set-policy', 'disable-auto-update', completeFromList(CEILINGS));

    // --- positional handlers ----
    // Tab's commander integration mirrors options automatically but not
    // arguments — we register positional handlers ourselves on the tab
    // Command instances exposed via completion.commands.
    attachPositional(completion, 'apps get', 'app-id', completeAppIdArg);
    attachPositional(completion, 'apps set-policy', 'app-id', completeAppIdArg);
    attachPositional(completion, 'bundles promote', 'version', completeBundleVersion);

    return completion;
}

// --- public handler functions (exported for tests) ----

/**
 * Static-enum factory. The library requires both a value and a description;
 * we hand each option an empty description string so shells fall back to
 * showing just the value.
 */
export function completeFromList(values: readonly string[]): (complete: CompleteFn) => void {
    return (complete) => {
        for (const v of values) complete(v, '');
    };
}

/**
 * Lists every app the admin token can see. Cached for 5 min; cache is
 * invalidated by the `apps add`, `apps set-policy`, and `publish commit`
 * write paths so newly-registered apps show up on the next TAB.
 */
export async function completeAppId(complete: CompleteFn): Promise<void> {
    const apps = await fetchApps();
    if (!apps) return;
    for (const app of apps) {
        complete(app.id, app.name ?? '');
    }
}

/**
 * Resolves an appId from env / config / capacitor.config.*, then lists
 * distinct channels seen on that app's bundles. No completions when the
 * appId can't be resolved at TAB time.
 */
export async function completeChannel(complete: CompleteFn): Promise<void> {
    const cfg = await safeLoadCompletionConfig();
    if (!cfg.serverUrl || !cfg.adminToken || !cfg.appId) return;
    const bundles = await fetchBundlesAllChannels(cfg.serverUrl, cfg.adminToken, cfg.appId);
    if (!bundles) return;
    const seen = new Set<string>();
    for (const b of bundles) {
        if (b.channel && !seen.has(b.channel)) {
            seen.add(b.channel);
            complete(b.channel, '');
        }
    }
}

/**
 * Lists bundle versions for `bundles promote <version>`. Only state=active
 * rows — promote on a pending/failed bundle returns 409 and isn't useful.
 * The bundle id flows into the description column so two rows with the same
 * version (rare but legal in deactivated history) stay distinguishable.
 */
export async function completeBundleVersion(complete: CompleteFn): Promise<void> {
    const cfg = await safeLoadCompletionConfig();
    if (!cfg.serverUrl || !cfg.adminToken || !cfg.appId) return;
    const channel = cfg.channel ?? 'production';
    const bundles = await fetchBundlesScoped(cfg.serverUrl, cfg.adminToken, cfg.appId, channel);
    if (!bundles) return;
    for (const b of bundles) {
        if (b.state === 'active') complete(b.version, `#${b.id}`);
    }
}

/** Same as `completeAppId` but typed for the positional-argument signature. */
const completeAppIdArg = ((complete: CompleteFn) => completeAppId(complete)) as unknown as (
    complete: CompleteFn
) => void;

// --- internals ----

async function safeLoadCompletionConfig() {
    try {
        return await loadCompletionConfig();
    } catch {
        return {} as Awaited<ReturnType<typeof loadCompletionConfig>>;
    }
}

async function fetchApps(): Promise<Array<{ id: string; name?: string }> | null> {
    const cached = await readCache<Array<{ id: string; name?: string }>>(APPS_CACHE);
    if (cached) return cached;

    const cfg = await safeLoadCompletionConfig();
    if (!cfg.serverUrl || !cfg.adminToken) return null;

    const data = await fetchJson<AppRow[]>(`${cfg.serverUrl}/admin/apps`, cfg.adminToken);
    if (!data) return null;

    const slim = data.map((row) => ({ id: row.id, name: row.name }));
    await writeCache(APPS_CACHE, slim);
    return slim;
}

async function fetchBundlesScoped(
    serverUrl: string,
    adminToken: string,
    appId: string,
    channel: string
): Promise<Array<Pick<BundleRow, 'id' | 'version' | 'state' | 'active' | 'channel'>> | null> {
    const key = bundlesCacheKey(appId, channel);
    const cached = await readCache<Array<Pick<BundleRow, 'id' | 'version' | 'state' | 'active' | 'channel'>>>(key);
    if (cached) return cached;

    const qs = new URLSearchParams({ app_id: appId, channel });
    const data = await fetchJson<BundleRow[]>(`${serverUrl}/admin/bundles?${qs.toString()}`, adminToken);
    if (!data) return null;

    const slim = data.map((row) => ({
        id: row.id,
        version: row.version,
        state: row.state,
        active: row.active,
        channel: row.channel
    }));
    await writeCache(key, slim);
    return slim;
}

async function fetchBundlesAllChannels(
    serverUrl: string,
    adminToken: string,
    appId: string
): Promise<Array<Pick<BundleRow, 'id' | 'version' | 'state' | 'active' | 'channel'>> | null> {
    const qs = new URLSearchParams({ app_id: appId });
    const data = await fetchJson<BundleRow[]>(`${serverUrl}/admin/bundles?${qs.toString()}`, adminToken);
    if (!data) return null;
    return data.map((row) => ({
        id: row.id,
        version: row.version,
        state: row.state,
        active: row.active,
        channel: row.channel
    }));
}

async function fetchJson<T>(url: string, adminToken: string): Promise<T | null> {
    try {
        const res = await fetch(url, {
            headers: { authorization: `Bearer ${adminToken}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

// --- tab-tree wiring helpers ----

function attachOption(
    completion: RootCommand,
    commandPath: string,
    optionName: string,
    handler: (complete: CompleteFn, options: Map<string, Option>) => void | Promise<void>
): void {
    const cmd: TabCommand | undefined =
        commandPath === '' ? completion : completion.commands.get(commandPath);
    if (!cmd) return;
    const opt = cmd.options.get(optionName);
    if (!opt) return;
    // tab's commander integration registers every option as boolean by
    // default — its `option()` API doesn't carry the value/no-value bit
    // through. Flip it manually so tab's value-completion path fires for
    // any option we've taken the trouble to attach a handler to.
    opt.isBoolean = false;
    opt.handler = function (complete, options) {
        const result = handler(complete, options);
        if (result instanceof Promise) {
            // Tab awaits the handler return value internally when it's a
            // promise; surface rejections as silent no-ops.
            return result.catch(() => {}) as never;
        }
    };
}

function attachPositional(
    completion: RootCommand,
    commandPath: string,
    argName: string,
    handler: (complete: CompleteFn, options: Map<string, Option>) => void | Promise<void>
): void {
    const cmd: TabCommand | undefined = completion.commands.get(commandPath);
    if (!cmd) return;
    cmd.argument(argName, function (this: Argument, complete, options) {
        const result = handler(complete, options);
        if (result instanceof Promise) {
            return result.catch(() => {}) as never;
        }
    });
}

// --- write-side cache invalidation (re-exports for the action handlers) ----

export const completionCache = {
    invalidateApps(): Promise<void> {
        return invalidate(APPS_CACHE);
    },
    invalidateBundlesFor(appId: string, channel: string): Promise<void> {
        return invalidate(bundlesCacheKey(appId, channel));
    }
};
