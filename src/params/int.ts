import type { ParamMatcher } from '@sveltejs/kit';

/** Positive integer id. No leading zeros. */
export const match: ParamMatcher = (param) => /^[1-9][0-9]*$/.test(param);
