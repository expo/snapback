#!/usr/bin/env node

// Generate the S0 API.md projection from the served app-api envelope. This
// script does not discover functions from source or maintain a second function
// registry: stable ids join the public function projection to the operation
// schemas already carried by the envelope.
//
// @ref LLP 0204#d2--surface-1-the-third-party-api — API.md is generated from
//   the envelope and documents the existing finite invocation routes.
// @ref LLP 0194#design — projections consume one authority and preserve its
//   stable identities instead of independently parsing or rewriting the API.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENVELOPE_SCHEMA_PATH = resolve(ROOT, 'schemas/api.envelope.schema.json');
const DISCOVERY_SCHEMA_PATH = resolve(ROOT, 'schemas/app-api.discovery.schema.json');

const ENVELOPE_ARTIFACT_KIND = 'apiEnvelope';
const ENVELOPE_FORMAT_VERSION = 'snapback.api-envelope.v1';
const DISCOVERY_ARTIFACT_KIND = 'appApiDiscovery';
const DISCOVERY_FORMAT_VERSION = 'snapback.app-api-discovery.v1';
const ENVELOPE_DIGEST_DOMAIN = 'snapback:api-envelope:v1\n';

const KIND_ORDER = new Map([
  ['Query', 0],
  ['LiveQuery', 0],
  ['Mutation', 1],
  ['Action', 2],
]);

const KIND_GROUPS = [
  { title: 'Queries', routeKind: 'query', kinds: new Set(['Query', 'LiveQuery']) },
  { title: 'Mutations', routeKind: 'mutation', kinds: new Set(['Mutation']) },
  { title: 'Actions', routeKind: 'action', kinds: new Set(['Action']) },
];

export class AppApiMdError extends Error {
  constructor(code, message, details = undefined, cause = undefined) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = 'AppApiMdError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details, cause) {
  return new AppApiMdError(code, message, details, cause);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort(compareText);
    const rightKeys = Object.keys(right).sort(compareText);
    return deepEqual(leftKeys, rightKeys)
      && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function jsonPointer(root, pointer) {
  if (!pointer.startsWith('#/')) {
    throw fail('SNAPBACK_APP_API_MD_SCHEMA_INVALID', `unsupported non-local schema reference '${pointer}'`);
  }
  let current = root;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    current = current?.[key];
  }
  if (current === undefined) {
    throw fail('SNAPBACK_APP_API_MD_SCHEMA_INVALID', `schema reference '${pointer}' does not resolve`);
  }
  return current;
}

function valueTypeMatches(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    default: return false;
  }
}

