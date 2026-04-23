export type Semver = { major: number; minor: number; patch: number };

/** Pragmatic parser — matches the server's style (semver with optional pre/build tags, ignored). */
export function parseSemver(v: string): Semver | null {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?(?:\+[\w.]+)?$/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3] };
}

export function cmpSemver(a: Semver, b: Semver): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}
