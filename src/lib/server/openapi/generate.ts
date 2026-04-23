import {
    toJsonSchema,
    toJsonSchemaDefs,
    type ConversionConfig,
    type JsonSchema,
    type OverrideSchemaContext
} from '@valibot/to-json-schema';
import type { BaseIssue, BaseSchema } from 'valibot';
import { ROUTE_META, type RouteDescriptor } from '../defineRoute.js';
import { NAMED_SCHEMAS } from '../validation/entities.js';

type AnySchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
type Method = (typeof HTTP_METHODS)[number];

interface DiscoveredRoute {
    path: string;
    method: Lowercase<Method>;
    descriptor: RouteDescriptor;
}

/** Eagerly import every route module so their `defineRoute` configs are visible. */
function discover(): DiscoveredRoute[] {
    const modules = import.meta.glob('/src/routes/**/+server.ts', { eager: true }) as Record<
        string,
        Record<string, unknown>
    >;
    const routes: DiscoveredRoute[] = [];
    for (const [file, mod] of Object.entries(modules)) {
        const path = filePathToOpenApi(file);
        for (const method of HTTP_METHODS) {
            const handler = mod[method] as unknown;
            if (!handler || typeof handler !== 'function') continue;
            const descriptor = (handler as unknown as Record<PropertyKey, unknown>)[ROUTE_META] as
                | RouteDescriptor
                | undefined;
            if (!descriptor) continue;
            routes.push({
                path,
                method: method.toLowerCase() as Lowercase<Method>,
                descriptor
            });
        }
    }
    return routes;
}

/**
 * `/src/routes/admin/bundles/[id]/+server.ts` → `/admin/bundles/{id}`.
 * Route groups `(foo)` are stripped.
 */
function filePathToOpenApi(file: string): string {
    const withoutPrefix = file.replace(/^\/src\/routes/, '').replace(/\/\+server\.ts$/, '');
    const segments = withoutPrefix
        .split('/')
        .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')))
        .map((s) => {
            if (s.startsWith('[...') && s.endsWith(']')) return `{${s.slice(4, -1)}}`;
            if (s.startsWith('[') && s.endsWith(']')) return `{${s.slice(1, -1)}}`;
            return s;
        });
    return '/' + segments.join('/');
}

// --- schema conversion -------------------------------------------------------

/** Shared conversion config: draft-2020-12 (matches OpenAPI 3.1), date-time override. */
const baseConversion: ConversionConfig = {
    target: 'draft-2020-12',
    errorMode: 'ignore',
    overrideSchema: ({ valibotSchema }: OverrideSchemaContext) => {
        if (valibotSchema.type === 'date') return { type: 'string', format: 'date-time' };
        return undefined;
    }
};

/**
 * Convert a route-level schema with reference collapsing:
 *   - Anywhere the schema mentions a registered NAMED_SCHEMAS entry, emit
 *     `$ref: #/components/schemas/<Name>` instead of inlining it.
 *   - Date → string/date-time.
 *   - Strip the emitted `$defs` block and top-level `$schema` key (they'd
 *     duplicate components.schemas and clutter the spec).
 */
function convertOperationSchema(schema: AnySchema): JsonSchema {
    const converted = toJsonSchema(schema, {
        ...baseConversion,
        definitions: NAMED_SCHEMAS
    });
    return cleanOperationSchema(converted);
}

/** Build the components.schemas block. */
function buildComponentSchemas(): Record<string, JsonSchema> {
    const defs = toJsonSchemaDefs(NAMED_SCHEMAS, baseConversion);
    const out: Record<string, JsonSchema> = {};
    for (const [name, schema] of Object.entries(defs)) {
        out[name] = cleanOperationSchema(schema);
    }
    return out;
}

/** Recursively rewrite `#/$defs/X` refs to `#/components/schemas/X`, drop `$defs` / `$schema`. */
function cleanOperationSchema<T>(input: T): T {
    if (Array.isArray(input)) {
        return input.map((item) => cleanOperationSchema(item)) as unknown as T;
    }
    if (input && typeof input === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
            if (k === '$defs' || k === '$schema') continue;
            if (k === '$ref' && typeof v === 'string') {
                out[k] = v.startsWith('#/$defs/') ? '#/components/schemas/' + v.slice('#/$defs/'.length) : v;
                continue;
            }
            out[k] = cleanOperationSchema(v);
        }
        return out as unknown as T;
    }
    return input;
}

