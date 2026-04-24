import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/server/defineRoute.js';
import { initBundle, type InitBundleInput } from './bundles.js';
import type { Db } from '$lib/server/db/index.js';

// Narrow scope: assert the pre-DB semver validation inside initBundle fails
// with ApiError before it ever reaches the database. A Db stub that throws on
// any method call guarantees we never get that far — if a test passes without
// the stub throwing, the validation branch did its job.

function dbStubThatMustNotBeCalled(): Db {
    const target = new Proxy(
        {},
        {
            get(_, prop) {
                throw new Error(`Db.${String(prop)} called; validation should have thrown first`);
            }
        }
    );
    return target as unknown as Db;
}

function makeInput(overrides: Partial<InitBundleInput> = {}): InitBundleInput {
    return {
        app_id: 'com.example.app',
        version: '1.4.2',
        min_android_build: '1.0.0',
        min_ios_build: '1.0.0',
        native_packages: {},
        ...overrides
    };
}

describe('initBundle — pre-DB validation', () => {
    it('rejects non-semver version before touching the database', async () => {
        const input = makeInput({ version: 'not-semver' });
        await expect(initBundle(dbStubThatMustNotBeCalled(), {} as never, input)).rejects.toSatisfy(
            (e: unknown) => e instanceof ApiError && e.code === 'invalid_request'
        );
    });

    it('rejects non-semver min_android_build', async () => {
        const input = makeInput({ min_android_build: 'abc' });
        await expect(initBundle(dbStubThatMustNotBeCalled(), {} as never, input)).rejects.toSatisfy(
            (e: unknown) => e instanceof ApiError && e.code === 'invalid_request' && /min_android_build/.test(e.message)
        );
    });

    it('rejects non-semver min_ios_build', async () => {
        const input = makeInput({ min_ios_build: '1' });
        await expect(initBundle(dbStubThatMustNotBeCalled(), {} as never, input)).rejects.toSatisfy(
            (e: unknown) => e instanceof ApiError && e.code === 'invalid_request' && /min_ios_build/.test(e.message)
        );
    });
});
