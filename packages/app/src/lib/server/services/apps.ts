import { eq } from 'drizzle-orm';
import { ApiError } from '$lib/server/defineRoute.js';
import { apps, type App } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';
import { isValidSemver } from '$lib/server/semver.js';

export async function listApps(db: Db): Promise<App[]> {
    return db.select().from(apps);
}

export async function upsertApp(db: Db, input: { id: string; name: string }): Promise<App> {
    const [row] = await db
        .insert(apps)
        .values({ id: input.id, name: input.name })
        .onConflictDoUpdate({ target: apps.id, set: { name: input.name } })
        .returning();
    return row;
}

export async function getApp(db: Db, id: string): Promise<App> {
    const [row] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
    if (!row) throw new ApiError(404, 'not_found', `Unknown app_id: ${id}`);
    return row;
}

export type PatchAppInput = {
    name?: string;
    disable_auto_update?: 'none' | 'major' | 'minor' | 'patch';
    disable_auto_update_under_native?: boolean;
    min_plugin_version?: string | null;
};

export async function patchApp(db: Db, id: string, patch: PatchAppInput): Promise<App> {
    if (
        patch.min_plugin_version !== undefined &&
        patch.min_plugin_version !== null &&
        !isValidSemver(patch.min_plugin_version)
    ) {
        throw new ApiError(
            400,
            'invalid_request',
            `min_plugin_version is not valid semver: ${patch.min_plugin_version}`
        );
    }

    await getApp(db, id);

    const set: Partial<typeof apps.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.disable_auto_update !== undefined) set.disableAutoUpdate = patch.disable_auto_update;
    if (patch.disable_auto_update_under_native !== undefined) {
        set.disableAutoUpdateUnderNative = patch.disable_auto_update_under_native;
    }
    if (patch.min_plugin_version !== undefined) set.minPluginVersion = patch.min_plugin_version;
    if (Object.keys(set).length === 0) return getApp(db, id);

    const [row] = await db.update(apps).set(set).where(eq(apps.id, id)).returning();
    return row;
}
