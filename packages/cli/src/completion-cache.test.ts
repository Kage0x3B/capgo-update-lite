import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_TTL_MS,
    invalidate,
    invalidateMatching,
    readCache,
    writeCache
} from './completion-cache.js';

let tmp: string;
let originalXdg: string | undefined;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-completion-cache-test-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    // Redirect the cache to an isolated tmpdir for the duration of each test.
    process.env.XDG_CACHE_HOME = tmp;
});

afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
    await rm(tmp, { recursive: true, force: true });
});

describe('writeCache + readCache', () => {
    it('round-trips a payload', async () => {
        await writeCache('apps', [{ id: 'com.x', name: 'X' }]);
        const got = await readCache<Array<{ id: string; name: string }>>('apps');
        expect(got).toEqual([{ id: 'com.x', name: 'X' }]);
    });

    it('returns null on a fresh cache miss', async () => {
        expect(await readCache('apps')).toBeNull();
    });

    it('returns null when the entry is older than the TTL', async () => {
        // Write a payload, then hand-craft an expired wrapper directly.
        const dir = path.join(tmp, 'capgo-update-lite');
        const file = path.join(dir, 'apps.json');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(dir, { recursive: true });
        await writeFile(
            file,
            JSON.stringify({ fetchedAt: Date.now() - DEFAULT_TTL_MS - 1000, data: [{ id: 'old' }] })
        );
        expect(await readCache('apps')).toBeNull();
    });

    it('returns null on malformed JSON', async () => {
        const dir = path.join(tmp, 'capgo-update-lite');
        const file = path.join(dir, 'apps.json');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(dir, { recursive: true });
        await writeFile(file, '{not json');
        expect(await readCache('apps')).toBeNull();
    });

    it('returns null when the entry has no fetchedAt timestamp', async () => {
        const dir = path.join(tmp, 'capgo-update-lite');
        const file = path.join(dir, 'apps.json');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(dir, { recursive: true });
        await writeFile(file, JSON.stringify({ data: [] }));
        expect(await readCache('apps')).toBeNull();
    });
});

describe('invalidate', () => {
    it('removes a written entry', async () => {
        await writeCache('apps', [{ id: 'com.x' }]);
        await invalidate('apps');
        expect(await readCache('apps')).toBeNull();
    });

    it('is idempotent on a missing file', async () => {
        await expect(invalidate('does-not-exist')).resolves.toBeUndefined();
    });
});

describe('invalidateMatching', () => {
    it('removes only files whose basename starts with the prefix', async () => {
        await writeCache('apps', [{ id: 'com.x' }]);
        await writeCache('bundles-com.x-production', [{ id: 1 }]);
        await writeCache('bundles-com.x-staging', [{ id: 2 }]);
        await invalidateMatching('bundles-');
        expect(await readCache('apps')).not.toBeNull();
        expect(await readCache('bundles-com.x-production')).toBeNull();
        expect(await readCache('bundles-com.x-staging')).toBeNull();
        // Confirm via a directory listing too.
        const dir = path.join(tmp, 'capgo-update-lite');
        const left = await readdir(dir);
        expect(left).toEqual(['apps.json']);
    });

    it('is a no-op when the cache directory does not exist', async () => {
        await expect(invalidateMatching('bundles-')).resolves.toBeUndefined();
    });
});
