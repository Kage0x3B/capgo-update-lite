/**
 * Display mapping for `update_checks.result`: either `'update'` (a bundle was
 * served) or one of the err200 codes POST /updates returns. Client-safe so
 * Svelte components can import it.
 */

/** How a result reads on the dashboard. Drives chart colour and grouping. */
export type ResultCategory = 'served' | 'current' | 'blocked' | 'setup' | 'invalid';

type ResultInfo = { label: string; category: ResultCategory; hint?: string };

const RESULTS: Record<string, ResultInfo> = {
    update: { label: 'Update served', category: 'served' },
    no_new_version_available: { label: 'Up to date', category: 'current' },
    below_min_native_build: {
        label: 'Native app too old',
        category: 'blocked',
        hint: "The device's native version is below the bundle's min Android/iOS version. Ship a store update or lower the minimum."
    },
    disable_auto_update_under_native: {
        label: 'Bundle older than native',
        category: 'blocked',
        hint: "The newest bundle's version is below the device's native version, and the app refuses downgrades under native. Publish a bundle with a higher version."
    },
    disable_auto_update_to_major: {
        label: 'Major upgrade blocked',
        category: 'blocked',
        hint: 'The app policy blocks major-version auto-updates.'
    },
    disable_auto_update_to_minor: {
        label: 'Minor upgrade blocked',
        category: 'blocked',
        hint: 'The app policy blocks minor-version auto-updates.'
    },
    disable_auto_update_to_patch: {
        label: 'Patch upgrade blocked',
        category: 'blocked',
        hint: 'The app policy blocks patch-version auto-updates.'
    },
    unsupported_plugin_version: {
        label: 'Plugin too old',
        category: 'blocked',
        hint: 'The device runs a capacitor-updater version below the app minimum, or one that is not valid semver.'
    },
    no_bundle: {
        label: 'No bundle on channel',
        category: 'setup',
        hint: 'No active bundle matches the channel and platform the device asked for (or the device has failed every one).'
    },
    no_bundle_url: { label: 'Bundle has no file', category: 'setup' },
    no_app: { label: 'Unknown app', category: 'setup' },
    semver_error: {
        label: 'Version not semver',
        category: 'invalid',
        hint: 'The version the device reports could not be compared with the bundle versions.'
    },
    invalid_version_build: {
        label: 'Native version not semver',
        category: 'invalid',
        hint: 'version_build must be the native versionName / CFBundleShortVersionString, e.g. 2.0.12.'
    },
    invalid_request: { label: 'Invalid request', category: 'invalid' },
    server_misconfigured: { label: 'Server misconfigured', category: 'invalid' }
};

export function resultInfo(code: string): ResultInfo {
    return RESULTS[code] ?? { label: code, category: 'invalid' };
}

export function resultLabel(code: string): string {
    return resultInfo(code).label;
}

export const CATEGORY_ORDER: ResultCategory[] = ['served', 'current', 'blocked', 'setup', 'invalid'];

export const CATEGORY_LABELS: Record<ResultCategory, string> = {
    served: 'Update served',
    current: 'Up to date',
    blocked: 'Blocked by a guard',
    setup: 'Nothing to serve',
    invalid: 'Bad request'
};

export const CATEGORY_COLORS: Record<ResultCategory, string> = {
    served: 'var(--color-primary-500)',
    current: 'var(--color-success-500)',
    blocked: 'var(--color-warning-500)',
    setup: 'var(--color-tertiary-500)',
    invalid: 'var(--color-error-500)'
};

/** Every known result code, in display order. */
export const RESULT_CODES: string[] = Object.keys(RESULTS);

/** Known result codes of one category. Unknown codes count as `invalid` but can't be listed. */
export function resultCodesIn(category: ResultCategory): string[] {
    return RESULT_CODES.filter((c) => RESULTS[c].category === category);
}

export function isResultCategory(v: string): v is ResultCategory {
    return (CATEGORY_ORDER as string[]).includes(v);
}
