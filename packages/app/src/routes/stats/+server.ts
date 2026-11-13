import * as v from 'valibot';
import { defineRoute } from '$lib/server/defineRoute.js';
import { and, inArray, isNull } from 'drizzle-orm';
import { apps, statsEvents, type NewStatsEvent } from '$lib/server/db/schema.js';
import { countryOf } from '$lib/server/services/updateChecks.js';
import { bres, err200 } from '$lib/server/responses.js';
import { StatsEventSchema, type StatsEventInput } from '$lib/server/validation/stats.js';
import { StatsResponseSchema, STATS_ERROR_CODES } from '$lib/server/validation/entities.js';
import { BUNDLE_BREAKING_ACTIONS } from '$lib/server/services/analytics.js';
import { evaluateBundleHealth, type BundleHealthEnv } from '$lib/server/services/bundleHealth.js';

const BUNDLE_BREAKING_SET: ReadonlySet<string> = new Set(BUNDLE_BREAKING_ACTIONS);

// The plugin flushes its queue in small batches; anything far larger is not
// a real device.
const MAX_BATCH = 200;

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
                'Accepts either a single StatsEvent object or an array of at most 200. Partial-success tolerant: per-item validation errors become per-index entries in the response. Events for unregistered app ids are acknowledged but not stored.',
            tags: ['plugin']
        }
    },
    async ({ body, db, platform, defer }) => {
        const isArray = Array.isArray(body);
        const items: unknown[] = isArray ? (body as unknown[]) : [body];
        if (items.length > MAX_BATCH) {
            return err200('invalid_request', `Batch too large: ${items.length} events (max ${MAX_BATCH})`);
        }

        type Parsed = { ok: true; value: StatsEventInput } | { ok: false; message: string };
        const parsed: Parsed[] = items.map((item) => {
            const result = v.safeParse(StatsEventSchema, item);
            if (result.success) return { ok: true, value: result.output };
            return { ok: false, message: result.issues.map((i) => i.message).join('; ') };
        });

        // Only keep events for registered, not deleted apps, so anonymous callers can't
        // fill stats_events with junk app ids. One indexed lookup per batch.
        const appIds = [...new Set(parsed.flatMap((p) => (p.ok ? [p.value.app_id] : [])))];
        const known = new Set(
            appIds.length === 0
                ? []
                : (
                      await db
                          .select({ id: apps.id })
                          .from(apps)
                          .where(and(inArray(apps.id, appIds), isNull(apps.deletedAt)))
                  ).map((r) => r.id)
        );
        const country = countryOf(platform);

        const toInsert: NewStatsEvent[] = [];
        for (const p of parsed) {
            if (!p.ok || !known.has(p.value.app_id)) continue;
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
                isProd: ev.is_prod,
                versionBuild: ev.version_build ?? null,
                versionCode: ev.version_code ?? null,
                versionOs: ev.version_os || null,
                channel: ev.channel ?? ev.defaultChannel ?? null,
                customId: ev.custom_id ?? null,
                country
            });
        }

        if (toInsert.length > 0) {
            await db.insert(statsEvents).values(toInsert);

            // Broken-bundle protection: for each unique (app, version) where we
            // just recorded a bundle-integrity failure, re-evaluate the bundle's
            // unique-device fail rate and auto-disable if it crossed threshold.
            // See services/bundleHealth.ts for the full resolution rule.
            const breaking = new Map<string, { appId: string; versionName: string }>();
            for (const ev of toInsert) {
                if (!ev.action || !ev.versionName) continue;
                if (!BUNDLE_BREAKING_SET.has(ev.action)) continue;
                if (ev.versionName === 'builtin' || ev.versionName === 'unknown') continue;
                breaking.set(`${ev.appId}\u0000${ev.versionName}`, {
                    appId: ev.appId,
                    versionName: ev.versionName
                });
            }
            if (breaking.size > 0) {
                // Off the hot path: re-evaluating bundle health requires another
                // Postgres round-trip per (app, version) pair and isn't needed to
                // ack the device. defer() runs it past the response but before
                // the lazy DB connection closes (defineRoute chains close() on it).
                const env = platform.env as unknown as BundleHealthEnv;
                defer(
                    Promise.all(
                        [...breaking.values()].map((p) =>
                            evaluateBundleHealth({ db, env, appId: p.appId, versionName: p.versionName })
                        )
                    )
                );
            }
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
