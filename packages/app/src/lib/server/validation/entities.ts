import * as v from 'valibot';

/**
 * Shared entity/response schemas.
 *
 * Two jobs in one module:
 *   1. Runtime: mirror Drizzle row types so handlers returning from `.select()`
 *      / `.returning()` type-check against `response: EntitySchema`.
 *   2. Docs: carry `v.title / v.description / v.examples` metadata that the
 *      OpenAPI generator materialises into `components.schemas` and reuses
 *      via `$ref`.
 */

// --- reusable field-level schemas -------------------------------------------

export const AppIdField = v.pipe(
    v.string(),
    v.description('Reverse-domain app identifier.'),
    v.examples(['com.example.notes'])
);

export const VersionField = v.pipe(v.string(), v.description('Semantic version string.'), v.examples(['1.4.2']));

export const ChannelField = v.pipe(
    v.string(),
    v.description('Release channel. Devices only receive bundles whose channel matches their `defaultChannel`.'),
    v.examples(['production'])
);

export const PlatformField = v.pipe(
    v.picklist(['ios', 'android', 'electron'] as const),
    v.description('Target platform.'),
    v.examples(['ios'])
);

export const DeviceIdField = v.pipe(
    v.string(),
    v.description('Device UUID, lowercased server-side.'),
    v.examples(['8b1c7b5c-1b2a-4f0b-9a74-3e3d6ad2d2fa'])
);

// --- entities ---------------------------------------------------------------

export const DisableAutoUpdateField = v.pipe(
    v.picklist(['none', 'major', 'minor', 'patch'] as const),
    v.description(
        'Upgrade-class ceiling. Bundles that would cause an upgrade at or above this class are withheld from /updates. "none" disables the guard.'
    ),
    v.examples(['none'])
);

export const AppSchema = v.pipe(
    v.object({
        id: AppIdField,
        name: v.pipe(v.string(), v.description('Display name.'), v.examples(['Notes'])),
        disableAutoUpdate: DisableAutoUpdateField,
        disableAutoUpdateUnderNative: v.pipe(
            v.boolean(),
            v.description(
                'When true, /updates refuses to serve a bundle whose semver is lower than the device version_build.'
            )
        ),
        minPluginVersion: v.nullable(
            v.pipe(
                v.string(),
                v.description(
                    'Minimum @capgo/capacitor-updater plugin version the server will serve. Null disables the floor.'
                ),
                v.examples(['6.25.0'])
            )
        ),
        failMinDevices: v.nullable(
            v.pipe(
                v.number(),
                v.description(
                    'Per-app override for the noise floor: a bundle must have been tried by at least this many unique devices before its fail rate triggers severity classification. Null falls back to env / default.'
                ),
                v.examples([10])
            )
        ),
        failWarnRate: v.nullable(
            v.pipe(
                v.number(),
                v.description('Per-app override for the warn-severity threshold (0..1). Null falls back to default.'),
                v.examples([0.2])
            )
        ),
        failRiskRate: v.nullable(
            v.pipe(
                v.number(),
                v.description('Per-app override for the at-risk-severity threshold (0..1). Null falls back to default.'),
                v.examples([0.35])
            )
        ),
        failRateThreshold: v.nullable(
            v.pipe(
                v.number(),
                v.description(
                    'Per-app override for the auto-disable threshold (0..1). Null falls back to default. 0 disables auto-disable for this app.'
                ),
                v.examples([0.5])
            )
        ),
        createdAt: v.date()
    }),
    v.title('App'),
    v.description('A registered mobile app.')
);
export type AppResponse = v.InferOutput<typeof AppSchema>;

