import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { createDb, type Db } from '$lib/server/db/index.js';
import type { R2Env } from '$lib/server/r2.js';

type RemoteContext = {
    env: App.Platform['env'];
    r2: R2Env;
    waitUntil: App.Platform['ctx']['waitUntil'];
};

function ctx(): RemoteContext {
    const event = getRequestEvent();
    const platform = event.platform;
    if (!platform) throw error(500, 'platform bindings missing');
    return {
        env: platform.env,
        r2: platform.env,
        waitUntil: (p) => platform.ctx.waitUntil(p)
    };
}

export function platformEnv(): App.Platform['env'] {
    return ctx().env;
}

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const { env, waitUntil } = ctx();
    const handle = createDb(env.HYPERDRIVE);
    try {
        return await fn(handle.db);
    } finally {
        waitUntil(handle.close());
    }
}
