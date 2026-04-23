import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireAdmin } from '$lib/server/auth.js';
import { createDb } from '$lib/server/db/index.js';
import { apps } from '$lib/server/db/schema.js';
import { AppCreateSchema } from '$lib/server/validation/admin.js';

export const GET: RequestHandler = async ({ request, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);
	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const rows = await handle.db.select().from(apps);
		return json(rows);
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) throw error(500, 'Platform bindings missing');
	requireAdmin(request, platform.env);

	const body = await request.json().catch(() => null);
	const parsed = v.safeParse(AppCreateSchema, body);
	if (!parsed.success) {
		throw error(400, parsed.issues.map((i) => i.message).join('; '));
	}

	const handle = createDb(platform.env.HYPERDRIVE);
	try {
		const [row] = await handle.db
			.insert(apps)
			.values({ id: parsed.output.id, name: parsed.output.name })
			.onConflictDoUpdate({
				target: apps.id,
				set: { name: parsed.output.name }
			})
			.returning();
		return json(row, { status: 201 });
	} finally {
		platform.ctx.waitUntil(handle.close());
	}
};
