import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth.js';
import { createDb } from '$lib/server/db/index.js';
import { bundles } from '$lib/server/db/schema.js';
import { deleteObject, sha256Hex } from '$lib/server/r2.js';
import { BundleCommitSchema } from '$lib/server/validation/admin.js';

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);

	const body = await request.json().catch(() => null);
	const parsed = v.safeParse(BundleCommitSchema, body);
	if (!parsed.success) {
		throw error(400, parsed.issues.map((i) => i.message).join('; '));
	}
	const { bundle_id, checksum, activate } = parsed.output;
	const expected = checksum.toLowerCase();

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const [bundle] = await handle.db
			.select()
			.from(bundles)
			.where(eq(bundles.id, bundle_id))
			.limit(1);
		if (!bundle) throw error(404, `bundle_id ${bundle_id} not found`);
		if (bundle.state !== 'pending') {
			throw error(409, `bundle_id ${bundle_id} is in state '${bundle.state}', not 'pending'`);
		}

		// Verify the uploaded object. Client-supplied checksum is untrusted until
		// we compute the same hash server-side over the stored bytes.
		let actual: string;
		try {
			actual = await sha256Hex(platform.env, bundle.r2Key);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw error(400, `failed to read uploaded object: ${message}`);
		}

		if (actual !== expected) {
			await deleteObject(platform.env, bundle.r2Key).catch(() => {});
			await handle.db
				.update(bundles)
				.set({ state: 'failed' })
				.where(eq(bundles.id, bundle_id));
			throw error(400, `checksum mismatch: client=${expected} server=${actual}`);
		}

		// Commit. If caller asks to activate, atomically deactivate siblings in
		// the same (app_id, channel) so only one bundle ever resolves.
		const updated = await handle.db.transaction(async (tx) => {
			if (activate) {
				await tx
					.update(bundles)
					.set({ active: false })
					.where(
						and(
							eq(bundles.appId, bundle.appId),
							eq(bundles.channel, bundle.channel),
							ne(bundles.id, bundle_id)
						)
					);
			}
			const [row] = await tx
				.update(bundles)
				.set({
					state: 'active',
					checksum: actual,
					active: activate ?? false,
					releasedAt: sql`now()`
				})
				.where(eq(bundles.id, bundle_id))
				.returning();
			return row;
		});

		return json(updated);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
