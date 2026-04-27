/**
 * Shared output helpers, layered over @clack/prompts so every subcommand gets
 * the same intro/outro boxed flow plus consistent step/success/warn/error
 * iconography.
 *
 * Public API:
 *   start(title)       — intro: opens a session
 *   step(msg)          — log.step: top-level operation boundary
 *   ok(msg)            — log.success: completed sub-step
 *   info(msg)          — log.info: neutral status update
 *   warn(msg)          — log.warn: non-fatal issue
 *   fail(msg)          — log.error + cancel: exits with code 1
 *   done(msg)          — outro: closes the session in green
 *   kv(label, value)   — dim label, normal value, indented under previous step
 *   printJson(data)    — raw JSON to stdout (bypasses clack — used for --json)
 *   table(...)         — fixed-width table inside a single log.message call
 *   spinner / note     — re-exported from clack for long-running steps
 */

import { cancel, intro, log, note, outro, spinner } from '@clack/prompts';
import chalk from 'chalk';

/**
 * --json mode contract: stdout always carries exactly one JSON document and
 * nothing else. Success → the payload from printJson(); failure → an
 * `{"error": "..."}` object. The exit code (0 vs non-zero) tells consumers
 * which one they got. All decorative helpers (intros, steps, kv, success
 * banners) become no-ops; clack's chrome is suppressed so it can't sneak
 * onto stdout.
 *
 * `jsonEmitted` guards the "exactly one" half of the contract: once the
 * success payload (or an earlier error) has been written, any later fail()
 * stays silent on stdout. The process still exits non-zero, but we don't
 * concatenate a second JSON object that would break `jq`.
 *
 * Commands that accept --json must call enterJsonMode() before any output
 * helper runs (typically as the first line of the action handler).
 */
let jsonMode = false;
let jsonEmitted = false;

export function enterJsonMode(): void {
    jsonMode = true;
}

export function isJsonMode(): boolean {
    return jsonMode;
}

export function start(title: string): void {
    if (jsonMode) return;
    intro(chalk.bgCyan.black(` ${title} `));
}

export function step(msg: string): void {
    if (jsonMode) return;
    log.step(msg);
}

export function ok(msg: string): void {
    if (jsonMode) return;
    log.success(msg);
}

export function info(msg: string): void {
    if (jsonMode) return;
    log.info(msg);
}

export function warn(msg: string): void {
    if (jsonMode) return;
    log.warn(msg);
}

export function fail(msg: string, code = 1): never {
    if (jsonMode) {
        // Honor the "exactly one JSON document" contract. If a payload has
        // already been printed, swallow the stdout side and leave a
        // diagnostic on stderr; otherwise emit an error object so consumers
        // always have something parseable to read.
        if (jsonEmitted) {
            process.stderr.write(`error: ${msg}\n`);
        } else {
            jsonEmitted = true;
            process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
        }
        process.exit(code);
    }
    // log.error gets the red ✗; cancel writes the trailing ─── footer so the
    // session closes cleanly even though we exit non-zero.
    log.error(msg);
    cancel('Operation cancelled.');
    process.exit(code);
}

export function done(msg: string): void {
    if (jsonMode) return;
    outro(chalk.green(msg));
}

export function kv(label: string, value: string): void {
    if (jsonMode) return;
    log.message(`${chalk.dim(`${label}:`)} ${value}`);
}

/**
 * Raw stdout — bypasses clack so `--json` output is pipe-clean. Marks the
 * stdout JSON slot as consumed so a subsequent fail() can't append a second
 * document to the same stream.
 */
export function printJson(data: unknown): void {
    if (jsonEmitted) return;
    jsonEmitted = true;
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export const dim = chalk.dim;
export const bold = chalk.bold;

/**
 * Fixed-width table. Headers dim; each cell padded to its column max. Emitted
 * as a single log.message call so the rows stay attached to the same gutter
 * bar instead of looking like separate log entries.
 */
export function table(headers: string[], rows: string[][]): void {
    if (jsonMode) return;
    if (rows.length === 0) {
        log.message(chalk.dim('(no rows)'));
        return;
    }
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
    const pad = (s: string, i: number): string => (s ?? '').padEnd(widths[i], ' ');
    const lines: string[] = [headers.map((h, i) => chalk.dim(pad(h, i))).join('  ')];
    for (const row of rows) {
        lines.push(row.map((c, i) => pad(c, i)).join('  '));
    }
    log.message(lines.join('\n'));
}

export { note, spinner };
