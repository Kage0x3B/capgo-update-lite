/**
 * Display mapping for the plugin's `stats_events.action` enum.
 *
 * The raw values come from the Capgo plugin (mirrored in
 * `src/lib/server/validation/stats.ts`'s `ALLOWED_STATS_ACTIONS`). They're
 * cryptic for non-implementers — e.g. `set` is actually "bundle installed".
 * This module renames them for human eyes without mutating what the plugin
 * sends or what we store.
 *
 * Kept under `src/lib/util/` (not `src/lib/server/`) so it's importable from
 * Svelte components too.
 */

// Single source of truth for the action enum. The server-side Valibot
// validator in `validation/stats.ts` re-exports this list.
export const ALLOWED_STATS_ACTIONS = [
    'ping',
    'delete',
    'reset',
    'set',
    'get',
    'set_fail',
    'update_fail',
    'download_fail',
    'windows_path_fail',
    'canonical_path_fail',
    'directory_path_fail',
    'unzip_fail',
    'low_mem_fail',
    'download_0',
    'download_10',
    'download_20',
    'download_30',
    'download_40',
    'download_50',
    'download_60',
    'download_70',
    'download_80',
    'download_90',
    'download_complete',
    'download_manifest_start',
    'download_manifest_complete',
    'download_zip_start',
    'download_zip_complete',
    'download_manifest_file_fail',
    'download_manifest_checksum_fail',
    'download_manifest_brotli_fail',
    'decrypt_fail',
    'app_moved_to_foreground',
    'app_moved_to_background',
    'uninstall',
    'needPlanUpgrade',
    'missingBundle',
    'noNew',
    'disablePlatformIos',
    'disablePlatformAndroid',
    'disableAutoUpdateToMajor',
    'cannotUpdateViaPrivateChannel',
    'disableAutoUpdateToMinor',
    'disableAutoUpdateToPatch',
    'channelMisconfigured',
    'disableAutoUpdateMetadata',
    'disableAutoUpdateUnderNative',
    'disableDevBuild',
    'disableProdBuild',
    'disableEmulator',
    'disableDevice',
    'cannotGetBundle',
    'checksum_fail',
    'NoChannelOrOverride',
    'setChannel',
    'getChannel',
    'rateLimited',
    'disableAutoUpdate',
    'InvalidIp',
    'blocked_by_server_url'
] as const;

export type StatsAction = (typeof ALLOWED_STATS_ACTIONS)[number];

/** Friendly label per raw action code. */
export const ACTION_LABELS: Record<StatsAction, string> = {
    ping: 'Heartbeat',
    get: 'Bundle fetched',
    set: 'Bundle installed',
    delete: 'Bundle deleted',
    reset: 'Reset to built-in',
    uninstall: 'App uninstalled',

    set_fail: 'Install failed',
    update_fail: 'Update failed',
    download_fail: 'Download failed',
    unzip_fail: 'Unzip failed',
    low_mem_fail: 'Out of memory',
    decrypt_fail: 'Decryption failed',
    checksum_fail: 'Checksum mismatch',
    cannotGetBundle: 'Bundle fetch failed',
    windows_path_fail: 'Windows path error',
    canonical_path_fail: 'Path normalization error',
    directory_path_fail: 'Directory path error',

    download_0: 'Downloading · 0%',
    download_10: 'Downloading · 10%',
    download_20: 'Downloading · 20%',
    download_30: 'Downloading · 30%',
    download_40: 'Downloading · 40%',
    download_50: 'Downloading · 50%',
    download_60: 'Downloading · 60%',
    download_70: 'Downloading · 70%',
    download_80: 'Downloading · 80%',
    download_90: 'Downloading · 90%',
    download_complete: 'Download complete',
    download_zip_start: 'Zip download started',
    download_zip_complete: 'Zip download complete',
    download_manifest_start: 'Delta manifest started',
    download_manifest_complete: 'Delta manifest complete',
    download_manifest_file_fail: 'Delta file download failed',
    download_manifest_checksum_fail: 'Delta checksum mismatch',
    download_manifest_brotli_fail: 'Delta decompression failed',

    app_moved_to_foreground: 'App foregrounded',
    app_moved_to_background: 'App backgrounded',

    needPlanUpgrade: 'Plan upgrade required',
    missingBundle: 'No bundle available',
    noNew: 'No new version',

    setChannel: 'Channel changed',
    getChannel: 'Channel queried',
    NoChannelOrOverride: 'No channel or override',
    channelMisconfigured: 'Channel misconfigured',
    cannotUpdateViaPrivateChannel: 'Private channel mismatch',

    disablePlatformIos: 'Blocked · iOS disabled',
    disablePlatformAndroid: 'Blocked · Android disabled',
    disableAutoUpdateToMajor: 'Blocked · major version',
    disableAutoUpdateToMinor: 'Blocked · minor version',
    disableAutoUpdateToPatch: 'Blocked · patch version',
    disableAutoUpdateMetadata: 'Blocked · metadata',
    disableAutoUpdateUnderNative: 'Blocked · older than native',
    disableAutoUpdate: 'Auto-update disabled',
    disableDevBuild: 'Blocked · dev build',
    disableProdBuild: 'Blocked · prod build',
    disableEmulator: 'Blocked · emulator',
    disableDevice: 'Blocked · device',
    rateLimited: 'Rate-limited',
    InvalidIp: 'Blocked · invalid IP',
    blocked_by_server_url: 'Blocked by server URL'
};

