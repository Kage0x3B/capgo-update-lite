// Postbuild step: append cron/job.js to the SvelteKit-generated _worker.js
// so the deployed worker exposes a `scheduled` handler alongside `fetch`.
// See cron/job.js for the design rationale.
import { appendFile, readFile } from 'node:fs/promises';

const WORKER_PATH = '.svelte-kit/cloudflare/_worker.js';
const SNIPPET_PATH = 'cron/job.js';

const snippet = await readFile(SNIPPET_PATH, 'utf8');
await appendFile(WORKER_PATH, '\n' + snippet, 'utf8');
console.log(`[cron/append] appended ${SNIPPET_PATH} → ${WORKER_PATH}`);
