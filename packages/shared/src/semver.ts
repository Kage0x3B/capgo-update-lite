/**
 * Pragmatic native-app version helpers shared between the server and the CLI.
 *
 * Strict semver requires X.Y.Z, but Apple's `CFBundleShortVersionString` allows
 * MAJOR[.MINOR[.PATCH]] (so `110`, `110.0`, and `110.0.0` are all valid Apple
 * versions) and Google Play's `versionName` is even looser. To accept what
 * these platforms actually ship, missing minor/patch components are treated as
 * 0. The `+build` suffix is parsed and ignored. The `-prerelease` suffix is
 * captured and ordered: prerelease < no-prerelease at the same triple.
 *
 * Server-specific decision helpers (isNewer, upgradeClass, isUpgradeBlocked)
 * live in `packages/app/src/lib/server/semver.ts` and re-use these primitives.
 */

const NATIVE_VERSION_RE = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

export interface Semver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
}

export function parseSemver(input: string): Semver | null {
    const m = input.match(NATIVE_VERSION_RE);
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

/** Returns 1 if a > b, -1 if a < b, 0 if equal. Prerelease ordering is
 * simplified: any prerelease < no-prerelease at the same major.minor.patch. */
export function compareSemver(a: Semver, b: Semver): number {
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
