import { describe, expect, it } from 'vitest';
import { compareSemver, isValidSemver, parseSemver, type Semver } from './semver.js';

describe('parseSemver', () => {
    it('accepts strict X.Y.Z', () => {
        expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    });

    it('treats missing minor/patch as 0 (Apple-style)', () => {
        expect(parseSemver('110')).toEqual({ major: 110, minor: 0, patch: 0, prerelease: null });
        expect(parseSemver('110.4')).toEqual({ major: 110, minor: 4, patch: 0, prerelease: null });
    });

    it('captures the prerelease tag and ignores build metadata', () => {
        expect(parseSemver('1.0.0-rc.1+sha.abc')).toEqual({
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: 'rc.1'
        });
    });

    it('returns null for invalid inputs', () => {
        expect(parseSemver('')).toBeNull();
        expect(parseSemver('v1.2.3')).toBeNull();
        expect(parseSemver('1.2.3.4')).toBeNull();
        expect(parseSemver('not-a-version')).toBeNull();
    });
});

describe('isValidSemver', () => {
    it('mirrors parseSemver acceptance', () => {
        expect(isValidSemver('1.2.3')).toBe(true);
        expect(isValidSemver('110')).toBe(true);
        expect(isValidSemver('garbage')).toBe(false);
    });
});

describe('compareSemver', () => {
    const sv = (major: number, minor = 0, patch = 0, prerelease: string | null = null): Semver => ({
        major,
        minor,
        patch,
        prerelease
    });

    it('orders by major.minor.patch', () => {
        expect(compareSemver(sv(1), sv(2))).toBe(-1);
        expect(compareSemver(sv(1, 2), sv(1, 1))).toBe(1);
        expect(compareSemver(sv(1, 1, 2), sv(1, 1, 2))).toBe(0);
    });

    it('treats prerelease as < release at the same triple', () => {
        expect(compareSemver(sv(1, 0, 0, 'rc.1'), sv(1, 0, 0))).toBe(-1);
        expect(compareSemver(sv(1, 0, 0), sv(1, 0, 0, 'rc.1'))).toBe(1);
    });

    it('falls back to lexicographic compare between two prereleases', () => {
        expect(compareSemver(sv(1, 0, 0, 'rc.1'), sv(1, 0, 0, 'rc.2'))).toBe(-1);
        expect(compareSemver(sv(1, 0, 0, 'beta'), sv(1, 0, 0, 'alpha'))).toBe(1);
    });
});
