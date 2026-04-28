import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

// Flat config. Applies to both packages. Rules are intentionally light —
// catch real bugs (unused-vars, no-explicit-any, await-in-non-async) without
// fighting the existing code style. Tighten over time, not in one go.
export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.svelte-kit/**',
            '**/.wrangler/**',
            '**/drizzle/**',
            '**/coverage/**',
            'packages/app/worker-configuration.d.ts'
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: {
            // Unused symbols are routine warning fodder while iterating;
            // surface them but allow `_` prefix to suppress.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    // `const { foo, ...rest } = obj;` to drop a key — the named
                    // var is unused on purpose, the destructure is the point.
                    ignoreRestSiblings: true
                }
            ],
            // The codebase deliberately uses `unknown as T` casts at platform
            // boundaries (Workers DigestStream, drizzle platform.env). Flag
            // them to discourage growth, but only as warnings.
            '@typescript-eslint/no-explicit-any': 'warn',
            // SvelteKit `error()` / `redirect()` helpers throw — TS doesn't
            // know that, but ESLint's no-throw-literal rule false-positives.
            'no-throw-literal': 'off'
        }
    },
    {
        // CommonJS / Node script files (postbuild, drizzle config) are pure
        // Node — no DOM globals, allow `process.env` etc.
        files: ['**/*.{cjs,mjs}', '**/cron/append.mjs', 'packages/app/drizzle.config.ts'],
        languageOptions: {
            globals: { ...globals.node }
        }
    },
    {
        // cron/job.js is appended to SvelteKit's generated _worker.js at build
        // time, so `worker_default` is in scope at runtime even though the file
        // can't import it directly. See cron/append.mjs.
        files: ['**/cron/job.js'],
        languageOptions: {
            globals: { worker_default: 'writable' }
        }
    },
    {
        // SvelteKit's `App` namespace augmentations are intentionally empty
        // interfaces — userland uses `declare global` to extend them only when
        // they want to. The "use object/unknown instead" rule doesn't apply.
        files: ['**/app.d.ts'],
        rules: {
            '@typescript-eslint/no-empty-object-type': 'off'
        }
    },
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                parser: tseslint.parser,
                extraFileExtensions: ['.svelte']
            }
        },
        plugins: {
            svelte
        },
        rules: {
            // svelte plugin's recommended set, applied after the general TS rules.
            ...svelte.configs.recommended.rules,
            // Same warn-only stance for unused vars in Svelte components.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
            ]
        }
    },
    {
        // Test files: `any` and unused expressions are common in arrange/act
        // blocks, no need to police them.
        files: ['**/*.test.ts', '**/*.spec.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-expressions': 'off'
        }
    }
);