export type ActionGroupKey = 'lifecycle' | 'resolution' | 'download' | 'appstate' | 'failure' | 'channel' | 'block';

/**
 * Actions grouped by what they mean. Drives the filter menu, the `@key` group
 * tokens in explorer URLs, and the colour of action badges and chart series.
 */
export const ACTION_GROUPS: Array<{ key: ActionGroupKey; label: string; color: string; actions: StatsAction[] }> = [
    {
        key: 'lifecycle',
        label: 'Lifecycle',
        color: 'var(--color-primary-500)',
        actions: ['set', 'get', 'delete', 'reset', 'uninstall', 'ping']
    },
    {
        key: 'resolution',
        label: 'Update resolution',
        color: 'var(--color-success-500)',
        actions: ['noNew', 'missingBundle', 'needPlanUpgrade']
    },
    {
        key: 'download',
        label: 'Download progress',
        color: 'var(--color-secondary-500)',
        actions: [
            'download_zip_start',
            'download_0',
            'download_10',
            'download_20',
            'download_30',
            'download_40',
            'download_50',
            'download_60',
            'download_70',
            'download_80',
            'download_90',
            'download_complete',
            'download_zip_complete',
            'download_manifest_start',
            'download_manifest_complete'
        ]
    },
    {
        key: 'appstate',
        label: 'App state',
        color: 'var(--color-surface-400-600)',
        actions: ['app_moved_to_foreground', 'app_moved_to_background']
    },
    {
        key: 'failure',
        label: 'Failures',
        color: 'var(--color-error-500)',
        actions: [
            'set_fail',
            'update_fail',
            'download_fail',
            'unzip_fail',
            'decrypt_fail',
            'checksum_fail',
            'low_mem_fail',
            'cannotGetBundle',
            'windows_path_fail',
            'canonical_path_fail',
            'directory_path_fail',
            'download_manifest_file_fail',
            'download_manifest_checksum_fail',
            'download_manifest_brotli_fail'
        ]
    },
    {
        key: 'channel',
        label: 'Channels',
        color: 'var(--color-tertiary-500)',
        actions: [
            'setChannel',
            'getChannel',
            'NoChannelOrOverride',
            'channelMisconfigured',
            'cannotUpdateViaPrivateChannel'
        ]
    },
    {
        key: 'block',
        label: 'Blocks',
        color: 'var(--color-warning-500)',
        actions: [
            'disablePlatformIos',
            'disablePlatformAndroid',
            'disableAutoUpdate',
            'disableAutoUpdateToMajor',
            'disableAutoUpdateToMinor',
            'disableAutoUpdateToPatch',
            'disableAutoUpdateMetadata',
            'disableAutoUpdateUnderNative',
            'disableDevBuild',
            'disableProdBuild',
            'disableEmulator',
            'disableDevice',
            'rateLimited',
            'InvalidIp',
            'blocked_by_server_url'
        ]
    }
];

/** Resolve a raw action code to its friendly label. Falls back to the code if unknown. */
export function actionLabel(raw: string | null | undefined): string {
    if (!raw) return '—';
    return (ACTION_LABELS as Record<string, string>)[raw] ?? raw;
}

const GROUP_BY_ACTION = new Map<string, (typeof ACTION_GROUPS)[number]>();
for (const g of ACTION_GROUPS) for (const a of g.actions) GROUP_BY_ACTION.set(a, g);

/** The group an action belongs to, or undefined for unknown / null actions. */
export function actionGroup(raw: string | null | undefined): (typeof ACTION_GROUPS)[number] | undefined {
    return raw ? GROUP_BY_ACTION.get(raw) : undefined;
}

export function actionGroupByKey(key: string): (typeof ACTION_GROUPS)[number] | undefined {
    return ACTION_GROUPS.find((g) => g.key === key);
}
