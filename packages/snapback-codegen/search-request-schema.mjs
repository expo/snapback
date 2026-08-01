// Derivation of every JS-side carrier of the search request grammar from the
// one exported Rust-owned schema, schemas/search.request.schema.json
// (LLP 0131 §The search fixture / LLP 0115 CV-5).
//
// The Rust parser owns the grammar; this module never authors a shape. It
// walks the committed schemars output and derives:
//   - the generated TypeScript declarations codegen emits into api.d.ts
//     (replacing the previously hand-authored SearchQueryAstV1/SearchRequestV1
//     interfaces),
//   - the provider-projection descriptor expansion the `schemaRef` argument
//     carries by value,
//   - the self-contained JSON-Schema subtree embedded in the operation args
//     schema, and
//   - the top-level {query, limit, after} facts the generation-time gate
//     checks the authored search-function argument contract against.
//
// The walker is deliberately closed: a construct outside the exact schemars
// vocabulary this schema uses fails generation loudly rather than deriving a
// silently wrong carrier. A Rust grammar change therefore either derives
// correctly everywhere or refuses.
//
// Canonical-form projection rule: an OPTIONAL property whose schema is
// nullable (`type: ["X","null"]`, schemars' Option<T> encoding) derives as an
// optional non-null member. Serde skips absent members on serialization and
// clients author the canonical form; explicit-null admission remains a
// deserialization-side latitude the derived carriers do not advertise.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEARCH_QUERY_AST_SCHEMA_REF = 'snapback:search-query-ast:v1';
export const SEARCH_REQUEST_SCHEMA_FILE = 'search.request.schema.json';

// Mirrors index.mjs's TOOLCHAIN_ARTIFACT_ROOT rule: a source checkout reads
// the committed schemas in place; a published package carries the same tree
// under runtime-artifacts/.
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const ARTIFACT_ROOT = existsSync(join(REPO_ROOT, 'schemas'))
  ? REPO_ROOT
  : join(PACKAGE_ROOT, 'runtime-artifacts');

function derivationError(message) {
  const error = new Error(`SNAPBACK_SEARCH_REQUEST_SCHEMA_DERIVATION: ${message}`);
  error.code = 'SNAPBACK_SEARCH_REQUEST_SCHEMA_DERIVATION';
  throw error;
}

