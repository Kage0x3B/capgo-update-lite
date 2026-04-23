/**
 * Response types mirror packages/app/src/lib/server/validation/entities.ts.
 * Dates arrive over JSON as ISO strings, not Date objects.
 */

import { fail } from './output.js';

export type Platform = 'ios' | 'android' | 'electron';
export const PLATFORMS: readonly Platform[] = ['ios', 'android', 'electron'] as const;

export type AppRow = {
    id: string;
    name: string;
    createdAt: string;
};

export type BundleRow = {
    id: number;
    appId: string;
    channel: string;
    version: string;
    platforms: string[];
    r2Key: string;
    checksum: string;
    sessionKey: string;
    link: string | null;
    comment: string | null;
    active: boolean;
    state: string;
    releasedAt: string | null;
    createdAt: string;
};

export type StatsEventRow = {
    id: string;
    receivedAt: string;
    appId: string;
    deviceId: string;
    action: string | null;
    versionName: string | null;
    oldVersionName: string | null;
    platform: string | null;
    pluginVersion: string | null;
    isEmulator: boolean | null;
    isProd: boolean | null;
};

export type BundleInitResponse = {
    bundle_id: number;
    r2_key: string;
    upload_url: string;
    expires_at: string;
};

export type BundlePurgeResponse = { deleted: number; purged: true };

export type UpdateAvailable = {
    version: string;
    url: string;
    session_key: string;
    checksum: string;
    link?: string;
    comment?: string;
};

export type PluginError = { error: string; message: string };
export type UpdatesResponse = UpdateAvailable | PluginError;

// --- client -----------------------------------------------------------------

export type ApiContext = {
    serverUrl: string;
    adminToken?: string;
};

export type ApiResult<T> =
    | { ok: true; status: number; data: T }
    | { ok: false; status: number; body: string };

function headers(ctx: ApiContext): Record<string, string> {
    return {
        'content-type': 'application/json',
        ...(ctx.adminToken ? { authorization: `Bearer ${ctx.adminToken}` } : {})
    };
}

/** Fetch + parse JSON. Exits on non-2xx. Use apiCall when you need to branch on status. */
export async function apiJson<T>(ctx: ApiContext, method: string, p: string, body?: unknown): Promise<T> {
    const res = await fetch(`${ctx.serverUrl}${p}`, {
        method,
        headers: headers(ctx),
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) fail(`${method} ${p} → ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

/** Same as apiJson but returns a discriminated result so callers can react to specific status codes. */
export async function apiCall<T>(ctx: ApiContext, method: string, p: string, body?: unknown): Promise<ApiResult<T>> {
    const res = await fetch(`${ctx.serverUrl}${p}`, {
        method,
        headers: headers(ctx),
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text };
    return {
        ok: true,
        status: res.status,
        data: text ? (JSON.parse(text) as T) : (undefined as unknown as T)
    };
}
