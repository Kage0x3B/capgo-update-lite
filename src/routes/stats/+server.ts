import * as v from 'valibot';
import { defineRoute } from '$lib/server/defineRoute.js';
import { statsEvents, type NewStatsEvent } from '$lib/server/db/schema.js';
import { bres, err200 } from '$lib/server/responses.js';
import { StatsEventSchema, type StatsEventInput } from '$lib/server/validation/stats.js';
import { StatsResponseSchema, STATS_ERROR_CODES } from '$lib/server/validation/entities.js';

/**
 * POST /stats — plugin telemetry. Body is either a single event object or an
 * array of events. Always returns HTTP 200. Mirrors capgo-backend's
 * `plugins/stats.ts` shape.
 *
 * Per-item validation is partial-success tolerant: bad items become per-index
 * error entries in the batch response rather than rejecting the whole batch.
 * That's why the body schema is `v.unknown()` — the wrapper just hands us
 * the parsed JSON and we validate each item manually.
 */
export const POST = defineRoute(
    {
        auth: 'none',
        body: v.unknown(),
        response: StatsResponseSchema,
        errorMode: 'err200',
        errorCodes: STATS_ERROR_CODES,
        meta: {
            operationId: 'ingestStats',
            summary: 'Ingest one or more plugin telemetry events',
            description:
                'Accepts either a single StatsEvent object or an array. Partial-success tolerant: per-item validation errors become per-index entries in the response.',
            tags: ['plugin']
        }
    },
    async ({ body, db }) => {
        const isArray = Array.isArray(body);
        const items: unknown[] = isArray ? (body as unknown[]) : [body];

        type Parsed = { ok: true; value: StatsEventInput } | { ok: false; message: string };
        const parsed: Parsed[] = items.map((item) => {
            const result = v.safeParse(StatsEventSchema, item);
            if (result.success) return { ok: true, value: result.output };
            return { ok: false, message: result.issues.map((i) => i.message).join('; ') };
        });

        const toInsert: NewStatsEvent[] = [];
        for (const p of parsed) {
            if (!p.ok) continue;
            const ev = p.value;
            toInsert.push({
                appId: ev.app_id,
                deviceId: ev.device_id.toLowerCase(),
                action: ev.action ?? null,
                versionName: ev.version_name,
                oldVersionName: ev.old_version_name ?? null,
                platform: ev.platform,
                pluginVersion: ev.plugin_version ?? null,
                isEmulator: ev.is_emulator,
                isProd: ev.is_prod
            });
        }

        if (toInsert.length > 0) {
            await db.insert(statsEvents).values(toInsert);
        }

        if (!isArray) {
            const only = parsed[0];
            if (!only.ok) return err200('invalid_request', only.message);
            return bres();
        }

        const results = parsed.map((p, i) =>
            p.ok
                ? { status: 'ok' as const, index: i }
                : {
                      status: 'error' as const,
                      error: 'invalid_request',
                      message: p.message,
                      index: i
                  }
        );
        return { status: 'ok' as const, results };
    }
);