// The committed schemas use a deliberately small Draft 2020-12 vocabulary.
// Keeping this validator data-driven lets the schemas remain the field-name
// authority while avoiding a package-install prerequisite for this JS lane.
function schemaProblems(value, schema, rootSchema, path = '$') {
  if (schema === true) return [];
  if (schema === false) return [`${path}: value is forbidden by schema`];
  if (!isPlainObject(schema)) return [`${path}: schema node is not an object or boolean`];

  if (schema.$ref !== undefined) {
    return schemaProblems(value, jsonPointer(rootSchema, schema.$ref), rootSchema, path);
  }

  const problems = [];
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    problems.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    problems.push(`${path}: expected one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
  }

  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map((branch) => schemaProblems(value, branch, rootSchema, path));
    const accepted = branches.filter((branchProblems) => branchProblems.length === 0).length;
    if (accepted !== 1) problems.push(`${path}: expected exactly one oneOf branch, matched ${accepted}`);
  }
  if (Array.isArray(schema.anyOf)) {
    const accepted = schema.anyOf.some(
      (branch) => schemaProblems(value, branch, rootSchema, path).length === 0,
    );
    if (!accepted) problems.push(`${path}: did not match any anyOf branch`);
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      problems.push(...schemaProblems(value, branch, rootSchema, path));
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => valueTypeMatches(value, type))) {
      problems.push(`${path}: expected type ${types.join('|')}`);
      return problems;
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) problems.push(`${path}: missing required property '${required}'`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        problems.push(...schemaProblems(item, properties[key], rootSchema, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}: unexpected property '${key}'`);
      } else if (isPlainObject(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
        problems.push(...schemaProblems(item, schema.additionalProperties, rootSchema, `${path}.${key}`));
      }
    }
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) {
      problems.push(`${path}: expected at least ${schema.minProperties} properties`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        problems.push(...schemaProblems(item, schema.items, rootSchema, `${path}[${index}]`));
      });
    }
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      problems.push(`${path}: expected at least ${schema.minItems} items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      problems.push(`${path}: expected at most ${schema.maxItems} items`);
    }
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && [...value].length < schema.minLength) {
      problems.push(`${path}: expected minimum length ${schema.minLength}`);
    }
    if (Number.isInteger(schema.maxLength) && [...value].length > schema.maxLength) {
      problems.push(`${path}: expected maximum length ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      problems.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      problems.push(`${path}: expected >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      problems.push(`${path}: expected <= ${schema.maximum}`);
    }
  }
  return problems;
}

async function readJson(path, code, label) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw fail(code, `could not read ${label} at ${path}`, undefined, cause);
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw fail(code, `${label} is not valid JSON`, undefined, cause);
  }
}

let schemaPromise;
async function loadSchemas() {
  schemaPromise ??= Promise.all([
    readJson(ENVELOPE_SCHEMA_PATH, 'SNAPBACK_APP_API_MD_SCHEMA_INVALID', 'envelope schema'),
    readJson(DISCOVERY_SCHEMA_PATH, 'SNAPBACK_APP_API_MD_SCHEMA_INVALID', 'discovery schema'),
  ]).then(([envelope, discovery]) => ({ envelope, discovery }));
  return schemaPromise;
}

function assertSchema(value, schema, code, label) {
  const problems = schemaProblems(value, schema, schema);
  if (problems.length > 0) {
    throw fail(code, `${label} failed its committed schema`, problems);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw fail('SNAPBACK_APP_API_MD_ENVELOPE_INVALID', 'envelope contains a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort(compareText).map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  throw fail('SNAPBACK_APP_API_MD_ENVELOPE_INVALID', 'envelope contains a non-JSON value');
}

export function envelopeSha256(envelope) {
  return createHash('sha256')
    .update(ENVELOPE_DIGEST_DOMAIN, 'utf8')
    .update(canonicalJson(envelope), 'utf8')
    .digest('hex');
}

function validateEnvelopeSemantics(envelope) {
  if (envelope.artifactKind !== ENVELOPE_ARTIFACT_KIND) {
    throw fail(
      'SNAPBACK_APP_API_MD_ARTIFACT_KIND_INVALID',
      `expected envelope artifactKind '${ENVELOPE_ARTIFACT_KIND}', got ${JSON.stringify(envelope.artifactKind)}`,
    );
  }
  if (envelope.formatVersion !== ENVELOPE_FORMAT_VERSION) {
    throw fail(
      'SNAPBACK_APP_API_MD_ENVELOPE_VERSION_UNSUPPORTED',
      `expected envelope formatVersion '${ENVELOPE_FORMAT_VERSION}', got ${JSON.stringify(envelope.formatVersion)}`,
    );
  }

  if (envelope.tuple.schemaVersion !== envelope.functions.schemaVersion) {
    throw fail(
      'SNAPBACK_APP_API_MD_SCHEMA_VERSION_MISMATCH',
      'envelope tuple.schemaVersion and public function projection schemaVersion differ',
    );
  }
  if (envelope.appId !== envelope.functions.appId) {
    throw fail(
      'SNAPBACK_APP_API_MD_GENERATION_MISMATCH',
      'envelope and public function projection appId differ',
    );
  }
  for (const field of ['bundleHash', 'inputsHash']) {
    if (envelope[field] !== envelope.functions[field]) {
      throw fail(
        'SNAPBACK_APP_API_MD_GENERATION_MISMATCH',
        `envelope and public function projection ${field} differ`,
      );
    }
  }

  const functions = envelope.functions.functions;
  const byId = new Map();
  for (const definition of functions) {
    if (byId.has(definition.id)) {
      throw fail('SNAPBACK_APP_API_MD_ENVELOPE_INVALID', `duplicate function stable id '${definition.id}'`);
    }
    byId.set(definition.id, definition);
  }
  const functionIds = [...byId.keys()].sort(compareText);
  const operationIds = Object.keys(envelope.operations).sort(compareText);
  if (!deepEqual(functionIds, operationIds)) {
    throw fail(
      'SNAPBACK_APP_API_MD_ENVELOPE_INVALID',
      'operation ids do not exactly match the public function projection',
      { functionIds, operationIds },
    );
  }
  return byId;
}

function validateDiscoverySemantics(discovery, envelope, digest) {
  if (discovery.artifactKind !== DISCOVERY_ARTIFACT_KIND) {
    throw fail(
      'SNAPBACK_APP_API_MD_DISCOVERY_ARTIFACT_KIND_INVALID',
      `expected discovery artifactKind '${DISCOVERY_ARTIFACT_KIND}', got ${JSON.stringify(discovery.artifactKind)}`,
    );
  }
  if (discovery.formatVersion !== DISCOVERY_FORMAT_VERSION) {
    throw fail(
      'SNAPBACK_APP_API_MD_DISCOVERY_VERSION_UNSUPPORTED',
      `expected discovery formatVersion '${DISCOVERY_FORMAT_VERSION}', got ${JSON.stringify(discovery.formatVersion)}`,
    );
  }
  if (discovery.envelope.state !== 'current') {
    throw fail('SNAPBACK_APP_API_MD_ENVELOPE_ABSENT', 'discovery reports no envelope for the active generation');
  }
  if (discovery.envelope.sha256 !== digest) {
    throw fail(
      'SNAPBACK_APP_API_MD_ENVELOPE_DIGEST_MISMATCH',
      `discovery pins envelope ${discovery.envelope.sha256}, but the supplied envelope hashes to ${digest}`,
    );
  }
  if (discovery.appId !== envelope.appId) {
    throw fail('SNAPBACK_APP_API_MD_GENERATION_MISMATCH', 'discovery and envelope appId differ');
  }
  for (const field of ['schemaVersion', 'authMode']) {
    if (discovery.tuple[field] !== envelope.tuple[field]) {
      throw fail(
        'SNAPBACK_APP_API_MD_GENERATION_MISMATCH',
        `discovery and envelope tuple.${field} differ`,
      );
    }
  }
  for (const field of ['bundleHash', 'inputsHash']) {
    if (discovery.tuple[field] !== envelope[field]) {
      throw fail(
        'SNAPBACK_APP_API_MD_GENERATION_MISMATCH',
        `discovery tuple.${field} and envelope ${field} differ`,
      );
    }
  }
}

async function validateInputs(envelope, discovery = null) {
  const schemas = await loadSchemas();
  assertSchema(envelope, schemas.envelope, 'SNAPBACK_APP_API_MD_ENVELOPE_INVALID', 'envelope');
  const functionsById = validateEnvelopeSemantics(envelope);
  const digest = envelopeSha256(envelope);
  if (discovery !== null) {
    assertSchema(discovery, schemas.discovery, 'SNAPBACK_APP_API_MD_DISCOVERY_INVALID', 'discovery');
    validateDiscoverySemantics(discovery, envelope, digest);
  }
  return { digest, functionsById };
}

async function fetchJson(url, label, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'error', headers: { accept: 'application/json' } });
  } catch (cause) {
    throw fail('SNAPBACK_APP_API_MD_FETCH_FAILED', `could not fetch ${label} from ${url}`, undefined, cause);
  }
  if (!response.ok) {
    throw fail(
      'SNAPBACK_APP_API_MD_FETCH_FAILED',
      `${label} at ${url} returned HTTP ${response.status}`,
      { status: response.status },
    );
  }
  try {
    return await response.json();
  } catch (cause) {
    throw fail('SNAPBACK_APP_API_MD_FETCH_FAILED', `${label} at ${url} was not JSON`, undefined, cause);
  }
}

function serverUrl(baseUrl, path) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (cause) {
    throw fail('SNAPBACK_APP_API_MD_USAGE', `--server is not a valid absolute URL: ${baseUrl}`, undefined, cause);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw fail('SNAPBACK_APP_API_MD_USAGE', '--server must use http: or https:');
  }
  return new URL(path, parsed.origin).href;
}

async function loadProjectionInputs({ envelopePath, discoveryPath, server, fetchImpl = fetch }) {
  if (server !== undefined) {
    const discoveryUrl = serverUrl(server, '/app-api/current');
    const discovery = await fetchJson(discoveryUrl, 'app-api discovery', fetchImpl);
    const schemas = await loadSchemas();
    assertSchema(discovery, schemas.discovery, 'SNAPBACK_APP_API_MD_DISCOVERY_INVALID', 'discovery');
    if (discovery.artifactKind !== DISCOVERY_ARTIFACT_KIND) {
      throw fail('SNAPBACK_APP_API_MD_DISCOVERY_ARTIFACT_KIND_INVALID', 'discovery artifactKind is not appApiDiscovery');
    }
    if (discovery.formatVersion !== DISCOVERY_FORMAT_VERSION) {
      throw fail('SNAPBACK_APP_API_MD_DISCOVERY_VERSION_UNSUPPORTED', 'discovery formatVersion is unsupported');
    }
    if (discovery.envelope.state !== 'current') {
      throw fail('SNAPBACK_APP_API_MD_ENVELOPE_ABSENT', 'discovery reports no current envelope');
    }
    if (!/^[0-9a-f]{64}$/u.test(discovery.envelope.sha256)) {
      throw fail('SNAPBACK_APP_API_MD_DISCOVERY_INVALID', 'discovery envelope sha256 is not lowercase hexadecimal');
    }
    const envelopeUrl = serverUrl(server, `/app-api/envelope/${discovery.envelope.sha256}`);
    const envelope = await fetchJson(envelopeUrl, 'app-api envelope', fetchImpl);
    return { envelope, discovery };
  }

  const envelope = await readJson(
    resolve(envelopePath),
    'SNAPBACK_APP_API_MD_ENVELOPE_INVALID',
    'envelope',
  );
  const discovery = discoveryPath === undefined
    ? null
    : await readJson(
      resolve(discoveryPath),
      'SNAPBACK_APP_API_MD_DISCOVERY_INVALID',
      'discovery',
    );
  return { envelope, discovery };
}

function markdownCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function inlineCode(value) {
  const text = String(value);
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${text}${fence}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function schemaType(schema) {
  if (schema === true) return 'any JSON value';
  if (schema === false) return 'no valid value';
  if (!isPlainObject(schema)) return 'unknown';
  if (schema.const !== undefined) return `constant ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.enum)) {
    const base = schema.type === undefined
      ? 'enum'
      : (Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type);
    return `${base} (${schema.enum.map((value) => JSON.stringify(value)).join(', ')})`;
  }
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(schemaType).join(' or ');
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(schemaType).join(' or ');
  if (Array.isArray(schema.allOf)) return schema.allOf.map(schemaType).join(' and ');
  if (typeof schema.$ref === 'string') return `reference ${schema.$ref}`;
  const types = schema.type === undefined
    ? [isPlainObject(schema.properties) ? 'object' : 'any JSON value']
    : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  return types.map((type) => {
    if (type === 'array') return `array<${schemaType(schema.items ?? true)}>`;
    if (type === 'string' && typeof schema.format === 'string') return `string (${schema.format})`;
    return type;
  }).join(' or ');
}

