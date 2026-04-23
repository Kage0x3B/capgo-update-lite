import { defineConfig } from 'drizzle-kit';

// POSTGRES_URL is only required for commands that hit a live DB
// (migrate/push/studio). `generate` diffs schema files and does not need it.
const url = process.env.POSTGRES_URL;

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/server/db/schema.ts',
    out: './drizzle',
    ...(url ? { dbCredentials: { url } } : {}),
    strict: true,
    verbose: true
});
