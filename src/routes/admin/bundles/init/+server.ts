import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import * as v from 'valibot';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { createDb } from '$lib/server/db/index.js';
import { apps, bundles } from '$lib/server/db/schema.js';
import { isValidSemver } from '$lib/server/semver.js';
import { presignPut } from '$lib/server/r2.js';
import { BundleInitSchema } from '$lib/server/validation/admin.js';

const UPLOAD_TTL_SECONDS = 900; // 15 min

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);

	const body = await request.json().catch(() => null);
	const parsed = v.safeParse(BundleInitSchema, body);
	if (!parsed.success) {
		throw error(400, parsed.issues.map((i) => i.message).join('; '));
	}
	const input = parsed.output;

	if (!isValidSemver(input.version)) {
		throw error(400, `version is not valid semver: ${input.version}`);
	}

	const channel = input.channel ?? 'production';
	const platforms = input.platforms ?? ['ios', 'android'];
	const r2Key = `${input.app_id}/${input.version}/${nanoid(10)}.zip`;

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const [app] = await handle.db.select().from(apps).where(eq(apps.id, input.app_id)).limit(1);
		if (!app) throw error(404, `Unknown app_id: ${input.app_id}`);

		const [existing] = await handle.db
			.select({ id: bundles.id, state: bundles.state })
			.from(bundles)
			.where(
				and(
					eq(bundles.appId, input.app_id),
					eq(bundles.channel, channel),
					eq(bundles.version, input.version)
				)
			)
			.limit(1);
		if (existing) {
			throw error(
				409,
				`bundle already exists for (${input.app_id}, ${channel}, ${input.version}) — id=${existing.id}, state=${existing.state}`
			);
		}

		const [inserted] = await handle.db
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

		const uploadUrl = await presignPut(platform.env, r2Key, UPLOAD_TTL_SECONDS);
		const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString();

		return json({
			bundle_id: inserted.id,
			r2_key: r2Key,
			upload_url: uploadUrl,
			expires_at: expiresAt
		});
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
