export type Semver = { major: number; minor: number; patch: number; prerelease: string | null };

/**
 * Pragmatic parser tuned for native app version strings.
 *
 * Strict semver requires X.Y.Z, but Apple's `CFBundleShortVersionString`
 * allows MAJOR[.MINOR[.PATCH]] (so `110`, `110.0`, and `110.0.0` are all
 * valid Apple versions) and Google Play's `versionName` is even looser. To
 * accept what these platforms actually ship, we treat missing minor/patch as
 * 0. The `+build` suffix is parsed and ignored. The `-prerelease` suffix is
 * captured and ordered: prerelease < no-prerelease at the same triple.
 *
 * Mirrors `packages/app/src/lib/server/semver.ts` — keep the two in sync.
 */
const NATIVE_VERSION_RE = /^(\d+)(?:\.(\d+)(?:\.(\d+))?)?(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseSemver(v: string): Semver | null {
    const m = v.match(NATIVE_VERSION_RE);
    if (!m) return null;
    return {
        major: +m[1],
        minor: m[2] !== undefined ? +m[2] : 0,
        patch: m[3] !== undefined ? +m[3] : 0,
        prerelease: m[4] ?? null
    };
}

export function cmpSemver(a: Semver, b: Semver): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    // Same X.Y.Z — prerelease ordering. Per semver, a prerelease is *less than*
    // the release at the same triple (1.0.0-rc.1 < 1.0.0). When both carry a
    // prerelease tag, fall back to lexicographic compare; that matches the
    // server's simplified rule and avoids the rabbit hole of dot-separated
    // numeric-vs-alpha precedence we don't actually need here.
    const ap = a.prerelease;
    const bp = b.prerelease;
    if (ap === bp) return 0;
    if (ap === null) return 1;
    if (bp === null) return -1;
    return ap > bp ? 1 : ap < bp ? -1 : 0;
}
