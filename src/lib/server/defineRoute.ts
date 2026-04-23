import { error, isHttpError, json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import * as v from 'valibot';
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';
import { createDb, type Db } from './db/index.js';
import { requireAdmin } from './auth.js';
import { err200 } from './responses.js';

type AnySchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;
type Output<S extends AnySchema | undefined> = S extends AnySchema ? InferOutput<S> : undefined;

export type AuthStrategy = 'none' | 'admin' | ((event: RequestEvent) => void | Promise<void>);

export type ErrorMode = 'throw' | 'err200';

export interface RouteExternalDocs {
    url: string;
    description?: string;
}

export interface RouteMeta {
    summary?: string;
    description?: string;
    tags?: string[];
    operationId?: string;
    deprecated?: boolean;
    /** Per-operation "Read more" link rendered by Scalar/Redoc. */
    externalDocs?: RouteExternalDocs;
}

/** Whole-payload examples to display in OpenAPI docs alongside the field-level ones. */
export interface RouteExamples<
    B extends AnySchema | undefined,
    Q extends AnySchema | undefined,
    P extends AnySchema | undefined,
    R extends AnySchema | undefined
> {
    body?: B extends AnySchema ? InferOutput<B> : unknown;
    query?: Q extends AnySchema ? InferOutput<Q> : unknown;
    params?: P extends AnySchema ? InferOutput<P> : unknown;
    response?: R extends AnySchema ? InferOutput<R> : unknown;
}

export interface RouteConfig<
    B extends AnySchema | undefined = undefined,
    Q extends AnySchema | undefined = undefined,
    P extends AnySchema | undefined = undefined,
    R extends AnySchema | undefined = undefined
> {
    /**
     * Auth strategy. Defaults to `'admin'` (calls requireAdmin) — routes that
     * should be reachable without a token must opt out explicitly with `'none'`,
     * so accidentally omitting `auth:` fails closed.
     */
    auth?: AuthStrategy;
    /** Valibot schema for JSON body. */
    body?: B;
    /** Valibot schema for query params (URLSearchParams → flat object, first value wins). */
    query?: Q;
    /** Valibot schema for route params. Replaces the default Record<string,string> typing. */
    params?: P;
    /** Optional schema of the successful response payload. Used for OpenAPI docs only. */
    response?: R;
    /**
     * `'throw'` — validation/ApiError failures become `throw error(status, msg)` (normal SvelteKit).
     * `'err200'` — everything returns HTTP 200 with `{ error, message }` (plugin wire contract).
     */
    errorMode?: ErrorMode;
    /** Status code for the auto-JSON success response. Default 200. Ignored when handler returns a Response. */
    successStatus?: number;
    /** OpenAPI metadata. All optional. */
    meta?: RouteMeta;
    /** Whole-payload examples shown in API docs. */
    examples?: RouteExamples<B, Q, P, R>;
    /**
     * For `errorMode: 'err200'` routes, the concrete list of `error` codes this
     * operation can emit. Documentation-only — tightens the response schema from
     * the generic `PluginError` (`error: string`) to `error: enum[...]`.
     */
    errorCodes?: readonly string[];
}

export interface RouteEvent<
    B extends AnySchema | undefined,
    Q extends AnySchema | undefined,
    P extends AnySchema | undefined
> extends Omit<RequestEvent, 'platform' | 'params'> {
    /** Non-null — the wrapper asserts platform bindings are present before calling the handler. */
    platform: NonNullable<RequestEvent['platform']>;
    /** Parsed & validated body. `undefined` when no body schema was configured. */
    body: Output<B>;
    /** Parsed & validated query object. `undefined` when no query schema was configured. */
    query: Output<Q>;
    /** Parsed & validated route params (or the raw SvelteKit params when no schema). */
    params: P extends AnySchema ? InferOutput<P> : RequestEvent['params'];
    /**
     * Lazy Drizzle instance. First access opens a pooled postgres connection through
     * Hyperdrive; subsequent accesses return the same connection. The wrapper schedules
     * `platform.ctx.waitUntil(close())` in its finally block — only if you accessed it.
     */
    readonly db: Db;
}

type RouteReturn<R extends AnySchema | undefined> = R extends AnySchema ? InferOutput<R> : unknown;

export type RouteHandler<
    B extends AnySchema | undefined,
    Q extends AnySchema | undefined,
    P extends AnySchema | undefined,
    R extends AnySchema | undefined
> = (event: RouteEvent<B, Q, P>) => Response | RouteReturn<R> | Promise<Response | RouteReturn<R>>;

/** Throw this from a handler to produce a structured error response. */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly extra: Record<string, unknown>;
    constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/**
 * Marker attached to RequestHandlers produced by defineRoute, so the OpenAPI
 * generator can discover config without re-parsing source files.
 */
export const ROUTE_META = Symbol.for('capgo-update-lite.route-meta');

export interface RouteDescriptor {
    auth: AuthStrategy;
    errorMode: ErrorMode;
    successStatus: number;
    body?: AnySchema;
    query?: AnySchema;
    params?: AnySchema;
    response?: AnySchema;
    meta: RouteMeta;
    examples: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
        response?: unknown;
    };
    errorCodes?: readonly string[];
}

export type RouteHandlerWithMeta = RequestHandler & { [ROUTE_META]: RouteDescriptor };

