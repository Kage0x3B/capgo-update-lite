import { eq } from 'drizzle-orm';
import { ApiError } from '$lib/server/defineRoute.js';
import { apps, type App } from '$lib/server/db/schema.js';
import type { Db } from '$lib/server/db/index.js';

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
