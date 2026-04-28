import { describe, expect, it } from 'vitest';
import { parseSemver } from '$lib/server/semver.js';
import type { App, Bundle } from '$lib/server/db/schema.js';
import type { UpdatesRequest } from '$lib/server/validation/updates.js';
import { evaluateUpdate, type EvaluateUpdateInput, type UpdateDecision } from './updateDecision.js';

// ---------------------------------------------------------------------------
// Fixtures
//
// makeFixtures() returns an input where every guard passes (delivery). Each
// test mutates exactly one axis to isolate what it's checking. Keep the
// "green" baseline stable; it's what documents the happy-path shape.
// ---------------------------------------------------------------------------

function makeApp(overrides: Partial<App> = {}): App {
    return {
        id: 'com.example.app',
        name: 'Example',
        disableAutoUpdate: 'none',
        disableAutoUpdateUnderNative: true,
        minPluginVersion: null,
        failMinDevices: null,
        failWarnRate: null,
        failRiskRate: null,
        failRateThreshold: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides
    };
}

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
    return {
        id: 42,
        appId: 'com.example.app',
        channel: 'production',
        version: '1.5.0',
        platforms: ['ios', 'android'],
        r2Key: 'com.example.app/1.5.0/abc.zip',
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sessionKey: '',
        link: null,
        comment: null,
        minAndroidBuild: '1.4.0',
        minIosBuild: '1.4.0',
        nativePackages: {},
        active: true,
        state: 'active',
        releasedAt: new Date('2026-02-01T00:00:00Z'),
        blacklistResetAt: null,
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ...overrides
    };
}

function makeBody(overrides: Partial<UpdatesRequest> = {}): UpdatesRequest {
    return {
        app_id: 'com.example.app',
        device_id: '8b1c7b5c-1b2a-4f0b-9a74-3e3d6ad2d2fa',
        version_name: '1.4.2',
        version_build: '1.4.2',
        is_emulator: false,
        is_prod: true,
        platform: 'ios',
        plugin_version: '6.3.0',
        defaultChannel: 'production',
        ...overrides
    };
}

function makeFixtures(
    partial: {
        app?: Partial<App>;
        bundle?: Partial<Bundle>;
        body?: Partial<UpdatesRequest>;
    } = {}
): EvaluateUpdateInput {
    const body = makeBody(partial.body);
    const pluginSv = parseSemver(body.plugin_version);
    const buildSv = parseSemver(body.version_build);
    if (!pluginSv || !buildSv) {
        throw new Error('test fixture has invalid semver — tighten the override');
    }
    return {
        app: makeApp(partial.app),
        bundle: makeBundle(partial.bundle),
        body,
        pluginSv,
        buildSv
    };
}

function expectDeliver(d: UpdateDecision): void {
    expect(d.kind).toBe('deliver');
}

