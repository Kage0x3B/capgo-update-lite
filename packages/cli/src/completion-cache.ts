/**
 * Tiny on-disk cache for shell-completion data.
 *
 * TAB time is performance-sensitive: any user-visible delay above ~150 ms
 * makes completions feel laggy. We can't synchronously hit the server every
 * time, so we cache `/admin/apps` and per-app bundle lists with a 5-minute
 * TTL and explicitly invalidate after writes (see commands/{apps,bundles,
 * publish}.ts).
 *
 * Every operation is best-effort:
 *   - read: miss returns null (so the caller falls back to a fresh fetch)
 *   - write: errors swallowed (worst case = next TAB pays the network cost)
 *   - invalidate: errors swallowed (worst case = stale completions for a few minutes)
 *
 * Cache root: $XDG_CACHE_HOME/capgo-update-lite/ when set, else
 * ~/.cache/capgo-update-lite/. Tests override the root via XDG_CACHE_HOME
 * pointed at a tmpdir.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { fetchedAt: number; data: T };

function cacheDir(): string {
    if (process.env.XDG_CACHE_HOME) {
        return path.join(process.env.XDG_CACHE_HOME, 'capgo-update-lite');
    }
    return path.join(os.homedir(), '.cache', 'capgo-update-lite');
}

function cachePath(name: string): string {
    return path.join(cacheDir(), `${name}.json`);
}

/**
 * Returns cached data when present and within `ttlMs` of `fetchedAt`.
 * Returns null on miss, expiry, IO error, or malformed JSON.
 */
export async function readCache<T>(name: string, ttlMs: number = DEFAULT_TTL_MS): Promise<T | null> {
    let raw: string;
    try {
        raw = await readFile(cachePath(name), 'utf8');
    } catch {
        return null;
    }
    let entry: CacheEntry<T>;
    try {
        entry = JSON.parse(raw) as CacheEntry<T>;
    } catch {
        return null;
    }
    if (typeof entry?.fetchedAt !== 'number') return null;
    if (Date.now() - entry.fetchedAt > ttlMs) return null;
    return entry.data;
}

export async function writeCache<T>(name: string, data: T): Promise<void> {
    try {
        await mkdir(cacheDir(), { recursive: true });
        const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
        await writeFile(cachePath(name), JSON.stringify(entry));
    } catch {
        // best-effort
    }
}

/** Idempotent — succeeds silently when the file is already gone. */
export async function invalidate(name: string): Promise<void> {
    try {
        await unlink(cachePath(name));
    } catch {
        // best-effort
    }
}

/**
 * Drops every cache file whose basename starts with `prefix` (e.g.
 * `'bundles-'`). Used by writes that change bundle state but don't carry
 * enough scope info to target a specific (appId, channel) cache key.
 */
export async function invalidateMatching(prefix: string): Promise<void> {
    const dir = cacheDir();
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return;
    }
    await Promise.all(
        entries
            .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
            .map((name) => unlink(path.join(dir, name)).catch(() => {}))
    );
}
