import * as v from 'valibot';

// Reverse-domain `com.example.notes` style.
// Mirror of capgo-backend/.../utils/utils.ts:16 (reverseDomainRegex).
const REVERSE_DOMAIN = /^[a-z0-9]+(\.[\w-]+)+$/i;

// UUID (lowercased-or-uppercased hex, dashed). Mirror of
// capgo-backend/.../utils/utils.ts:21 (deviceIdRegex).
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UpdatesRequestSchema = v.pipe(
    v.object({
        app_id: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(128),
            v.regex(REVERSE_DOMAIN),
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
        version_name: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(128),
            v.description('Semver currently running on the device.'),
            v.examples(['1.4.1'])
        ),
        version_build: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(128),
            v.description('Native build identifier (CFBundleVersion / versionCode).'),
            v.examples(['104'])
        ),
        is_emulator: v.pipe(v.boolean(), v.description('True when running in a simulator/emulator.')),
        is_prod: v.pipe(v.boolean(), v.description('True when the app was built in release mode.')),
        platform: v.pipe(
            v.picklist(['ios', 'android', 'electron'] as const),
            v.description('Target platform.'),
            v.examples(['ios'])
        ),
        plugin_version: v.pipe(
            v.string(),
            v.minLength(1),
            v.description('Version of @capgo/capacitor-updater on the device.'),
            v.examples(['6.3.0'])
        ),
        defaultChannel: v.optional(
            v.pipe(
                v.string(),
                v.description('Override the channel the device reads from (defaults to "production").'),
                v.examples(['production'])
            )
        ),
        key_id: v.optional(v.pipe(v.string(), v.maxLength(20)))
    }),
    v.title('UpdatesRequest'),
    v.description('Body of POST /updates, sent on every app launch by the capacitor-updater plugin.')
);

export type UpdatesRequest = v.InferOutput<typeof UpdatesRequestSchema>;
