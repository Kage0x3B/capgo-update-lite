import { error } from '@sveltejs/kit';

export function requireAdmin(request: Request, env: { ADMIN_TOKEN: string }): void {
	const header = request.headers.get('authorization') ?? '';
	const [scheme, token] = header.split(' ');
	if (scheme !== 'Bearer' || !token || !timingSafeEquals(token, env.ADMIN_TOKEN)) {
		throw error(401, 'unauthorized');
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}
