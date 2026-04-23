import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq, ne } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { createDb } from '$lib/server/db/index.js';
import { bundles } from '$lib/server/db/schema.js';
import { deleteObject } from '$lib/server/r2.js';
import { BundlePatchSchema } from '$lib/server/validation/admin.js';

function parseId(raw: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1) throw error(400, `invalid bundle id: ${raw}`);
	return n;
}

export const PATCH: RequestHandler = async ({ request, params, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);
	const id = parseId(params.id);

	const body = await request.json().catch(() => null);
	const parsed = v.safeParse(BundlePatchSchema, body);
	if (!parsed.success) {
		throw error(400, parsed.issues.map((i) => i.message).join('; '));
	}
	const patch = parsed.output;

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const [current] = await handle.db
			.select()
			.from(bundles)
			.where(eq(bundles.id, id))
			.limit(1);
		if (!current) throw error(404, `bundle ${id} not found`);

		if (patch.active === true && current.state !== 'active') {
			throw error(409, `cannot activate bundle ${id}: state is '${current.state}'`);
		}

		const updated = await handle.db.transaction(async (tx) => {
			if (patch.active === true) {
				await tx
					.update(bundles)
					.set({ active: false })
					.where(
						and(
							eq(bundles.appId, current.appId),
							eq(bundles.channel, patch.channel ?? current.channel),
							ne(bundles.id, id)
						)
					);
			}
			const set: Partial<typeof bundles.$inferInsert> = {};
			if (patch.active !== undefined) set.active = patch.active;
			if (patch.channel !== undefined) set.channel = patch.channel;
			if (patch.platforms !== undefined) set.platforms = patch.platforms;
			if (patch.link !== undefined) set.link = patch.link;
			if (patch.comment !== undefined) set.comment = patch.comment;
			if (Object.keys(set).length === 0) return current;

			const [row] = await tx.update(bundles).set(set).where(eq(bundles.id, id)).returning();
			return row;
		});

		return json(updated);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};

export const DELETE: RequestHandler = async ({ request, params, url, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);
	const id = parseId(params.id);
	const purge = url.searchParams.get('purge') === '1';

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const [current] = await handle.db
			.select()
			.from(bundles)
			.where(eq(bundles.id, id))
			.limit(1);
		if (!current) throw error(404, `bundle ${id} not found`);

		if (purge) {
			await deleteObject(platform.env, current.r2Key).catch(() => {});
			await handle.db.delete(bundles).where(eq(bundles.id, id));
			return json({ deleted: id, purged: true });
		}

		const [row] = await handle.db
			.update(bundles)
			.set({ active: false, state: 'failed' })
			.where(eq(bundles.id, id))
			.returning();
		return json(row);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
