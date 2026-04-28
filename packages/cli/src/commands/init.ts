/**
 * `init`: interactively scaffold capgo-update.config.json.
 *
 * Anything provided via flag / env / existing config is treated as a default
 * and the prompt is skipped. The admin token is never written to the file —
 * it's only collected (optionally) to validate the server during the wizard
 * itself, and discarded immediately after.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { cancel, confirm, intro, isCancel, log, note, outro, password, select, spinner, text } from '@clack/prompts';
import type { Command } from 'commander';
import { readAppIdFromCapacitorConfig } from '../capacitor-config.js';
import { resolveConfig } from '../config.js';
import { fail } from '../output.js';
import { checkServerVersion, compatWarningMessage } from '../server-version.js';
import { APP_ID_FORMAT_HINT, appIdError } from '../validators.js';

const DEFAULT_FILENAME = 'capgo-update.config.json';
const DEFAULT_CHANNEL = 'production';
const DIST_DIR_CANDIDATES = ['build', 'dist', 'www', 'out', 'public'];

type InitOpts = {
    force?: boolean;
    path?: string;
    appId?: string;
    serverUrl?: string;
    channel?: string;
    distDir?: string;
    validate?: boolean;
};

export function registerInit(program: Command): void {
    program
        .command('init')
        .description(`Interactively scaffold a ${DEFAULT_FILENAME} config in the current directory.`)
        .option('-f, --force', 'Overwrite an existing file')
        .option('--path <path>', `Target file path (default: ./${DEFAULT_FILENAME})`)
        .option('--app-id <id>', 'Pre-fill appId (skips that prompt)')
        .option('--server-url <url>', 'Pre-fill serverUrl (skips that prompt)')
        .option('--channel <name>', 'Pre-fill channel (skips that prompt)')
        .option('--dist-dir <path>', 'Pre-fill distDir (skips that prompt)')
        .option('--no-validate', 'Skip the optional server validation step')
        .action(async function action(this: Command): Promise<void> {
            const opts = this.opts<InitOpts>();
            // resolveConfig pulls global flags (--server-url, --admin-token,
            // --config) plus CAPGO_* env vars. We use it for defaults only —
            // the wizard never blocks on missing values.
            const cfg = await resolveConfig(this);

            const target = opts.path
                ? path.resolve(process.cwd(), opts.path)
                : path.resolve(process.cwd(), DEFAULT_FILENAME);

            if (existsSync(target) && !opts.force) {
                fail(`${target} already exists — pass --force to overwrite`);
            }

            intro(chalk.bgCyan.black(' capgo-update-lite init '));

            note(
                [
                    "This wizard scaffolds your project's capgo-update.config.json.",
                    'Anything supplied via flag / env / existing config is pre-filled.',
                    'Press Ctrl+C at any time to abort without writing anything.'
                ].join('\n'),
                'Welcome'
            );

            if (existsSync(target)) {
                log.warn(
                    `${path.relative(process.cwd(), target) || target} already exists — it will be overwritten when this finishes.`
                );
            }

            // appId source ladder: CLI flag (strict — fail on bad input),
            // env/existing config (lenient — warn + reprompt on bad input),
            // wizard prompt (validates inline). When prompting we pre-fill
            // the input from capacitor.config.{ts,js,json} on a best-effort
            // basis — silent skip if extraction fails.
            let appId: string;
            if (opts.appId !== undefined) {
                const e = appIdError(opts.appId);
                if (e) fail(e);
                appId = opts.appId.trim();
            } else if (cfg.appId !== undefined && !appIdError(cfg.appId)) {
                appId = cfg.appId;
            } else {
                if (cfg.appId !== undefined) {
                    log.warn(`Ignoring invalid appId from env/config ("${cfg.appId}").`);
                }
                let detectedInitial: string | undefined;
                try {
                    const detected = await readAppIdFromCapacitorConfig();
                    if (detected) {
                        log.info(`Detected appId "${detected.appId}" in ${detected.source}`);
                        detectedInitial = detected.appId;
                    }
                } catch {
                    // Silent — extraction is best-effort.
                }
                appId = await askAppId(detectedInitial);
            }
            const serverUrl = (opts.serverUrl ?? cfg.serverUrl ?? (await askServerUrl())).replace(/\/+$/, '');
            const channel = opts.channel ?? cfg.channel ?? (await askChannel());
            const distDir = opts.distDir ?? cfg.distDir ?? (await askDistDir());

            let appKnownRegistered = false;
            if (opts.validate !== false) {
                appKnownRegistered = await validateOptional(serverUrl, appId, cfg.adminToken);
            }

            const template = {
                appId,
                serverUrl,
                channel,
                distDir,
                platforms: ['ios', 'android'],
                // Inherit min builds from the previous bundle when native deps
                // haven't changed; bump otherwise. Default-on for new projects.
                autoMinUpdateBuild: true
            };
            // mkdir -p the parent so a custom --path nested in a directory
            // that doesn't exist yet doesn't blow up writeFile with ENOENT.
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
            log.success(`Wrote ${path.relative(process.cwd(), target) || target}`);

            const completionsInstalled = await maybeInstallCompletions();

            const steps: string[] = [
                `1. Set ${chalk.cyan('CAPGO_ADMIN_TOKEN')} in your shell (do NOT commit it):`,
                `     export CAPGO_ADMIN_TOKEN=...`
            ];
            let n = 2;
            if (!appKnownRegistered) {
                steps.push(
                    `${n++}. Register the app on the server (one-time):`,
                    `     capgo-update-lite-cli apps add ${appId} --name "..."`
                );
            }
            steps.push(
                `${n++}. Publish a bundle (version sourced from package.json):`,
                `     capgo-update-lite-cli publish`
            );
            if (!completionsInstalled) {
                steps.push(
                    `${n}. Enable shell tab-completion (optional):`,
                    `     capgo-update-lite complete zsh > "\${ZDOTDIR:-$HOME}/.zsh/completions/_capgo-update-lite"`,
                    `     # or: capgo-update-lite complete bash >> ~/.bashrc`
                );
            }
            note(steps.join('\n'), 'Next steps');

            outro(chalk.green('Config scaffolded.'));
        });
}

function abortIfCancelled<T>(value: T | symbol): asserts value is T {
    if (isCancel(value)) {
        cancel('Init aborted — no config written.');
        process.exit(0);
    }
}

async function askAppId(initialValue?: string): Promise<string> {
    const result = await text({
        message: `App ID — ${APP_ID_FORMAT_HINT}`,
        placeholder: 'com.example.app',
        initialValue,
        validate: (value) => appIdError(value) ?? undefined
    });
    abortIfCancelled(result);
    return result.trim();
}

async function askServerUrl(): Promise<string> {
    const result = await text({
        message: 'Server URL — public URL of your deployed capgo-update-lite worker',
        placeholder: 'https://ota.example.com',
        validate: (value) => {
            const v = (value ?? '').trim();
            if (!v) return 'Required';
            try {
                const u = new URL(v);
                if (!/^https?:$/.test(u.protocol)) return 'Must be http(s)';
                if (!u.hostname) return 'Missing hostname';
            } catch {
                return 'Not a valid URL';
            }
            return undefined;
        }
    });
    abortIfCancelled(result);
    return result.trim();
}

async function askChannel(): Promise<string> {
    const result = await text({
        message: 'Channel — release channel name (e.g. production, staging, canary)',
        placeholder: DEFAULT_CHANNEL,
        defaultValue: DEFAULT_CHANNEL,
        validate: (value) => {
            const v = (value ?? '').trim();
            if (v && !/^[A-Za-z0-9._-]+$/.test(v)) return 'Use letters, digits, dot, hyphen, underscore';
            return undefined;
        }
    });
    abortIfCancelled(result);
    return result.trim() || DEFAULT_CHANNEL;
}

async function askDistDir(): Promise<string> {
    // Auto-detect typical web build outputs in the cwd. Each candidate is
    // surfaced as a select option with a hint about whether it contains the
    // index.html the publish preflight requires.
    const detected: Array<{ rel: string; hasIndex: boolean }> = [];
    for (const name of DIST_DIR_CANDIDATES) {
        const abs = path.resolve(process.cwd(), name);
        if (!existsSync(abs)) continue;
        try {
            if (!statSync(abs).isDirectory()) continue;
        } catch {
            continue;
        }
        detected.push({
            rel: `./${name}`,
            hasIndex: existsSync(path.join(abs, 'index.html'))
        });
    }

    if (detected.length === 0) {
        const result = await text({
            message: 'Dist directory — built web bundle (must contain index.html at publish time)',
            placeholder: './dist',
            validate: (value) => ((value ?? '').trim() ? undefined : 'Required')
        });
        abortIfCancelled(result);
        return result.trim();
    }

    type Choice = string;
    const options: Array<{ value: Choice; label: string; hint?: string }> = detected.map((d) => ({
        value: d.rel,
        label: d.rel,
        hint: d.hasIndex ? 'contains index.html' : 'no index.html (yet)'
    }));
    options.push({ value: '__custom__', label: 'Enter a custom path…' });

    // Prefer the first detected dir that has an index.html; otherwise the
    // first detected dir at all.
    const initial = detected.find((d) => d.hasIndex)?.rel ?? detected[0].rel;
    const choice = await select<Choice>({
        message: 'Dist directory — pick the folder containing your built web bundle',
        options,
        initialValue: initial
    });
    abortIfCancelled(choice);

    if (choice !== '__custom__') return choice;
    const custom = await text({
        message: 'Custom dist directory path',
        placeholder: './dist',
        validate: (value) => ((value ?? '').trim() ? undefined : 'Required')
    });
    abortIfCancelled(custom);
    return custom.trim();
}

/**
 * Always pings `/health`. If an admin token is available — either pre-set in
 * env / --admin-token, or entered at the optional password prompt — also
 * verifies admin auth and reports whether the appId is already registered.
 * When it isn't, offers to register it inline (same path as `apps add`).
 *
 * Token is used once and discarded; never written to the config file.
 *
 * Returns true when the appId is known-registered (either was already, or we
 * just registered it during the wizard) so the caller can suppress the
 * "register the app" line in the post-init checklist.
 */
