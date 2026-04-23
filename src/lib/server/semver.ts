/**
 * Minimal semver helpers.
 *
 * We only need:
 *  - parse: is this a syntactically valid semver?
 *  - compare: strict greater-than between two semvers
 *  - isNewer: does the server's candidate version supersede what the device runs?
 *
 * `version_name` from the plugin carries two special sentinels — 'builtin'
 * (no JS bundle applied yet) and 'unknown' (a prior bundle failed). Both are
 * treated as "always update" and never parsed as semver.
 */

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

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
		minor: Number(m[2]),
		patch: Number(m[3]),
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
