import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { createDb } from '$lib/server/db/index.js';
import { statsEvents, type NewStatsEvent } from '$lib/server/db/schema.js';
import { bres, err200 } from '$lib/server/responses.js';
import { StatsEventSchema, type StatsEventInput } from '$lib/server/validation/stats.js';

/**
 * POST /stats — plugin telemetry. Body is either a single event object or an
 * array of events. Always returns HTTP 200. Mirrors capgo-backend's
 * `plugins/stats.ts` shape.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) return err200('server_misconfigured', 'Platform bindings missing');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return err200('invalid_request', 'Request body is not valid JSON');
	}

	const isArray = Array.isArray(body);
	const items: unknown[] = isArray ? (body as unknown[]) : [body];

	type Parsed = { ok: true; value: StatsEventInput } | { ok: false; message: string };
	const parsed: Parsed[] = items.map((item) => {
		const result = v.safeParse(StatsEventSchema, item);
		if (result.success) return { ok: true, value: result.output };
		return { ok: false, message: result.issues.map((i) => i.message).join('; ') };
	});

	const toInsert: NewStatsEvent[] = [];
	const indexMap: number[] = []; // toInsert[i] came from items[indexMap[i]]
	for (let i = 0; i < parsed.length; i++) {
		const p = parsed[i];
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
		indexMap.push(i);
	}

	if (toInsert.length > 0) {
		const handle = createDb(platform.env.HYPERDRIVE);
		try {
			await handle.db.insert(statsEvents).values(toInsert);
		} finally {
			platform.ctx.waitUntil(handle.close());
		}
	}

	if (!isArray) {
		const only = parsed[0];
		if (!only.ok) return err200('invalid_request', only.message);
		return bres();
	}

	const results = parsed.map((p, i) =>
		p.ok
			? { status: 'ok', index: i }
			: { status: 'error', error: 'invalid_request', message: p.message, index: i }
	);
	return json({ status: 'ok', results }, { status: 200 });
};
