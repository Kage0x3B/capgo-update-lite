import * as v from 'valibot';

// Strict reverse-domain — what both Apple's CFBundleIdentifier and Android's
// applicationId accept simultaneously. Lowercase letters/digits/underscore/hyphen,
// each segment must start with a letter, ≥2 dot-separated segments. Mirrors
// packages/cli/src/validators.ts → REVERSE_DOMAIN_RE.
const REVERSE_DOMAIN = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;
const PLATFORM = v.pipe(v.picklist(['ios', 'android', 'electron'] as const), v.description('Target platform.'));

const AppIdInput = v.pipe(
    v.string(),
    v.regex(REVERSE_DOMAIN),
    v.maxLength(128),
    v.description('Reverse-domain app identifier.'),
    v.examples(['com.example.notes'])
);
const VersionInput = v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(64),
    v.description('Semantic version (strict semver required).'),
    v.examples(['1.4.2'])
);
const ChannelInput = v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(64),
    v.description('Release channel.'),
    v.examples(['production'])
);
const LinkInput = v.pipe(
    v.string(),
    v.maxLength(2048),
    v.description('Release notes / changelog URL.'),
    v.examples(['https://example.com/notes/1.4.2'])
);
const CommentInput = v.pipe(v.string(), v.maxLength(2048), v.description('Operator-authored note.'));

export const AppCreateSchema = v.object({
    id: AppIdInput,
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.description('Display name.'), v.examples(['Notes']))
});

const NativeBuildInput = v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(64),
    v.description(
        'Minimum native-shell version required to run this bundle. Accepts X[.Y[.Z]] (Apple\'s CFBundleShortVersionString format — "110", "110.0", and "110.0.0" all work). Compared against device.version_build on the matching platform.'
    ),
    v.examples(['1.4.0', '110.0'])
);

const NativePackagesInput = v.pipe(
    v.record(v.string(), v.string()),
    v.description(
        'Fingerprint of native-code dependencies (e.g. @capacitor/app) and their resolved versions at publish time.'
    ),
    v.examples([{ '@capacitor/app': '6.0.0' }])
);

export const BundleInitSchema = v.object({
    app_id: AppIdInput,
    version: VersionInput,
    channel: v.optional(ChannelInput),
    platforms: v.optional(
        v.pipe(
            v.array(PLATFORM),
            v.minLength(1),
            v.description('Platforms this bundle should resolve for.'),
            v.examples([['ios', 'android']])
        )
    ),
    session_key: v.optional(v.pipe(v.string(), v.description('Optional encryption session key.'))),
    link: v.optional(LinkInput),
    comment: v.optional(CommentInput),
    min_android_build: NativeBuildInput,
    min_ios_build: NativeBuildInput,
    native_packages: NativePackagesInput
});

const FailRateInput = v.nullable(
    v.pipe(
        v.number(),
        v.minValue(0),
        v.maxValue(1),
        v.description(
            'Per-app override for a broken-bundle severity threshold (0..1, fraction of unique devices that hit a bundle-integrity failure). null falls back to env / default.'
        )
    )
);

export const AppPatchSchema = v.object({
    disable_auto_update: v.optional(
        v.pipe(
            v.picklist(['none', 'major', 'minor', 'patch'] as const),
            v.description('Upgrade-class ceiling for /updates. "none" disables the guard.')
        )
    ),
    disable_auto_update_under_native: v.optional(
        v.pipe(
            v.boolean(),
            v.description(
                'When true, /updates refuses to serve a bundle whose semver is lower than the device version_build.'
            )
        )
    ),
    min_plugin_version: v.optional(
        v.nullable(
            v.pipe(
                v.string(),
                v.minLength(1),
                v.maxLength(64),
                v.description(
                    'Minimum @capgo/capacitor-updater plugin version the server will serve. Pass null to clear the floor.'
                ),
                v.examples(['6.25.0'])
            )
        )
    ),
    name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.description('Display name.'))),
    fail_min_devices: v.optional(
        v.nullable(
            v.pipe(
                v.number(),
                v.integer(),
                v.minValue(0),
                v.description(
                    'Per-app override for the broken-bundle noise floor: a bundle must have been tried by at least this many unique devices before its fail rate triggers severity classification. 0 disables auto-disable. null falls back to env / default.'
                )
            )
        )
    ),
    fail_warn_rate: v.optional(FailRateInput),
    fail_risk_rate: v.optional(FailRateInput),
    fail_rate_threshold: v.optional(FailRateInput)
});

