/**
 * Shared output helpers. All CLI text goes through these so indentation, color,
 * and symbol choice stay consistent across every subcommand.
 *
 *   step()   column 0, cyan »        top-level operation boundary
 *   ok()     2-space indent          subordinate detail under a step
 *   warn()   2-space indent, yellow ⚠   non-fatal issue
 *   fail()   column 0, red ✗          fatal — writes to stderr and exits
 *   done()   blank line + green ✓     terminal success, one per command
 *   kv()     2-space indent, dim label   structured key:value under a step
 *   table()  2-space indent, dim header  simple fixed-width list output
 */

import chalk from 'chalk';

const INDENT = '  ';

export function step(msg: string): void {
    console.log(`${chalk.cyan('»')} ${msg}`);
}

export function ok(msg: string): void {
    console.log(`${INDENT}${msg}`);
}

export function warn(msg: string): void {
    console.warn(`${INDENT}${chalk.yellow('⚠')} ${msg}`);
}

export function fail(msg: string, code = 1): never {
    console.error(`${chalk.red('✗')} ${msg}`);
    process.exit(code);
}

export function done(msg: string): void {
    console.log(`\n${chalk.green('✓')} ${msg}`);
}

export function kv(label: string, value: string): void {
    console.log(`${INDENT}${chalk.dim(`${label}:`)} ${value}`);
}

export function printJson(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
}

export const dim = chalk.dim;
export const bold = chalk.bold;

/**
 * Fixed-width table. Headers dim; each cell padded to its column max.
 * Columns separated by two spaces to keep visual noise low.
 */
export function table(headers: string[], rows: string[][]): void {
    if (rows.length === 0) {
        ok(chalk.dim('(no rows)'));
        return;
    }
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
    const pad = (s: string, i: number): string => (s ?? '').padEnd(widths[i], ' ');
    const formattedHeader = headers.map((h, i) => chalk.dim(pad(h, i))).join('  ');
    console.log(`${INDENT}${formattedHeader}`);
    for (const row of rows) {
        const formatted = row.map((c, i) => pad(c, i)).join('  ');
        console.log(`${INDENT}${formatted}`);
    }
}