function objectSchema(schema) {
  if (!isPlainObject(schema)) return null;
  if (schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'))) return schema;
  if (isPlainObject(schema.properties)) return schema;
  return null;
}

function argumentRows(schema, prefix = '', ancestorsRequired = true) {
  const object = objectSchema(schema);
  if (object === null) {
    return [{
      name: prefix || '$',
      type: schemaType(schema),
      required: ancestorsRequired ? 'yes' : 'no',
      description: isPlainObject(schema) ? schema.description ?? '' : '',
    }];
  }
  const properties = isPlainObject(object.properties) ? object.properties : {};
  const required = new Set(object.required ?? []);
  const rows = [];
  for (const name of Object.keys(properties).sort(compareText)) {
    const child = properties[name];
    const childName = prefix === '' ? name : `${prefix}.${name}`;
    const locallyRequired = required.has(name);
    const unconditionallyRequired = ancestorsRequired && locallyRequired;
    rows.push({
      name: childName,
      type: schemaType(child),
      required: unconditionallyRequired ? 'yes' : locallyRequired ? 'when parent is present' : 'no',
      description: isPlainObject(child) ? child.description ?? '' : '',
    });
    if (objectSchema(child) !== null) {
      rows.push(...argumentRows(child, childName, unconditionallyRequired));
    } else if (isPlainObject(child) && child.type === 'array' && objectSchema(child.items) !== null) {
      rows.push(...argumentRows(child.items, `${childName}[]`, unconditionallyRequired));
    }
  }
  return rows;
}

function numericExample(schema, integer) {
  let value = typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    value = integer ? Math.floor(schema.exclusiveMinimum) + 1 : schema.exclusiveMinimum + 0.5;
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    value = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
  }
  return integer ? Math.ceil(value) : value;
}

