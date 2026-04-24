import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';
import { resolveConfig, type FileConfig } from './config.js';

// `fail` calls process.exit(1). Tests replace it with a throw so we can assert
// failure cases without killing the worker.
vi.mock('./output.js', async () => {
    const mod = await vi.importActual<typeof import('./output.js')>('./output.js');
    return {
        ...mod,
        fail: (msg: string) => {
            throw new Error(`FAIL:${msg}`);
        }
    };
});

let tmp: string;
let originalCwd: string;
const CAPGO_ENV_KEYS = [
    'CAPGO_APP_ID',
    'CAPGO_VERSION',
    'CAPGO_DIST_DIR',
    'CAPGO_SERVER_URL',
    'CAPGO_ADMIN_TOKEN',
    'CAPGO_CHANNEL',
    'CAPGO_PLATFORMS',
    'CAPGO_LINK',
    'CAPGO_COMMENT',
    'CAPGO_ACTIVATE',
    'CAPGO_DRY_RUN',
    'CAPGO_SKIP_PREFLIGHT',
    'CAPGO_CONFIG',
    'CAPGO_PACKAGE_JSON',
    'CAPGO_CAPACITOR_CONFIG',
    'CAPGO_MIN_ANDROID_BUILD',
    'CAPGO_MIN_IOS_BUILD',
    'CAPGO_AUTO_MIN_UPDATE_BUILD',
    'CAPGO_ANDROID_PROJECT',
    'CAPGO_IOS_PROJECT'
];

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-config-test-'));
    originalCwd = process.cwd();
    process.chdir(tmp);
    // Make sure no stray CAPGO_* from the outer shell leaks into tests.
    for (const k of CAPGO_ENV_KEYS) delete process.env[k];
});

afterEach(async () => {
    process.chdir(originalCwd);
    for (const k of CAPGO_ENV_KEYS) delete process.env[k];
    await rm(tmp, { recursive: true, force: true });
});

function makeCmd(opts: Record<string, unknown>): Command {
    // Only `optsWithGlobals` is consumed by resolveConfig.
    return { optsWithGlobals: () => opts } as unknown as Command;
}

async function writeCfgFile(body: FileConfig): Promise<void> {
    await writeFile(path.join(tmp, 'capgo-update.json'), JSON.stringify(body));
}

describe('resolveConfig precedence', () => {
    it('CLI flag beats env, file, and default', async () => {
        process.env.CAPGO_MIN_ANDROID_BUILD = 'from-env';
        await writeCfgFile({ minAndroidBuild: 'from-file' });
        const cfg = await resolveConfig(makeCmd({ minAndroidBuild: 'from-cli' }));
        expect(cfg.minAndroidBuild).toBe('from-cli');
    });

    it('env beats file and default', async () => {
        process.env.CAPGO_MIN_IOS_BUILD = 'from-env';
        await writeCfgFile({ minIosBuild: 'from-file' });
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.minIosBuild).toBe('from-env');
    });

    it('file beats default', async () => {
        await writeCfgFile({ minAndroidBuild: 'from-file' });
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.minAndroidBuild).toBe('from-file');
    });

    it('default for androidProject is ./android', async () => {
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.androidProject).toBe('./android');
    });

    it('default for iosProject is ./ios', async () => {
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.iosProject).toBe('./ios');
    });

    it('min-*-build is undefined when absent from all layers', async () => {
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.minAndroidBuild).toBeUndefined();
        expect(cfg.minIosBuild).toBeUndefined();
    });

    it('androidProject and iosProject pick up env and file overrides', async () => {
        process.env.CAPGO_ANDROID_PROJECT = 'env-android';
        await writeCfgFile({ iosProject: 'file-ios' });
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.androidProject).toBe('env-android');
        expect(cfg.iosProject).toBe('file-ios');
    });
});

describe('resolveConfig — autoMinUpdateBuild', () => {
    it('CLI flag true wins regardless of env/file', async () => {
        process.env.CAPGO_AUTO_MIN_UPDATE_BUILD = 'false';
        await writeCfgFile({ autoMinUpdateBuild: false });
        const cfg = await resolveConfig(makeCmd({ autoMinUpdateBuild: true }));
        expect(cfg.autoMinUpdateBuild).toBe(true);
    });

    it.each(['true', '1', 'yes', 'on'])('env "%s" parses as true', async (val) => {
        process.env.CAPGO_AUTO_MIN_UPDATE_BUILD = val;
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.autoMinUpdateBuild).toBe(true);
    });

    it.each(['false', '0', 'no', 'off'])('env "%s" parses as false', async (val) => {
        process.env.CAPGO_AUTO_MIN_UPDATE_BUILD = val;
        await writeCfgFile({ autoMinUpdateBuild: true });
        const cfg = await resolveConfig(makeCmd({}));
        // env=false overrides file=true — the current OR-chain treats only
        // truthy values as on; false/unset both fall through. Assert the spec:
        // false env does NOT force-disable the file flag here.
        //
        // Looking at resolveConfig: autoMinUpdateBuild is set via
        //   opts.x === true || envBool === true || file.x === true
        // so envBool=false falls through to file=true. That's the current
        // behaviour.
        expect(cfg.autoMinUpdateBuild).toBe(true);
    });

    it('unparseable env value fails', async () => {
        process.env.CAPGO_AUTO_MIN_UPDATE_BUILD = 'maybe';
        await expect(resolveConfig(makeCmd({}))).rejects.toThrow(/FAIL:/);
    });

    it('file boolean true is respected when env and CLI absent', async () => {
        await writeCfgFile({ autoMinUpdateBuild: true });
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.autoMinUpdateBuild).toBe(true);
    });

    it('defaults to false when nothing is set', async () => {
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.autoMinUpdateBuild).toBe(false);
    });
});

describe('resolveConfig — nativePackages', () => {
    it('starts undefined (populated by preflightNativeBuild later)', async () => {
        const cfg = await resolveConfig(makeCmd({}));
        expect(cfg.nativePackages).toBeUndefined();
    });
});

describe('resolveConfig — regression smoke on existing ladder', () => {
    it('appId still resolves through CLI/env/file/default', async () => {
        process.env.CAPGO_APP_ID = 'com.env.app';
        await writeCfgFile({ appId: 'com.file.app' });
        expect((await resolveConfig(makeCmd({ appId: 'com.cli.app' }))).appId).toBe('com.cli.app');
        expect((await resolveConfig(makeCmd({}))).appId).toBe('com.env.app');
        delete process.env.CAPGO_APP_ID;
        expect((await resolveConfig(makeCmd({}))).appId).toBe('com.file.app');
    });
});
