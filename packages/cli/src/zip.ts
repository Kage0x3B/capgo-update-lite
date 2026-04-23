import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { fail, step } from './output.js';

export async function collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) out.push(full);
        }
    }
    await walk(root);
    return out;
}

export async function zipDir(root: string): Promise<Uint8Array> {
    const files = await collectFiles(root);
    if (files.length === 0) fail(`no files found under: ${root}`);
    step(`Zipping ${root} (${files.length} files)`);
    const zip = new JSZip();
    for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        zip.file(rel, await readFile(file));
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function verifyZipIntegrity(bytes: Uint8Array): Promise<void> {
    try {
        await new JSZip().loadAsync(bytes);
    } catch (e) {
        fail(`zip integrity check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}
