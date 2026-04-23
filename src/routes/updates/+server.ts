import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { and, eq, sql } from 'drizzle-orm';
import { createDb } from '$lib/server/db/index.js';
import { bundles } from '$lib/server/db/schema.js';
import { err200, resToVersion } from '$lib/server/responses.js';
import { isNewer, isValidSemver } from '$lib/server/semver.js';
import { presignGet } from '$lib/server/r2.js';
import { UpdatesRequestSchema } from '$lib/server/validation/updates.js';

/**
 * POST /updates — called by @capgo/capacitor-updater on every app launch.
 *
 * Every response is HTTP 200. Any 4xx/5xx would be treated by the native
 * plugin as a network failure and trigger rollback — see handoff §4
 * and the `err200` helper in responses.ts.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) {
		return err200('server_misconfigured', 'Platform bindings missing');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return err200('invalid_request', 'Request body is not valid JSON');
	}

	const parsed = v.safeParse(UpdatesRequestSchema, body);
	if (!parsed.success) {
		const message = parsed.issues.map((issue) => issue.message).join('; ');
		return err200('invalid_request', message);
	}
	const req = parsed.output;

	if (!isValidSemver(req.plugin_version)) {
		return err200(
			'unsupported_plugin_version',
			`plugin_version is not valid semver: ${req.plugin_version}`
		);
	}

	// device_id is lowercased server-side before any DB I/O — parity with
	// capgo-backend/.../plugins/stats.ts:186-195 so that mixed-case IDs don't
	// appear as duplicates across endpoints.
	const deviceId = req.device_id.toLowerCase();
	void deviceId; // referenced by /stats; no DB write on /updates itself yet

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const rows = await handle.db
			.select()
			.from(bundles)
			.where(
				and(
					eq(bundles.appId, req.app_id),
					eq(bundles.channel, req.defaultChannel ?? 'production'),
					eq(bundles.active, true),
					eq(bundles.state, 'active'),
					sql`${req.platform} = ANY(${bundles.platforms})`
				)
			)
			.orderBy(sql`${bundles.releasedAt} DESC NULLS LAST`)
			.limit(1);

		const bundle = rows[0];
		if (!bundle) {
			return err200('no_bundle', 'Cannot get bundle');
		}

		let shouldUpdate: boolean;
		try {
			shouldUpdate = isNewer(bundle.version, req.version_name);
		} catch (e) {
			return err200('semver_error', e instanceof Error ? e.message : 'semver error');
		}

		if (!shouldUpdate) {
			return err200('no_new_version_available', 'No new version available');
		}

		if (!bundle.r2Key) {
			return err200('no_bundle_url', 'Cannot get bundle url');
		}

		const url = await presignGet(platform.env, bundle.r2Key);
		return resToVersion(bundle, url);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