function synthesizeValue(schema, path = '$') {
  if (schema === true) return null;
  if (schema === false) {
    throw fail('SNAPBACK_APP_API_MD_ARGS_UNSATISFIABLE', `${path} rejects every JSON value`);
  }
  if (!isPlainObject(schema)) {
    throw fail('SNAPBACK_APP_API_MD_ARGS_SCHEMA_INVALID', `${path} is not a JSON Schema object or boolean`);
  }
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return structuredClone(schema.examples[0]);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return structuredClone(schema.enum[0]);
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return synthesizeValue(schema.oneOf[0], path);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return synthesizeValue(schema.anyOf[0], path);
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const values = schema.allOf.map((branch) => synthesizeValue(branch, path));
    if (values.every(isPlainObject)) return Object.assign({}, ...values);
    return values[0];
  }

  const declaredTypes = schema.type === undefined
    ? []
    : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  const type = declaredTypes.find((candidate) => candidate !== 'null')
    ?? declaredTypes[0]
    ?? (isPlainObject(schema.properties) ? 'object' : 'object');
  switch (type) {
    case 'object': {
      const result = {};
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      for (const name of [...(schema.required ?? [])].sort(compareText)) {
        if (!Object.hasOwn(properties, name)) {
          if (isPlainObject(schema.additionalProperties)) {
            result[name] = synthesizeValue(schema.additionalProperties, `${path}.${name}`);
            continue;
          }
          throw fail(
            'SNAPBACK_APP_API_MD_ARGS_UNSATISFIABLE',
            `${path} requires '${name}' but carries no schema for it`,
          );
        }
        result[name] = synthesizeValue(properties[name], `${path}.${name}`);
      }
      return result;
    }
    case 'array': {
      const length = Number.isInteger(schema.minItems) ? schema.minItems : 0;
      return Array.from({ length }, (_, index) => synthesizeValue(schema.items ?? true, `${path}[${index}]`));
    }
    case 'string': return 'x'.repeat(Math.max(1, schema.minLength ?? 0));
    case 'integer': return numericExample(schema, true);
    case 'number': return numericExample(schema, false);
    case 'boolean': return false;
    case 'null': return null;
    default:
      throw fail('SNAPBACK_APP_API_MD_ARGS_SCHEMA_INVALID', `${path} uses unsupported type '${type}'`);
  }
}

