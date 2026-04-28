import type { AdminRole } from './db/schema.js';

export type { AdminRole };

/**
 * Role rank. Higher = more privileged.
 *
 *  - viewer    → read-only dashboard + GET admin endpoints
 *  - publisher → viewer + bundle CRUD (publish, edit, delete, promote, reactivate)
 *  - admin     → full access: app CRUD, per-app policy, token management
 *
 * `meetsRole(actual, required)` is the only check that matters at route guards;
 * the rest of the codebase should treat roles as opaque strings.
 */
export const ROLE_RANK: Record<AdminRole, number> = {
    viewer: 1,
    publisher: 2,
    admin: 3
};

/** True iff `actual` is at least as privileged as `required`. */
export function meetsRole(actual: AdminRole, required: AdminRole): boolean {
    return ROLE_RANK[actual] >= ROLE_RANK[required];
}

const ROLE_VALUES: readonly AdminRole[] = ['viewer', 'publisher', 'admin'];

export function isAdminRole(value: unknown): value is AdminRole {
    return typeof value === 'string' && (ROLE_VALUES as readonly string[]).includes(value);
}

/**
 * Resolved-bearer / resolved-session shape used across the request lifecycle.
 * `tokenId` is null for the build-time `PRIVATE_ADMIN_TOKEN` (super-admin) and
 * for sessions issued via that token; otherwise it's the admin_tokens row id.
 */
export interface ResolvedAuth {
    role: AdminRole;
    tokenId: number | null;
}
