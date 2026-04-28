import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleInitSchema } from '$lib/server/validation/admin.js';
import { BundleInitResponseSchema } from '$lib/server/validation/entities.js';
import { initBundle } from '$lib/server/services/bundles.js';

export const POST = defineRoute(
    {
        auth: 'publisher',
        body: BundleInitSchema,
        response: BundleInitResponseSchema,
        meta: {
            operationId: 'initBundle',
            summary: 'Reserve a bundle slot and get a presigned upload URL',
            description:
                'Creates a `pending` bundle row and returns a presigned R2 PUT URL valid for 15 minutes. Follow up with POST /admin/bundles/commit after the upload finishes.',
            tags: ['admin']
        },
        examples: {
            body: {
                app_id: 'com.example.notes',
                version: '1.4.2',
                channel: 'production',
                platforms: ['ios', 'android'],
                link: 'https://example.com/notes/1.4.2',
                comment: 'Fixes crash on empty note save.',
                min_android_build: '1.4.0',
                min_ios_build: '1.4.0',
                native_packages: { '@capacitor/app': '6.0.0' }
            },
            response: {
                bundle_id: 42,
                r2_key: 'com.example.notes/1.4.2/abc123nano.zip',
                upload_url: 'https://<acct>.r2.cloudflarestorage.com/bundles/…?X-Amz-Signature=…',
                expires_at: '2026-04-23T15:12:00.000Z'
            }
        }
    },
    async ({ body, db, platform }) => initBundle(db, platform.env, body)
);