function synthesizeArgs(schema, operationName) {
  const args = synthesizeValue(schema, `operations.${operationName}.argsSchema`);
  const problems = schemaProblems(args, schema, schema);
  if (problems.length > 0) {
    throw fail(
      'SNAPBACK_APP_API_MD_ARGS_SYNTHESIS_INVALID',
      `could not synthesize a valid minimal body for '${operationName}'`,
      problems,
    );
  }
  return args;
}

function invocationCurl(routeKind, name, args) {
  const body = JSON.stringify({ args, read_set: [] }, null, 2);
  return [
    '```sh',
    `curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/${routeKind}/${encodeURIComponent(name)}" \\
  -H 'content-type: application/json' \\
  -H 'x-snapback-auth-client-protocol: 1' \\
  -H "authorization: Bearer $SNAPBACK_TOKEN" \\
  --data ${shellQuote(body)}`,
    '```',
  ].join('\n');
}

function identityTuple(envelope, discovery) {
  if (discovery !== null) {
    return {
      schemaVersion: discovery.tuple.schemaVersion,
      authMode: discovery.tuple.authMode,
      schemaHash: discovery.tuple.schemaHash ?? null,
      bundleHash: discovery.tuple.bundleHash ?? null,
      inputsHash: discovery.tuple.inputsHash ?? null,
    };
  }
  return {
    schemaVersion: envelope.tuple.schemaVersion,
    authMode: envelope.tuple.authMode,
    bundleHash: envelope.bundleHash ?? null,
    inputsHash: envelope.inputsHash ?? null,
  };
}

