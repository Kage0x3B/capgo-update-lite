#!/usr/bin/env tsx
/**
 * Publish a built SvelteKit/Capacitor bundle to capgo-update-lite.
 *
 * Usage:
 *   pnpm publish-bundle <app-id> <version> <dist-dir> [--activate]
 *
 * Env:
 *   OTA_BASE_URL   e.g. http://localhost:8787 or https://ota.example.com
 *   ADMIN_TOKEN    Bearer token matching the server's ADMIN_TOKEN secret
 *
 * Flow: zip <dist-dir> in memory → init → PUT to R2 → commit [with activate].
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import JSZip from 'jszip';

type InitResponse = {
	bundle_id: number;
	r2_key: string;
	upload_url: string;
	expires_at: string;
};

type BundleRow = {
	id: number;
	app_id: string;
	version: string;
	state: string;
	active: boolean;
};

function die(msg: string, code = 1): never {
	console.error(`[31merror:[0m ${msg}`);
	process.exit(code);
}

function parseArgs(argv: string[]): { appId: string; version: string; dist: string; activate: boolean } {
	const positional: string[] = [];
	let activate = false;
	for (const arg of argv) {
		if (arg === '--activate') activate = true;
		else if (arg.startsWith('--')) die(`unknown flag: ${arg}`);
		else positional.push(arg);
	}
	if (positional.length !== 3) {
		die('usage: publish-bundle <app-id> <version> <dist-dir> [--activate]');
	}
	return { appId: positional[0], version: positional[1], dist: positional[2], activate };
}

async function collectFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string) {
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

async function zipDir(root: string): Promise<Uint8Array> {
	const rootStat = await stat(root).catch(() => null);
	if (!rootStat?.isDirectory()) die(`not a directory: ${root}`);

	const files = await collectFiles(root);
	if (files.length === 0) die(`no files found under: ${root}`);

	const hasIndex = files.some((f) => path.relative(root, f) === 'index.html');
	if (!hasIndex) {
		console.warn(
			'[33mwarn:[0m no index.html at the root of the dist dir — the plugin may not boot the bundle'
		);
	}

	const zip = new JSZip();
	for (const file of files) {
		const rel = path.relative(root, file).split(path.sep).join('/');
		zip.file(rel, await readFile(file));
	}
	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function sha256Hex(bytes: Uint8Array): string {
	const h = createHash('sha256');
	h.update(bytes);
	return h.digest('hex');
}

async function main() {
	const { appId, version, dist, activate } = parseArgs(process.argv.slice(2));
	const baseUrl = process.env.OTA_BASE_URL;
	const token = process.env.ADMIN_TOKEN;
	if (!baseUrl) die('OTA_BASE_URL is not set');
	if (!token) die('ADMIN_TOKEN is not set');

	console.log(`→ zipping ${dist}`);
	const zipped = await zipDir(dist);
	const checksum = sha256Hex(zipped);
	console.log(`  size=${(zipped.byteLength / 1024).toFixed(1)} KB  sha256=${checksum.slice(0, 12)}…`);

	console.log(`→ init`);
	const initRes = await fetch(`${baseUrl}/admin/bundles/init`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ app_id: appId, version })
	});
	if (!initRes.ok) die(`init failed: ${initRes.status} ${await initRes.text()}`);
	const init = (await initRes.json()) as InitResponse;
	console.log(`  bundle_id=${init.bundle_id}  r2_key=${init.r2_key}`);

	console.log(`→ uploading to R2`);
	const putRes = await fetch(init.upload_url, {
		method: 'PUT',
		body: zipped,
		headers: { 'content-type': 'application/zip' }
	});
	if (!putRes.ok) die(`R2 PUT failed: ${putRes.status} ${await putRes.text()}`);

	console.log(`→ commit${activate ? ' (+activate)' : ''}`);
	const commitRes = await fetch(`${baseUrl}/admin/bundles/commit`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ bundle_id: init.bundle_id, checksum, activate })
	});
	if (!commitRes.ok) die(`commit failed: ${commitRes.status} ${await commitRes.text()}`);
	const row = (await commitRes.json()) as BundleRow;
	console.log(
		`✓ published bundle ${init.bundle_id} (${version}) — state=${row.state} active=${row.active}`
	);
}

void main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)));
