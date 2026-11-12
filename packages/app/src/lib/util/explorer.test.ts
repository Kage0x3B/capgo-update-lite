import { describe, expect, it } from 'vitest';
import {
    bucketSeconds,
    DEFAULT_QUERY,
    parseQuery,
    readableQuery,
    resolveRange,
    toParams,
    toQueryString,
    valueLabel,
    withoutValue,
    withValue
} from './explorer.js';

const parse = (s: string) => parseQuery(new URLSearchParams(s));

describe('explorer query model', () => {
    it('defaults to plugin events over 24h with app state hidden', () => {
        expect(parse('')).toEqual(DEFAULT_QUERY);
        expect(toQueryString(DEFAULT_QUERY)).toBe('');
    });

    it('parses include, exclude, group and none tokens', () => {
        const q = parse('action=@failure,set,!ping&version=~&platform=!ios');
        expect(q.dims.action).toEqual({ in: ['@failure', 'set'], out: ['ping'] });
        expect(q.dims.version).toEqual({ in: ['~'], out: [] });
        expect(q.dims.platform).toEqual({ in: [], out: ['ios'] });
    });

    it('round-trips through the URL', () => {
        const s = 'src=all&range=7d&q=6b33&appstate=1&prod=yes&emu=no&action=@failure,!ping&channel=beta';
        const q = parse(s);
        expect(parse(toQueryString(q))).toEqual(q);
        expect(readableQuery(toParams(q))).toContain('action=@failure,!ping');
    });

    it('rejects junk values', () => {
        const q = parse('src=nope&range=1y&prod=maybe&action=,,!');
        expect(q.source).toBe('events');
        expect(q.range).toBe('24h');
        expect(q.prod).toBe('any');
        expect(q.dims.action).toBeUndefined();
    });

    it('falls back to 24h when a custom range has no valid start', () => {
        expect(parse('range=custom&from=garbage').range).toBe('24h');
        const q = parse('range=custom&from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z');
        expect(q.range).toBe('custom');
        expect(resolveRange(q)).toEqual({
            since: new Date('2026-11-01T00:00:00Z'),
            until: new Date('2026-11-02T00:00:00Z')
        });
    });

    it('resolves relative ranges against now', () => {
        const now = new Date('2026-11-12T12:00:00Z');
        expect(resolveRange(parse('range=1h'), now)).toEqual({
            since: new Date('2026-11-12T11:00:00Z'),
            until: now
        });
    });

    it('caps custom ranges and repairs inverted ones', () => {
        const inverted = resolveRange(parse('range=custom&from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z'));
        expect(inverted.until.getTime()).toBeGreaterThan(inverted.since.getTime());
        const huge = resolveRange(parse('range=custom&from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z'));
        expect(huge.until.getTime() - huge.since.getTime()).toBe(400 * 86_400_000);
    });

    it('picks histogram buckets that keep bars countable', () => {
        const at = (h: number) => new Date(Date.UTC(2026, 0, 1) + h * 3_600_000);
        expect(bucketSeconds(at(0), at(1))).toBe(60);
        expect(bucketSeconds(at(0), at(24))).toBe(900);
        expect(bucketSeconds(at(0), at(24 * 7))).toBe(3 * 3600);
        expect(bucketSeconds(at(0), at(24 * 90))).toBe(86_400);
    });

    it('adds, moves and removes values', () => {
        let q = withValue(DEFAULT_QUERY, 'platform', 'ios', 'in');
        expect(q.dims.platform).toEqual({ in: ['ios'], out: [] });
        q = withValue(q, 'platform', 'ios', 'out');
        expect(q.dims.platform).toEqual({ in: [], out: ['ios'] });
        q = withValue(q, 'platform', 'android', 'only');
        expect(q.dims.platform).toEqual({ in: ['android'], out: [] });
        q = withoutValue(q, 'platform', 'android');
        expect(q.dims.platform).toBeUndefined();
    });

    it('labels tokens for chips', () => {
        expect(valueLabel('action', '@failure')).toBe('Failures (all)');
        expect(valueLabel('action', 'set')).toBe('Bundle installed');
        expect(valueLabel('result', '@blocked')).toBe('Blocked by a guard (all)');
        expect(valueLabel('version', '~')).toBe('(none)');
    });
});
