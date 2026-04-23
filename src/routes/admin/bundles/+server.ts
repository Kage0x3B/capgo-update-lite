import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { createDb } from '$lib/server/db/index.js';
import { bundles } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);

	const appId = url.searchParams.get('app_id');
	const channel = url.searchParams.get('channel');
	const state = url.searchParams.get('state');
	const activeParam = url.searchParams.get('active');

	const filters = [
		appId ? eq(bundles.appId, appId) : undefined,
		channel ? eq(bundles.channel, channel) : undefined,
		state ? eq(bundles.state, state) : undefined,
		activeParam === 'true' || activeParam === 'false'
			? eq(bundles.active, activeParam === 'true')
			: undefined
	].filter((x): x is Exclude<typeof x, undefined> => x !== undefined);

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const rows = await handle.db
			.select()
			.from(bundles)
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(desc(bundles.createdAt));
		return json(rows);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