export const BundleSchema = v.pipe(
    v.object({
        id: v.pipe(v.number(), v.description('Server-assigned bundle id.')),
        appId: AppIdField,
        channel: ChannelField,
        version: VersionField,
        platforms: v.pipe(
            v.array(v.string()),
            v.description('Platforms this bundle is eligible for.'),
            v.examples([['ios', 'android']])
        ),
        r2Key: v.pipe(v.string(), v.description('Object key of the uploaded ZIP in R2.')),
        checksum: v.pipe(
            v.string(),
            v.description('Lowercase sha256 hex digest of the uploaded ZIP (empty while pending).')
        ),
        sessionKey: v.pipe(v.string(), v.description('Optional encryption session key — empty string when none.')),
        link: v.nullable(v.pipe(v.string(), v.description('Release notes / changelog URL.'))),
        comment: v.nullable(v.pipe(v.string(), v.description('Operator-authored note.'))),
        minAndroidBuild: v.pipe(
            v.string(),
            v.description(
                'Minimum native Android versionName required to receive this bundle. Compared against device.version_build on platform=android.'
            ),
            v.examples(['1.4.0'])
        ),
        minIosBuild: v.pipe(
            v.string(),
            v.description(
                'Minimum native iOS CFBundleShortVersionString required to receive this bundle. Compared against device.version_build on platform=ios.'
            ),
            v.examples(['1.4.0'])
        ),
        nativePackages: v.pipe(
            v.record(v.string(), v.string()),
            v.description(
                "Fingerprint of native-code dependencies (e.g. @capacitor/app) with resolved versions at publish time. Drives the CLI's --auto-min-update-build decision."
            ),
            v.examples([{ '@capacitor/app': '6.0.0', '@capacitor/haptics': '6.0.0' }])
        ),
        active: v.pipe(v.boolean(), v.description('Whether this bundle currently resolves for its (app_id, channel).')),
        state: v.pipe(
            v.string(),
            v.description('Lifecycle state: `pending` → `active` → `failed`.'),
            v.examples(['active'])
        ),
        releasedAt: v.nullable(v.date()),
        createdAt: v.date()
    }),
    v.title('Bundle'),
    v.description('An OTA bundle row.')
);
export type BundleResponse = v.InferOutput<typeof BundleSchema>;

export const BundleListResponseSchema = v.array(BundleSchema);
export const AppListResponseSchema = v.array(AppSchema);

export const StatsEventSchema = v.pipe(
    v.object({
        id: v.string(),
        receivedAt: v.date(),
        appId: AppIdField,
        deviceId: DeviceIdField,
        action: v.nullable(v.string()),
        versionName: v.nullable(v.string()),
        oldVersionName: v.nullable(v.string()),
        platform: v.nullable(v.string()),
        pluginVersion: v.nullable(v.string()),
        isEmulator: v.nullable(v.boolean()),
        isProd: v.nullable(v.boolean())
    }),
    v.title('StatsEvent'),
    v.description('A single telemetry event as persisted in stats_events.')
);
export type StatsEventResponse = v.InferOutput<typeof StatsEventSchema>;
export const StatsEventListResponseSchema = v.array(StatsEventSchema);

export const BundleInitResponseSchema = v.pipe(
    v.object({
        bundle_id: v.pipe(v.number(), v.description('ID of the reserved bundle row.')),
        r2_key: v.pipe(v.string(), v.description('Object key the client must PUT to.')),
        upload_url: v.pipe(v.string(), v.description('Presigned S3 PUT URL, valid for 15 minutes.')),
        expires_at: v.pipe(
            v.string(),
            v.description('ISO-8601 UTC timestamp when the upload_url stops being accepted.')
        )
    }),
    v.title('BundleInitResponse'),
    v.description('Response to POST /admin/bundles/init.')
);

export const BundleDeleteResponseSchema = v.union([
    BundleSchema,
    v.pipe(
        v.object({
            deleted: v.pipe(v.number(), v.description('ID of the purged bundle.')),
            purged: v.literal(true)
        }),
        v.title('BundlePurged'),
        v.description('Returned when DELETE /admin/bundles/{id}?purge=1 hard-deletes the bundle.')
    )
]);

// --- bundle-health responses ------------------------------------------------

export const BundleHealthSeverityField = v.pipe(
    v.picklist(['healthy', 'noisy', 'warning', 'at_risk', 'auto_disabled', 'manually_disabled'] as const),
    v.description(
        'Severity ladder. healthy=0 fails. noisy=below the noise floor. warning=>= warnRate. at_risk=>= riskRate. auto_disabled=tripped the disable threshold. manually_disabled=state=failed without crossing the threshold.'
    ),
    v.examples(['warning'])
);

export const ResolvedThresholdsSchema = v.pipe(
    v.object({
        minDevices: v.pipe(v.number(), v.description('Effective minimum devices before severity is classified.')),
        warnRate: v.pipe(v.number(), v.description('Effective warn-severity threshold (0..1).')),
        riskRate: v.pipe(v.number(), v.description('Effective at-risk-severity threshold (0..1).')),
        disableRate: v.pipe(v.number(), v.description('Effective auto-disable threshold (0..1).'))
    }),
    v.title('ResolvedThresholds'),
    v.description('Per-app override → env var → default ladder, fully resolved.')
);

export const BundleHealthRowSchema = v.pipe(
    v.object({
        bundleId: v.pipe(v.number(), v.description('Server-assigned bundle id.')),
        appId: AppIdField,
        version: VersionField,
        channel: ChannelField,
        state: v.pipe(v.string(), v.description('Lifecycle state.'), v.examples(['active'])),
        active: v.pipe(v.boolean(), v.description('Whether this bundle currently resolves for its (app_id, channel).')),
        releasedAt: v.nullable(v.string()),
        attemptedDevices: v.pipe(
            v.number(),
            v.description('Unique devices that attempted this bundle since its blacklist_reset_at.')
        ),
        failedDevices: v.pipe(v.number(), v.description('Unique devices that hit a bundle-integrity failure.')),
        failRate: v.pipe(v.number(), v.description('failedDevices / attemptedDevices (0..1).')),
        severity: BundleHealthSeverityField,
        thresholds: ResolvedThresholdsSchema
    }),
    v.title('BundleHealthRow'),
    v.description('Per-bundle health row used by the operator-facing health views.')
);