function expectError(d: UpdateDecision, code: string): Extract<UpdateDecision, { kind: 'error' }> {
    if (d.kind !== 'error') {
        throw new Error(`expected error but got ${JSON.stringify(d)}`);
    }
    expect(d.code).toBe(code);
    return d;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('evaluateUpdate — happy path', () => {
    it('delivers when every guard is satisfied', () => {
        expectDeliver(evaluateUpdate(makeFixtures()));
    });
});

// ---------------------------------------------------------------------------
// Plugin-version floor
// ---------------------------------------------------------------------------

describe('evaluateUpdate — plugin version floor', () => {
    it('rejects when plugin_version is below app.minPluginVersion', () => {
        const d = evaluateUpdate(
            makeFixtures({ app: { minPluginVersion: '6.25.0' }, body: { plugin_version: '6.24.9' } })
        );
        expectError(d, 'unsupported_plugin_version');
    });

    it('delivers when plugin_version equals the floor', () => {
        expectDeliver(
            evaluateUpdate(makeFixtures({ app: { minPluginVersion: '6.25.0' }, body: { plugin_version: '6.25.0' } }))
        );
    });

    it('delivers when plugin_version is above the floor', () => {
        expectDeliver(
            evaluateUpdate(makeFixtures({ app: { minPluginVersion: '6.25.0' }, body: { plugin_version: '7.0.0' } }))
        );
    });

    it('skips the check when minPluginVersion is null', () => {
        expectDeliver(
            evaluateUpdate(makeFixtures({ app: { minPluginVersion: null }, body: { plugin_version: '1.0.0' } }))
        );
    });
});

// ---------------------------------------------------------------------------
// Platform-split min native build
// ---------------------------------------------------------------------------

describe('evaluateUpdate — platform min native build (android)', () => {
    it('rejects when version_build is below min_android_build', () => {
        const d = evaluateUpdate(
            makeFixtures({
                bundle: { minAndroidBuild: '1.4.0', minIosBuild: '0.0.0' },
                body: { platform: 'android', version_build: '1.3.9' }
            })
        );
        const err = expectError(d, 'below_min_native_build');
        expect(err.extra).toEqual({ min_required: '1.4.0', current: '1.3.9' });
    });

    it('delivers when version_build equals min_android_build', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    bundle: { minAndroidBuild: '1.4.0' },
                    body: { platform: 'android', version_build: '1.4.0' }
                })
            )
        );
    });

    it('delivers when version_build exceeds min_android_build', () => {
        // Disable the under-native guard — the baseline bundle.version (1.5.0)
        // would otherwise trip it against version_build 2.0.0. Here we isolate
        // the min-build check only.
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdateUnderNative: false },
                    bundle: { minAndroidBuild: '1.4.0' },
                    body: { platform: 'android', version_build: '2.0.0' }
                })
            )
        );
    });

    it('fails closed when min_android_build is corrupt (non-semver)', () => {
        const d = evaluateUpdate(
            makeFixtures({
                bundle: { minAndroidBuild: 'garbage' },
                body: { platform: 'android' }
            })
        );
        expectError(d, 'server_misconfigured');
    });
});

describe('evaluateUpdate — platform min native build (ios)', () => {
    it('rejects when version_build is below min_ios_build', () => {
        const d = evaluateUpdate(
            makeFixtures({
                bundle: { minIosBuild: '1.4.0', minAndroidBuild: '0.0.0' },
                body: { platform: 'ios', version_build: '1.3.9' }
            })
        );
        const err = expectError(d, 'below_min_native_build');
        expect(err.extra).toEqual({ min_required: '1.4.0', current: '1.3.9' });
    });

    it('delivers when version_build equals min_ios_build', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    bundle: { minIosBuild: '1.4.0' },
                    body: { platform: 'ios', version_build: '1.4.0' }
                })
            )
        );
    });

    it('uses min_ios_build, not min_android_build, on ios', () => {
        // ios request: android min is irrelevant; only iOS value matters.
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    bundle: { minIosBuild: '1.0.0', minAndroidBuild: '99.0.0' },
                    body: { platform: 'ios', version_build: '1.0.0' }
                })
            )
        );
    });

    it('fails closed when min_ios_build is corrupt', () => {
        const d = evaluateUpdate(
            makeFixtures({
                bundle: { minIosBuild: 'garbage' },
                body: { platform: 'ios' }
            })
        );
        expectError(d, 'server_misconfigured');
    });
});

describe('evaluateUpdate — platform min native build (electron)', () => {
    it('skips the guard regardless of min_android_build / min_ios_build', () => {
        // Even if both min builds are very high, electron traffic passes.
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    bundle: { minAndroidBuild: '99.0.0', minIosBuild: '99.0.0' },
                    body: { platform: 'electron', version_build: '0.0.1' }
                })
            )
        );
    });
});

// ---------------------------------------------------------------------------
// No-downgrade-under-native
// ---------------------------------------------------------------------------

describe('evaluateUpdate — disable_auto_update_under_native', () => {
    it('rejects when bundle.version < device version_build and guard is on', () => {
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdateUnderNative: true },
                bundle: { version: '1.4.0' },
                body: { version_build: '1.5.0', version_name: '1.3.0' }
            })
        );
        expectError(d, 'disable_auto_update_under_native');
    });

    it('delivers when bundle.version equals device version_build', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdateUnderNative: true },
                    bundle: { version: '1.4.0' },
                    body: { version_build: '1.4.0', version_name: '1.3.0' }
                })
            )
        );
    });

    it('skips the guard when the toggle is off', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdateUnderNative: false },
                    bundle: { version: '1.4.0', minIosBuild: '0.0.0' },
                    body: { version_build: '1.5.0', version_name: '1.3.0' }
                })
            )
        );
    });
});

