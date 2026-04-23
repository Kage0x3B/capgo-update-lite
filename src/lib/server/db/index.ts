import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export type DbHandle = {
    db: Db;
    close: () => Promise<void>;
};

/**
 * Create a Drizzle client backed by postgres.js, connected through Cloudflare
 * Hyperdrive. Caller must `close()` when the request finishes — idiomatic call:
 *   platform.context.waitUntil(handle.close());
 */
export function createDb(hyperdrive: Hyperdrive): DbHandle {
    const client: Sql = postgres(hyperdrive.connectionString, {
        max: 5,
        fetch_types: false
    });
    return {
        db: drizzle(client, { schema }),
        close: () => client.end({ timeout: 5 })
    };
}

export { schema };