export const BundleHealthRowListSchema = v.array(BundleHealthRowSchema);

export const AppNeedingAttentionSchema = v.pipe(
    v.object({
        appId: AppIdField,
        appName: v.pipe(v.string(), v.description('Display name.')),
        autoDisabled: v.pipe(v.number(), v.description('Bundles tripped by auto-disable.')),
        atRisk: v.pipe(v.number(), v.description('Bundles at or above the risk threshold but not auto-disabled.')),
        warnings: v.pipe(v.number(), v.description('Bundles in the warning band.')),
        noisy: v.pipe(v.number(), v.description('Bundles with at least one failure but below the noise floor.'))
    }),
    v.title('AppNeedingAttention'),
    v.description('Cross-app summary entry for apps with at least one non-healthy bundle.')
);

export const AppNeedingAttentionListSchema = v.array(AppNeedingAttentionSchema);

// --- plugin-facing responses ------------------------------------------------

/** Error codes /updates can emit inside its always-200 body. */
export const UPDATES_ERROR_CODES = [
    'invalid_request',
    'invalid_version_build',
    'unsupported_plugin_version',
    'no_app',
    'no_bundle',
    'no_new_version_available',
    'semver_error',
    'no_bundle_url',
    'below_min_native_build',
    'disable_auto_update_under_native',
    'disable_auto_update_to_major',
    'disable_auto_update_to_minor',
    'disable_auto_update_to_patch',
    'server_misconfigured'
] as const;

/** Error codes /stats can emit inside its always-200 body. */
export const STATS_ERROR_CODES = ['invalid_request', 'server_misconfigured', 'internal_error'] as const;

export const UpdatesErrorCode = v.picklist(UPDATES_ERROR_CODES);

/** Shape returned by /updates when a newer bundle is available. */
export const UpdateAvailableSchema = v.pipe(
    v.object({
        version: VersionField,
        url: v.pipe(v.string(), v.description('Presigned R2 GET URL the plugin will download.')),
        session_key: v.string(),
        checksum: v.pipe(v.string(), v.description('Sha256 hex, lowercase.')),
        link: v.optional(v.string()),
        comment: v.optional(v.string())
    }),
    v.title('UpdateAvailable'),
    v.description('Success shape for POST /updates when a new bundle is available.')
);

/** err200 envelope shared across plugin routes. */
export const PluginErrorSchema = v.pipe(
    v.object({
        error: v.pipe(v.string(), v.description('Error code — see operation description for the set.')),
        message: v.pipe(v.string(), v.description('Human-readable diagnostic.'))
    }),
    v.title('PluginError'),
    v.description(
        'Always-HTTP-200 error envelope used by /updates and /stats. Non-200 responses would be treated as network failures by the native Capgo plugin.'
    )
);

/** Single-event /stats success shape. */
export const StatsSingleOkSchema = v.pipe(v.object({ status: v.literal('ok') }), v.title('StatsSingleOk'));

/** Batch-mode /stats response shape. */
export const StatsBatchResponseSchema = v.pipe(
    v.object({
        status: v.literal('ok'),
        results: v.array(
            v.union([
                v.object({ status: v.literal('ok'), index: v.number() }),
                v.object({
                    status: v.literal('error'),
                    error: v.string(),
                    message: v.string(),
                    index: v.number()
                })
            ])
        )
    }),
    v.title('StatsBatchResponse'),
    v.description('Per-item status list when the request body was an array.')
);

/** Combined /stats response (body can be single event or batch). */
export const StatsResponseSchema = v.union([StatsSingleOkSchema, StatsBatchResponseSchema]);

// --- named-schema registry (exposed in components.schemas) ------------------

/**
 * The registry of schemas that should appear in `components.schemas` and be
 * referenced via `$ref` anywhere they're used. Name = OpenAPI schema name.
 */
export const NAMED_SCHEMAS = {
    App: AppSchema,
    Bundle: BundleSchema,
    StatsEvent: StatsEventSchema,
    BundleInitResponse: BundleInitResponseSchema,
    BundleHealthRow: BundleHealthRowSchema,
    AppNeedingAttention: AppNeedingAttentionSchema,
    UpdateAvailable: UpdateAvailableSchema,
    PluginError: PluginErrorSchema
} as const;