/**
 * Wrap a RequestHandler with validation, auth, a lazy DB handle, auto-JSON
 * responses, and a uniform error model. Two error modes are supported:
 *
 * - `'throw'` (default, admin routes): throws SvelteKit `error(status, msg)`
 *   so 4xx/5xx propagate normally.
 * - `'err200'` (plugin routes /updates, /stats): every response is HTTP 200
 *   with `{ error, message }` — failures return, they don't throw — because
 *   the native Capgo plugin treats any non-200 as a network failure.
 */
export function defineRoute<
    B extends AnySchema | undefined = undefined,
    Q extends AnySchema | undefined = undefined,
    P extends AnySchema | undefined = undefined,
    R extends AnySchema | undefined = undefined
>(config: RouteConfig<B, Q, P, R>, handler: RouteHandler<B, Q, P, R>): RequestHandler {
    const errorMode: ErrorMode = config.errorMode ?? 'throw';
    const successStatus = config.successStatus ?? 200;
    const auth: AuthStrategy = config.auth ?? 'admin';

    const wrapped: RequestHandler = async (event) => {
        // platform — centralise the null-check
        const platform = event.platform;
        if (!platform) {
            return fail(errorMode, 500, 'server_misconfigured', 'Platform bindings missing');
        }

        // auth
        try {
            if (auth === 'admin') {
                requireAdmin(event.request);
            } else if (typeof auth === 'function') {
                await auth(event);
            }
        } catch (e) {
            return handleThrown(e, errorMode);
        }

        // body (skip parsing when no schema — don't consume the stream for nothing)
        let body: unknown = undefined;
        if (config.body) {
            let raw: unknown;
            try {
                raw = await event.request.json();
            } catch {
                return fail(errorMode, 400, 'invalid_request', 'Request body is not valid JSON');
            }
            const parsed = v.safeParse(config.body, raw);
            if (!parsed.success) {
                return fail(errorMode, 400, 'invalid_request', issuesToMessage(parsed.issues));
            }
            body = parsed.output;
        }

        // query
        let query: unknown = undefined;
        if (config.query) {
            const obj = Object.fromEntries(event.url.searchParams);
            const parsed = v.safeParse(config.query, obj);
            if (!parsed.success) {
                return fail(errorMode, 400, 'invalid_request', issuesToMessage(parsed.issues));
            }
            query = parsed.output;
        }

        // params
        let params: unknown = event.params;
        if (config.params) {
            const parsed = v.safeParse(config.params, event.params);
            if (!parsed.success) {
                return fail(errorMode, 400, 'invalid_request', issuesToMessage(parsed.issues));
            }
            params = parsed.output;
        }

        // lazy db — only instantiated if the handler reads `event.db`. We expose just the
        // drizzle instance and keep close() internal so route code stays `db.select(...)` clean.
        // Held in a ref object so TS doesn't over-narrow the let binding to `null`.
        const dbRef: { current: { db: Db; close: () => Promise<void> } | null } = { current: null };
        const getDb = (): Db => {
            if (!dbRef.current) dbRef.current = createDb(platform.env.HYPERDRIVE);
            return dbRef.current.db;
        };

        const routeEvent = new Proxy(event as unknown as Record<string | symbol, unknown>, {
            get(target, prop, receiver) {
                if (prop === 'platform') return platform;
                if (prop === 'body') return body;
                if (prop === 'query') return query;
                if (prop === 'params') return params;
                if (prop === 'db') return getDb();
                return Reflect.get(target, prop, receiver);
            }
        }) as unknown as RouteEvent<B, Q, P>;

        try {
            const result = await handler(routeEvent);
            if (result instanceof Response) return result;
            // Auto-JSON: treat any non-Response return value (including null) as payload.
            return json(result as unknown, { status: successStatus });
        } catch (e) {
            return handleThrown(e, errorMode);
        } finally {
            if (dbRef.current) platform.ctx.waitUntil(dbRef.current.close());
        }
    };

    const descriptor: RouteDescriptor = {
        auth,
        errorMode,
        successStatus,
        body: config.body,
        query: config.query,
        params: config.params,
        response: config.response,
        meta: config.meta ?? {},
        examples: (config.examples ?? {}) as RouteDescriptor['examples'],
        errorCodes: config.errorCodes
    };
    Object.defineProperty(wrapped, ROUTE_META, {
        value: descriptor,
        enumerable: false,
        configurable: false,
        writable: false
    });
    return wrapped;
}

// --- internals ---------------------------------------------------------------

function issuesToMessage(issues: readonly BaseIssue<unknown>[]): string {
    return issues.map((i) => i.message).join('; ');
}

function fail(mode: ErrorMode, status: number, code: string, message: string): Response {
    if (mode === 'err200') return err200(code, message);
    throw error(status, message);
}

function handleThrown(e: unknown, mode: ErrorMode): Response {
    // SvelteKit HttpError — produced by error(status, msg). Let it bubble in throw
    // mode; convert to err200 in plugin mode.
    if (isHttpError(e)) {
        if (mode === 'throw') throw e;
        const body = e.body as unknown;
        const message =
            typeof body === 'object' && body && 'message' in body
                ? String((body as { message: unknown }).message)
                : 'error';
        return err200(statusToCode(e.status), message);
    }
    if (e instanceof ApiError) {
        if (mode === 'err200') return err200(e.code, e.message, e.extra);
        throw error(e.status, e.message);
    }
    // Unknown — rethrow in throw mode (SvelteKit will 500); in err200 mode swallow.
    if (mode === 'throw') throw e;
    const message = e instanceof Error ? e.message : 'internal error';
    return err200('internal_error', message);
}

function statusToCode(status: number): string {
    if (status === 400) return 'invalid_request';
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 409) return 'conflict';
    if (status >= 500) return 'server_error';
    return 'error';
}