function tokenWalkthrough() {
  return `## Acquire a scoped token

Agent onboarding follows the app's declared \`auth.agents.mode\`. In \`open\` mode, register without an invitation. In \`invited\` mode, first obtain a single-use \`sbagi_…\` creation invitation from an allowed inviter and include it in the same registration call. In \`disabled\` mode no new agent can register; use an existing credential or ask the app owner to change the declaration.

\`POST /auth/agents/register\` returns the durable agent credential once. Keep it outside source, logs, generated files, and model output.

\`\`\`sh
# auth.agents.mode = open
curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/agents/register" \\
  -H 'content-type: application/json' \\
  --data '{}'

# auth.agents.mode = invited
curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/agents/register" \\
  -H 'content-type: application/json' \\
  --data '{"invitation":"sbagi_REPLACE_ME"}'
\`\`\`

Next, a signed-in user creates a short-lived pairing code and conveys it out of band. The agent presents that code, its credential, a fresh pairing request id, and the exact scopes it requests.

\`\`\`sh
curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/pairing-codes" \\
  -H 'content-type: application/json' \\
  -H "authorization: Bearer $SNAPBACK_USER_SESSION" \\
  --data '{}'

curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/agents/pair" \\
  -H 'content-type: application/json' \\
  --data '{"credential":"sbac_REPLACE_ME","pairingRequestId":"REPLACE_WITH_FRESH_ID","pairingCode":"REPLACE_ME","requestedScopes":[{"fn":"REPLACE_WITH_STABLE_FUNCTION_ID","kind":"Query"}]}'
\`\`\`

The user reviews \`GET /auth/grant-requests\` and approves the matching request with \`POST /auth/grant-requests/{id}/approve\` (or denies it). Approval is the consent step; an authority-creating scope may require step-up authentication.

\`\`\`sh
curl --fail-with-body --silent --show-error \\
  "$SNAPBACK_BASE_URL/auth/grant-requests" \\
  -H "authorization: Bearer $SNAPBACK_USER_SESSION"

curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/grant-requests/$GRANT_REQUEST_ID/approve" \\
  -H 'content-type: application/json' \\
  -H "authorization: Bearer $SNAPBACK_USER_SESSION" \\
  --data '{}'
\`\`\`

After approval, the agent polls \`POST /auth/agents/token\`. While approval is pending, wait on \`SNAPBACK_AUTH_GRANT_PENDING\`; stop on \`SNAPBACK_AUTH_GRANT_INVALID\`. Use the returned \`expiresInMs\` for renewal scheduling.

\`\`\`sh
curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/agents/token" \\
  -H 'content-type: application/json' \\
  --data '{"credential":"sbac_REPLACE_ME","pairingRequestId":"REPLACE_WITH_FRESH_ID","ttlMs":130000}'
\`\`\`

The resulting \`sbagt_…\` bearer is scoped, expiring, and revocable. Put it in \`SNAPBACK_TOKEN\` only for the bounded work that needs it. When that work settles, release the exact carrier through \`POST /auth/agents/token/release\`; release is idempotent and does not revoke the durable grant.

\`\`\`sh
curl --fail-with-body --silent --show-error \\
  -X POST "$SNAPBACK_BASE_URL/auth/agents/token/release" \\
  -H 'content-type: application/json' \\
  --data "{\\"token\\":\\"$SNAPBACK_TOKEN\\"}"
\`\`\``;
}