async function validateOptional(serverUrl: string, appId: string, existingToken: string | undefined): Promise<boolean> {
    let token = existingToken?.trim();
    if (token) {
        log.info('Using admin token from CAPGO_ADMIN_TOKEN / --admin-token (not written to config).');
    } else {
        const ans = await password({
            message:
                'Admin token? (optional — leave empty for a public health check only; used once for validation, NOT written to capgo-update.config.json)'
        });
        abortIfCancelled(ans);
        token = String(ans).trim();
    }

    // Public health probe — runs whether or not we have a token. A failing
    // /health is just a warning: maybe the server isn't deployed yet, or
    // it's behind a different DNS name. The config still gets written so
    // the user can fix and re-run.
    const ping = spinner();
    ping.start(`GET ${serverUrl}/health`);
    try {
        const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const body = (await res
            .clone()
            .json()
            .catch(() => null)) as { version?: unknown } | null;
        if (!res.ok) {
            ping.error(`server returned HTTP ${res.status}`);
            log.warn('Server is reachable but /health is unhealthy. Verify your deploy.');
            return false;
        }
        const serverVersion = typeof body?.version === 'string' ? body.version : null;
        const compat = checkServerVersion(serverVersion);
        const versionLabel = serverVersion ?? '(unreported)';
        ping.stop(`server reachable · v${versionLabel}`);
        const compatMsg = compatWarningMessage(compat);
        if (compatMsg) log.warn(compatMsg);
    } catch (e) {
        ping.error(`unreachable: ${e instanceof Error ? e.message : String(e)}`);
        log.warn('Could not reach the server — config will still be written. Verify the URL.');
        return false;
    }

    if (!token) return false;

    const adminCheck = spinner();
    adminCheck.start(`GET ${serverUrl}/admin/apps`);
    try {
        const res = await fetch(`${serverUrl}/admin/apps`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000)
        });
        if (res.status === 401 || res.status === 403) {
            adminCheck.error(`admin token rejected (HTTP ${res.status})`);
            log.warn(`The token does not match the server's PRIVATE_ADMIN_TOKEN. Config will still be written.`);
            return false;
        }
        if (!res.ok) {
            adminCheck.error(`admin endpoint returned HTTP ${res.status}`);
            return false;
        }
        const apps = (await res.json()) as Array<{ id: string; name: string }>;
        adminCheck.stop(`admin OK — ${apps.length} app${apps.length === 1 ? '' : 's'} registered`);

        const match = apps.find((a) => a.id === appId);
        if (match) {
            log.success(`appId "${appId}" is already registered on the server ("${match.name}")`);
            return true;
        }
        log.warn(`appId "${appId}" is NOT registered yet.`);
        return await maybeRegisterApp(serverUrl, appId, token);
    } catch (e) {
        adminCheck.error(`failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}

/**
 * Optional inline flow that runs the same logic as `apps add`. Triggered when
 * the wizard already has an admin token AND the appId isn't registered — at
 * that point the operator is one prompt away from being publish-ready, so we
 * offer it instead of telling them to drop out and re-run a separate command.
 */
async function maybeRegisterApp(serverUrl: string, appId: string, token: string): Promise<boolean> {
    const wantRegister = await confirm({
        message: `Register "${appId}" on the server now? (POST /admin/apps)`,
        initialValue: true
    });
    if (isCancel(wantRegister) || !wantRegister) {
        log.message(`Skipped — register later with: capgo-update-lite-cli apps add ${appId} --name "..."`);
        return false;
    }

    const nameSuggestion = humanizeAppId(appId);
    const nameAns = await text({
        message: 'Display name for the app',
        placeholder: nameSuggestion,
        initialValue: nameSuggestion,
        validate: (value) => {
            const v = (value ?? '').trim();
            if (!v) return 'Required';
            if (v.length > 256) return 'Too long (max 256 chars)';
            return undefined;
        }
    });
    abortIfCancelled(nameAns);
    const name = nameAns.trim();

    const reg = spinner();
    reg.start(`POST ${serverUrl}/admin/apps`);
    try {
        const res = await fetch(`${serverUrl}/admin/apps`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ id: appId, name }),
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            reg.error(`registration failed (HTTP ${res.status})`);
            log.warn(
                `${res.status}: ${body || '(no body)'} — register later with: capgo-update-lite-cli apps add ${appId} --name "${name}"`
            );
            return false;
        }
        reg.stop(`registered ${appId} as "${name}"`);
        return true;
    } catch (e) {
        reg.error(`failed: ${e instanceof Error ? e.message : String(e)}`);
        log.warn(`Register later with: capgo-update-lite-cli apps add ${appId} --name "${name}"`);
        return false;
    }
}

/**
 * Best-effort title-case from the last segment of a reverse-domain appId.
 * `com.example.member_app` → `Member App`. Used as a default for the
 * registration prompt; the user can override.
 */
function humanizeAppId(appId: string): string {
    const last = appId.split('.').slice(-1)[0] ?? appId;
    return last
        .split(/[_-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// --- shell completion install ----

type DetectableShell = 'zsh' | 'bash' | 'fish';

function detectShell(): DetectableShell | null {
    const sh = process.env.SHELL ?? '';
    if (/\/zsh$/.test(sh)) return 'zsh';
    if (/\/bash$/.test(sh)) return 'bash';
    if (/\/fish$/.test(sh)) return 'fish';
    return null;
}

/**
 * Generate the per-shell completion script by re-invoking the current binary
 * with `complete <shell>`. We don't import the script generator from
 * @bomb.sh/tab directly — only the CLI's `complete` subcommand surface is
 * a public contract, and a subprocess keeps that boundary stable.
 */
async function generateCompletionScript(shell: DetectableShell): Promise<string> {
    return await new Promise((resolve, reject) => {
        const entry = process.argv[1];
        if (!entry) {
            reject(new Error('process.argv[1] missing — cannot locate CLI entry point'));
            return;
        }
        const child = spawn(process.execPath, [entry, 'complete', shell], {
            stdio: ['ignore', 'pipe', 'inherit']
        });
        let stdout = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`complete ${shell} exited with code ${code}`));
        });
    });
}

const RC_MARKER = '# capgo-update-lite shell completion';

/**
 * Heuristic: are we running from a one-shot `pnpx` / `npx` / `pnpm dlx`
 * invocation, where the binary lives in a temporary cache and won't be on
 * PATH from a fresh shell? If so, an `eval "$(capgo-update-lite ...)"` line
 * in the user's rc would be a no-op (or worse, error noise) until they
 * install the CLI globally.
 */
function isEphemeralInvocation(): boolean {
    const entry = process.argv[1] ?? '';
    return /(?:^|\/)(?:_npx|\.npm\/_npx|\.pnpm-store|\.pnpm\/store|dlx|corepack)(?:\/|$)/.test(entry);
}

/** Spawn `command -v <bin>` to check whether the named binary is on PATH. */
function binaryOnPath(name: string): boolean {
    try {
        const result = spawnSync('command', ['-v', name], {
            shell: true,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return result.status === 0 && (result.stdout?.toString().trim().length ?? 0) > 0;
    } catch {
        return false;
    }
}

/**
 * Optionally append a `source <(...)` style line to the user's shell rc.
 * Runs only when `process.env.SHELL` matches a supported shell, the wizard
 * was launched from a globally-installed CLI (not via `pnpx`/`npx`/`dlx`),
 * and the binary is reachable on PATH. Idempotent: when the marker already
 * exists in the rc file, the helper logs a confirmation and returns true.
 *
 * Returns true when completions are installed (or already were); false on
 * decline / unsupported shell / ephemeral invocation / failure. The caller
 * falls back to the manual install hint in the Next steps panel.
 */
async function maybeInstallCompletions(): Promise<boolean> {
    const shell = detectShell();
    if (!shell) return false;

    if (isEphemeralInvocation()) {
        log.info(
            'Running from a one-shot invocation (pnpx/npx/dlx) — skipping completion install. Install the CLI globally (e.g. `pnpm add -g capgo-update-lite-cli`) and re-run init to enable completions.'
        );
        return false;
    }
    if (!binaryOnPath('capgo-update-lite')) {
        log.info(
            '`capgo-update-lite` is not on PATH yet — skipping completion install. Install the CLI globally and re-run init to enable completions.'
        );
        return false;
    }

    const wantInstall = await confirm({
        message: `Install shell tab-completion for ${shell} now?`,
        initialValue: true
    });
    if (isCancel(wantInstall) || !wantInstall) return false;

    try {
        if (shell === 'fish') {
            // Fish auto-discovers completion files in this directory; no rc edit.
            const target = path.join(os.homedir(), '.config/fish/completions/capgo-update-lite.fish');
            const script = await generateCompletionScript('fish');
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, script);
            log.success(`Installed completions: ${target}`);
            log.info('Open a new fish session to pick them up.');
            return true;
        }

        // zsh / bash — append a single eval line to the rc file. Cheap to run
        // at every shell start and self-healing if the binary path changes.
        const rcFile = shell === 'zsh' ? '.zshrc' : '.bashrc';
        const rcPath = path.join(os.homedir(), rcFile);
        const sourceLine = `eval "$(capgo-update-lite complete ${shell})"`;
        const rcContents = await readFile(rcPath, 'utf8').catch(() => '');
        if (rcContents.includes(sourceLine) || rcContents.includes(RC_MARKER)) {
            log.info(`Completions already installed in ~/${rcFile}.`);
            return true;
        }

        const proceed = await confirm({
            message: `Append \`${sourceLine}\` to ~/${rcFile}?`,
            initialValue: true
        });
        if (isCancel(proceed) || !proceed) return false;

        const tail = rcContents.endsWith('\n') || rcContents.length === 0 ? '' : '\n';
        const block = `${tail}\n${RC_MARKER}\n${sourceLine}\n`;
        await writeFile(rcPath, rcContents + block);
        log.success(`Appended completion line to ${rcPath}`);
        log.info(`Run \`source ~/${rcFile}\` or open a new shell to enable.`);
        return true;
    } catch (e) {
        log.warn(`Could not install completions: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}
