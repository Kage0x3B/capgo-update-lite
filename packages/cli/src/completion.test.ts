import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from './completion-cache.js';

// loadCompletionConfig is the auth resolver consulted by every dynamic
// handler. We mock it per test so we never touch real env vars / config files.
vi.mock('./config.js', () => ({
    loadCompletionConfig: vi.fn()
}));

// Each test installs its own fetch stub via vi.stubGlobal('fetch', ...).
// Reset between tests so leakage is impossible.

const { loadCompletionConfig } = await import('./config.js');
const {
    completeAppId,
    completeBundleVersion,
    completeChannel,
    completeFromList
} = await import('./completion.js');

let tmp: string;
let originalXdg: string | undefined;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-completion-test-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = tmp;
    vi.mocked(loadCompletionConfig).mockReset();
    vi.unstubAllGlobals();
});

afterEach(async () => {
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
    vi.unstubAllGlobals();
    await rm(tmp, { recursive: true, force: true });
});

function recorder(): { fn: (value: string, description: string) => void; calls: Array<[string, string]> } {
    const calls: Array<[string, string]> = [];
    return {
        fn: (value, description) => {
            calls.push([value, description]);
        },
        calls
    };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' }
    });
}

describe('completeFromList', () => {
    it('emits each value exactly once', () => {
        const r = recorder();
        completeFromList(['ios', 'android', 'electron'])(r.fn);
        expect(r.calls).toEqual([
            ['ios', ''],
            ['android', ''],
            ['electron', '']
        ]);
    });
});

describe('completeAppId', () => {
    it('emits id+name pairs from a fresh fetch', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://ota.example.com',
            adminToken: 'tok'
        });
        const fetchMock = vi.fn(async () =>
            jsonResponse([
                { id: 'com.x', name: 'X' },
                { id: 'com.y', name: 'Y' }
            ])
        );
        vi.stubGlobal('fetch', fetchMock);

        const r = recorder();
        await completeAppId(r.fn);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(r.calls).toEqual([
            ['com.x', 'X'],
            ['com.y', 'Y']
        ]);
    });

    it('reads the cache on a hit and skips the fetch', async () => {
        // Pre-warm the cache via a first run.
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://ota.example.com',
            adminToken: 'tok'
        });
        const fetchMock = vi.fn(async () => jsonResponse([{ id: 'com.cached', name: 'Cached' }]));
        vi.stubGlobal('fetch', fetchMock);
        await completeAppId(recorder().fn);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Second run with a fetch that would throw — proves the cache hit path.
        const failingFetch = vi.fn(async () => {
            throw new Error('should not have been called');
        });
        vi.stubGlobal('fetch', failingFetch);
        const r = recorder();
        await completeAppId(r.fn);
        expect(failingFetch).not.toHaveBeenCalled();
        expect(r.calls).toEqual([['com.cached', 'Cached']]);
    });

    it('is silent when serverUrl is missing', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({ adminToken: 'tok' });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const r = recorder();
        await completeAppId(r.fn);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(r.calls).toEqual([]);
    });

    it('is silent when adminToken is missing', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({ serverUrl: 'https://x' });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const r = recorder();
        await completeAppId(r.fn);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(r.calls).toEqual([]);
    });

    it('is silent on fetch rejection (network error)', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({ serverUrl: 'https://x', adminToken: 't' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('ECONNREFUSED');
            })
        );
        const r = recorder();
        await expect(completeAppId(r.fn)).resolves.toBeUndefined();
        expect(r.calls).toEqual([]);
    });

    it('is silent on a non-2xx response', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({ serverUrl: 'https://x', adminToken: 't' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('forbidden', { status: 403 }))
        );
        const r = recorder();
        await completeAppId(r.fn);
        expect(r.calls).toEqual([]);
    });

    it('is silent on AbortError (timeout)', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({ serverUrl: 'https://x', adminToken: 't' });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            })
        );
        const r = recorder();
        await expect(completeAppId(r.fn)).resolves.toBeUndefined();
        expect(r.calls).toEqual([]);
    });
});

describe('completeChannel', () => {
    it('returns silent when no appId can be resolved', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://x',
            adminToken: 't'
        });
        const r = recorder();
        await completeChannel(r.fn);
        expect(r.calls).toEqual([]);
    });

    it('emits distinct channels seen across that app\'s bundles', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://x',
            adminToken: 't',
            appId: 'com.x'
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse([
                    { id: 1, version: '1.0.0', state: 'active', active: true, channel: 'production' },
                    { id: 2, version: '1.0.1', state: 'active', active: true, channel: 'staging' },
                    { id: 3, version: '0.9.0', state: 'active', active: false, channel: 'production' }
                ])
            )
        );
        const r = recorder();
        await completeChannel(r.fn);
        expect(r.calls.map(([v]) => v).sort()).toEqual(['production', 'staging']);
    });
});

describe('completeBundleVersion', () => {
    it('returns silent when no appId can be resolved', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://x',
            adminToken: 't'
        });
        const r = recorder();
        await completeBundleVersion(r.fn);
        expect(r.calls).toEqual([]);
    });

    it('emits version + #id description for state=active rows only', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://x',
            adminToken: 't',
            appId: 'com.x',
            channel: 'production'
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse([
                    { id: 1, version: '1.0.0', state: 'active', active: true, channel: 'production' },
                    { id: 2, version: '1.0.1', state: 'pending', active: false, channel: 'production' },
                    { id: 3, version: '1.1.0', state: 'active', active: false, channel: 'production' }
                ])
            )
        );
        const r = recorder();
        await completeBundleVersion(r.fn);
        expect(r.calls).toEqual([
            ['1.0.0', '#1'],
            ['1.1.0', '#3']
        ]);
    });

    it('defaults the channel to "production" when not configured', async () => {
        vi.mocked(loadCompletionConfig).mockResolvedValue({
            serverUrl: 'https://x',
            adminToken: 't',
            appId: 'com.x'
        });
        const fetchMock = vi.fn(async () => jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);
        await completeBundleVersion(recorder().fn);
        const firstCall = fetchMock.mock.calls[0] as unknown as [string];
        expect(firstCall?.[0]).toContain('channel=production');
    });
});

// Cache write/read paths share state with completeAppId; clean up between
// tests by invalidating the keys we touched.
afterEach(async () => {
    await invalidate('apps');
});
