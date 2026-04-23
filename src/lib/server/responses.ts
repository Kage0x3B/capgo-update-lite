import { json } from '@sveltejs/kit';
import type { Bundle } from './db/schema.js';

/**
 * All plugin-facing endpoints must return HTTP 200 even for business-logic
 * errors. Any 4xx/5xx is treated by the native plugin as a network failure
 * and triggers rollback. Mirror of Capgo's `simpleError200` (see
 * capgo-backend/supabase/functions/_backend/utils/hono.ts:282).
 */
export function err200(code: string, message: string, extra: Record<string, unknown> = {}): Response {
    return json({ error: code, message, ...extra }, { status: 200 });
}

/** Canonical `{ status: 'ok' }` success payload. */
export function bres(extra: Record<string, unknown> = {}): Response {
    return json({ status: 'ok', ...extra }, { status: 200 });
}

/**
 * Builds the "update available" response shape expected by the client plugin.
 * Wire names are snake_case — the native bridge transforms to camelCase on
 * the device side (verified in CapgoUpdater.java:1283-1284).
 *
 * Mirrors `resToVersion` in capgo-backend/.../utils/update.ts:26.
 */
export function resToVersion(bundle: Bundle, url: string): Response {
    const body: Record<string, unknown> = {
        version: bundle.version,
        url,
        session_key: bundle.sessionKey ?? '',
        checksum: bundle.checksum
    };
    if (bundle.link) body.link = bundle.link;
    if (bundle.comment) body.comment = bundle.comment;
    return json(body, { status: 200 });
}
