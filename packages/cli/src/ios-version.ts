/**
 * Layered resolver for the iOS short version string.
 *
 * Info.plist often contains `$(MARKETING_VERSION)` instead of a literal —
 * Xcode substitutes the value at build time. To match what gets shipped,
 * we walk the same chain Xcode would, cheapest first:
 *
 *   1. Info.plist literal                         (every platform)
 *   2. project.pbxproj build settings             (every platform)
 *   3. .xcconfig referenced as baseConfiguration  (every platform)
 *   4. xcodebuild -showBuildSettings -json        (macOS only, ground truth)
 *
 * Layers 1–3 are pure file parsing and run anywhere. Layer 4 spawns Xcode's
 * own resolver and is the source of truth, but requires a macOS host with
 * Xcode installed. On non-macOS hosts it's silently skipped — we just emit
 * an unresolved-result with whatever the file layers produced.
 *
 * Each layer appends to `trace`, so callers can show *what was tried* when
 * resolution fails. Vague "unresolved $(VAR)" errors send users to GitHub
 * issues; explicit traces let them fix the problem locally.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_DEPTH = 8;

export type IosVersionLayer = 'Info.plist' | 'pbxproj' | 'xcconfig' | 'xcodebuild';

export type IosVersionTraceEntry = {
    layer: IosVersionLayer;
    detail: string;
};

export type IosVersionResult =
    | { ok: true; version: string; trace: IosVersionTraceEntry[] }
    | { ok: false; partial: string; trace: IosVersionTraceEntry[]; reason: string };

export type ResolveOptions = {
    /** Allow spawning `xcodebuild` on macOS as a final fallback. Default: true. */
    allowXcodebuild?: boolean;
    /** Override platform check, useful for tests. Default: process.platform. */
    platform?: NodeJS.Platform;
    /** Override the xcodebuild binary, useful for tests. Default: 'xcodebuild'. */
    xcodebuildPath?: string;
};

/**
 * Resolve `CFBundleShortVersionString` for the iOS project at `iosRoot`.
 * Returns `null` when no Info.plist can be located (caller's iosProject is
 * empty or wrong). Returns a result otherwise — `ok: true` with the literal
 * version, or `ok: false` with the best-effort partial value plus the trace
 * of attempts so the caller can build an actionable error message.
 */
export async function resolveIosShortVersion(
    iosRoot: string,
    options: ResolveOptions = {}
): Promise<IosVersionResult | null> {
    const trace: IosVersionTraceEntry[] = [];

    // Layer 1: Info.plist
    const plistPath = await findInfoPlist(iosRoot);
    if (!plistPath) return null;
    const plistRaw = await readFile(plistPath, 'utf8');
    const plistMatch = plistRaw.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    if (!plistMatch) return null;

    let value = plistMatch[1].trim();
    trace.push({ layer: 'Info.plist', detail: value });
    if (!hasPlaceholder(value)) return { ok: true, version: value, trace };

    // Layer 2: pbxproj
    const pbxprojPath = await findPbxproj(iosRoot);
    let pbxprojSettings: Record<string, string> = {};
    let releaseConfigs: BuildConfig[] = [];
    if (!pbxprojPath) {
        trace.push({ layer: 'pbxproj', detail: 'no .xcodeproj/project.pbxproj found' });
    } else {
        const pbxprojRaw = await readFile(pbxprojPath, 'utf8');
        const configs = parseBuildConfigurations(pbxprojRaw);
        releaseConfigs = pickReleaseConfigs(configs);
        pbxprojSettings = mergeBuildSettings(releaseConfigs);
        const next = expand(value, pbxprojSettings);
        const configNames = releaseConfigs.length ? releaseConfigs.map((c) => c.name).join(',') : '(none)';
        trace.push({
            layer: 'pbxproj',
            detail: `${path.basename(pbxprojPath)} configs=[${configNames}] → ${next}`
        });
        value = next;
        if (!hasPlaceholder(value)) return { ok: true, version: value, trace };
    }

    // Layer 3: xcconfig (only useful when we have a pbxproj that pointed at one)
    if (pbxprojPath && releaseConfigs.length > 0) {
        const xcconfigPaths = collectXcconfigPaths(releaseConfigs, pbxprojPath);
        for (const xcPath of xcconfigPaths) {
            const xcSettings = await readXcconfigChain(xcPath, new Set());
            // pbxproj settings override xcconfig (target settings beat xcconfig defaults).
            const merged = { ...xcSettings, ...pbxprojSettings };
            const next = expand(value, merged);
            trace.push({ layer: 'xcconfig', detail: `${path.basename(xcPath)} → ${next}` });
            value = next;
            if (!hasPlaceholder(value)) return { ok: true, version: value, trace };
        }
    }

    // Layer 4: xcodebuild (macOS ground truth)
    const allowXcodebuild = options.allowXcodebuild ?? true;
    const platform = options.platform ?? process.platform;
    if (allowXcodebuild && platform === 'darwin' && pbxprojPath) {
        const xcodebuild = options.xcodebuildPath ?? 'xcodebuild';
        const xcodeprojDir = path.dirname(pbxprojPath);
        const xcResult = await runXcodebuildShowSettings(xcodebuild, xcodeprojDir);
        if (xcResult.ok) {
            const settings = xcResult.settings;
            const direct = settings.MARKETING_VERSION ?? settings.CFBundleShortVersionString;
            if (direct && !hasPlaceholder(direct)) {
                trace.push({ layer: 'xcodebuild', detail: `MARKETING_VERSION=${direct}` });
                return { ok: true, version: direct, trace };
            }
            // Re-expand the partial value through xcodebuild's full settings map.
            const next = expand(value, settings);
            trace.push({ layer: 'xcodebuild', detail: `expanded → ${next}` });
            value = next;
            if (!hasPlaceholder(value)) return { ok: true, version: value, trace };
        } else {
            trace.push({ layer: 'xcodebuild', detail: `skipped (${xcResult.reason})` });
        }
    }

    const reason = buildUnresolvedReason(value, trace);
    return { ok: false, partial: value, trace, reason };
}