// ---------------------------------------------------------------------------
// Upgrade-class ceiling (disable_auto_update)
// ---------------------------------------------------------------------------

describe('evaluateUpdate — disable_auto_update ceiling', () => {
    it('major ceiling blocks major upgrade', () => {
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdate: 'major' },
                bundle: { version: '2.0.0' },
                body: { version_name: '1.9.9' }
            })
        );
        expectError(d, 'disable_auto_update_to_major');
    });

    it('major ceiling lets minor upgrade through', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'major' },
                    bundle: { version: '1.10.0' },
                    body: { version_name: '1.9.9' }
                })
            )
        );
    });

    it('minor ceiling blocks minor upgrade', () => {
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdate: 'minor' },
                bundle: { version: '1.10.0' },
                body: { version_name: '1.9.9' }
            })
        );
        expectError(d, 'disable_auto_update_to_minor');
    });

    it('minor ceiling also blocks major upgrade', () => {
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdate: 'minor' },
                bundle: { version: '2.0.0' },
                body: { version_name: '1.9.9' }
            })
        );
        expectError(d, 'disable_auto_update_to_major');
    });

    it('minor ceiling lets patch upgrade through', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'minor' },
                    bundle: { version: '1.9.10' },
                    body: { version_name: '1.9.9' }
                })
            )
        );
    });

    it('patch ceiling blocks every class of upgrade', () => {
        // patch: patches blocked
        expectError(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'patch' },
                    bundle: { version: '1.9.10' },
                    body: { version_name: '1.9.9' }
                })
            ),
            'disable_auto_update_to_patch'
        );
        // minor:
        expectError(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'patch' },
                    bundle: { version: '1.10.0' },
                    body: { version_name: '1.9.9' }
                })
            ),
            'disable_auto_update_to_minor'
        );
        // major:
        expectError(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'patch' },
                    bundle: { version: '2.0.0' },
                    body: { version_name: '1.9.9' }
                })
            ),
            'disable_auto_update_to_major'
        );
    });

    it('none lets every class through', () => {
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'none' },
                    bundle: { version: '99.0.0' },
                    body: { version_name: '1.0.0' }
                })
            )
        );
    });

    it('skips the ceiling when version_name is a sentinel (builtin/unknown)', () => {
        // 'builtin' doesn't parse as semver, so the ceiling check silently
        // falls through — the device gets the bundle it would otherwise get.
        expectDeliver(
            evaluateUpdate(
                makeFixtures({
                    app: { disableAutoUpdate: 'major' },
                    bundle: { version: '2.0.0' },
                    body: { version_name: 'builtin' }
                })
            )
        );
    });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('evaluateUpdate — ordering guarantees', () => {
    it('plugin floor fires before min-build when both would block', () => {
        // Same fixture would trip both the plugin floor and below-min-build.
        // Assert plugin floor wins.
        const d = evaluateUpdate(
            makeFixtures({
                app: { minPluginVersion: '9.0.0' },
                bundle: { minIosBuild: '9.9.9' },
                body: { plugin_version: '1.0.0', version_build: '0.1.0', platform: 'ios' }
            })
        );
        expectError(d, 'unsupported_plugin_version');
    });

    it('min-build fires before under-native when both would block', () => {
        // Bundle 1.0.0, device native 2.0.0, min_ios_build 3.0.0 → min build
        // trips first even though under-native would also fire.
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdateUnderNative: true },
                bundle: { version: '1.0.0', minIosBuild: '3.0.0' },
                body: { platform: 'ios', version_build: '2.0.0', version_name: '0.9.0' }
            })
        );
        expectError(d, 'below_min_native_build');
    });

    it('under-native fires before ceiling when both would block', () => {
        // Device native 2.0.0, bundle 1.0.0 (below native); ceiling set to
        // 'patch'. Under-native fires first because ordering matters.
        const d = evaluateUpdate(
            makeFixtures({
                app: { disableAutoUpdateUnderNative: true, disableAutoUpdate: 'patch' },
                bundle: { version: '1.0.0', minIosBuild: '0.0.0' },
                body: { platform: 'ios', version_build: '2.0.0', version_name: '0.9.0' }
            })
        );
        expectError(d, 'disable_auto_update_under_native');
    });
});
