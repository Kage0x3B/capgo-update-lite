import JSZip from 'jszip';

export type ZipResult = { blob: Blob; sha256: string; size: number };

/**
 * Zip the provided files into a deflated archive and compute its SHA-256.
 *
 * Assumes the `File` objects carry a `webkitRelativePath` (from an `<input type="file" webkitdirectory>`).
 * The first path segment (the user-picked folder name) is stripped so `index.html`
 * lands at the zip root — matching the layout `scripts/publish.ts` produces.
 */
export async function zipFiles(files: File[]): Promise<ZipResult> {
    if (files.length === 0) throw new Error('no files selected');
    const zip = new JSZip();
    let hasIndex = false;
    for (const file of files) {
        const rel = file.webkitRelativePath || file.name;
        const parts = rel.split('/');
        const path = parts.length > 1 ? parts.slice(1).join('/') : rel;
        if (path === 'index.html') hasIndex = true;
        zip.file(path, await file.arrayBuffer());
    }
    if (!hasIndex) {
        throw new Error('zip is missing index.html at the root — pick the dist folder, not its parent');
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = toHex(new Uint8Array(hash));
    return { blob, sha256, size: blob.size };
}

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}
