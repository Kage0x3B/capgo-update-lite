/**
 * Native-project introspection used by the publish-time min-build guards.
 *
 * The `version_build` the Capacitor plugin sends is platform-specific:
 *   - Android: versionName from android/app/build.gradle(.kts)
 *   - iOS:     CFBundleShortVersionString from ios/App/App/Info.plist
 *
 * We read those values off the filesystem so the CLI can default or
 * auto-detect the `min_*_build` required for the uploaded bundle.
 *
 * `collectNativePackages` captures a fingerprint of native-code dependencies
 * from package.json. When that fingerprint changes between publishes, it's a
 * strong signal that a bundle now requires a newer native shell. Upstream
 * capgo uses a very similar trick (`--auto-min-update-version`).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveIosShortVersion, type ResolveOptions } from './ios-version.js';

export { resolveIosShortVersion } from './ios-version.js';
export type { IosVersionLayer, IosVersionResult, IosVersionTraceEntry, ResolveOptions } from './ios-version.js';

const ANDROID_GRADLE_CANDIDATES = ['app/build.gradle', 'app/build.gradle.kts'];

// Native-plugin prefixes. Anything matching these in dependencies+devDependencies
// becomes part of the fingerprint; a version bump in any of them hints that the
// native shell may need to be rebuilt/reshipped to run the new OTA bundle.
const NATIVE_PLUGIN_PATTERNS = [
    /^@capacitor\//,
    /^@capacitor-community\//,
    /^@ionic-enterprise\//,
    /^cordova-plugin-/,
    /^capacitor-plugin-/,
    /^capacitor-/
];

// Packages that match the patterns above but contain no native code. @capacitor/cli
// ships the build tool; @capacitor/core is the JS bridge. Bumping either doesn't
// require a native-shell reship on its own.
const NATIVE_PACKAGE_EXCLUDES = new Set<string>(['@capacitor/cli', '@capacitor/core']);

export async function readAndroidVersionName(projectRoot: string): Promise<string | null> {
    for (const rel of ANDROID_GRADLE_CANDIDATES) {
        const p = path.resolve(projectRoot, rel);
        if (!existsSync(p)) continue;
        let raw: string;
        try {
            raw = await readFile(p, 'utf8');
        } catch {
            continue;
        }
        // Matches `versionName "1.4.0"` and `versionName = "1.4.0"` (Groovy + KTS).
        const m = raw.match(/versionName\s*=?\s*['"]([^'"]+)['"]/);
        if (m) return m[1];
    }
    return null;
}

/**
 * Backwards-compatible thin wrapper. Returns:
 *   - the resolved literal version when every layer succeeds,
 *   - the unresolved partial (e.g. `$(MARKETING_VERSION)`) when no layer can
 *     resolve it (preserves the legacy "let preflight semver-check it" path),
 *   - null when there's no Info.plist at all.
 *
 * For richer error reporting prefer `resolveIosShortVersion` directly — it
 * returns the layer trace.
 */
export async function readIosShortVersion(projectRoot: string, options: ResolveOptions = {}): Promise<string | null> {
    const result = await resolveIosShortVersion(projectRoot, options);
    if (!result) return null;
    return result.ok ? result.version : result.partial;
}

export async function collectNativePackages(packageJsonPath: string): Promise<Record<string, string>> {
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        parsed = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch {
        return {};
    }
    // On conflict, dependencies win over devDependencies — only `dependencies`
    // actually ships into the native shell. Spread order matters.
    const merged: Record<string, string> = {
        ...(parsed.devDependencies ?? {}),
        ...(parsed.dependencies ?? {})
    };
    const out: Record<string, string> = {};
    for (const name of Object.keys(merged).sort()) {
        if (NATIVE_PACKAGE_EXCLUDES.has(name)) continue;
        if (!NATIVE_PLUGIN_PATTERNS.some((rx) => rx.test(name))) continue;
        out[name] = merged[name];
    }
    return out;
}

export function sameNativeFingerprint(a: Record<string, string>, b: Record<string, string>): boolean {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}

/** Names that appear in `current` but not `previous`, or whose version changed. */
export function fingerprintDiff(
    previous: Record<string, string>,
    current: Record<string, string>
): { added: string[]; removed: string[]; changed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const k of Object.keys(current)) {
        if (!(k in previous)) added.push(k);
        else if (previous[k] !== current[k]) changed.push(k);
    }
    for (const k of Object.keys(previous)) {
        if (!(k in current)) removed.push(k);
    }
    return { added, removed, changed };
}
