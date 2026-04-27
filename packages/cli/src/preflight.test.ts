import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleRow } from './api.js';
import type { ResolvedConfig } from './config.js';

// ---- module mocks ----
// `output.fail` normally calls process.exit. Tests throw instead so assertions
// can inspect the error. The other helpers are silenced to keep test output
// clean.
vi.mock('./output.js', async () => {
    const actual = await vi.importActual<typeof import('./output.js')>('./output.js');
    return {
        ...actual,
        fail: (msg: string) => {
            throw new Error(`FAIL:${msg}`);
        },
        ok: vi.fn(),
        warn: vi.fn(),
        kv: vi.fn(),
        step: vi.fn(),
        done: vi.fn()
    };
});

// The admin API fetch is controlled per-test via the `apiJsonMock`.
const apiJsonMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('./api.js', async () => {
    const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
    return {
        ...actual,
        apiJson: (...args: unknown[]) => apiJsonMock(...args)
    };
});

// The prompt module reaches for stdin TTY state; in unit tests we never want
// to actually prompt, so isInteractive() is forced false. Bump scenarios that
// exercise the prompt path are covered by manual smoke testing.
vi.mock('./prompt.js', () => ({
    isInteractive: () => false,
    selectBumpLevel: vi.fn(),
    confirmBump: vi.fn()
}));

// Dynamic import after mocks are registered. vi.mock is hoisted so this works.
const { preflightNativeBuild, preflightVersionAutoresolve } = await import('./preflight.js');

// ---- fixture helpers ----
let tmp: string;
let originalCwd: string;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-preflight-test-'));
    originalCwd = process.cwd();
    process.chdir(tmp);
    apiJsonMock.mockReset();
});

afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tmp, { recursive: true, force: true });
});

async function writeFileEnsuringDir(p: string, body: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
}

async function writeAndroidVersion(versionName: string, root = 'android'): Promise<void> {
    await writeFileEnsuringDir(path.join(tmp, root, 'app/build.gradle'), `versionName "${versionName}"\n`);
}

async function writeIosVersion(short: string, root = 'ios'): Promise<void> {
    await writeFileEnsuringDir(
        path.join(tmp, root, 'App/App/Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleShortVersionString</key>\n  <string>${short}</string>\n</dict>\n</plist>\n`
    );
}

async function writePackageJson(deps: Record<string, string>): Promise<void> {
    await writeFile(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: deps }));
}

function makeCfg(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
    return {
        appId: 'com.example.app',
        version: '1.2.3',
        distDir: './dist',
        serverUrl: 'https://ota.example.com',
        adminToken: 'test-token',
        channel: 'production',
        platforms: undefined,
        link: undefined,
        comment: undefined,
        activate: true,
        packageJson: undefined,
        capacitorConfig: undefined,
        skipPreflight: false,
        dryRun: false,
        codeCheck: true,
        versionExistsOk: false,
        minAndroidBuild: undefined,
        minIosBuild: undefined,
        autoMinUpdateBuild: false,
        androidProject: './android',
        iosProject: './ios',
        sessionKey: undefined,
        nativePackages: undefined,
        ...overrides
    };
}

function mockBundleList(rows: BundleRow[]): void {
    apiJsonMock.mockResolvedValueOnce(rows);
}

function bundleRow(overrides: Partial<BundleRow> = {}): BundleRow {
    return {
        id: 1,
        appId: 'com.example.app',
        channel: 'production',
        version: '1.0.0',
        platforms: ['ios', 'android'],
        r2Key: 'foo',
        checksum: '',
        sessionKey: '',
        link: null,
        comment: null,
        minAndroidBuild: '1.0.0',
        minIosBuild: '1.0.0',
        nativePackages: {},
        active: true,
        state: 'active',
        releasedAt: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        ...overrides
    };
}

