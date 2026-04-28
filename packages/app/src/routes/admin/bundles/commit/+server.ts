import { defineRoute } from '$lib/server/defineRoute.js';
import { BundleCommitSchema } from '$lib/server/validation/admin.js';
import { BundleSchema } from '$lib/server/validation/entities.js';
import { commitBundle } from '$lib/server/services/bundles.js';

export const POST = defineRoute(
    {
        auth: 'publisher',
        body: BundleCommitSchema,
        response: BundleSchema,
        meta: {
            operationId: 'commitBundle',
            summary: 'Verify the uploaded bundle and commit it',
            description:
                'Verifies the uploaded R2 object against the client-supplied checksum (re-hashed server-side). On match, transitions state=active; on mismatch, deletes the R2 object and sets state=failed.',
            tags: ['admin']
        },
        examples: {
            body: {
                bundle_id: 42,
                checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                activate: true
            }
        }
    },
    async ({ body, db, platform }) => commitBundle(db, platform.env, body)
);