export const AppIdParamsSchema = v.object({
    id: AppIdInput
});

export const BundleCommitSchema = v.object({
    bundle_id: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(1),
        v.description('ID returned from POST /admin/bundles/init.'),
        v.examples([42])
    ),
    checksum: v.pipe(
        v.string(),
        v.regex(/^[0-9a-f]{64}$/i),
        v.description('Sha256 hex of the uploaded ZIP — re-hashed server-side to verify.'),
        v.examples(['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'])
    ),
    activate: v.optional(
        v.pipe(
            v.boolean(),
            v.description('If true, marks this bundle active. Siblings in (app_id, channel) stay active — guards in /updates pick per device.')
        )
    )
});

const BOOL_STRING = v.pipe(
    v.picklist(['true', 'false'] as const),
    v.transform((s) => s === 'true')
);

export const BundleListQuerySchema = v.object({
    app_id: v.optional(AppIdInput),
    channel: v.optional(ChannelInput),
    state: v.optional(
        v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(32),
            v.description('Lifecycle state filter.'),
            v.examples(['active'])
        )
    ),
    active: v.optional(v.pipe(BOOL_STRING, v.description('Filter by resolvable bundles only.')))
});

export const BundleIdParamsSchema = v.object({
    id: v.pipe(
        v.string(),
        v.regex(/^[1-9][0-9]*$/, 'id must be a positive integer'),
        v.transform(Number),
        v.integer(),
        v.minValue(1),
        v.description('Numeric bundle id.'),
        v.examples([42])
    )
});

export const BundleDeleteQuerySchema = v.object({
    purge: v.optional(
        v.pipe(v.picklist(['1'] as const), v.description('If "1", hard-delete the bundle (R2 object + DB row).'))
    )
});

export const BundlePatchSchema = v.object({
    active: v.optional(
        v.pipe(
            v.boolean(),
            v.description(
                'Set this bundle active or inactive. Siblings in (app_id, channel) are not touched — multiple bundles can be active and the /updates resolver picks per device based on guards.'
            )
        )
    ),
    channel: v.optional(ChannelInput),
    platforms: v.optional(v.pipe(v.array(PLATFORM), v.minLength(1))),
    link: v.optional(v.nullable(LinkInput)),
    comment: v.optional(v.nullable(CommentInput))
});

const ISO_DATE = v.pipe(
    v.string(),
    v.isoTimestamp('must be an ISO-8601 timestamp'),
    v.transform((s) => new Date(s))
);
const INT_STRING = v.pipe(
    v.string(),
    v.regex(/^\d+$/, 'must be a non-negative integer'),
    v.transform(Number),
    v.integer(),
    v.minValue(0)
);

export const StatsListQuerySchema = v.object({
    app_id: v.optional(AppIdInput),
    action: v.optional(
        v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(64),
            v.description('Action name filter.'),
            v.examples(['update'])
        )
    ),
    since: v.optional(v.pipe(ISO_DATE, v.description('Only events received at or after this timestamp.'))),
    until: v.optional(v.pipe(ISO_DATE, v.description('Only events received strictly before.'))),
    limit: v.optional(
        v.pipe(INT_STRING, v.maxValue(1000), v.description('Max rows to return (≤1000).'), v.examples([100]))
    ),
    offset: v.optional(v.pipe(INT_STRING, v.description('Skip rows.')))
});

export const LoginSchema = v.object({
    password: v.pipe(v.string(), v.minLength(1), v.maxLength(512))
});

// --- admin tokens ---------------------------------------------------------

const AdminRoleInput = v.pipe(
    v.picklist(['viewer', 'publisher', 'admin'] as const),
    v.description('Role granted to this token.')
);

export const AdminTokenIdParamsSchema = v.object({
    id: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/), v.transform(Number), v.integer(), v.minValue(1))
});

export const AdminTokenCreateSchema = v.object({
    name: v.pipe(
        v.string(),
        v.minLength(1),
        v.maxLength(100),
        v.description('Human label, shown on the management page.'),
        v.examples(['CI publish'])
    ),
    role: AdminRoleInput
});
