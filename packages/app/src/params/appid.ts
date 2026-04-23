import type { ParamMatcher } from '@sveltejs/kit';

/** Reverse-domain app identifier, e.g. `com.example.notes`. Max 128 chars. */
const PATTERN = /^[a-z0-9]+(\.[\w-]+)+$/i;
export const match: ParamMatcher = (param) => param.length <= 128 && PATTERN.test(param);
