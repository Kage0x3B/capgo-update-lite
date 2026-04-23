import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildOpenApi } from '$lib/server/openapi/generate.js';
import pkg from '../../../package.json' with { type: 'json' };

export const GET: RequestHandler = ({ url }) => {
    const doc = buildOpenApi({
        title: 'capgo-update-lite',
        version: pkg.version,
        description:
            'OTA update server for @capgo/capacitor-updater. Admin endpoints use Bearer auth; plugin endpoints (`/updates`, `/stats`) always return HTTP 200 with an error envelope, because any non-200 response is treated as a network failure by the native plugin.',
        contact: { name: 'capgo-update-lite' },
        license: { name: 'MIT' },
        servers: [
            { url: url.origin, description: 'Current host' },
            { url: 'https://ota.example.com', description: 'Production' }
        ],
        tags: [
            {
                name: 'plugin',
                description: 'Endpoints called by the capacitor-updater plugin on device. Always return HTTP 200.'
            },
            {
                name: 'admin',
                description:
                    'Operator endpoints for managing apps and bundles. Require `Authorization: Bearer <ADMIN_TOKEN>`.'
            },
            {
                name: 'ops',
                description: 'Operational endpoints — health checks and similar probes.'
            }
        ],
        externalDocs: {
            url: '/docs',
            description: 'Interactive API reference (Scalar).'
        }
    });
    return json(doc);
};
