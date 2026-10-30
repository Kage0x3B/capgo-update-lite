import { eq } from 'drizzle-orm';
import { apps, updateChecks, type NewUpdateCheck } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';

/** `result` value for checks that served a bundle. Every other value is an err200 code. */
export const UPDATE_SERVED = 'update';

const MAX_DETAIL = 500;
const MAX_FIELD = 128;

function str(v: unknown, max = MAX_FIELD): string | null {
    if (typeof v !== 'string' || v.length === 0) return null;
    return v.slice(0, max);
}

function bool(v: unknown): boolean | null {
    return typeof v === 'boolean' ? v : null;
}

/** Two-letter country from Cloudflare's request metadata, if present. */
export function countryOf(platform: { cf?: unknown } | undefined): string | null {
    const c = (platform?.cf as { country?: unknown } | undefined)?.country;
    return typeof c === 'string' && c.length <= 3 ? c : null;
}

/**
 * Device context shared by valid and refused requests. Reads loosely from the
 * raw body so a request that failed validation can still be attributed to an
 * app and device.
 */
export function deviceContext(raw: unknown): Omit<NewUpdateCheck, 'result' | 'appId' | 'deviceId'> & {
    appId: string | null;
    deviceId: string | null;
} {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
        appId: str(b.app_id),
        deviceId: str(b.device_id, 64)?.toLowerCase() ?? null,
        platform: str(b.platform, 32),
        channel: str(b.defaultChannel, 64) ?? 'production',
        versionName: str(b.version_name),
        versionBuild: str(b.version_build),
        versionCode: str(b.version_code, 64),
        versionOs: str(b.version_os, 64),
        pluginVersion: str(b.plugin_version, 32),
        customId: str(b.custom_id, 36),
        isEmulator: bool(b.is_emulator),
        isProd: bool(b.is_prod)
    };
}

export type UpdateCheckOutcome = {
    result: string;
    detail?: string | null;
    candidates?: number | null;
    bundleId?: number | null;
    bundleVersion?: string | null;
};

/**
 * Persist one /updates call. Never throws: logging must not change what the
 * device gets back. Requests without an app_id or device_id, or for an app
 * that isn't registered, are dropped so anonymous callers can't fill the table.
 * Pass `appKnown` when the caller already confirmed the app exists.
 */
export async function recordUpdateCheck(
    db: Db,
    raw: unknown,
    country: string | null,
    outcome: UpdateCheckOutcome,
    appKnown = false
): Promise<void> {
    const ctx = deviceContext(raw);
    if (!ctx.appId || !ctx.deviceId) return;
    try {
        if (!appKnown) {
            const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.id, ctx.appId)).limit(1);
            if (!app) return;
        }
        await db.insert(updateChecks).values({
            ...ctx,
            appId: ctx.appId,
            deviceId: ctx.deviceId,
            country,
            result: outcome.result,
            detail: outcome.detail ? outcome.detail.slice(0, MAX_DETAIL) : null,
            candidates: outcome.candidates ?? null,
            bundleId: outcome.bundleId ?? null,
            bundleVersion: outcome.bundleVersion ?? null
        });
    } catch (e) {
        console.error('[updates] failed to record update check', e);
    }
}
