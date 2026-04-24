import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    collectNativePackages,
    fingerprintDiff,
    readAndroidVersionName,
    readIosShortVersion,
    sameNativeFingerprint
} from './native.js';

let tmp: string;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-native-test-'));
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

async function writeFileEnsuringDir(p: string, contents: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, contents);
}

describe('readAndroidVersionName', () => {
    it('parses Groovy-style versionName "..."', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'app/build.gradle'),
            `android {\n  defaultConfig {\n    versionName "1.4.0"\n  }\n}\n`
        );
        expect(await readAndroidVersionName(tmp)).toBe('1.4.0');
    });

    it('parses KTS-style versionName = "..."', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'app/build.gradle.kts'),
            `android {\n  defaultConfig {\n    versionName = "2.1.7"\n  }\n}\n`
        );
        expect(await readAndroidVersionName(tmp)).toBe('2.1.7');
    });

    it('returns null when no gradle file exists', async () => {
        expect(await readAndroidVersionName(tmp)).toBeNull();
    });

    it('returns null when gradle file has no versionName', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'app/build.gradle'),
            `android {\n  defaultConfig {\n    versionCode 42\n  }\n}\n`
        );
        expect(await readAndroidVersionName(tmp)).toBeNull();
    });

    it('prefers the first candidate (build.gradle over .kts)', async () => {
        // Both present. Groovy wins because it's first in ANDROID_GRADLE_CANDIDATES.
        await writeFileEnsuringDir(path.join(tmp, 'app/build.gradle'), `versionName "1.0.0"\n`);
        await writeFileEnsuringDir(path.join(tmp, 'app/build.gradle.kts'), `versionName = "2.0.0"\n`);
        expect(await readAndroidVersionName(tmp)).toBe('1.0.0');
    });
});

describe('readIosShortVersion', () => {
    function plist(body: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
    }

    it('parses CFBundleShortVersionString', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'App/App/Info.plist'),
            plist(`  <key>CFBundleShortVersionString</key>\n  <string>1.4.0</string>`)
        );
        expect(await readIosShortVersion(tmp)).toBe('1.4.0');
    });

    it('tolerates whitespace between key and string tags', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'App/App/Info.plist'),
            plist(`  <key>CFBundleShortVersionString</key>\n\n\n  <string>\t2.0.1\t</string>`)
        );
        expect(await readIosShortVersion(tmp)).toBe('2.0.1');
    });

    it('returns null when the key is missing', async () => {
        await writeFileEnsuringDir(
            path.join(tmp, 'App/App/Info.plist'),
            plist(`  <key>CFBundleVersion</key>\n  <string>42</string>`)
        );
        expect(await readIosShortVersion(tmp)).toBeNull();
    });

    it('returns null when Info.plist is missing', async () => {
        expect(await readIosShortVersion(tmp)).toBeNull();
    });
});

describe('collectNativePackages', () => {
    async function writePkg(deps: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    }): Promise<string> {
        const p = path.join(tmp, 'package.json');
        await writeFile(p, JSON.stringify(deps));
        return p;
    }

    it('includes @capacitor/*, @capacitor-community/*, @ionic-enterprise/*, cordova-plugin-*, capacitor-plugin-*', async () => {
        const p = await writePkg({
            dependencies: {
                '@capacitor/app': '6.0.0',
                '@capacitor-community/bluetooth-le': '3.0.0',
                '@ionic-enterprise/auth': '5.0.0',
                'cordova-plugin-camera': '7.0.0',
                'capacitor-plugin-foo': '1.0.0',
                react: '18.0.0',
                vite: '5.0.0'
            }
        });
        const pkgs = await collectNativePackages(p);
        expect(pkgs).toEqual({
            '@capacitor-community/bluetooth-le': '3.0.0',
            '@capacitor/app': '6.0.0',
            '@ionic-enterprise/auth': '5.0.0',
            'capacitor-plugin-foo': '1.0.0',
            'cordova-plugin-camera': '7.0.0'
        });
        // Also assert non-native entries are filtered out.
        expect(pkgs).not.toHaveProperty('react');
        expect(pkgs).not.toHaveProperty('vite');
    });

    it('excludes @capacitor/cli and @capacitor/core (non-native members of the @capacitor/* family)', async () => {
        const p = await writePkg({
            dependencies: {
                '@capacitor/cli': '6.0.0',
                '@capacitor/core': '6.0.0',
                '@capacitor/app': '6.0.0'
            }
        });
        const pkgs = await collectNativePackages(p);
        expect(pkgs).toEqual({ '@capacitor/app': '6.0.0' });
    });

    it('returns keys in alphabetical order', async () => {
        const p = await writePkg({
            dependencies: {
                'cordova-plugin-zzz': '1.0.0',
                '@capacitor/app': '6.0.0',
                '@capacitor-community/bluetooth-le': '3.0.0'
            }
        });
        const pkgs = await collectNativePackages(p);
        expect(Object.keys(pkgs)).toEqual([
            '@capacitor-community/bluetooth-le',
            '@capacitor/app',
            'cordova-plugin-zzz'
        ]);
    });

    it('merges devDependencies; dependencies win on conflict', async () => {
        const p = await writePkg({
            dependencies: { '@capacitor/app': '6.0.0' },
            devDependencies: { '@capacitor/app': '5.0.0', '@capacitor/haptics': '6.0.0' }
        });
        const pkgs = await collectNativePackages(p);
        expect(pkgs['@capacitor/app']).toBe('6.0.0');
        expect(pkgs['@capacitor/haptics']).toBe('6.0.0');
    });

    it('returns empty map on invalid JSON', async () => {
        const p = path.join(tmp, 'package.json');
        await writeFile(p, 'not json');
        expect(await collectNativePackages(p)).toEqual({});
    });

    it('returns empty map when the file is missing', async () => {
        expect(await collectNativePackages(path.join(tmp, 'does-not-exist.json'))).toEqual({});
    });
});

describe('sameNativeFingerprint', () => {
    it('returns true for structurally equal maps', () => {
        expect(sameNativeFingerprint({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(true);
        expect(sameNativeFingerprint({}, {})).toBe(true);
    });

    it('returns false on differing keys', () => {
        expect(sameNativeFingerprint({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    });

    it('returns false on same keys with different versions', () => {
        expect(sameNativeFingerprint({ a: '1' }, { a: '2' })).toBe(false);
    });
});

describe('fingerprintDiff', () => {
    it('reports added packages', () => {
        const d = fingerprintDiff({ a: '1' }, { a: '1', b: '2' });
        expect(d).toEqual({ added: ['b'], removed: [], changed: [] });
    });

    it('reports removed packages', () => {
        const d = fingerprintDiff({ a: '1', b: '2' }, { a: '1' });
        expect(d).toEqual({ added: [], removed: ['b'], changed: [] });
    });

    it('reports version changes', () => {
        const d = fingerprintDiff({ a: '1' }, { a: '2' });
        expect(d).toEqual({ added: [], removed: [], changed: ['a'] });
    });

    it('reports all three classes simultaneously', () => {
        const prev = { a: '1', b: '2', c: '3' };
        const curr = { a: '1', b: '9', d: '4' };
        const d = fingerprintDiff(prev, curr);
        expect(d.added).toEqual(['d']);
        expect(d.removed).toEqual(['c']);
        expect(d.changed).toEqual(['b']);
    });

    it('empty vs empty produces no diff', () => {
        expect(fingerprintDiff({}, {})).toEqual({ added: [], removed: [], changed: [] });
    });
});
