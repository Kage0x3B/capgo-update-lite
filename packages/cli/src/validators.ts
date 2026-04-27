/**
 * Client-side input validators that mirror the server's valibot schemas in
 * packages/app/src/lib/server/validation/*. Catching bad input here turns a
 * round-trip 400 into an immediate, actionable error message.
 */

/**
 * Reverse-domain app identifier. Capacitor accepts hyphens in segments (the
 * scaffold often produces `com.example.my-app` from a hyphenated npm name)
 * even though strict Android applicationId rules don't, so we allow them
 * here. The server's REVERSE_DOMAIN regex is the canonical contract.
 *
 *   - Lowercase letters, digits, underscores, hyphens. No uppercase.
 *   - Each segment must start with a letter.
 *   - At least two dot-separated segments (e.g. `com.example.app`).
 *
 * Mirrors packages/app/src/lib/server/validation/admin.ts → REVERSE_DOMAIN.
 */
const REVERSE_DOMAIN_RE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

// Mirrors packages/app/src/lib/server/validation/updates.ts → DEVICE_ID.
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the BundleIdParamsSchema regex on the server.
const BUNDLE_ID_RE = /^[1-9][0-9]*$/;

export const APP_ID_FORMAT_HINT =
    'reverse-domain, lowercase letters/digits/underscore/hyphen, each segment starts with a letter (e.g. com.example.app)';

export function isReverseDomainAppId(s: string): boolean {
    return REVERSE_DOMAIN_RE.test(s) && s.length <= 128;
}

/**
 * Validate-or-return-error helper: returns a string error message when `s`
 * isn't a valid appId, otherwise null. The message is suitable both for
 * clack's `validate` callback (returning string aborts the prompt with that
 * message) and for the `fail()` path in non-interactive flows.
 */
export function appIdError(s: string | undefined | null): string | null {
    const v = (s ?? '').trim();
    if (!v) return 'app-id is required';
    if (v.length > 128) return 'app-id is too long (max 128 chars)';
    if (!REVERSE_DOMAIN_RE.test(v)) return `invalid app-id "${v}" — ${APP_ID_FORMAT_HINT}`;
    return null;
}

export function isUuidLike(s: string): boolean {
    return DEVICE_ID_RE.test(s);
}

export function isCanonicalBundleId(s: string): boolean {
    return BUNDLE_ID_RE.test(s);
}
