import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';
import { defineRoute } from '$lib/server/defineRoute.js';
import { ping as pingR2 } from '$lib/server/r2.js';
// Inlined at build time by Vite — keeps the runtime free of any FS access.
import { version as SERVER_VERSION } from '../../../package.json';

const HealthCheckSchema = v.pipe(
    v.object({
        name: v.pipe(v.string(), v.description('Name of the dependency probed.')),
        ok: v.pipe(v.boolean(), v.description('Whether the probe succeeded.')),
        durationMs: v.pipe(v.number(), v.description('Wall-clock duration of the probe.')),
        error: v.optional(v.pipe(v.string(), v.description('Error message when `ok` is false. Omitted on success.')))
    }),
    v.title('HealthCheck')
);

const HealthResponseSchema = v.pipe(
    v.object({
        status: v.pipe(
            v.picklist(['ok', 'degraded'] as const),
            v.description('`ok` when every check passed, `degraded` when any failed.')
        ),
        version: v.pipe(
            v.string(),
            v.description(
                'Server build version (semver). Clients can compare against their own minimum compatible version.'
            )
        ),
        checks: v.array(HealthCheckSchema)
    }),
    v.title('HealthResponse'),
    v.description(
        'Aggregated health probe results. Always returned with HTTP 200 — inspect `status` and the per-check entries.'
    )
);

type CheckResult = v.InferOutput<typeof HealthCheckSchema>;

async function runCheck(name: string, fn: () => Promise<void>): Promise<CheckResult> {
    const start = Date.now();
    try {
        await fn();
        return { name, ok: true, durationMs: Date.now() - start };
    } catch (e) {
        return {
            name,
            ok: false,
            durationMs: Date.now() - start,
            error: e instanceof Error ? e.message : String(e)
        };
    }
}

export const GET = defineRoute(
    {
        auth: 'none',
        response: HealthResponseSchema,
        meta: {
            operationId: 'health',
            summary: 'Health check',
            description:
                'Probes the database (Hyperdrive/Postgres) and R2 bucket. Returns HTTP 200 only when every check passes; 503 otherwise. Body always carries the per-dependency results.',
            tags: ['ops']
        }
    },
    async ({ platform, db }) => {
        const [dbCheck, r2Check] = await Promise.all([
            runCheck('database', async () => {
                await db.execute(sql`select 1`);
            }),
            runCheck('r2', () => pingR2(platform.env))
        ]);

        const checks = [dbCheck, r2Check];
        const healthy = checks.every((c) => c.ok);
        return json(
            {
                status: healthy ? ('ok' as const) : ('degraded' as const),
                version: SERVER_VERSION,
                checks
            },
            { status: healthy ? 200 : 503 }
        );
    }
);