export function renderApiMarkdown({ envelope, discovery = null, digest, functionsById }) {
  const tuple = identityTuple(envelope, discovery);
  const operations = Object.entries(envelope.operations).map(([id, operation]) => ({
    id,
    operation,
    definition: functionsById.get(id),
  })).sort((left, right) => {
    const kind = KIND_ORDER.get(left.definition.kind) - KIND_ORDER.get(right.definition.kind);
    if (kind !== 0) return kind;
    const name = compareText(left.operation.name, right.operation.name);
    return name !== 0 ? name : compareText(left.id, right.id);
  });

  const lines = [
    `# Snapback API: ${markdownCell(envelope.appId)}`,
    '',
    '## Identity pin',
    '',
    `- App ID: ${inlineCode(envelope.appId)}`,
    `- Envelope SHA-256: ${inlineCode(digest)}`,
    `- Generation tuple${discovery === null ? ' (envelope-carried fields)' : ''}: ${inlineCode(canonicalJson(tuple))}`,
    '',
    `This document is a deterministic projection of envelope ${inlineCode(digest)}. The envelope is the authority; only functions present in that envelope are documented here.`,
  ];
  if (discovery === null) {
    lines.push(
      '',
      'A standalone envelope does not carry the discovery tuple\'s `schemaHash`; pass `--discovery` (or use `--server`) to include the complete active-generation tuple.',
    );
  }
  lines.push(
    '',
    '## How to call functions',
    '',
    'Set `SNAPBACK_BASE_URL` to the app server and send JSON to the existing finite client-protocol routes:',
    '',
    '- Queries (including live-query definitions used as finite snapshots): `POST /query/{name}`',
    '- Mutations: `POST /mutation/{name}`',
    '- Actions: `POST /action/{name}`',
    '',
    'Each request body contains the function arguments under `args` and a client-protocol `read_set` array. Authenticated calls send the scoped bearer in `Authorization` and opt into the sessions protocol with `x-snapback-auth-client-protocol: 1`. The examples below use a fresh snapshot and therefore send an empty `read_set`.',
    '',
    tokenWalkthrough(),
  );

  for (const group of KIND_GROUPS) {
    const members = operations.filter(({ definition }) => group.kinds.has(definition.kind));
    if (members.length === 0) continue;
    lines.push('', `## ${group.title}`);
    for (const { id, operation, definition } of members) {
      const authRequirement = definition.authRequirement ?? 'optional-user (legacy default)';
      const rows = argumentRows(operation.argsSchema);
      const args = synthesizeArgs(operation.argsSchema, operation.name);
      lines.push(
        '',
        `### ${inlineCode(operation.name)}`,
        '',
        `- Stable function ID: ${inlineCode(id)}`,
        `- Manifest kind: ${inlineCode(definition.kind)}`,
        `- Auth requirement: ${inlineCode(authRequirement)}`,
        `- Route: ${inlineCode(`POST /${group.routeKind}/${encodeURIComponent(operation.name)}`)}`,
        '',
        '#### Arguments',
        '',
      );
      if (rows.length === 0) {
        lines.push('No arguments. The minimal `args` value is `{}`.');
      } else {
        lines.push(
          '| Name | Type | Required | Description |',
          '| --- | --- | --- | --- |',
          ...rows.map((row) => `| ${inlineCode(row.name)} | ${markdownCell(row.type)} | ${markdownCell(row.required)} | ${markdownCell(row.description) || '—'} |`),
        );
      }
      lines.push('', '#### Example', '', invocationCurl(group.routeKind, operation.name, args));
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function generateApiMarkdown(options) {
  const { envelope, discovery } = await loadProjectionInputs(options);
  const { digest, functionsById } = await validateInputs(envelope, discovery);
  return renderApiMarkdown({ envelope, discovery, digest, functionsById });
}

function usage() {
  return `Usage:
  node scripts/generate-app-api-md.mjs --envelope <envelope.json> [--discovery <discovery.json>] [--out <API.md>]
  node scripts/generate-app-api-md.mjs --server <base-url> [--out <API.md>]

Without --out, generated Markdown is written to stdout.`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--envelope', '--discovery', '--server', '--out'].includes(argument)) {
      throw fail('SNAPBACK_APP_API_MD_USAGE', `unknown argument '${argument}'`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw fail('SNAPBACK_APP_API_MD_USAGE', `${argument} requires a value`);
    }
    const key = {
      '--envelope': 'envelopePath',
      '--discovery': 'discoveryPath',
      '--server': 'server',
      '--out': 'outPath',
    }[argument];
    if (options[key] !== undefined) {
      throw fail('SNAPBACK_APP_API_MD_USAGE', `${argument} may be supplied only once`);
    }
    options[key] = value;
    index += 1;
  }
  if ((options.envelopePath === undefined) === (options.server === undefined)) {
    throw fail('SNAPBACK_APP_API_MD_USAGE', 'choose exactly one of --envelope or --server');
  }
  if (options.server !== undefined && options.discoveryPath !== undefined) {
    throw fail('SNAPBACK_APP_API_MD_USAGE', '--discovery may be used only with --envelope');
  }
  return options;
}

export async function main(argv = process.argv.slice(2), io = process) {
  const options = parseArgs(argv);
  if (options.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }
  const markdown = await generateApiMarkdown(options);
  if (options.outPath === undefined) {
    io.stdout.write(markdown);
  } else {
    await writeFile(resolve(options.outPath), markdown, 'utf8');
  }
  return 0;
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const typed = error instanceof AppApiMdError
      ? error
      : fail('SNAPBACK_APP_API_MD_INTERNAL', error?.message ?? String(error), undefined, error);
    process.stderr.write(`[generate-app-api-md] ${typed.message}\n`);
    if (Array.isArray(typed.details)) {
      for (const detail of typed.details) process.stderr.write(`  - ${detail}\n`);
    }
    process.exitCode = 1;
  }
}