function buildUnresolvedReason(partial: string, trace: IosVersionTraceEntry[]): string {
    // Use a fresh regex — the module-level PLACEHOLDER_RX has `g` and its
    // lastIndex leaks between callers if reused here.
    const placeholders = [...partial.matchAll(/\$[({]([A-Z_][A-Z0-9_]*)[)}]/g)].map((m) => m[1]);
    const unique = [...new Set(placeholders)];
    const layers = trace.map((t) => t.layer).join(' → ');
    if (unique.length === 0) return `value still non-semver after walking ${layers}`;
    return `unresolved variable${unique.length > 1 ? 's' : ''} ${unique.map((n) => `$(${n})`).join(', ')} after walking ${layers}`;
}

// --- placeholder expansion ---------------------------------------------------

function hasPlaceholder(s: string): boolean {
    return /\$[({][A-Z_][A-Z0-9_]*[)}]/.test(s);
}

function expand(input: string, settings: Record<string, string>): string {
    let prev = input;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
        let changed = false;
        const next = prev.replace(/\$[({]([A-Z_][A-Z0-9_]*)[)}]/g, (whole, name) => {
            const sub = settings[name];
            if (sub === undefined) return whole;
            changed = true;
            return sub;
        });
        if (!changed) return next;
        prev = next;
    }
    return prev; // depth cap reached — likely a cycle
}

// --- pbxproj parsing ---------------------------------------------------------

type BuildConfig = {
    name: string;
    settings: Record<string, string>;
    /** Comment-extracted filename of the referenced .xcconfig, if any. */
    baseConfigurationReference?: string;
};

/**
 * Walk every `XCBuildConfiguration` block. We deliberately don't follow object
 * graphs (XCConfigurationList → target → buildConfigurations) — that would
 * require a real plist parser. Instead we pick configurations by `name`
 * (Release wins) and merge their build settings. Project-level and
 * target-level Release configs both surface; merging in declaration order
 * means target-level (declared later) overrides project-level, matching how
 * Xcode actually resolves settings.
 */
