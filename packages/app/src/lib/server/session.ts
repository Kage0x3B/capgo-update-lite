import { isAdminRole, type AdminRole } from './roles.js';

export const SESSION_COOKIE = 'capgo_admin_session';
const SESSION_PAYLOAD_PREFIX = 'admin.session.v2.';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type SessionCookieOptions = {
    path: '/';
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    maxAge: number;
};

const baseOptions = (secure: boolean): SessionCookieOptions => ({
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: MAX_AGE_SECONDS
});

export interface VerifiedSession {
    role: AdminRole;
}

/**
 * Sign a fresh session cookie. The role is part of the signed payload so we
 * can authorise dashboard requests without hitting the DB on every navigation.
 *
 * Format: `<exp>.<role>.<hmac>` where hmac covers `prefix + exp + '.' + role`.
 *
 * Note: revoking a DB-backed admin_tokens row does NOT invalidate live
 * sessions issued from it — the session HMAC is keyed by PRIVATE_ADMIN_TOKEN,
 * not by the user's token. Rotate PRIVATE_ADMIN_TOKEN to force a global logout.
 */
export async function issueSession(
    adminToken: string,
    role: AdminRole,
    opts: { secure?: boolean } = {}
): Promise<{ value: string; options: SessionCookieOptions }> {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
    const data = `${exp}.${role}`;
    const hmac = await hmacHex(adminToken, SESSION_PAYLOAD_PREFIX + data);
    return {
        value: `${data}.${hmac}`,
        options: baseOptions(opts.secure ?? true)
    };
}

/** Returns the verified payload iff the cookie signature is valid and not expired. */
export async function verifySession(value: string | undefined, adminToken: string): Promise<VerifiedSession | null> {
    if (!value) return null;
    const parts = value.split('.');
    if (parts.length !== 3) return null;
    const [expStr, role, mac] = parts;
    if (!isAdminRole(role)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    const expected = await hmacHex(adminToken, SESSION_PAYLOAD_PREFIX + `${expStr}.${role}`);
    if (!timingSafeEqualHex(mac, expected)) return null;
    return { role };
}

/** Cookie attributes for clearing — call via `cookies.delete(SESSION_COOKIE, { path: '/' })` or `cookies.set('', { maxAge: 0 })`. */
export function clearSessionOptions(secure = true): SessionCookieOptions & { maxAge: 0 } {
    return { ...baseOptions(secure), maxAge: 0 };
}

async function hmacHex(key: string, data: string): Promise<string> {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign'
    ]);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
    return toHex(new Uint8Array(sig));
}

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
}
