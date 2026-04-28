import { defineRoute } from '$lib/server/defineRoute.js';
import { AppNeedingAttentionListSchema } from '$lib/server/validation/entities.js';
import { appsNeedingAttention, type BundleHealthEnv } from '$lib/server/services/bundleHealth.js';

export const GET = defineRoute(
    {
        auth: 'viewer',
        response: AppNeedingAttentionListSchema,
        meta: {
            operationId: 'listAppsNeedingAttention',
            summary: 'Cross-app bundle-health summary',
            description:
                'Lists apps that have at least one non-healthy / non-manually-disabled bundle, with severity counts. Most-urgent apps first.',
            tags: ['admin']
        }
    },
    async ({ db, platform }) => appsNeedingAttention(db, platform.env as unknown as BundleHealthEnv)
);