// --- parameter extraction ---------------------------------------------------

interface OpenApiParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    example?: unknown;
    schema: JsonSchema;
}

/**
 * Walk an object schema's top-level properties and emit OpenAPI
 * `parameters` entries. `description`, `examples`, etc. bubble up
 * from each property's own JSON schema.
 */
function extractParameters(
    schema: AnySchema,
    where: 'path' | 'query',
    pathTemplate?: string,
    routeExample?: Record<string, unknown>
): OpenApiParameter[] {
    const js = convertOperationSchema(schema) as Record<string, unknown>;
    const props = (js.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((js.required as string[]) ?? []);
    const templated =
        where === 'path' && pathTemplate
            ? new Set([...pathTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]))
            : new Set<string>();
    const out: OpenApiParameter[] = [];
    for (const [name, propSchema] of Object.entries(props)) {
        const description =
            typeof propSchema === 'object' && propSchema && 'description' in propSchema
                ? (propSchema as { description?: string }).description
                : undefined;
        const param: OpenApiParameter = {
            name,
            in: where,
            required: where === 'path' ? templated.has(name) || required.has(name) : required.has(name),
            schema: propSchema
        };
        if (description) param.description = description;
        if (routeExample && Object.prototype.hasOwnProperty.call(routeExample, name)) {
            param.example = routeExample[name];
        }
        out.push(param);
    }
    return out;
}

// --- responses --------------------------------------------------------------

interface OpenApiMediaType {
    schema: JsonSchema;
    example?: unknown;
    examples?: Record<string, { summary?: string; value: unknown }>;
}

interface OpenApiResponse {
    description: string;
    content?: { 'application/json': OpenApiMediaType };
    $ref?: string;
}

function buildResponses(d: RouteDescriptor): Record<string, OpenApiResponse> {
    const successSchema = d.response ? convertOperationSchema(d.response) : undefined;

    if (d.errorMode === 'err200') {
        // Plugin wire contract: always 200. Body is either the success shape
        // (when response schema is set) or a PluginError envelope. If the route
        // declared `errorCodes`, tighten the error shape to enumerate them.
        const errorShape: JsonSchema =
            d.errorCodes && d.errorCodes.length > 0
                ? {
                      type: 'object',
                      required: ['error', 'message'],
                      properties: {
                          error: {
                              type: 'string',
                              enum: [...d.errorCodes],
                              description: 'Business-error code.'
                          },
                          message: { type: 'string' }
                      }
                  }
                : { $ref: '#/components/schemas/PluginError' };
        const schema: JsonSchema = successSchema ? { oneOf: [successSchema, errorShape] } : errorShape;
        const media: OpenApiMediaType = { schema };
        if (d.examples.response !== undefined) media.example = d.examples.response;
        return {
            '200': {
                description:
                    'Always HTTP 200. Responses encode success or business errors in the body — the native Capgo plugin treats any non-200 as a network failure.',
                content: { 'application/json': media }
            }
        };
    }

    // throw-mode: standard SvelteKit error responses.
    const media: OpenApiMediaType | undefined = successSchema ? { schema: successSchema } : undefined;
    if (media && d.examples.response !== undefined) media.example = d.examples.response;

    const responses: Record<string, OpenApiResponse> = {
        [String(d.successStatus)]: {
            description: 'Success',
            ...(media ? { content: { 'application/json': media } } : {})
        }
    };
    const errorRefs = ['400', '401', '404', '409', '500'];
    const needsAuth = d.auth === 'admin' || typeof d.auth === 'function';
    for (const status of errorRefs) {
        if (status === '401' && !needsAuth) continue;
        responses[status] = { $ref: `#/components/responses/Error${status}` } as OpenApiResponse;
    }
    return responses;
}

// --- operation -------------------------------------------------------------

interface OpenApiExternalDocs {
    url: string;
    description?: string;
}

interface OpenApiOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
    externalDocs?: OpenApiExternalDocs;
    security?: Array<Record<string, string[]>>;
    parameters?: OpenApiParameter[];
    requestBody?: {
        required?: boolean;
        content: { 'application/json': OpenApiMediaType };
    };
    responses: Record<string, OpenApiResponse>;
}

