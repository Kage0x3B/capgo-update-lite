/**
 * Best-effort extraction of fields from capacitor.config.{ts,js,json}.
 *
 * Capacitor's config files come in three flavours: pure JSON, plain JS, or
 * TypeScript. Properly parsing them would mean either spinning up a TS
 * compiler or trusting a `require()` of arbitrary user code — overkill for
 * the one field we want (appId).
 *
 *   - `.json` files are tried as JSON first, then fall through to the
 *     regex extractor (covers files with comments / trailing commas that
 *     happen to be checked in even though strict JSON forbids them).
 *   - `.ts` / `.js` files use the regex directly.
 *
 * The regex handles all three string quotings — `"..."`, `'...'`, and
 * backtick-templated `` `...` `` — plus the JSON-ish `"appId": "..."` shape
 * that some hand-written configs use. Each quote variant is its own capture
 * group so a mismatched pair like `'foo"` doesn't sneak through.
 *
 * Any failure (no file, unreadable, parse error, regex no-match) returns
 * null so callers can silently skip the optimisation.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CANDIDATES = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'];

export type DetectedAppId = {
    appId: string;
    /** File the value came from, relative to cwd when possible. */
    source: string;
};

export async function readAppIdFromCapacitorConfig(cwd: string = process.cwd()): Promise<DetectedAppId | null> {
    for (const filename of CANDIDATES) {
        const abs = path.resolve(cwd, filename);
        if (!existsSync(abs)) continue;
        let raw: string;
        try {
            raw = await readFile(abs, 'utf8');
        } catch {
            continue;
        }
        const value = (filename.endsWith('.json') ? extractFromJson(raw) : null) ?? extractFromCode(raw);
        if (value) {
            return { appId: value, source: path.relative(cwd, abs) || filename };
        }
    }
    return null;
}

function extractFromJson(raw: string): string | null {
    try {
        const parsed = JSON.parse(raw) as { appId?: unknown };
        return typeof parsed.appId === 'string' ? parsed.appId : null;
    } catch {
        return null;
    }
}

// Three alternatives — one per quote style — keep the opening + closing
// quote bound to each other. The captured value is restricted to characters
// that can legitimately appear in a reverse-domain appId, which has the
// happy side-effect of rejecting mismatched-quote shapes like `'foo"` (a
// looser pattern would match across the rest of the line).
//
// The optional outer ['"]? on the key handles the JSON-quoted shape
// `"appId": "com.example.app"` that hand-written configs sometimes use
// even in .ts files.
const APP_ID_VALUE = '[A-Za-z0-9._-]+';
const APP_ID_RE = new RegExp(
    `['"]?appId['"]?\\s*:\\s*(?:"(${APP_ID_VALUE})"|'(${APP_ID_VALUE})'|\`(${APP_ID_VALUE})\`)`
);

function extractFromCode(raw: string): string | null {
    const m = raw.match(APP_ID_RE);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
}
