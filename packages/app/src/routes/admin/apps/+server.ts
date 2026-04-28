import { defineRoute } from '$lib/server/defineRoute.js';
import { AppCreateSchema } from '$lib/server/validation/admin.js';
import { AppListResponseSchema, AppSchema } from '$lib/server/validation/entities.js';
import { listApps, upsertApp } from '$lib/server/services/apps.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        response: AppListResponseSchema,
        meta: {
            operationId: 'listApps',
            summary: 'List apps',
            tags: ['admin']
        }
    },
    async ({ db }) => listApps(db)
);

export const POST = defineRoute(
    {
        auth: 'admin',
        body: AppCreateSchema,
        response: AppSchema,
        successStatus: 201,
        meta: {
            operationId: 'upsertApp',
            summary: 'Create or rename an app',
            description: 'Inserts a new app or updates the name of an existing one (upsert on id).',
            tags: ['admin']
        },
        examples: {
            body: { id: 'com.example.notes', name: 'Notes' }
        }
    },
    async ({ body, db }) => upsertApp(db, body)
);
