import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpVersion, detectIndent, writePackageJsonVersion } from './version-bump.js';

let tmp: string;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-version-bump-test-'));
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

describe('bumpVersion', () => {
    it.each([
        ['1.2.3', 'patch', '1.2.4'],
        ['1.2.3', 'minor', '1.3.0'],
        ['1.2.3', 'major', '2.0.0'],
        ['0.0.0', 'patch', '0.0.1'],
        // Apple-style two-segment input is normalized via parseSemver to .0
        ['1.2', 'patch', '1.2.1'],
        ['1.2', 'minor', '1.3.0'],
        ['110', 'major', '111.0.0']
    ] as const)('%s + %s = %s', (input, level, expected) => {
        expect(bumpVersion(input, level)).toBe(expected);
    });

    it('throws on non-numeric input', () => {
        expect(() => bumpVersion('not-a-version', 'patch')).toThrow();
    });
});

describe('detectIndent', () => {
    it('detects 2-space indent', () => {
        expect(detectIndent('{\n  "name": "x"\n}\n')).toBe(2);
    });
    it('detects 4-space indent', () => {
        expect(detectIndent('{\n    "name": "x"\n}\n')).toBe(4);
    });
    it('detects tab indent', () => {
        expect(detectIndent('{\n\t"name": "x"\n}\n')).toBe('\t');
    });
    it('falls back to 2 on empty/single-line input', () => {
        expect(detectIndent('{}')).toBe(2);
    });
});

describe('writePackageJsonVersion', () => {
    async function writePkg(body: string): Promise<string> {
        const p = path.join(tmp, 'package.json');
        await writeFile(p, body);
        return p;
    }

    it('rewrites the version and returns the previous value', async () => {
        const p = await writePkg(`{\n  "name": "x",\n  "version": "1.2.3"\n}\n`);
        const result = await writePackageJsonVersion(p, '1.2.4');
        expect(result.previous).toBe('1.2.3');
        const after = JSON.parse(await readFile(p, 'utf8')) as { version: string };
        expect(after.version).toBe('1.2.4');
    });

    it('preserves 4-space indentation', async () => {
        const p = await writePkg(`{\n    "name": "x",\n    "version": "1.0.0"\n}\n`);
        await writePackageJsonVersion(p, '2.0.0');
        const raw = await readFile(p, 'utf8');
        // The 4-space indent should be preserved on the rewritten file.
        expect(raw).toContain('    "name": "x"');
        expect(raw).toContain('    "version": "2.0.0"');
    });

    it('preserves tab indentation', async () => {
        const p = await writePkg(`{\n\t"name": "x",\n\t"version": "1.0.0"\n}\n`);
        await writePackageJsonVersion(p, '1.0.1');
        const raw = await readFile(p, 'utf8');
        expect(raw).toContain('\t"version": "1.0.1"');
    });

    it('preserves trailing newline when present', async () => {
        const p = await writePkg(`{\n  "version": "1.0.0"\n}\n`);
        await writePackageJsonVersion(p, '1.0.1');
        const raw = await readFile(p, 'utf8');
        expect(raw.endsWith('\n')).toBe(true);
    });

    it('does not add a trailing newline when source had none', async () => {
        const p = await writePkg(`{\n  "version": "1.0.0"\n}`);
        await writePackageJsonVersion(p, '1.0.1');
        const raw = await readFile(p, 'utf8');
        expect(raw.endsWith('\n')).toBe(false);
    });

    it('throws when the file has no top-level "version" field', async () => {
        const p = await writePkg(`{\n  "name": "x"\n}\n`);
        await expect(writePackageJsonVersion(p, '1.0.0')).rejects.toThrow(/no top-level "version"/);
    });
});
