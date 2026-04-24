import { describe, expect, it } from 'vitest';
import {
    compareSemver,
    isNewer,
    isUpgradeBlocked,
    isValidSemver,
    parseSemver,
    upgradeClass,
    type ParsedSemver
} from './semver.js';

// Drift check: when adding a case here, mirror it in
// packages/cli/src/semver.test.ts so the CLI's parseSemver/cmpSemver clones
// stay in lockstep.

const sv = (major: number, minor: number, patch: number, prerelease: string | null = null): ParsedSemver => ({
    major,
    minor,
    patch,
    prerelease
});

describe('parseSemver', () => {
    it.each([
        ['1.2.3', { major: 1, minor: 2, patch: 3, prerelease: null }],
        ['10.20.30', { major: 10, minor: 20, patch: 30, prerelease: null }],
        ['0.0.0', { major: 0, minor: 0, patch: 0, prerelease: null }],
        ['1.0.0-alpha', { major: 1, minor: 0, patch: 0, prerelease: 'alpha' }],
        ['1.0.0-alpha.1', { major: 1, minor: 0, patch: 0, prerelease: 'alpha.1' }],
        ['1.0.0+build', { major: 1, minor: 0, patch: 0, prerelease: null }],
        ['1.0.0-rc.1+build.42', { major: 1, minor: 0, patch: 0, prerelease: 'rc.1' }]
    ])('parses %s', (input, expected) => {
        expect(parseSemver(input)).toEqual(expected);
    });

    it.each(['1', '1.2', 'v1.2.3', '1.2.3.4', '', ' ', 'latest'])('rejects %s', (input) => {
        expect(parseSemver(input)).toBeNull();
    });
});

describe('isValidSemver', () => {
    it('true for valid semver', () => {
        expect(isValidSemver('1.2.3')).toBe(true);
    });
    it('false for invalid', () => {
        expect(isValidSemver('1.2')).toBe(false);
    });
});

describe('compareSemver', () => {
    it('compares major, then minor, then patch', () => {
        expect(compareSemver(sv(2, 0, 0), sv(1, 99, 99))).toBe(1);
        expect(compareSemver(sv(1, 2, 4), sv(1, 2, 3))).toBe(1);
        expect(compareSemver(sv(1, 2, 3), sv(1, 2, 3))).toBe(0);
    });

    it('prerelease < no-prerelease at same major.minor.patch', () => {
        expect(compareSemver(sv(1, 0, 0, 'rc.1'), sv(1, 0, 0))).toBe(-1);
        expect(compareSemver(sv(1, 0, 0), sv(1, 0, 0, 'rc.1'))).toBe(1);
    });

    it('identical prereleases return zero', () => {
        expect(compareSemver(sv(1, 0, 0, 'rc.1'), sv(1, 0, 0, 'rc.1'))).toBe(0);
    });

    it('differing prereleases compare lexicographically', () => {
        expect(compareSemver(sv(1, 0, 0, 'rc.2'), sv(1, 0, 0, 'rc.1'))).toBe(1);
    });
});

describe('isNewer', () => {
    it('returns true for builtin sentinel', () => {
        expect(isNewer('1.0.0', 'builtin')).toBe(true);
    });

    it('returns true for unknown sentinel', () => {
        expect(isNewer('1.0.0', 'unknown')).toBe(true);
    });

    it('throws when candidate is not semver', () => {
        expect(() => isNewer('not-semver', '1.0.0')).toThrow();
    });

    it('returns true when running is not semver (strictly upgrading to something)', () => {
        expect(isNewer('1.0.0', 'nonsense')).toBe(true);
    });

    it('returns true only when candidate is strictly newer', () => {
        expect(isNewer('1.0.1', '1.0.0')).toBe(true);
        expect(isNewer('1.0.0', '1.0.0')).toBe(false);
        expect(isNewer('1.0.0', '1.0.1')).toBe(false);
    });
});

describe('upgradeClass', () => {
    it('classifies a major bump', () => {
        expect(upgradeClass(sv(2, 0, 0), sv(1, 9, 9))).toBe('major');
    });

    it('classifies a minor bump', () => {
        expect(upgradeClass(sv(1, 3, 0), sv(1, 2, 9))).toBe('minor');
    });

    it('classifies a patch bump', () => {
        expect(upgradeClass(sv(1, 2, 4), sv(1, 2, 3))).toBe('patch');
    });

    it('returns none when equal', () => {
        expect(upgradeClass(sv(1, 2, 3), sv(1, 2, 3))).toBe('none');
    });

    it('returns none on a downgrade', () => {
        expect(upgradeClass(sv(1, 2, 2), sv(1, 2, 3))).toBe('none');
    });

    it('prerelease promotion collapses into patch class', () => {
        // rc.1 → final at same triple; treated as a patch-level upgrade.
        expect(upgradeClass(sv(1, 0, 0), sv(1, 0, 0, 'rc.1'))).toBe('patch');
    });
});

describe('isUpgradeBlocked (4x4 matrix)', () => {
    // rows = blocked ceiling, cols = actual upgrade class
    const cases: Array<{
        blocked: 'none' | 'patch' | 'minor' | 'major';
        actual: 'none' | 'patch' | 'minor' | 'major';
        result: boolean;
    }> = [
        { blocked: 'none', actual: 'none', result: false },
        { blocked: 'none', actual: 'patch', result: false },
        { blocked: 'none', actual: 'minor', result: false },
        { blocked: 'none', actual: 'major', result: false },
        { blocked: 'patch', actual: 'none', result: false },
        { blocked: 'patch', actual: 'patch', result: true },
        { blocked: 'patch', actual: 'minor', result: true },
        { blocked: 'patch', actual: 'major', result: true },
        { blocked: 'minor', actual: 'none', result: false },
        { blocked: 'minor', actual: 'patch', result: false },
        { blocked: 'minor', actual: 'minor', result: true },
        { blocked: 'minor', actual: 'major', result: true },
        { blocked: 'major', actual: 'none', result: false },
        { blocked: 'major', actual: 'patch', result: false },
        { blocked: 'major', actual: 'minor', result: false },
        { blocked: 'major', actual: 'major', result: true }
    ];

    it.each(cases)('blocked=$blocked × actual=$actual → $result', ({ blocked, actual, result }) => {
        expect(isUpgradeBlocked(actual, blocked)).toBe(result);
    });
});
