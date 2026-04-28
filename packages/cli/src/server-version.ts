/**
 * CLI ↔ server compatibility floor.
 *
 * The server exposes its build version on `/health`. The CLI compares it
 * against MIN_SERVER_VERSION and warns when:
 *   - the server returns no `version` field (predates the contract)
 *   - the server's version is lower than the CLI's minimum
 *
 * Bump MIN_SERVER_VERSION whenever a CLI release starts depending on a
 * server feature that older deploys can't satisfy.
 */

import { cmpSemver, parseSemver } from './semver.js';

export const MIN_SERVER_VERSION = '0.4.0';

export type CompatStatus = 'ok' | 'missing' | 'unparseable' | 'too-old';

export type CompatResult = {
    status: CompatStatus;
    serverVersion: string | null;
    minVersion: string;
};

/**
 * Compare a server version (as reported on /health) against the CLI's
 * minimum. The CLI's `parseSemver` is lenient — it accepts the Apple-style
 * `MAJOR[.MINOR[.PATCH]]` shape — so mainstream version strings parse fine.
 */
export function checkServerVersion(serverVersion: string | null | undefined): CompatResult {
    if (!serverVersion) {
        return { status: 'missing', serverVersion: serverVersion ?? null, minVersion: MIN_SERVER_VERSION };
    }
    const sv = parseSemver(serverVersion);
    if (!sv) {
        return { status: 'unparseable', serverVersion, minVersion: MIN_SERVER_VERSION };
    }
    const min = parseSemver(MIN_SERVER_VERSION)!;
    return {
        status: cmpSemver(sv, min) < 0 ? 'too-old' : 'ok',
        serverVersion,
        minVersion: MIN_SERVER_VERSION
    };
}

/** Human-readable warning for a non-`ok` CompatResult; null when ok. */
export function compatWarningMessage(result: CompatResult): string | null {
    switch (result.status) {
        case 'ok':
            return null;
        case 'missing':
            return `server did not report a version on /health — expected ≥ ${result.minVersion}. Upgrade the server, or some CLI features may behave unexpectedly.`;
        case 'unparseable':
            return `server reported an unrecognizable version "${result.serverVersion}" on /health — expected ≥ ${result.minVersion}.`;
        case 'too-old':
            return `server version ${result.serverVersion} is below the CLI's minimum ${result.minVersion}. Some features may not work — upgrade the server.`;
    }
}
