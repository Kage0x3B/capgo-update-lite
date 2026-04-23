import * as v from 'valibot';

// Reverse-domain `com.example.app` style.
// Mirror of capgo-backend/.../utils/utils.ts:16 (reverseDomainRegex).
const REVERSE_DOMAIN = /^[a-z0-9]+(\.[\w-]+)+$/i;

// UUID (lowercased-or-uppercased hex, dashed). Mirror of
// capgo-backend/.../utils/utils.ts:21 (deviceIdRegex).
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UpdatesRequestSchema = v.object({
	app_id: v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.regex(REVERSE_DOMAIN)),
	device_id: v.pipe(v.string(), v.minLength(1), v.maxLength(36), v.regex(DEVICE_ID)),
	version_name: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	version_build: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	is_emulator: v.boolean(),
	is_prod: v.boolean(),
	platform: v.picklist(['ios', 'android', 'electron'] as const),
	plugin_version: v.pipe(v.string(), v.minLength(1)),
	defaultChannel: v.optional(v.string()),
	key_id: v.optional(v.pipe(v.string(), v.maxLength(20)))
});

export type UpdatesRequest = v.InferOutput<typeof UpdatesRequestSchema>;