describe('preflightNativeBuild — explicit flags', () => {
    it('uses explicit values without reading native files', async () => {
        // No android/ or ios/ directories; must not fall through to detection.
        const cfg = makeCfg({ minAndroidBuild: '2.0.0', minIosBuild: '2.0.0' });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('2.0.0');
        expect(cfg.minIosBuild).toBe('2.0.0');
        expect(apiJsonMock).not.toHaveBeenCalled();
    });

    it('fails fast when explicit android value is not semver', async () => {
        const cfg = makeCfg({ minAndroidBuild: 'not-semver', minIosBuild: '1.0.0' });
        await expect(preflightNativeBuild(cfg)).rejects.toThrow(/FAIL:.*min-android-build/);
    });

    it('fails fast when explicit ios value is not semver', async () => {
        const cfg = makeCfg({ minAndroidBuild: '1.0.0', minIosBuild: 'nope' });
        await expect(preflightNativeBuild(cfg)).rejects.toThrow(/FAIL:.*min-ios-build/);
    });
});

describe('preflightNativeBuild — auto-detect only', () => {
    it('defaults to detected native versions when no flags given', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        const cfg = makeCfg();
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('1.4.0');
        expect(cfg.minIosBuild).toBe('1.4.0');
    });

    it('fails when android project is absent and no flag was given', async () => {
        await writeIosVersion('1.4.0');
        const cfg = makeCfg();
        await expect(preflightNativeBuild(cfg)).rejects.toThrow(/FAIL:.*could not detect native android/);
    });

    it('fails when the detected native version is not semver', async () => {
        await writeAndroidVersion('weird-1.4');
        await writeIosVersion('1.4.0');
        const cfg = makeCfg();
        await expect(preflightNativeBuild(cfg)).rejects.toThrow(/FAIL:.*not valid semver/);
    });

    it('populates nativePackages from package.json', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        await writePackageJson({ '@capacitor/app': '6.0.0', react: '18.0.0' });
        const cfg = makeCfg();
        await preflightNativeBuild(cfg);
        expect(cfg.nativePackages).toEqual({ '@capacitor/app': '6.0.0' });
    });

    it('empty nativePackages when package.json absent', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        const cfg = makeCfg();
        await preflightNativeBuild(cfg);
        expect(cfg.nativePackages).toEqual({});
    });
});

describe('preflightNativeBuild — auto mode (--auto-min-update-build)', () => {
    it('requires an admin token', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        const cfg = makeCfg({ autoMinUpdateBuild: true, adminToken: undefined });
        await expect(preflightNativeBuild(cfg)).rejects.toThrow(/FAIL:.*admin token/);
    });

    it('uses detected versions when no previous bundle exists', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        mockBundleList([]);
        const cfg = makeCfg({ autoMinUpdateBuild: true });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('1.4.0');
        expect(cfg.minIosBuild).toBe('1.4.0');
    });

    it('inherits previous bundle min builds when native fingerprint is unchanged', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        await writePackageJson({ '@capacitor/app': '6.0.0' });
        mockBundleList([
            bundleRow({
                minAndroidBuild: '1.0.0',
                minIosBuild: '1.0.0',
                nativePackages: { '@capacitor/app': '6.0.0' }
            })
        ]);
        const cfg = makeCfg({ autoMinUpdateBuild: true });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('1.0.0');
        expect(cfg.minIosBuild).toBe('1.0.0');
    });

    it('bumps to detected native versions when a native dep changed', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        await writePackageJson({ '@capacitor/app': '7.0.0' });
        mockBundleList([
            bundleRow({
                minAndroidBuild: '1.0.0',
                minIosBuild: '1.0.0',
                nativePackages: { '@capacitor/app': '6.0.0' }
            })
        ]);
        const cfg = makeCfg({ autoMinUpdateBuild: true });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('1.4.0');
        expect(cfg.minIosBuild).toBe('1.4.0');
    });

    it('bumps when a native dep was added', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        await writePackageJson({ '@capacitor/app': '6.0.0', '@capacitor/haptics': '6.0.0' });
        mockBundleList([
            bundleRow({
                minAndroidBuild: '1.0.0',
                minIosBuild: '1.0.0',
                nativePackages: { '@capacitor/app': '6.0.0' }
            })
        ]);
        const cfg = makeCfg({ autoMinUpdateBuild: true });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('1.4.0');
        expect(cfg.minIosBuild).toBe('1.4.0');
    });

    it('explicit flag still wins over inherit path', async () => {
        await writeAndroidVersion('1.4.0');
        await writeIosVersion('1.4.0');
        await writePackageJson({ '@capacitor/app': '6.0.0' });
        mockBundleList([
            bundleRow({
                minAndroidBuild: '0.5.0',
                minIosBuild: '0.5.0',
                nativePackages: { '@capacitor/app': '6.0.0' }
            })
        ]);
        const cfg = makeCfg({ autoMinUpdateBuild: true, minAndroidBuild: '9.9.9' });
        await preflightNativeBuild(cfg);
        expect(cfg.minAndroidBuild).toBe('9.9.9');
        // iOS still inherits because no flag was set.
        expect(cfg.minIosBuild).toBe('0.5.0');
    });
});

