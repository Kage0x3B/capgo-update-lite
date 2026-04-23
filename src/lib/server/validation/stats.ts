import * as v from 'valibot';
import { ALLOWED_STATS_ACTIONS } from '$lib/util/statsActions.js';

const REVERSE_DOMAIN = /^[a-z0-9]+(\.[\w-]+)+$/i;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Re-export so existing consumers don't need to change their import path.
// Single source of truth lives in `$lib/util/statsActions.ts` (client-safe).
export { ALLOWED_STATS_ACTIONS };

export const StatsEventSchema = v.pipe(
    v.object({
        app_id: v.pipe(
            v.string(),
            v.regex(REVERSE_DOMAIN),
            v.maxLength(128),
            v.description('Reverse-domain app identifier.'),
            v.examples(['com.example.notes'])
        ),
        device_id: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(36),
            v.regex(DEVICE_ID),
            v.description('Device UUID (lowercased server-side).'),
            v.examples(['8b1c7b5c-1b2a-4f0b-9a74-3e3d6ad2d2fa'])
        ),
        platform: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(32),
            v.description('Target platform.'),
            v.examples(['ios'])
        ),
        version_name: v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.examples(['1.4.2'])),
        old_version_name: v.optional(v.pipe(v.string(), v.maxLength(128))),
        version_os: v.pipe(v.string(), v.maxLength(64), v.description('OS version string.')),
        version_code: v.optional(v.pipe(v.string(), v.maxLength(64))),
        version_build: v.optional(v.pipe(v.string(), v.maxLength(64))),
        action: v.optional(
            v.pipe(
                v.picklist(ALLOWED_STATS_ACTIONS),
                v.description('Event name — must match the Capgo plugin action list.'),
                v.examples(['set'])
            )
        ),
        custom_id: v.optional(v.pipe(v.string(), v.maxLength(36))),
        channel: v.optional(v.pipe(v.string(), v.maxLength(64))),
        defaultChannel: v.optional(v.pipe(v.string(), v.maxLength(64))),
        plugin_version: v.optional(v.pipe(v.string(), v.maxLength(32))),
        is_emulator: v.boolean(),
        is_prod: v.boolean(),
        key_id: v.optional(v.pipe(v.string(), v.maxLength(20)))
    }),
    v.title('StatsEventInput'),
    v.description('One telemetry event as sent by the capacitor-updater plugin.')
);

export type StatsEventInput = v.InferOutput<typeof StatsEventSchema>;