function loadCommittedSearchRequestSchema() {
  const path = join(ARTIFACT_ROOT, 'schemas', SEARCH_REQUEST_SCHEMA_FILE);
  if (!existsSync(path)) {
    derivationError(`committed schema not found at ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    derivationError(`committed schema at ${path} is not valid JSON: ${cause.message}`);
  }
  return null;
}

function resolveRef(schema, node) {
  const ref = node?.$ref;
  if (typeof ref !== 'string') return { name: null, node };
  const match = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(ref);
  if (!match) derivationError(`unsupported $ref ${ref}`);
  const target = schema.$defs?.[match[1]];
  if (!target) derivationError(`unresolved $ref ${ref}`);
  return { name: match[1], node: target };
}

// A `type: ["X","null"]` pair (schemars Option<T>). Returns the non-null type
// name or null when the node is not that shape.
function nullablePairType(node) {
  if (
    Array.isArray(node?.type)
    && node.type.length === 2
    && node.type.includes('null')
  ) {
    return node.type.find((entry) => entry !== 'null');
  }
  return null;
}

const TS_NAMED_DEFS = new Set(['SearchMatchAtomV1', 'SearchClauseV1', 'SearchQueryAstV1']);

// --- TypeScript derivation --------------------------------------------------

function tsForNode(schema, node, { named }) {
  const resolved = resolveRef(schema, node);
  if (resolved.name && named && TS_NAMED_DEFS.has(resolved.name)) return resolved.name;
  const target = resolved.node;
  const variants = target.oneOf ?? target.anyOf;
  if (Array.isArray(variants)) {
    return variants.map((variant) => tsForNode(schema, variant, { named })).join(' | ');
  }
  if (Array.isArray(target.enum)) {
    return target.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  const nullable = nullablePairType(target);
  const type = nullable ?? target.type;
  if (type === 'string') return 'string';
  if (type === 'boolean') return 'boolean';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'array') {
    if (!target.items) derivationError('array node without items');
    return `readonly ${wrapUnion(tsForNode(schema, target.items, { named }))}[]`;
  }
  if (type === 'object') {
    if (target.additionalProperties !== false || !target.properties) {
      derivationError('object node must be closed with declared properties');
    }
    const required = new Set(target.required ?? []);
    const members = Object.entries(target.properties).map(([name, property]) => {
      const optional = !required.has(name);
      if (!optional && nullablePairType(resolveRef(schema, property).node)) {
        derivationError(`required property ${name} is nullable; no derivation rule`);
      }
      return `${name}${optional ? '?' : ''}: ${tsForNode(schema, property, { named })}`;
    });
    return `{ ${members.join('; ')} }`;
  }
  derivationError(`no TypeScript derivation for node ${JSON.stringify(target)}`);
  return 'never';
}

function wrapUnion(text) {
  return text.includes('|') ? `(${text})` : text;
}

// --- Provider descriptor derivation ----------------------------------------

function descriptorForNode(schema, node) {
  const target = resolveRef(schema, node).node;
  const variants = target.oneOf ?? target.anyOf;
  if (Array.isArray(variants)) {
    if (variants.length < 2 || variants.length > 8) {
      derivationError(`descriptor union needs 2–8 variants, got ${variants.length}`);
    }
    return {
      shape: 'union',
      variants: variants.map((variant) => descriptorForNode(schema, variant)),
    };
  }
  if (Array.isArray(target.enum)) {
    if (target.enum.length === 1) return { shape: 'literal', value: target.enum[0] };
    return {
      shape: 'union',
      variants: target.enum.map((value) => ({ shape: 'literal', value })),
    };
  }
  const nullable = nullablePairType(target);
  const type = nullable ?? target.type;
  if (type === 'string' || type === 'boolean') return { shape: 'primitive', name: type };
  if (type === 'integer' || type === 'number') return { shape: 'primitive', name: 'number' };
  if (type === 'array') {
    return { shape: 'array', items: descriptorForNode(schema, target.items) };
  }
  if (type === 'object') {
    if (target.additionalProperties !== false || !target.properties) {
      derivationError('object node must be closed with declared properties');
    }
    const required = new Set(target.required ?? []);
    const fields = {};
    for (const [name, property] of Object.entries(target.properties)) {
      const descriptor = descriptorForNode(schema, property);
      fields[name] = required.has(name) ? descriptor : { ...descriptor, optional: true };
    }
    return { shape: 'object', fields };
  }
  derivationError(`no descriptor derivation for node ${JSON.stringify(target)}`);
  return null;
}

// --- Self-contained JSON-Schema embedding -----------------------------------

function inlineRefs(schema, node) {
  if (Array.isArray(node)) return node.map((entry) => inlineRefs(schema, entry));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const { node: target } = resolveRef(schema, node);
    return inlineRefs(schema, target);
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, inlineRefs(schema, value)]),
  );
}

// --- The derived emission ---------------------------------------------------

let cached = null;

/**
 * Derive every JS-side carrier from the committed exported schema. Memoized:
 * the committed artifact is immutable within one codegen process.
 */
export function searchAstEmission() {
  if (cached) return cached;
  const schema = loadCommittedSearchRequestSchema();
  if (schema.title !== 'SearchRequestV1') {
    derivationError(`expected SearchRequestV1 at the schema root, got ${schema.title}`);
  }
  const defs = schema.$defs ?? {};
  for (const name of TS_NAMED_DEFS) {
    if (!defs[name]) derivationError(`exported schema is missing $defs/${name}`);
  }

  const tsLines = [
    `export type SearchMatchAtomV1 = ${tsForNode(schema, defs.SearchMatchAtomV1, { named: false })};`,
    `export type SearchClauseV1 = ${tsForNode(schema, defs.SearchClauseV1, { named: true })};`,
    `export interface SearchQueryAstV1 ${tsForNode(schema, defs.SearchQueryAstV1, { named: true })}`,
    `export interface SearchRequestV1 ${tsForNode(schema, { type: 'object', properties: schema.properties, required: schema.required, additionalProperties: false }, { named: true })}`,
  ];

  // Fully inlined structural type for positions with no named types in scope
  // (Contract runtime links / binding modules).
  const queryTypeInline = tsForNode(schema, defs.SearchQueryAstV1, { named: false });

  const queryDescriptorExpansion = descriptorForNode(schema, defs.SearchQueryAstV1);
  const queryJsonSchema = inlineRefs(schema, defs.SearchQueryAstV1);

  const required = [...(schema.required ?? [])].sort();
  const properties = Object.keys(schema.properties ?? {}).sort();
  const limitKind = nullablePairType(schema.properties?.limit) ?? schema.properties?.limit?.type;
  const afterKind = nullablePairType(schema.properties?.after) ?? schema.properties?.after?.type;
  const queryRef = schema.properties?.query?.$ref === '#/$defs/SearchQueryAstV1';

  cached = {
    schemaId: SEARCH_QUERY_AST_SCHEMA_REF,
    tsLines,
    queryTypeInline,
    queryDescriptorExpansion,
    queryJsonSchema,
    topLevel: { required, properties, limitKind, afterKind, queryRef },
  };
  return cached;
}

/**
 * The generation-time gate (LLP 0131 §The search fixture item 2): the search
 * function's complete authored argument contract must agree with the exported
 * request schema's top level. Returns a list of problems; empty = agreement.
 */
export function searchArgsSchemaProblems(args, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('search argument schema options must be an object');
  }
  const optionNames = Object.keys(options);
  if (optionNames.some((name) => name !== 'resourceArg')) {
    throw new TypeError(`search argument schema options contain unknown fields [${optionNames}]`);
  }
  const resourceArg = options.resourceArg;
  if (resourceArg !== undefined && (typeof resourceArg !== 'string' || resourceArg.length === 0)) {
    throw new TypeError('search argument schema resourceArg must be a non-empty string');
  }
  const emission = searchAstEmission();
  const problems = [];
  const { topLevel } = emission;
  if (!topLevel.queryRef) problems.push('exported schema query is not $defs/SearchQueryAstV1');
  if (topLevel.required.join(',') !== 'query') {
    problems.push(`exported schema requires [${topLevel.required}] instead of [query]`);
  }
  if (topLevel.properties.join(',') !== 'after,limit,query') {
    problems.push(`exported schema declares properties [${topLevel.properties}]`);
  }
  if (topLevel.limitKind !== 'integer') problems.push('exported schema limit is not an integer');
  if (topLevel.afterKind !== 'string') problems.push('exported schema after is not a string');

  const names = Object.keys(args ?? {}).sort();
  const expectedNames = ['after', 'limit', 'query', ...(resourceArg === undefined ? [] : [resourceArg])].sort();
  if (names.join(',') !== expectedNames.join(',')) {
    const expected = resourceArg === undefined
      ? '[query, limit, after]'
      : `[query, limit, after, ${resourceArg}]`;
    problems.push(`authored search arguments are [${names}] instead of ${expected}`);
    return problems;
  }
  const query = args.query;
  if (
    query?.primitive !== 'platformSchemaRef'
    || query?.fieldType?.PlatformSchemaRef?.authority !== 'platform'
    || query?.fieldType?.PlatformSchemaRef?.schema !== SEARCH_QUERY_AST_SCHEMA_REF
    || query?.optional
  ) {
    problems.push('authored query argument must be the required search-query-ast platform schema reference');
  }
  if (args.limit?.fieldType !== 'Integer' || args.limit?.optional !== true) {
    problems.push('authored limit argument must be an optional integer');
  }
  if (args.after?.fieldType !== 'String' || args.after?.optional !== true) {
    problems.push('authored after argument must be an optional string');
  }
  if (resourceArg !== undefined && args[resourceArg]?.optional !== false) {
    problems.push(`authored membership resource argument ${resourceArg} must be required`);
  }
  return problems;
}