export function parseBuildConfigurations(pbxproj: string): BuildConfig[] {
    const out: BuildConfig[] = [];
    // Match each XCBuildConfiguration block. A block ends at the matching `};`
    // for the outer object — we find it by tracking brace depth.
    const isaRx = /isa\s*=\s*XCBuildConfiguration\s*;/g;
    for (const isaMatch of pbxproj.matchAll(isaRx)) {
        // Walk backwards from `isa` to find the opening `{` of the object.
        const isaIdx = isaMatch.index ?? 0;
        const openIdx = findEnclosingOpenBrace(pbxproj, isaIdx);
        if (openIdx < 0) continue;
        const closeIdx = findMatchingCloseBrace(pbxproj, openIdx);
        if (closeIdx < 0) continue;
        const body = pbxproj.slice(openIdx + 1, closeIdx);
        const nameMatch = body.match(/\bname\s*=\s*(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*;/);
        const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
        const baseRefComment = body.match(/baseConfigurationReference\s*=\s*[A-Z0-9]+\s*\/\*\s*([^*]+?)\s*\*\//)?.[1];
        const settings = extractBuildSettings(body);
        out.push({
            name,
            settings,
            baseConfigurationReference: baseRefComment
        });
    }
    return out;
}

function findEnclosingOpenBrace(s: string, from: number): number {
    let depth = 0;
    for (let i = from; i >= 0; i--) {
        const ch = s[i];
        if (ch === '}') depth++;
        else if (ch === '{') {
            if (depth === 0) return i;
            depth--;
        }
    }
    return -1;
}

function findMatchingCloseBrace(s: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        const ch = s[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function extractBuildSettings(body: string): Record<string, string> {
    const idx = body.search(/\bbuildSettings\s*=\s*\{/);
    if (idx === -1) return {};
    const openIdx = body.indexOf('{', idx);
    if (openIdx === -1) return {};
    const closeIdx = findMatchingCloseBrace(body, openIdx);
    if (closeIdx === -1) return {};
    const inner = body.slice(openIdx + 1, closeIdx);
    // Strip block comments inside settings (rare, but cheap insurance).
    const cleaned = inner.replace(/\/\*[\s\S]*?\*\//g, '');
    return parseAsciiPlistAssignments(cleaned);
}

/**
 * Parse `KEY = VALUE;` pairs from an ASCII-plist body. Handles:
 *   - bare identifier values (`MARKETING_VERSION = 109;`)
 *   - quoted values with escapes (`KEY = "1.2 \"beta\"";`)
 * Skips array values (`KEY = ( ... );`) and dict values (`KEY = { ... };`).
 * Conditional keys like `OTHER_CFLAGS[sdk=*]` won't match the strict-uppercase
 * key regex and are silently skipped — none of the version-related settings
 * we care about use conditional syntax.
 */
function parseAsciiPlistAssignments(body: string): Record<string, string> {
    const out: Record<string, string> = {};
    const rx = /(^|[\s;])([A-Z_][A-Z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^"(\s{][^;\n]*?))\s*;/g;
    for (const m of body.matchAll(rx)) {
        const key = m[2];
        const quoted = m[3];
        const bare = m[4];
        const value = quoted !== undefined ? quoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : (bare?.trim() ?? '');
        out[key] = value;
    }
    return out;
}

function pickReleaseConfigs(configs: BuildConfig[]): BuildConfig[] {
    const release = configs.filter((c) => /^release$/i.test(c.name));
    if (release.length > 0) return release;
    // Last config is conventionally release-like; fall back to it. If nothing
    // exists at all the caller will report empty buildSettings.
    return configs.slice(-1);
}

function mergeBuildSettings(configs: BuildConfig[]): Record<string, string> {
    // Declaration order in pbxproj: project-level config block appears before
    // target-level. Merging in iteration order gives target-level the win.
    const out: Record<string, string> = {};
    for (const c of configs) Object.assign(out, c.settings);
    return out;
}

// --- xcconfig resolution -----------------------------------------------------

function collectXcconfigPaths(configs: BuildConfig[], pbxprojPath: string): string[] {
    // pbxprojPath = .../ios/App/App.xcodeproj/project.pbxproj
    const xcodeprojDir = path.dirname(pbxprojPath); // .../App.xcodeproj
    const projectRoot = path.dirname(xcodeprojDir); // .../ios/App  (Capacitor convention)
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
        const ref = c.baseConfigurationReference;
        if (!ref) continue;
        for (const candidate of [
            path.resolve(projectRoot, ref),
            path.resolve(projectRoot, 'App', ref),
            path.resolve(xcodeprojDir, ref)
        ]) {
            if (seen.has(candidate)) continue;
            seen.add(candidate);
            if (existsSync(candidate)) {
                out.push(candidate);
                break;
            }
        }
    }
    return out;
}

async function readXcconfigChain(filePath: string, seen: Set<string>): Promise<Record<string, string>> {
    if (seen.has(filePath)) return {};
    seen.add(filePath);
    if (!existsSync(filePath)) return {};
    let raw: string;
    try {
        raw = await readFile(filePath, 'utf8');
    } catch {
        return {};
    }
    const out: Record<string, string> = {};
    for (const rawLine of raw.split(/\r?\n/)) {
        // Strip line and inline comments. xcconfig uses //; block comments are
        // unusual but legal — handle the common case only.
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const includeMatch = line.match(/^#include\??\s+"([^"]+)"/);
        if (includeMatch) {
            const nested = path.resolve(path.dirname(filePath), includeMatch[1]);
            const sub = await readXcconfigChain(nested, seen);
            // Earlier (outer) file wins on conflict, mirroring xcconfig's
            // include semantics: the including file overrides the included.
            for (const [k, v] of Object.entries(sub)) {
                if (!(k in out)) out[k] = v;
            }
            continue;
        }
        const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

// --- file discovery ----------------------------------------------------------

async function findInfoPlist(iosRoot: string): Promise<string | null> {
    const conventional = path.join(iosRoot, 'App/App/Info.plist');
    if (existsSync(conventional)) return conventional;
    return null;
}

async function findPbxproj(iosRoot: string): Promise<string | null> {
    const conventional = path.join(iosRoot, 'App/App.xcodeproj/project.pbxproj');
    if (existsSync(conventional)) return conventional;
    // Capacitor's scaffold always produces App.xcodeproj. Fall back to a
    // shallow scan only when someone has renamed it.
    if (!existsSync(iosRoot)) return null;
    let appDirEntries;
    try {
        appDirEntries = await readdir(path.join(iosRoot, 'App'), { withFileTypes: true });
    } catch {
        return null;
    }
    for (const ent of appDirEntries) {
        if (ent.isDirectory() && ent.name.endsWith('.xcodeproj')) {
            const candidate = path.join(iosRoot, 'App', ent.name, 'project.pbxproj');
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

// --- xcodebuild integration --------------------------------------------------

type XcodebuildOk = { ok: true; settings: Record<string, string> };
type XcodebuildSkip = { ok: false; reason: string };
type XcodebuildOutcome = XcodebuildOk | XcodebuildSkip;

/**
 * Run `xcodebuild -showBuildSettings -json -configuration Release` and return
 * the merged build settings for the first target. We don't try to pick a
 * specific target — Capacitor projects have a single application target named
 * "App", and forcing it via -target requires an extra xcodebuild query first.
 *
 * Failure modes (xcodebuild missing, project corrupt, command times out) all
 * collapse into `{ ok: false, reason }` so the resolver can record the skip
 * in its trace without blowing up the publish.
 */
async function runXcodebuildShowSettings(binary: string, xcodeprojDir: string): Promise<XcodebuildOutcome> {
    return new Promise<XcodebuildOutcome>((resolve) => {
        let child;
        try {
            child = spawn(
                binary,
                ['-project', xcodeprojDir, '-showBuildSettings', '-json', '-configuration', 'Release'],
                { stdio: ['ignore', 'pipe', 'pipe'] }
            );
        } catch (e) {
            resolve({ ok: false, reason: e instanceof Error ? e.message : String(e) });
            return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL');
            resolve({ ok: false, reason: 'xcodebuild timed out after 30s' });
        }, 30_000);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: false, reason: err.message });
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (code !== 0) {
                const tail = (stderr.trim() || stdout.trim()).split('\n').slice(-1)[0] ?? '';
                resolve({ ok: false, reason: `xcodebuild exited ${code}${tail ? `: ${tail}` : ''}` });
                return;
            }
            try {
                const parsed = JSON.parse(stdout) as Array<{ buildSettings?: Record<string, string> }>;
                const merged: Record<string, string> = {};
                for (const entry of parsed) {
                    if (entry?.buildSettings) Object.assign(merged, entry.buildSettings);
                }
                resolve({ ok: true, settings: merged });
            } catch (e) {
                resolve({
                    ok: false,
                    reason: `xcodebuild output not JSON: ${e instanceof Error ? e.message : String(e)}`
                });
            }
        });
    });
}
