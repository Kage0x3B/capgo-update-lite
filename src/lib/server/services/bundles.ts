import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ApiError } from '$lib/server/defineRoute.js';
import { apps, bundles, type Bundle } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { isValidSemver } from '$lib/server/semver.js';
import { deleteObject, presignPut, sha256Hex, type R2Env } from '$lib/server/r2.js';

const UPLOAD_TTL_SECONDS = 900; // 15 min

export type BundleListFilters = {
    app_id?: string;
    channel?: string;
    state?: string;
    active?: boolean;
};

export async function listBundles(db: Db, filters: BundleListFilters): Promise<Bundle[]> {
    const where = [
        filters.app_id ? eq(bundles.appId, filters.app_id) : undefined,
        filters.channel ? eq(bundles.channel, filters.channel) : undefined,
        filters.state ? eq(bundles.state, filters.state) : undefined,
        filters.active !== undefined ? eq(bundles.active, filters.active) : undefined
    ].filter((x): x is Exclude<typeof x, undefined> => x !== undefined);

    return db
        .select()
        .from(bundles)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(bundles.createdAt));
}

export async function getBundle(db: Db, id: number): Promise<Bundle> {
    const [row] = await db.select().from(bundles).where(eq(bundles.id, id)).limit(1);
    if (!row) throw new ApiError(404, 'not_found', `bundle ${id} not found`);
    return row;
}

export type InitBundleInput = {
    app_id: string;
    version: string;
    channel?: string;
    platforms?: string[];
    session_key?: string;
    link?: string;
    comment?: string;
};

export type InitBundleResult = {
    bundle_id: number;
    r2_key: string;
    upload_url: string;
    expires_at: string;
};

export async function initBundle(db: Db, env: R2Env, input: InitBundleInput): Promise<InitBundleResult> {
    if (!isValidSemver(input.version)) {
        throw new ApiError(400, 'invalid_request', `version is not valid semver: ${input.version}`);
    }

    const channel = input.channel ?? 'production';
    const platforms = input.platforms ?? ['ios', 'android'];
    const r2Key = `${input.app_id}/${input.version}/${nanoid(10)}.zip`;

    const [app] = await db.select().from(apps).where(eq(apps.id, input.app_id)).limit(1);
    if (!app) throw new ApiError(404, 'not_found', `Unknown app_id: ${input.app_id}`);

    const [existing] = await db
        .select({ id: bundles.id, state: bundles.state })
        .from(bundles)
        .where(and(eq(bundles.appId, input.app_id), eq(bundles.channel, channel), eq(bundles.version, input.version)))
        .limit(1);
    if (existing) {
        throw new ApiError(
            409,
            'conflict',
            `bundle already exists for (${input.app_id}, ${channel}, ${input.version}) — id=${existing.id}, state=${existing.state}`
        );
    }

    const [inserted] = await db
        .insert(bundles)
        .values({
            appId: input.app_id,
            channel,
            version: input.version,
            platforms,
            r2Key,
            sessionKey: input.session_key ?? '',
            link: input.link ?? null,
            comment: input.comment ?? null,
            state: 'pending',
            active: false
        })
        .returning();

    const uploadUrl = await presignPut(env, r2Key, UPLOAD_TTL_SECONDS);
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString();

    return {
        bundle_id: inserted.id,
        r2_key: r2Key,
        upload_url: uploadUrl,
        expires_at: expiresAt
    };
}

export type CommitBundleInput = {
    bundle_id: number;
    checksum: string;
    activate?: boolean;
};

export async function commitBundle(db: Db, env: R2Env, input: CommitBundleInput): Promise<Bundle> {
    const { bundle_id, activate } = input;
    const expected = input.checksum.toLowerCase();

    const bundle = await getBundle(db, bundle_id);
    if (bundle.state !== 'pending') {
        throw new ApiError(409, 'conflict', `bundle_id ${bundle_id} is in state '${bundle.state}', not 'pending'`);
    }

    let actual: string;
    try {
        actual = await sha256Hex(env, bundle.r2Key);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new ApiError(400, 'invalid_request', `failed to read uploaded object: ${message}`);
    }

    if (actual !== expected) {
        await deleteObject(env, bundle.r2Key).catch(() => {});
        await db.update(bundles).set({ state: 'failed' }).where(eq(bundles.id, bundle_id));
        throw new ApiError(400, 'invalid_request', `checksum mismatch: client=${expected} server=${actual}`);
    }

    return db.transaction(async (tx) => {
        if (activate) {
            await tx
                .update(bundles)
                .set({ active: false })
                .where(
                    and(eq(bundles.appId, bundle.appId), eq(bundles.channel, bundle.channel), ne(bundles.id, bundle_id))
                );
        }
        const [row] = await tx
            .update(bundles)
            .set({
                state: 'active',
                checksum: actual,
                active: activate ?? false,
                releasedAt: sql`now()`
            })
            .where(eq(bundles.id, bundle_id))
            .returning();
        return row;
    });
}

export type PatchBundleInput = {
    active?: boolean;
    channel?: string;
    platforms?: string[];
    link?: string | null;
    comment?: string | null;
};

export async function patchBundle(db: Db, id: number, patch: PatchBundleInput): Promise<Bundle> {
    const current = await getBundle(db, id);

    if (patch.active === true && current.state !== 'active') {
        throw new ApiError(409, 'conflict', `cannot activate bundle ${id}: state is '${current.state}'`);
    }

    return db.transaction(async (tx) => {
        if (patch.active === true) {
            await tx
                .update(bundles)
                .set({ active: false })
                .where(
                    and(
                        eq(bundles.appId, current.appId),
                        eq(bundles.channel, patch.channel ?? current.channel),
                        ne(bundles.id, id)
                    )
                );
        }
        const set: Partial<typeof bundles.$inferInsert> = {};
        if (patch.active !== undefined) set.active = patch.active;
        if (patch.channel !== undefined) set.channel = patch.channel;
        if (patch.platforms !== undefined) set.platforms = patch.platforms;
        if (patch.link !== undefined) set.link = patch.link;
        if (patch.comment !== undefined) set.comment = patch.comment;
        if (Object.keys(set).length === 0) return current;

        const [row] = await tx.update(bundles).set(set).where(eq(bundles.id, id)).returning();
        return row;
    });
}

export type DeleteBundleResult = Bundle | { deleted: number; purged: true };

export async function deleteBundle(db: Db, env: R2Env, id: number, purge: boolean): Promise<DeleteBundleResult> {
    const current = await getBundle(db, id);

    if (purge) {
        await deleteObject(env, current.r2Key).catch(() => {});
        await db.delete(bundles).where(eq(bundles.id, id));
        return { deleted: id, purged: true as const };
    }

    const [row] = await db
        .update(bundles)
        .set({ active: false, state: 'failed' })
        .where(eq(bundles.id, id))
        .returning();
    return row;
}
