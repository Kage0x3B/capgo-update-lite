/**
 * Minimal native-app version helpers.
 *
 * We only need:
 *  - parse: is this a syntactically valid version?
 *  - compare: strict greater-than between two versions
 *  - isNewer: does the server's candidate version supersede what the device runs?
 *
 * Strict semver requires X.Y.Z, but Apple's `CFBundleShortVersionString`
 * allows MAJOR[.MINOR[.PATCH]] (so `110`, `110.0`, and `110.0.0` are all
 * valid Apple versions) and Google Play's `versionName` is even looser. To
 * accept what these platforms actually ship, we treat missing minor/patch
 * as 0. The pre-release suffix is still parsed for ordering.
 *
 * `version_name` from the plugin carries two special sentinels — 'builtin'
 * (no JS bundle applied yet) and 'unknown' (a prior bundle failed). Both are
 * treated as "always update" and never parsed as a version.
 *
 * Mirrors `packages/cli/src/semver.ts` — keep the two in sync.
 */

const SEMVER_RE = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

export type ParsedSemver = {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
};

export function parseSemver(input: string): ParsedSemver | null {
    const m = SEMVER_RE.exec(input);
    if (!m) return null;
    return {
        major: Number(m[1]),
        minor: m[2] !== undefined ? Number(m[2]) : 0,
        patch: m[3] !== undefined ? Number(m[3]) : 0,
        prerelease: m[4] ?? null
    };
}

export function isValidSemver(input: string): boolean {
    return parseSemver(input) !== null;
}

/** Returns 1 if a>b, -1 if a<b, 0 if equal. Prerelease ordering is simplified:
 * any prerelease < no-prerelease at same major.minor.patch. */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
    if (a.major !== b.major) return a.major > b.major ? 1 : -1;
    if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
    if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
    const ap = a.prerelease;
    const bp = b.prerelease;
    if (ap === bp) return 0;
    if (ap === null) return 1;
    if (bp === null) return -1;
    return ap > bp ? 1 : -1;
}

/**
 * True if `candidate` is strictly newer than what the device is currently
 * running. Handles the 'builtin'/'unknown' sentinels by always returning true.
 * Throws on an invalid candidate — callers should surface a `semver_error`.
 */
export function isNewer(candidate: string, running: string): boolean {
    if (running === 'builtin' || running === 'unknown') return true;
    const c = parseSemver(candidate);
    if (!c) throw new Error(`invalid candidate semver: ${candidate}`);
    const r = parseSemver(running);
    if (!r) return true;
    return compareSemver(c, r) > 0;
}

/**
 * Classifies the upgrade class between two semvers. Used by the per-app
 * `disable_auto_update` ceiling on POST /updates. Mirrors upstream capgo's
 * `getUpgradeKind` (utils/update.ts).
 *
 * Returns 'none' when candidate is not strictly greater than running. The
 * callers of this function only care about blocked upgrades, so downgrades
 * collapse into 'none' — the no-downgrade-under-native guard handles those.
 */
export type UpgradeClass = 'major' | 'minor' | 'patch' | 'none';

export function upgradeClass(candidate: ParsedSemver, running: ParsedSemver): UpgradeClass {
    if (compareSemver(candidate, running) <= 0) return 'none';
    if (candidate.major !== running.major) return 'major';
    if (candidate.minor !== running.minor) return 'minor';
    if (candidate.patch !== running.patch) return 'patch';
    // Same X.Y.Z but candidate > running implies prerelease promotion. Treat
    // as 'patch' so it's caught by the most permissive guard level.
    return 'patch';
}

/**
 * True when the blocked class is met or exceeded. E.g. blocking 'minor' also
 * blocks 'major'. 'none' never blocks.
 */
export function isUpgradeBlocked(actual: UpgradeClass, blocked: UpgradeClass): boolean {
    if (blocked === 'none' || actual === 'none') return false;
    const rank: Record<Exclude<UpgradeClass, 'none'>, number> = { patch: 1, minor: 2, major: 3 };
    return rank[actual] >= rank[blocked];
}
