import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { AppPatchSchema, BundleInitSchema } from './admin.js';
import { UPDATES_ERROR_CODES } from './entities.js';

// Valibot's v.safeParse returns { success, issues?, output? }. Assert the
// relevant shape without pulling in the issue machinery.

function parse<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown
): v.SafeParseResult<TSchema> {
    return v.safeParse(schema, input);
}

describe('BundleInitSchema — compatibility fields are required', () => {
    const base = {
        app_id: 'com.example.app',
        version: '1.2.3',
        min_android_build: '1.0.0',
        min_ios_build: '1.0.0',
        native_packages: {}
    };

    it('accepts a valid payload', () => {
        expect(parse(BundleInitSchema, base).success).toBe(true);
    });

    it('rejects a payload missing min_android_build', () => {
        const { min_android_build, ...without } = base;
        expect(parse(BundleInitSchema, without).success).toBe(false);
    });

    it('rejects a payload missing min_ios_build', () => {
        const { min_ios_build, ...without } = base;
        expect(parse(BundleInitSchema, without).success).toBe(false);
    });

    it('rejects a payload missing native_packages', () => {
        const { native_packages, ...without } = base;
        expect(parse(BundleInitSchema, without).success).toBe(false);
    });

    it('accepts native_packages as an empty object', () => {
        expect(parse(BundleInitSchema, { ...base, native_packages: {} }).success).toBe(true);
    });

    it('rejects non-string values inside native_packages', () => {
        expect(parse(BundleInitSchema, { ...base, native_packages: { '@capacitor/app': 6 } }).success).toBe(false);
    });

    it('accepts optional link + comment + platforms', () => {
        const full = {
            ...base,
            channel: 'production',
            platforms: ['ios', 'android'] as const,
            link: 'https://example.com/notes',
            comment: 'fix',
            session_key: ''
        };
        expect(parse(BundleInitSchema, full).success).toBe(true);
    });
});

describe('AppPatchSchema', () => {
    it('accepts an empty object (no-op patch)', () => {
        expect(parse(AppPatchSchema, {}).success).toBe(true);
    });

    it.each(['none', 'patch', 'minor', 'major'])('accepts disable_auto_update = %s', (val) => {
        expect(parse(AppPatchSchema, { disable_auto_update: val }).success).toBe(true);
    });

    it('rejects unknown disable_auto_update values', () => {
        expect(parse(AppPatchSchema, { disable_auto_update: 'nope' }).success).toBe(false);
    });

    it('accepts null for min_plugin_version (clears the floor)', () => {
        expect(parse(AppPatchSchema, { min_plugin_version: null }).success).toBe(true);
    });

    it('accepts a semver string for min_plugin_version', () => {
        expect(parse(AppPatchSchema, { min_plugin_version: '6.25.0' }).success).toBe(true);
    });

    it('rejects empty string for min_plugin_version', () => {
        // minLength(1) enforces this. Operators must use null to clear.
        expect(parse(AppPatchSchema, { min_plugin_version: '' }).success).toBe(false);
    });

    it('accepts a boolean for disable_auto_update_under_native', () => {
        expect(parse(AppPatchSchema, { disable_auto_update_under_native: false }).success).toBe(true);
    });
});

describe('UPDATES_ERROR_CODES', () => {
    // Regression guard: removing any of these silently would drop a server-side
    // check from the documented wire contract.
    const required = [
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

    it.each(required)('includes %s', (code) => {
        expect(UPDATES_ERROR_CODES).toContain(code);
    });
});
