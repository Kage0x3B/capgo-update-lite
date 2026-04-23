export const SESSION_COOKIE = 'capgo_admin_session';
const SESSION_PAYLOAD_PREFIX = 'admin.session.v1.';
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

/** Sign a fresh session cookie. Caller stores the returned value via `cookies.set(SESSION_COOKIE, ...)`. */
export async function issueSession(
    adminToken: string,
    opts: { secure?: boolean } = {}
): Promise<{ value: string; options: SessionCookieOptions }> {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
    const hmac = await hmacHex(adminToken, SESSION_PAYLOAD_PREFIX + exp);
    return {
        value: `${exp}.${hmac}`,
        options: baseOptions(opts.secure ?? true)
    };
}

/** Returns true iff the cookie signature is valid and has not expired. */
export async function verifySession(value: string | undefined, adminToken: string): Promise<boolean> {
    if (!value) return false;
    const dot = value.indexOf('.');
    if (dot <= 0) return false;
    const expStr = value.slice(0, dot);
    const mac = value.slice(dot + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
    const expected = await hmacHex(adminToken, SESSION_PAYLOAD_PREFIX + exp);
    return timingSafeEqualHex(mac, expected);
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