describe('preflightVersionAutoresolve', () => {
    async function writeRootPackageJson(version: string | null): Promise<void> {
        const body = version === null ? { name: 'x' } : { name: 'x', version };
        await writeFile(path.join(tmp, 'package.json'), JSON.stringify(body, null, 2));
    }

    it('keeps an explicit cfg.version unchanged when no active bundle exists', async () => {
        // No previous active bundle on this channel ⇒ list returns [].
        mockBundleList([]);
        const cfg = makeCfg({ version: '1.5.0' });
        const outcome = await preflightVersionAutoresolve(cfg);
        expect(outcome.kind).toBe('explicit');
        expect(cfg.version).toBe('1.5.0');
    });

    it('reads version from package.json when none is provided', async () => {
        await writeRootPackageJson('2.4.7');
        mockBundleList([]);
        const cfg = makeCfg({ version: undefined });
        const outcome = await preflightVersionAutoresolve(cfg);
        expect(outcome.kind).toBe('fromPackageJson');
        expect(cfg.version).toBe('2.4.7');
    });

    it('fails fast when no version is provided and no package.json exists', async () => {
        const cfg = makeCfg({ version: undefined });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/missing version/);
    });

    it('rejects an explicit non-semver version', async () => {
        const cfg = makeCfg({ version: 'not-a-version' });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/not valid semver/);
    });

    it('rejects when package.json version is not parseable', async () => {
        await writeRootPackageJson('not-a-version');
        const cfg = makeCfg({ version: undefined });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/not valid semver/);
    });

    it('passes through when target is strictly newer than the active bundle', async () => {
        mockBundleList([bundleRow({ version: '1.4.0' })]);
        const cfg = makeCfg({ version: '1.5.0' });
        const outcome = await preflightVersionAutoresolve(cfg);
        expect(outcome.kind).toBe('explicit');
        expect(cfg.version).toBe('1.5.0');
    });

    it('fails when the explicit version would downgrade the active bundle', async () => {
        mockBundleList([bundleRow({ version: '1.5.0' })]);
        const cfg = makeCfg({ version: '1.4.0' });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/downgrade/);
    });

    it('fails when an explicit version equals the active bundle (no prompt)', async () => {
        mockBundleList([bundleRow({ version: '1.5.0' })]);
        const cfg = makeCfg({ version: '1.5.0' });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/already active/);
    });

    it('falls through on equal version when --version-exists-ok is set', async () => {
        mockBundleList([bundleRow({ version: '1.5.0' })]);
        const cfg = makeCfg({ version: '1.5.0', versionExistsOk: true });
        // Should NOT throw — preflightAppRegistered handles the early-exit.
        const outcome = await preflightVersionAutoresolve(cfg);
        expect(outcome.kind).toBe('explicit');
    });

    it('refuses to prompt for a bump in non-interactive contexts (sourced)', async () => {
        await writeRootPackageJson('1.5.0');
        mockBundleList([bundleRow({ version: '1.5.0' })]);
        const cfg = makeCfg({ version: undefined });
        await expect(preflightVersionAutoresolve(cfg)).rejects.toThrow(/non-interactive/);
    });

    it('skips the active-bundle compare when no admin token is available', async () => {
        // No mockBundleList — apiJsonMock would throw if called.
        const cfg = makeCfg({ version: '1.5.0', adminToken: undefined });
        const outcome = await preflightVersionAutoresolve(cfg);
        expect(outcome.kind).toBe('explicit');
        expect(apiJsonMock).not.toHaveBeenCalled();
    });
});
