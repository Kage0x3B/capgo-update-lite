/**
 * Server-side semver helpers.
 *
 * Parsing primitives live in `capgo-update-lite-shared/semver` so the CLI and
 * server agree on what counts as a valid native-app version. This module adds
 * the server-only update-decision helpers (isNewer, upgradeClass,
 * isUpgradeBlocked) used by /updates and the analytics pipeline.
 *
 * `version_name` from the plugin carries two special sentinels — 'builtin'
 * (no JS bundle applied yet) and 'unknown' (a prior bundle failed). Both are
 * treated as "always update" and never parsed as a version.
 */

import { compareSemver, isValidSemver, parseSemver, type Semver } from 'capgo-update-lite-shared/semver';

export { compareSemver, isValidSemver, parseSemver };

/** Backwards-compatible alias for the legacy server type name. */
export type ParsedSemver = Semver;

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
