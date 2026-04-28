import { and, desc, eq, isNull } from 'drizzle-orm';
import { ApiError } from '$lib/server/defineRoute.js';
import { adminTokens, type AdminRole, type AdminToken } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';

const TOKEN_BYTE_LEN = 32; // 256 bits → 64-char hex string

/**
 * Generate a cryptographically random plaintext token. Returned to the caller
 * exactly once; only `sha256(plaintext)` is persisted.
 */
function generateTokenPlaintext(): string {
    const buf = new Uint8Array(TOKEN_BYTE_LEN);
    crypto.getRandomValues(buf);
    return bytesToHex(buf);
}

export async function hashToken(plaintext: string): Promise<string> {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(plaintext));
    return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

/**
 * Row shape returned to dashboards / API clients. The plaintext token and
 * its hash are never exposed once stored — only existence + metadata.
 */
export type AdminTokenSummary = Omit<AdminToken, 'tokenHash'> & {
    /** Convenience flag derived from `revokedAt`. */
    revoked: boolean;
};

export async function listTokens(db: Db): Promise<AdminTokenSummary[]> {
    const rows = await db
        .select({
            id: adminTokens.id,
            name: adminTokens.name,
            role: adminTokens.role,
            createdAt: adminTokens.createdAt,
            createdBy: adminTokens.createdBy,
            lastUsedAt: adminTokens.lastUsedAt,
            revokedAt: adminTokens.revokedAt
        })
        .from(adminTokens)
        .orderBy(desc(adminTokens.createdAt));
    return rows.map((r) => ({ ...r, revoked: r.revokedAt !== null }));
}

export interface CreateTokenInput {
    name: string;
    role: AdminRole;
    /** Token id of the creator, or null for the bootstrap super-admin. */
    createdBy: number | null;
}

export interface CreateTokenResult {
    /** The plaintext token. Display once, never stored. */
    plaintext: string;
    summary: AdminTokenSummary;
}

export async function createToken(db: Db, input: CreateTokenInput): Promise<CreateTokenResult> {
    if (!input.name.trim()) {
        throw new ApiError(400, 'invalid_request', 'name must be non-empty');
    }
    const plaintext = generateTokenPlaintext();
    const tokenHash = await hashToken(plaintext);
    const [row] = await db
        .insert(adminTokens)
        .values({
            name: input.name.trim(),
            role: input.role,
            tokenHash,
            createdBy: input.createdBy
        })
        .returning();
    return {
        plaintext,
        summary: {
            id: row.id,
            name: row.name,
            role: row.role,
            createdAt: row.createdAt,
            createdBy: row.createdBy,
            lastUsedAt: row.lastUsedAt,
            revokedAt: row.revokedAt,
            revoked: false
        }
    };
}

/** Soft-revoke. Idempotent — already-revoked rows are returned unchanged. */
export async function revokeToken(db: Db, id: number): Promise<AdminTokenSummary> {
    const [existing] = await db.select().from(adminTokens).where(eq(adminTokens.id, id)).limit(1);
    if (!existing) {
        throw new ApiError(404, 'not_found', `admin token ${id} not found`);
    }
    if (existing.revokedAt !== null) {
        return summaryFromRow(existing);
    }
    const [row] = await db.update(adminTokens).set({ revokedAt: new Date() }).where(eq(adminTokens.id, id)).returning();
    return summaryFromRow(row);
}

/**
 * Look up a token by its hash. Returns null if no row matches or the row is
 * revoked — both must fail-closed at the same point so callers can't tell
 * "wrong token" from "revoked token" via timing.
 */
export async function lookupTokenByHash(db: Db, hash: string): Promise<AdminToken | null> {
    const [row] = await db
        .select()
        .from(adminTokens)
        .where(and(eq(adminTokens.tokenHash, hash), isNull(adminTokens.revokedAt)))
        .limit(1);
    return row ?? null;
}

/** Best-effort `last_used_at` bump. Failures are swallowed by the caller. */
export async function touchTokenUsage(db: Db, id: number): Promise<void> {
    await db.update(adminTokens).set({ lastUsedAt: new Date() }).where(eq(adminTokens.id, id));
}

function summaryFromRow(row: AdminToken): AdminTokenSummary {
    return {
        id: row.id,
        name: row.name,
        role: row.role,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        revoked: row.revokedAt !== null
    };
}
