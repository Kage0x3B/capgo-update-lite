import { describe, expect, it } from 'vitest';
import { cmpSemver, parseSemver, type Semver } from './semver.js';

// These tests also act as a drift check against
// packages/app/src/lib/server/semver.ts — the two modules must stay in sync on
// the cases covered here. When adding a case here, mirror it in the server's
// semver.test.ts.

describe('parseSemver', () => {
    it.each([
        ['1.2.3', { major: 1, minor: 2, patch: 3 }],
        ['10.20.30', { major: 10, minor: 20, patch: 30 }],
        ['0.0.0', { major: 0, minor: 0, patch: 0 }],
        ['1.0.0-alpha', { major: 1, minor: 0, patch: 0 }],
        ['1.0.0-alpha.1', { major: 1, minor: 0, patch: 0 }],
        ['1.0.0+build', { major: 1, minor: 0, patch: 0 }],
        ['1.0.0-rc.1+build.42', { major: 1, minor: 0, patch: 0 }]
    ])('parses %s', (input, expected) => {
        expect(parseSemver(input)).toEqual(expected);
    });

    it.each(['1', '1.2', 'v1.2.3', '1.2.3.4', '', ' ', '1.2.x', 'latest'])('rejects %s', (input) => {
        expect(parseSemver(input)).toBeNull();
    });
});

describe('cmpSemver', () => {
    const sv = (major: number, minor: number, patch: number): Semver => ({ major, minor, patch });

    it('returns positive when a > b', () => {
        expect(cmpSemver(sv(1, 2, 4), sv(1, 2, 3))).toBeGreaterThan(0);
        expect(cmpSemver(sv(1, 3, 0), sv(1, 2, 99))).toBeGreaterThan(0);
        expect(cmpSemver(sv(2, 0, 0), sv(1, 99, 99))).toBeGreaterThan(0);
    });

    it('returns negative when a < b', () => {
        expect(cmpSemver(sv(1, 2, 3), sv(1, 2, 4))).toBeLessThan(0);
        expect(cmpSemver(sv(1, 2, 99), sv(1, 3, 0))).toBeLessThan(0);
        expect(cmpSemver(sv(1, 99, 99), sv(2, 0, 0))).toBeLessThan(0);
    });

    it('returns zero when equal', () => {
        expect(cmpSemver(sv(1, 2, 3), sv(1, 2, 3))).toBe(0);
    });

    it('compares major first, then minor, then patch', () => {
        // Major dominates: even when minor/patch invert, the major decides.
        expect(cmpSemver(sv(2, 0, 0), sv(1, 99, 99))).toBeGreaterThan(0);
        expect(cmpSemver(sv(1, 99, 99), sv(2, 0, 0))).toBeLessThan(0);
    });
});
