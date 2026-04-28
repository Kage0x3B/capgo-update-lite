import { describe, expect, it } from 'vitest';
import { checkServerVersion, compatWarningMessage, MIN_SERVER_VERSION } from './server-version.js';

describe('checkServerVersion', () => {
    it('returns "ok" when the server reports exactly MIN_SERVER_VERSION', () => {
        const result = checkServerVersion(MIN_SERVER_VERSION);
        expect(result.status).toBe('ok');
    });

    it('returns "ok" when the server reports a newer version', () => {
        const result = checkServerVersion('99.0.0');
        expect(result.status).toBe('ok');
    });

    it('returns "too-old" when the server is below MIN_SERVER_VERSION', () => {
        const result = checkServerVersion('0.0.1');
        expect(result.status).toBe('too-old');
        expect(result.serverVersion).toBe('0.0.1');
        expect(result.minVersion).toBe(MIN_SERVER_VERSION);
    });

    it('returns "missing" when no version is reported', () => {
        expect(checkServerVersion(null).status).toBe('missing');
        expect(checkServerVersion(undefined).status).toBe('missing');
        expect(checkServerVersion('').status).toBe('missing');
    });

    it('returns "unparseable" when the server reports a non-semver string', () => {
        expect(checkServerVersion('latest').status).toBe('unparseable');
    });

    it('accepts Apple-style X.Y (relaxed semver) — minor-only counts as 0 patch', () => {
        // The CLI's parseSemver accepts MAJOR[.MINOR[.PATCH]], so a server
        // reporting "1.2" parses as 1.2.0. With MIN_SERVER_VERSION currently
        // 0.3.0, "1.2" should be ok.
        expect(checkServerVersion('1.2').status).toBe('ok');
    });
});

describe('compatWarningMessage', () => {
    it('returns null for ok status', () => {
        expect(compatWarningMessage({ status: 'ok', serverVersion: '1.0.0', minVersion: '0.3.0' })).toBeNull();
    });

    it('mentions /health for missing version', () => {
        const msg = compatWarningMessage({
            status: 'missing',
            serverVersion: null,
            minVersion: '0.3.0'
        });
        expect(msg).toMatch(/\/health/);
        expect(msg).toMatch(/0\.3\.0/);
    });

    it('quotes the unrecognized value', () => {
        const msg = compatWarningMessage({
            status: 'unparseable',
            serverVersion: 'latest',
            minVersion: '0.3.0'
        });
        expect(msg).toMatch(/"latest"/);
    });

    it('mentions both versions for too-old', () => {
        const msg = compatWarningMessage({
            status: 'too-old',
            serverVersion: '0.1.0',
            minVersion: '0.3.0'
        });
        expect(msg).toMatch(/0\.1\.0/);
        expect(msg).toMatch(/0\.3\.0/);
    });
});
