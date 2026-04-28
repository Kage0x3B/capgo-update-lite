/**
 * Version bumping + package.json writeback. Mirrors `npm version`'s file-write
 * semantics: preserve the existing indent style and trailing newline so the
 * change is one-line in a diff.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { parseSemver } from './semver.js';

export type BumpLevel = 'major' | 'minor' | 'patch';

export function bumpVersion(v: string, level: BumpLevel): string {
    const sv = parseSemver(v);
    if (!sv) throw new Error(`cannot bump non-semver version: "${v}"`);
    if (level === 'major') return `${sv.major + 1}.0.0`;
    if (level === 'minor') return `${sv.major}.${sv.minor + 1}.0`;
    return `${sv.major}.${sv.minor}.${sv.patch + 1}`;
}

/**
 * Update the top-level "version" field in package.json. Returns the previous
 * value so the caller can include both ends of the bump in its log line.
 *
 * Indent style is detected from the first key after the opening brace —
 * matches npm/yarn behavior. JSON.stringify preserves top-level key order on
 * V8/Node, so the rest of the file shape is left alone.
 */
export async function writePackageJsonVersion(pkgPath: string, newVersion: string): Promise<{ previous: string }> {
    const raw = await readFile(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.version !== 'string') {
        throw new Error(`${pkgPath} has no top-level "version" field`);
    }
    const previous = parsed.version;
    parsed.version = newVersion;
    const indent = detectIndent(raw);
    const trailingNewline = raw.endsWith('\n') ? '\n' : '';
    await writeFile(pkgPath, JSON.stringify(parsed, null, indent) + trailingNewline);
    return { previous };
}

export function detectIndent(raw: string): string | number {
    // Look at whatever leads the first key after `{`. Tabs are returned
    // verbatim so JSON.stringify uses them as-is; spaces are returned as a
    // count which JSON.stringify converts to that many spaces.
    const m = raw.match(/^\{\s*\n([\t ]+)"/);
    if (!m) return 2;
    const indent = m[1];
    if (indent.includes('\t')) return indent;
    return indent.length;
}
