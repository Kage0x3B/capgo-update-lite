import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppIdFromCapacitorConfig } from './capacitor-config.js';

let tmp: string;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-capacitor-config-test-'));
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

async function write(filename: string, contents: string): Promise<void> {
    await mkdir(tmp, { recursive: true });
    await writeFile(path.join(tmp, filename), contents);
}

describe('readAppIdFromCapacitorConfig', () => {
    it('returns null when no capacitor.config.* file exists', async () => {
        expect(await readAppIdFromCapacitorConfig(tmp)).toBeNull();
    });

    it('parses capacitor.config.json via JSON.parse', async () => {
        await write(
            'capacitor.config.json',
            JSON.stringify({ appId: 'com.example.app', appName: 'Example' }, null, 2)
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result).toEqual({ appId: 'com.example.app', source: 'capacitor.config.json' });
    });

    it('falls back to regex when JSON has comments / trailing commas', async () => {
        // Strict JSON.parse rejects this, so the regex path must catch it.
        await write(
            'capacitor.config.json',
            `{\n  // legacy hand-written file with comments\n  "appId": "com.example.legacy",\n}`
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.legacy');
    });

    it('parses single-quoted appId in a TS module', async () => {
        await write(
            'capacitor.config.ts',
            `import type { CapacitorConfig } from '@capacitor/cli';\nconst c: CapacitorConfig = {\n  appId: 'com.example.ts',\n  appName: 'X'\n};\nexport default c;`
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result).toEqual({ appId: 'com.example.ts', source: 'capacitor.config.ts' });
    });

    it('parses double-quoted appId in a JS module', async () => {
        await write(
            'capacitor.config.js',
            `module.exports = {\n  appId: "com.example.js",\n  appName: "X"\n};`
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.js');
    });

    it('parses backtick-quoted appId', async () => {
        await write(
            'capacitor.config.ts',
            'const config = { appId: `com.example.tpl`, appName: `X` };'
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.tpl');
    });

    it('parses JSON-style quoted-key in a TS file', async () => {
        // Some hand-written configs use the JSON-quoted key shape even in TS.
        await write(
            'capacitor.config.ts',
            `export default {\n  "appId": "com.example.quoted-key",\n};`
        );
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.quoted-key');
    });

    it('tolerates no-whitespace shapes (appId:"...")', async () => {
        await write('capacitor.config.js', `module.exports={appId:"com.example.tight"};`);
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.tight');
    });

    it('does not match a mismatched quote pair like \'foo"', async () => {
        await write(
            'capacitor.config.ts',
            `const c = { appId: 'broken", appName: 'X' };` // mismatched quotes around the value
        );
        // Our regex requires matching pairs, so this returns null. (A regex
        // that didn't enforce pairing would happily return "broken".)
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result).toBeNull();
    });

    it('prefers TS over JS when both exist (CANDIDATES order)', async () => {
        await write('capacitor.config.ts', `export default { appId: 'com.example.ts' };`);
        await write('capacitor.config.js', `module.exports = { appId: 'com.example.js' };`);
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.appId).toBe('com.example.ts');
    });

    it('returns null when the file exists but has no appId field', async () => {
        await write('capacitor.config.json', JSON.stringify({ appName: 'X' }));
        expect(await readAppIdFromCapacitorConfig(tmp)).toBeNull();
    });

    it('returns null when JSON is unparseable AND has no regex match', async () => {
        await write('capacitor.config.json', `not even close to valid json`);
        expect(await readAppIdFromCapacitorConfig(tmp)).toBeNull();
    });

    it('reports the source filename relative to cwd', async () => {
        await write('capacitor.config.ts', `export default { appId: 'com.example.app' };`);
        const result = await readAppIdFromCapacitorConfig(tmp);
        expect(result?.source).toBe('capacitor.config.ts');
    });
});
