import { AwsClient } from 'aws4fetch';

const BUCKET_NAME = 'capgo-update-lite';

export type R2Env = {
	R2_S3_ENDPOINT: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
};

function s3Endpoint(env: R2Env): string {
	if (!env.R2_S3_ENDPOINT) throw new Error('R2_S3_ENDPOINT not configured');
	return env.R2_S3_ENDPOINT.replace(/\/+$/, '');
}

function client(env: R2Env): AwsClient {
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: 's3',
		region: 'auto'
	});
}

function objectUrl(env: R2Env, key: string): string {
	return `${s3Endpoint(env)}/${BUCKET_NAME}/${encodePath(key)}`;
}

function encodePath(key: string): string {
	return key
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

/** Presigned URL that the admin CLI PUTs the bundle zip directly to. */
export async function presignPut(env: R2Env, key: string, ttlSeconds = 900): Promise<string> {
	const url = new URL(objectUrl(env, key));
	url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
	const signed = await client(env).sign(
		new Request(url, { method: 'PUT' }),
		{ aws: { signQuery: true } }
	);
	return signed.url;
}

/** Presigned GET URL handed to the device plugin in /updates responses. */
export async function presignGet(env: R2Env, key: string, ttlSeconds = 900): Promise<string> {
	const url = new URL(objectUrl(env, key));
	url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
	const signed = await client(env).sign(
		new Request(url, { method: 'GET' }),
		{ aws: { signQuery: true } }
	);
	return signed.url;
}

/**
 * Stream the object via the S3 API and compute its SHA-256 in one pass using
 * Workers' native DigestStream — avoids buffering the whole zip in memory and
 * works identically in `wrangler dev` (local) and production without needing
 * a real R2 binding.
 */
export async function sha256Hex(env: R2Env, key: string): Promise<string> {
	const res = await client(env).fetch(objectUrl(env, key), { method: 'GET' });
	if (!res.ok || !res.body) {
		throw new Error(`R2 GET failed for ${key}: ${res.status}`);
	}
	const digester = new (crypto as unknown as { DigestStream: new (algorithm: string) => { digest: Promise<ArrayBuffer> } & WritableStream<Uint8Array> }).DigestStream('SHA-256');
	await res.body.pipeTo(digester);
	const digest = await digester.digest;
	return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, '0');
	}
	return out;
}

export async function deleteObject(env: R2Env, key: string): Promise<void> {
	const res = await client(env).fetch(objectUrl(env, key), { method: 'DELETE' });
	if (!res.ok && res.status !== 404) {
		throw new Error(`R2 DELETE failed for ${key}: ${res.status}`);
	}
}
