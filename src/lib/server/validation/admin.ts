import * as v from 'valibot';

const REVERSE_DOMAIN = /^[a-z0-9]+(\.[\w-]+)+$/i;
const PLATFORM = v.picklist(['ios', 'android', 'electron'] as const);

export const AppCreateSchema = v.object({
	id: v.pipe(v.string(), v.regex(REVERSE_DOMAIN), v.maxLength(128)),
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(256))
});

export const BundleInitSchema = v.object({
	app_id: v.pipe(v.string(), v.regex(REVERSE_DOMAIN), v.maxLength(128)),
	version: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	channel: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
	platforms: v.optional(v.pipe(v.array(PLATFORM), v.minLength(1))),
	session_key: v.optional(v.string()),
	link: v.optional(v.pipe(v.string(), v.maxLength(2048))),
	comment: v.optional(v.pipe(v.string(), v.maxLength(2048)))
});

export const BundleCommitSchema = v.object({
	bundle_id: v.pipe(v.number(), v.integer(), v.minValue(1)),
	checksum: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)),
	activate: v.optional(v.boolean())
});

export const BundlePatchSchema = v.object({
	active: v.optional(v.boolean()),
	channel: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
	platforms: v.optional(v.pipe(v.array(PLATFORM), v.minLength(1))),
	link: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2048)))),
	comment: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2048))))
});