// --- top-level document -----------------------------------------------------

export interface OpenApiDocument {
    openapi: '3.1.0';
    info: {
        title: string;
        version: string;
        description?: string;
        contact?: { name?: string; url?: string; email?: string };
        license?: { name: string; url?: string };
    };
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
    externalDocs?: OpenApiExternalDocs;
    paths: Record<string, Record<string, OpenApiOperation>>;
    components: {
        schemas: Record<string, JsonSchema>;
        securitySchemes: Record<string, unknown>;
        responses: Record<string, OpenApiResponse>;
    };
}

export interface BuildOptions {
    title?: string;
    version?: string;
    description?: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
    externalDocs?: OpenApiExternalDocs;
}

export function buildOpenApi(options: BuildOptions = {}): OpenApiDocument {
    const routes = discover();
    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    const seenOpIds = new Map<string, string>(); // opId → "METHOD path" for error reporting

    for (const route of routes) {
        const { descriptor: d, path, method } = route;
        const parameters: OpenApiParameter[] = [];
        if (d.params) {
            parameters.push(
                ...extractParameters(d.params, 'path', path, d.examples.params as Record<string, unknown> | undefined)
            );
        }
        if (d.query) {
            parameters.push(
                ...extractParameters(
                    d.query,
                    'query',
                    undefined,
                    d.examples.query as Record<string, unknown> | undefined
                )
            );
        }

        if (d.meta.operationId) {
            const here = `${method.toUpperCase()} ${path}`;
            const prev = seenOpIds.get(d.meta.operationId);
            if (prev) {
                throw new Error(
                    `Duplicate operationId "${d.meta.operationId}" on ${here} and ${prev}. ` +
                        `operationId must be unique across the spec.`
                );
            }
            seenOpIds.set(d.meta.operationId, here);
        }

        const op: OpenApiOperation = {
            operationId: d.meta.operationId,
            summary: d.meta.summary,
            description: d.meta.description,
            tags: d.meta.tags,
            deprecated: d.meta.deprecated,
            externalDocs: d.meta.externalDocs,
            responses: buildResponses(d)
        };
        if (parameters.length > 0) op.parameters = parameters;
        if (d.body) {
            const media: OpenApiMediaType = { schema: convertOperationSchema(d.body) };
            if (d.examples.body !== undefined) media.example = d.examples.body;
            op.requestBody = { required: true, content: { 'application/json': media } };
        }
        if (d.auth === 'admin' || typeof d.auth === 'function') {
            op.security = [{ bearerAuth: [] }];
        }

        // Strip undefined keys so the emitted JSON is tidy.
        for (const k of Object.keys(op) as (keyof OpenApiOperation)[]) {
            if (op[k] === undefined) delete op[k];
        }

        paths[path] ??= {};
        paths[path][method] = op;
    }

    return {
        openapi: '3.1.0',
        info: {
            title: options.title ?? 'capgo-update-lite',
            version: options.version ?? '0.0.0',
            description: options.description,
            contact: options.contact,
            license: options.license
        },
        servers: options.servers,
        tags: options.tags,
        externalDocs: options.externalDocs,
        paths,
        components: {
            schemas: buildComponentSchemas(),
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'Admin API token. Send as `Authorization: Bearer <ADMIN_TOKEN>`.'
                }
            },
            responses: {
                Error400: errorResponse('Bad request — validation or client error.', {
                    message: 'Invalid key: Expected "app_id" but received undefined'
                }),
                Error401: errorResponse('Missing or invalid admin token.', { message: 'unauthorized' }),
                Error404: errorResponse('Resource not found.', { message: 'bundle 42 not found' }),
                Error409: errorResponse('Conflict with current server state.', {
                    message: "cannot activate bundle 42: state is 'pending'"
                }),
                Error500: errorResponse('Internal server error.', {
                    message: 'Platform bindings missing'
                })
            }
        }
    };
}

function errorResponse(description: string, example: Record<string, unknown>): OpenApiResponse {
    return {
        description,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['message'],
                    properties: { message: { type: 'string' } },
                    additionalProperties: true
                },
                example
            }
        }
    };
}
