// Snapback codegen: one source of truth -> generated manifests.
//
// @ref LLP 0012#versioning — a single source-of-truth definition feeds both the
//   Snapback server manifests and the Contract data manifest, instead of two
//   hand-synced files that drift (Valet's protocol.ts/protocol.rs trap).
// @ref LLP 0010#generated-artifacts — no silent drops: anything that cannot be
//   resolved emits a structured diagnostic with a stable code; generated output is
//   deterministic and carries an inputsHash staleness marker.
//
// This is product code (LLP 0032 P1): it lives in packages/snapback-codegen and
// the demo kit re-exports it for compatibility (demos/_kit/codegen.mjs).
//
// Usage: node packages/snapback-codegen/index.mjs [backendDir]   (default: demos/todo/snapback)
// Emits <backendDir>/generated/{schema,functions,contract-data}.manifest.json + artifacts.json.
// Exits non-zero (writing nothing) if any error diagnostic is produced.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isConfigDef, isCronDef, isEphemeralCollectionDef, isFunctionDef } from './define.mjs';
import {
  generatedByHeader,
  jsonLiteral,
  pascal,
  renderBindingModule,
  renderMutationMetaModule,
  renderQueryMetaModule,
  renderRuntimeLinksModule,
} from './contract-emitter.mjs';

const HEADER = generatedByHeader();

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// ECMAScript reserved words (generated modules are always strict-mode code, so
// the strict-only set applies too). Function export names are interpolated
// into emitted declarations (`export function ${name}(`), where a reserved
// word — reachable via `export { f as delete }` — is a syntax error even
// though it passes IDENT. `eval` and `arguments` are not reserved words but
// are equally invalid strict-mode binding names.
const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'eval', 'arguments',
]);
const GENERATED_API_RESERVED_EXPORTS = new Set(['api', 'ephemeral']);
const SCHEMA_VERSION = 'snapback.v0';
const TARGET_PROFILE = 'local-dev-sqlite-ibex';

// Contract data manifest v2 (LLP 0034 D3; Exact LLP 0284 §2.4).
//
// manifestVersion 2 adds the per-descriptor liveness/cost facts additively:
// old consumers ignore the new fields, and the legacy `subscription` field is
// still emitted during the migration (0284 §2.4's emit-both rule). The
// provider-owned poll-fallback floor is the demos' existing 1500 ms cadence.
const CONTRACT_DATA_MANIFEST_VERSION = 2;
const PROVIDER_POLL_CADENCE_FLOOR_MS = 1_500;

/// Per-query liveness facts derived once from the definition kind, so the
/// legacy field and the v2 fields cannot silently drift apart inside one
/// binding (`crossCheckContractQueryBinding` re-verifies the emitted object).
function contractQueryLivenessFields(def) {
  const live = def.__kind === 'LiveQuery';
  return {
    // Legacy field (LLP 0263): kept during migration, emit-both.
    subscription: live ? 'initial-snapshot' : 'none',
    // v2 fields (Exact LLP 0284 §2.4).
    mode: live ? 'live' : 'snapshot',
    livePush: live, // D1 wires the live socket as the browser durable transport.
    initialSnapshot: live,
    // Liveness is descriptor policy, not a blanket default: a chatty/expensive
    // LiveQuery may opt out with `defineLiveQuery({ ..., defaultLive: false })`.
    defaultLive: live ? def.defaultLive !== false : false,
    ephemeral: false,
    ...(live
      ? {
          transport: 'push',
          pollCadenceMs: PROVIDER_POLL_CADENCE_FLOOR_MS,
        }
      : {}),
  };
}

/**
 * Migration cross-check (Exact LLP 0284 §2.4; LLP 0034 D3): the legacy
 * `subscription` field and the new liveness fields are both emitted during the
 * migration and MUST agree. Codegen fails loudly (writes nothing) if a future
 * edit changes one emission path without the other. Exported for conformance
 * tests (LLP 0034 §6 check 4).
 */
export function crossCheckContractQueryBinding(name, binding) {
  const mismatches = [];
  if (binding.ephemeral === true) {
    // Ephemeral read descriptors (ENG-22479): always-live push maps; the
    // durable transport/poll rules do not apply. Cross-check the invariant
    // facts instead.
    const expectEphemeral = (field, expected) => {
      if (binding[field] !== expected) {
        mismatches.push(`${field}=${JSON.stringify(binding[field])} must be ${JSON.stringify(expected)} on an ephemeral descriptor`);
      }
    };
    expectEphemeral('subscription', 'initial-snapshot');
    expectEphemeral('mode', 'live');
    expectEphemeral('livePush', true);
    expectEphemeral('initialSnapshot', true);
    expectEphemeral('coalesce', true);
    if (!Number.isInteger(binding.maxDeltaRateHz) || binding.maxDeltaRateHz <= 0) {
      mismatches.push(`maxDeltaRateHz=${JSON.stringify(binding.maxDeltaRateHz)} must be a positive integer`);
    }
    return mismatches.map((message) => ({
      code: 'CONTRACT_MANIFEST_MIGRATION_MISMATCH',
      severity: 'error',
      subsystem: 'contract',
      message: `${name}: ${message}`,
      query: name,
    }));
  }
  const legacyLive = binding.subscription === 'initial-snapshot';
  const expect = (field, expected) => {
    if (binding[field] !== expected) {
      mismatches.push(
        `${field}=${JSON.stringify(binding[field])} disagrees with subscription=${JSON.stringify(binding.subscription)} (expected ${JSON.stringify(expected)})`,
      );
    }
  };
  if (!['initial-snapshot', 'none'].includes(binding.subscription)) {
    mismatches.push(`subscription=${JSON.stringify(binding.subscription)} is not a legacy value this provider emits`);
  }
  expect('mode', legacyLive ? 'live' : 'snapshot');
  expect('livePush', legacyLive);
  expect('initialSnapshot', legacyLive);
  if (!legacyLive && binding.defaultLive !== false) {
    mismatches.push(`defaultLive=${JSON.stringify(binding.defaultLive)} must be false on a snapshot descriptor`);
  }
  if (legacyLive && typeof binding.defaultLive !== 'boolean') {
    mismatches.push(`defaultLive=${JSON.stringify(binding.defaultLive)} must be declared on a live descriptor`);
  }
  if (legacyLive && binding.transport !== 'push') {
    mismatches.push(`transport=${JSON.stringify(binding.transport)} disagrees with livePush=true (expected "push")`);
  }
  if (legacyLive && !(Number.isInteger(binding.pollCadenceMs) && binding.pollCadenceMs >= PROVIDER_POLL_CADENCE_FLOOR_MS)) {
    mismatches.push(`pollCadenceMs=${JSON.stringify(binding.pollCadenceMs)} must be >= the provider floor ${PROVIDER_POLL_CADENCE_FLOOR_MS}`);
  }
  return mismatches.map((message) => ({
    code: 'CONTRACT_MANIFEST_MIGRATION_MISMATCH',
    severity: 'error',
    subsystem: 'contract',
    message: `${name}: ${message}`,
    query: name,
  }));
}

// --- DK-7: validate emitted Snapback-owned artifacts against committed schemas --
//
// LLP 0037 makes the Rust serde types the single source of truth; the JSON
// Schemas under `schemas/` are generated from them and committed. Codegen
// validates each Snapback-owned artifact it emits against those schemas BEFORE
// writing, and fails closed with a structured diagnostic (never a thrown string)
// so a manifest the Rust server would reject cannot be written (the S5.D2 bug
// class). This is a dependency-free STRUCTURAL check of the highest-value
// invariants — required properties, `additionalProperties: false` where the
// schema closes the object, top-level property types, and the
// artifactKind/schemaVersion constants (which are serde defaults, not schema
// consts, so they are pinned here). It is deliberately not a full JSON Schema
// validator: the exhaustive gate is the Rust round-trip in
// `tests/artifact_schemas_v0.rs`, which deserializes every committed manifest
// through the runtime structs. The Exact-owned contract-data manifest is out of
// scope (LLP 0037 scope fence).
//
// @ref LLP 0037#decision-ratified-2026-07-02 — JS codegen validates each artifact
//   it emits against the committed schemas/ before writing; failures are structured
//   diagnostics.
// @ref LLP 0032#decision-docket — DK-7 / P3(c) emit-time validation (defense in depth).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadCommittedSchema(schemaFile) {
  const path = join(REPO_ROOT, 'schemas', schemaFile);
  if (!existsSync(path)) {
    return { missing: `committed schema not found at ${path}` };
  }
  try {
    return { schema: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (cause) {
    return { missing: `committed schema ${schemaFile} is not valid JSON: ${cause.message}` };
  }
}

// schemars inlines the root type at the top level (properties/required present),
// but a $ref root is possible; follow one same-document $ref into $defs.
function schemaRootNode(schema) {
  if (schema && typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const name = schema.$ref.slice('#/$defs/'.length);
    return (schema.$defs || {})[name] || schema;
  }
  return schema;
}

function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value; // string | boolean | object
}

function typeMatches(propSchema, value) {
  // Enforce only a declared concrete top-level type; skip $ref/oneOf/anyOf/absent
  // (those are covered exhaustively by the Rust round-trip gate).
  const expected = propSchema && propSchema.type;
  const actual = jsonTypeOf(value);
  const ok = (t) => t === actual || (t === 'number' && actual === 'integer');
  if (typeof expected === 'string') return ok(expected);
  if (Array.isArray(expected)) return expected.some(ok);
  return true;
}

// Returns { missing?, problems: [] }. `expected` pins the artifactKind and
// schemaVersion constants the derived schema cannot express (serde defaults).
function validateArtifactAgainstSchema(schemaFile, instance, expected) {
  const loaded = loadCommittedSchema(schemaFile);
  if (loaded.missing) return { missing: loaded.missing, problems: [] };
  const root = schemaRootNode(loaded.schema) || {};
  const properties = root.properties || {};
  const problems = [];
  for (const key of Array.isArray(root.required) ? root.required : []) {
    if (!(key in instance)) problems.push(`missing required property "${key}"`);
  }
  if (root.additionalProperties === false) {
    for (const key of Object.keys(instance)) {
      if (!(key in properties)) problems.push(`unexpected property "${key}" (schema closes the object)`);
    }
  }
  for (const [key, value] of Object.entries(instance)) {
    if (properties[key] && !typeMatches(properties[key], value)) {
      problems.push(`property "${key}" is ${jsonTypeOf(value)} but the schema requires ${JSON.stringify(properties[key].type)}`);
    }
  }
  if (expected.artifactKind !== undefined && instance.artifactKind !== expected.artifactKind) {
    problems.push(`artifactKind is ${JSON.stringify(instance.artifactKind)}, expected ${JSON.stringify(expected.artifactKind)}`);
  }
  if (expected.schemaVersion !== undefined && instance.schemaVersion !== expected.schemaVersion) {
    problems.push(`schemaVersion is ${JSON.stringify(instance.schemaVersion)}, expected ${JSON.stringify(expected.schemaVersion)}`);
  }
  return { problems };
}

export async function generate(backendDir) {
  const diagnostics = [];
  const err = (code, subsystem, message, extra = {}) =>
    diagnostics.push({ code, severity: 'error', subsystem, message, ...extra });

  const schemaPath = join(backendDir, 'schema.mjs');
  const functionsPath = join(backendDir, 'functions.mjs');
  const seedPath = join(backendDir, 'seed.json');
  const handlerSourceCache = new Map();
  const schemaSource = readRequiredSource(schemaPath, diagnostics, {
    code: 'SCHEMA_SOURCE_MISSING',
    subsystem: 'schema',
    message: `schema source ${schemaPath} could not be read`,
  });
  const functionsSource = readRequiredSource(functionsPath, diagnostics, {
    code: 'FUNCTION_SOURCE_MISSING',
    subsystem: 'function',
    message: `functions source ${functionsPath} could not be read`,
  });
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const schemaModule = await import(moduleUrlWithSourceHash(schemaPath, schemaSource));
  const functionsModule = await import(moduleUrlWithSourceHash(functionsPath, functionsSource));

  const schemaDef = schemaModule.default;
  if (!schemaDef || !schemaDef.__schema) {
    err('SCHEMA_NO_DEFAULT_EXPORT', 'schema', `${schemaPath} must default-export defineSchema(...)`);
    return { ok: false, diagnostics };
  }

  // --- Build + validate schema ------------------------------------------------
  const tables = dict();
  const seenTables = new Set();
  for (const [name, table] of Object.entries(schemaDef.tables)) {
    if (!IDENT.test(name) || name.startsWith('_snapback')) {
      err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid table identifier ${name}`, { table: name });
      continue;
    }
    if (seenTables.has(name)) {
      err('SCHEMA_DUPLICATE_TABLE', 'schema', `duplicate table ${name}`, { table: name });
    }
    seenTables.add(name);

    const fields = [];
    const seenFields = new Set();
    for (const [fieldName, val] of Object.entries(table.fields)) {
      if (SYSTEM_FIELDS.includes(fieldName)) {
        err('SCHEMA_SYSTEM_FIELD', 'schema', `${fieldName} is managed by Snapback`, { table: name, field: fieldName });
        continue;
      }
      if (!IDENT.test(fieldName)) {
        err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid field identifier ${name}.${fieldName}`, { table: name, field: fieldName });
        continue;
      }
      if (seenFields.has(fieldName)) {
        err('SCHEMA_DUPLICATE_FIELD', 'schema', `duplicate field ${name}.${fieldName}`, { table: name, field: fieldName });
      }
      seenFields.add(fieldName);
      fields.push({ name: fieldName, field_type: val.fieldType, optional: val.optional });
    }

    const indexes = [];
    const seenIndexes = new Set();
    for (const index of table.indexes) {
      if (seenIndexes.has(index.name)) {
        err('SCHEMA_DUPLICATE_INDEX', 'schema', `duplicate index ${name}.${index.name}`, { table: name, index: index.name });
      }
      seenIndexes.add(index.name);
      if (index.fields.length === 0) {
        err('SCHEMA_EMPTY_INDEX', 'schema', `index ${name}.${index.name} has no fields`, { table: name, index: index.name });
      }
      for (const f of index.fields) {
        if (!seenFields.has(f)) {
          err('SCHEMA_UNKNOWN_FIELD', 'schema', `index ${name}.${index.name} references unknown field ${f}`, { table: name, index: index.name, field: f });
        }
      }
      indexes.push({ name: index.name, fields: index.fields });
    }

    tables[name] = { name, fields, indexes, syncable: table.syncable };
  }

  // --- Build + validate functions --------------------------------------------
  const ephemeralCollections = buildEphemeralCollections(schemaDef.ephemeral, err);
  const functions = [];
  const contractQueries = dict();
  const contractMutations = dict();
  const cronDefs = [];
  const configDefs = [];

  const fieldNames = (t) => new Set(tables[t]?.fields.map((f) => f.name) ?? []);
  const isKnownField = (t, f) => SYSTEM_FIELDS.includes(f) || fieldNames(t).has(f);

  for (const [name, def] of Object.entries(functionsModule)) {
    if (isCronDef(def)) {
      cronDefs.push({ exportName: name, def });
      continue;
    }
    if (isConfigDef(def)) {
      configDefs.push({ exportName: name, def });
      continue;
    }
    if (!isFunctionDef(def)) continue;
    // Function export names flow unescaped into emitted declarations
    // (`export function ${name}(`), pascal-cased type names, unquoted
    // interface members, and contract module file paths (`${name}.query.ts`);
    // ES2022 `export { f as "any string" }` makes arbitrary export names
    // reachable, and `export { f as delete }` makes reserved words reachable.
    // Fail closed like the table/field/ephemeral/cron namespaces.
    if (!IDENT.test(name) || RESERVED_WORDS.has(name)) {
      err('FUNCTION_INVALID_IDENTIFIER', 'function', `invalid function export name ${name}`, { function: name });
      continue;
    }
    for (const [argName, argVal] of Object.entries(def.args)) {
      // Arg names and nested v.object field names become unquoted TS property
      // names in api.d.ts, runtime-links.ts, and the per-binding Args types.
      if (!IDENT.test(argName)) {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: invalid arg identifier ${argName}`, { function: name, arg: argName });
        continue;
      }
      checkObjectValidatorFieldIdents(argVal, `arg ${argName}`, (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, arg: argName, field: fieldName });
      });
    }
    if (def.result) {
      checkObjectValidatorFieldIdents(def.result, 'result', (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, field: fieldName });
      });
    }
    if (GENERATED_API_RESERVED_EXPORTS.has(name)) {
      err('FUNCTION_RESERVED_EXPORT', 'function', `${name}: function export collides with a generated API namespace`, { function: name });
      continue;
    }
    const argNames = new Set(Object.keys(def.args));

    const checkExpr = (expr, where) => {
      if (!expr || !expr.__expr) {
        err('FUNCTION_INVALID_EXPR', 'function', `${name}: ${where} is not a value expression`, { function: name });
        return;
      }
      if ('Arg' in expr && !argNames.has(expr.Arg)) {
        err('FUNCTION_UNKNOWN_ARG', 'function', `${name}: ${where} references undeclared arg "${expr.Arg}"`, { function: name });
      }
    };

    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.js) {
      const readTables = def.js.reads ?? [];
      for (const table of readTables) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: handler declares unknown read table ${table}`, { function: name, table });
        }
      }
      const handlerSource = loadHandlerSource(def.js.source, name);
      functions.push({
        name,
        kind: def.__kind,
        runtime: { IbexModule: { source: handlerSource ?? '', export: def.js.exportName } },
        declaredReads: readTables,
        declaredWrites: [],
        authScopeField: def.js.authScopeField ?? null,
        syncabilityClass: def.js.syncabilityClass,
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        // Mirror the HostPlan branch: the declared read-set must reach the
        // contract binding, or every JS query's .contract-meta.ts emits
        // `reads: []` and a per-function cacheKey, breaking Exact's
        // table-dependency/invalidation mapping (ENG-23421).
        reads: readTables,
        result: { kind: 'list', row: jsQueryRowDescriptor(def, name, err) },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Query' || def.__kind === 'LiveQuery') {
      const t = def.plan.table;
      if (!tables[t]) {
        err('QUERY_UNKNOWN_TABLE', 'function', `${name}: unknown table ${t}`, { function: name, table: t });
      } else {
        for (const filter of def.plan.filters) {
          if (!isKnownField(t, filter.field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: filter on unknown field ${t}.${filter.field}`, { function: name, table: t, field: filter.field });
          checkExpr(filter.value, `filter ${filter.field}`);
        }
        for (const order of def.plan.order) {
          if (!isKnownField(t, order.field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: order by unknown field ${t}.${order.field}`, { function: name, table: t, field: order.field });
        }
        if (def.plan.index && !tables[t].indexes.some((i) => i.name === def.plan.index)) {
          err('QUERY_UNKNOWN_INDEX', 'function', `${name}: unknown index ${t}.${def.plan.index}`, { function: name, table: t, index: def.plan.index });
        }
      }
      functions.push({
        name,
        kind: def.__kind,
        runtime: { HostPlan: { Query: serializeQueryPlan(def.plan) } },
        declaredReads: [t],
        declaredWrites: [],
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: [t],
        result: { kind: 'list', row: rowDescriptor(tables[t]) },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Mutation' && def.js) {
      const reads = def.js.reads ?? [];
      const writes = def.js.writes ?? [];
      for (const table of [...reads, ...writes]) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: handler declares unknown table ${table}`, { function: name, table });
        }
      }
      const handlerSource = loadHandlerSource(def.js.source, name);
      functions.push({
        name,
        kind: 'Mutation',
        runtime: { IbexModule: { source: handlerSource ?? '', export: def.js.exportName } },
        declaredReads: reads,
        declaredWrites: writes,
        syncabilityClass: 'mutation',
      });
      contractMutations[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes,
        invalidates: writes,
        optimistic: false,
        serverRunnable: true,
      };
    } else if (def.__kind === 'Mutation') {
      const writes = new Set();
      for (const step of def.plan.steps) {
        const kind = Object.keys(step)[0];
        const body = step[kind];
        const t = body.table;
        writes.add(t);
        if (!tables[t]) {
          err('QUERY_UNKNOWN_TABLE', 'function', `${name}: ${kind} on unknown table ${t}`, { function: name, table: t });
          continue;
        }
        if (kind === 'Insert') {
          for (const [field, expr] of Object.entries(body.values)) {
            if (!fieldNames(t).has(field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: insert sets unknown field ${t}.${field}`, { function: name, table: t, field });
            checkExpr(expr, `insert ${field}`);
          }
          for (const f of tables[t].fields) {
            if (!f.optional && !(f.name in body.values)) {
              err('FUNCTION_MISSING_REQUIRED_FIELD', 'function', `${name}: insert into ${t} omits required field ${f.name}`, { function: name, table: t, field: f.name });
            }
          }
        } else if (kind === 'Patch') {
          checkExpr(body.id, 'patch id');
          for (const [field, expr] of Object.entries(body.values)) {
            if (!fieldNames(t).has(field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: patch sets unknown field ${t}.${field}`, { function: name, table: t, field });
            checkExpr(expr, `patch ${field}`);
          }
        } else if (kind === 'Delete') {
          checkExpr(body.id, 'delete id');
        }
      }
      functions.push({
        name,
        kind: 'Mutation',
        runtime: { HostPlan: { Mutation: serializeMutationPlan(def.plan) } },
        declaredReads: mutationReadTables(def.plan),
        declaredWrites: [...writes],
        syncabilityClass: 'mutation',
      });
      contractMutations[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes: [...writes],
        invalidates: [...writes],
        optimistic: false,
        serverRunnable: true,
      };
    } else if (def.__kind === 'Action' && def.js) {
      const writes = def.js.writes ?? [];
      for (const table of writes) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: action declares unknown write table ${table}`, { function: name, table });
        }
      }
      const handlerSource = loadHandlerSource(def.js.source, name);
      functions.push({
        name,
        kind: 'Action',
        uses: def.uses ?? [],
        runtime: { IbexModule: { source: handlerSource ?? '', export: def.js.exportName } },
        declaredReads: [],
        declaredWrites: writes,
        syncabilityClass: 'action',
      });
    } else if (def.__kind === 'Action') {
      const writes = def.writes ?? [];
      for (const table of writes) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: action declares unknown write table ${table}`, { function: name, table });
        }
      }
      functions.push({
        name,
        kind: 'Action',
        uses: def.uses ?? [],
        runtime: { HostPlan: { Action: serializeActionPlan(def.plan, name, err) } },
        declaredReads: [],
        declaredWrites: writes,
        syncabilityClass: 'action',
      });
    }
  }

  // Ephemeral collections project as Contract read descriptors (ENG-22479;
  // Exact LLP 0284 §2.5): they live in the manifest QUERIES map with
  // `ephemeral: true` (the runtime's subscribeEphemeral looks descriptors up
  // there and the compiler rejects `query`-binding them — §2.4 kind
  // mismatch). They are NOT server functions; name collisions are errors.
  for (const collection of ephemeralCollections) {
    if (contractQueries[collection.name] || contractMutations[collection.name]) {
      err('EPHEMERAL_NAME_COLLISION', 'ephemeral', `${collection.name} collides with a function name`, { collection: collection.name });
      continue;
    }
    contractQueries[collection.name] = contractEphemeralDescriptor(collection, schemaDef);
  }

  validateActionPlans(functions, err);
  const cronJobs = buildCronJobs(cronDefs, functions, err);
  const configEntries = buildConfigEntries(configDefs, functions, err);

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Hashes + emit ----------------------------------------------------------
  const seedSource = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : null;
  const defineSource = readFileSync(join(packageDir(), 'define.mjs'), 'utf8');
  const canonicalCapability = loadCanonicalCapabilityManifest(err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const appId = inferAppId(backendDir);
  const demoMetadata = readDemoAppMetadata(backendDir, appId, diagnostics);
  // Hash inputs use the MANIFEST-RELATIVE handler path (LLP 0034 review fix
  // 4): keying by absolute path baked the checkout location into inputsHash /
  // bundleHash, so committed artifacts only reproduced from the checkout that
  // generated them.
  const handlerInputs = [];
  for (const [sourcePath, source] of [...handlerSourceCache.entries()].sort(([a], [b]) => compareCodeUnits(a, b))) {
    handlerInputs.push(sourcePath, source ?? '');
  }
  const inputs = [
    schemaSource,
    functionsSource,
    ...(seedSource === null ? [] : [seedSource]),
    ...(demoMetadata.source === null ? [] : [demoMetadata.source]),
    defineSource,
    canonicalCapability.source,
    ...handlerInputs,
  ];
  const inputsHash = sha256(inputs.join('\0'));
  const schemaContentHash = sha256(schemaSource);
  const bundleContentHash = sha256([functionsSource, defineSource, ...handlerInputs].join('\0'));

  const generatedAt = generatedAtMillis();
  const appIdentity = demoMetadata.identity;
  const schemaHash = `sha256:${schemaContentHash.slice(0, 16)}`;
  const bundleHash = `sha256:${bundleContentHash.slice(0, 16)}`;
  const schemaManifest = {
    artifactKind: 'schemaManifest',
    schemaVersion: SCHEMA_VERSION,
    appId,
    ...(appIdentity ? { app: appIdentity } : {}),
    schemaHash,
    inputsHash,
    generatedAt,
    targetProfile: TARGET_PROFILE,
    portabilityFlags: [],
    artifactDiagnostics: [],
    ephemeralCollections,
    tables: Object.values(tables),
  };
  const functionManifest = {
    artifactKind: 'functionManifest',
    schemaVersion: SCHEMA_VERSION,
    appId,
    bundleHash,
    inputsHash,
    generatedAt,
    unsupportedDependencyDiagnostics: [],
    functions: decorateFunctions(appId, functions),
    cronJobs,
    config: configEntries,
  };
  // Server-declared, never authored here (LLP 0032 P2 / LLP 0037): the
  // committed schemas/ file is generated from the Rust core's declaration
  // (`CapabilityManifest::local_v0_declared`, drift-gated by
  // tests/capability_v0.rs) and embedded verbatim.
  const capabilityManifest = canonicalCapability.manifest;
  const contractManifest = {
    artifactKind: 'contractDataManifest',
    schemaVersion: SCHEMA_VERSION,
    // v2 (LLP 0034 D3): additive per-descriptor liveness/cost facts per Exact
    // LLP 0284 §2.4. Old fields remain valid inputs; unknown new fields are
    // ignored by old consumers.
    manifestVersion: CONTRACT_DATA_MANIFEST_VERSION,
    provider: 'snapback',
    inputsHash,
    schemaHash,
    bundleHash,
    capabilities: {
      localReplica: false,
      subscriptions: true,
      initialSnapshot: true,
      optimisticMutations: false,
      rowSyncState: true,
      serverRunnableQueries: true,
      forceStates: true,
      branchableFixtures: false,
      headlessBoot: true,
    },
    // Honest until LLP 0034 D2 lands: no MutationReceipt/SubscriptionReceipt
    // surface exists yet (the D1 kit emits minimal subscription events only).
    receipts: 'none',
    queries: contractQueries,
    mutations: contractMutations,
    ephemeral: contractEphemeralSection(ephemeralCollections),
  };
  for (const [name, binding] of Object.entries(contractQueries)) {
    // Migration cross-check (0284 §2.4): fail loudly, write nothing, if the
    // legacy `subscription` field and the v2 liveness fields ever disagree.
    diagnostics.push(...crossCheckContractQueryBinding(name, binding));
  }

  // DK-7 (LLP 0037): validate the Snapback-owned artifacts against the committed
  // Rust-derived schemas before writing. Fail closed (write nothing) on any
  // mismatch. The Exact-owned contract-data manifest is out of scope (scope fence).
  for (const [schemaFile, instance, expected] of [
    ['schema.manifest.schema.json', schemaManifest, { artifactKind: 'schemaManifest', schemaVersion: SCHEMA_VERSION }],
    ['functions.manifest.schema.json', functionManifest, { artifactKind: 'functionManifest', schemaVersion: SCHEMA_VERSION }],
    ['capability.manifest.schema.json', capabilityManifest, { artifactKind: 'capabilityManifest', schemaVersion: SCHEMA_VERSION }],
  ]) {
    const { missing, problems } = validateArtifactAgainstSchema(schemaFile, instance, expected);
    if (missing) {
      err('CODEGEN_ARTIFACT_SCHEMA_MISSING', 'codegen',
        `cannot validate ${instance.artifactKind} against committed schema: ${missing}`,
        { artifact: instance.artifactKind, schema: `schemas/${schemaFile}` });
    } else if (problems.length > 0) {
      err('CODEGEN_ARTIFACT_SCHEMA_INVALID', 'codegen',
        `${instance.artifactKind} does not match committed schemas/${schemaFile}: ${problems.join('; ')}`,
        { artifact: instance.artifactKind, schema: `schemas/${schemaFile}`, problems });
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const outDir = join(backendDir, 'generated');
  const apiModule = renderApiModule(appId, functionManifest.functions, ephemeralCollections);
  const apiTypes = renderApiTypes(functionManifest.functions, functionsModule, ephemeralCollections, schemaDef);
  const contractModules = renderContractModules(contractManifest, functionManifest.functions, functionsModule, ephemeralCollections, schemaDef);
  validateContractModuleFilenames(contractModules, err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const packageJson = {
    type: 'module',
    exports: {
      '.': {
        types: './api.d.ts',
        import: './api.mjs',
      },
      './schema': './schema.manifest.json',
      './functions': './functions.manifest.json',
      './capabilities': './capability.manifest.json',
      './contract/*': './contract/*',
    },
  };
  const contractArtifactFiles = contractModules.map((module) => `contract/${module.file}`);
  const artifactIndex = {
    artifactKind: 'artifactIndex',
    schemaVersion: SCHEMA_VERSION,
    appId,
    inputsHash,
    generatedAt,
    schemaHash,
    bundleHash,
    artifacts: ['schema.manifest.json', 'functions.manifest.json', 'capability.manifest.json', 'contract-data.manifest.json', 'api.mjs', 'api.d.ts', 'package.json', ...contractArtifactFiles],
    tables: Object.keys(tables),
    ephemeralCollections: ephemeralCollections.map((collection) => collection.name),
    functions: functionManifest.functions.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
    cronJobs: cronJobs.map((job) => ({ name: job.name, action: job.action, enabled: job.enabled })),
    // Names and requirement flags only — the index mirrors declarations,
    // never values (LLP 0036).
    config: configEntries.map((entry) => ({ name: entry.name, required: entry.required, pool: entry.pool })),
  };
  const tmpOutDir = join(backendDir, `.generated.tmp-${process.pid}-${Date.now()}`);
  try {
    writeGeneratedOutput(tmpOutDir, {
      schemaManifest,
      functionManifest,
      capabilityManifest,
      contractManifest,
      apiModule,
      apiTypes,
      contractModules,
      packageJson,
      artifactIndex,
    });
    replaceDirectory(tmpOutDir, outDir);
  } catch (error) {
    rmSync(tmpOutDir, { recursive: true, force: true });
    err('CODEGEN_WRITE_FAILED', 'codegen', `failed to write generated artifacts transactionally: ${error.message}`, { path: outDir, error: error.message });
    return { ok: false, diagnostics };
  }

  return { ok: true, diagnostics, inputsHash, outDir, schemaManifest, functionManifest, capabilityManifest, contractManifest };

  // Cache (and hash — see handlerInputs) by the manifest-relative sourcePath,
  // never the absolute checkout path, so generated hashes are reproducible
  // from any checkout (LLP 0034 review fix 4).
  function loadHandlerSource(sourcePath, functionName) {
    if (!handlerSourceCache.has(sourcePath)) {
      const absolute = join(backendDir, sourcePath);
      let source = '';
      try {
        source = readFileSync(absolute, 'utf8');
      } catch (error) {
        err('BUNDLE_SOURCE_MISSING', 'bundle', `${functionName}: handler source ${sourcePath} could not be read`, { function: functionName, source: sourcePath, error: error.message });
        handlerSourceCache.set(sourcePath, null);
        return null;
      }
      const blocked = scanUnsupportedHandlerSource(source);
      if (blocked.length > 0) {
        for (const issue of blocked) {
          err(issue.code, 'bundle', `${functionName}: ${issue.message}`, {
            function: functionName,
            source: sourcePath,
            token: issue.token,
            sourceSpan: { file: sourcePath, line: issue.line, column: issue.column },
          });
        }
      }
      handlerSourceCache.set(sourcePath, source);
    }
    return handlerSourceCache.get(sourcePath);
  }
}

function buildEphemeralCollections(ephemeralDef, err) {
  if (!ephemeralDef) return [];

  // @ref LLP 0013#agent-and-developer-diagnostics — missing TTL/auth/routing
  // and unsupported targets must be generated diagnostics, not silent drops.
  const collections = [];
  for (const [name, def] of Object.entries(ephemeralDef.collections ?? {})) {
    if (!IDENT.test(name)) {
      err('EPHEMERAL_INVALID_IDENTIFIER', 'ephemeral', `invalid ephemeral collection identifier ${name}`, { collection: name });
      continue;
    }
    if (!isEphemeralCollectionDef(def)) {
      err('EPHEMERAL_INVALID_COLLECTION', 'ephemeral', `${name} must be ephemeral.collection(...)`, { collection: name });
      continue;
    }

    const scopeFields = Object.keys(def.scope ?? {});
    if (scopeFields.length === 0) {
      err('EPHEMERAL_EMPTY_SCOPE', 'ephemeral', `${name} needs at least one scope field`, { collection: name });
    }
    for (const field of scopeFields) {
      if (!IDENT.test(field)) {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} has invalid scope field ${field}`, { collection: name, field });
        continue;
      }
      checkObjectValidatorFieldIdents(def.scope?.[field], `scope field ${field}`, (fieldName, where) => {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
      });
    }
    // The value validator's nested v.object field names reach the emitted
    // scope/value TS types (typeForValidator) unescaped, same as scope fields.
    checkObjectValidatorFieldIdents(def.value, 'value', (fieldName, where) => {
      err('EPHEMERAL_INVALID_VALUE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
    });

    const routingFields = def.routing ?? scopeFields;
    if (!Array.isArray(routingFields) || routingFields.length === 0) {
      err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} needs at least one routing field`, { collection: name });
    }
    for (const field of routingFields) {
      if (!scopeFields.includes(field)) {
        err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} routes by ${field}, which is not in its scope`, { collection: name, field, scopeFields });
      }
    }

    if (!Number.isInteger(def.ttlMs) || def.ttlMs <= 0) {
      err('EPHEMERAL_MISSING_TTL', 'ephemeral', `${name} needs a positive ttlMs`, { collection: name });
    }
    if (def.maxTtlMs < def.ttlMs) {
      err('EPHEMERAL_INVALID_TTL', 'ephemeral', `${name} maxTtlMs is below ttlMs`, { collection: name, ttlMs: def.ttlMs, maxTtlMs: def.maxTtlMs });
    }
    if (def.maxValueBytes > def.hardMaxValueBytes || def.maxValueBytes > 4_096) {
      err('EPHEMERAL_VALUE_BUDGET_TOO_LARGE', 'ephemeral', `${name} maxValueBytes exceeds the local hard cap`, {
        collection: name,
        maxValueBytes: def.maxValueBytes,
        hardMaxValueBytes: def.hardMaxValueBytes,
      });
    }
    if (!def.publish || !def.publish.__accessPolicy || !def.subscribe || !def.subscribe.__accessPolicy) {
      err('EPHEMERAL_MISSING_AUTH', 'ephemeral', `${name} needs explicit publish and subscribe auth policies`, { collection: name });
    }
    for (const target of def.targets ?? []) {
      if (target !== TARGET_PROFILE) {
        err('EPHEMERAL_UNSUPPORTED_TARGET', 'ephemeral', `${name} declares unsupported ephemeral target ${target}`, { collection: name, target });
      }
    }
    if (def.delivery?.mode !== 'latest') {
      err('EPHEMERAL_UNSUPPORTED_DELIVERY_MODE', 'ephemeral', `${name} uses unsupported delivery mode ${def.delivery?.mode}`, { collection: name, mode: def.delivery?.mode });
    }

    const resolvedKeyMode = keyMode(def.key);
    if (!resolvedKeyMode) {
      err('EPHEMERAL_UNSUPPORTED_KEY_MODE', 'ephemeral', `${name} declares unsupported ephemeral key mode ${def.key}`, {
        collection: name,
        key: def.key,
        supportedKeys: ['connection', 'session', 'user', 'custom'],
      });
    }

    collections.push({
      name,
      scopeFields,
      keyMode: resolvedKeyMode ?? 'Connection',
      routingFields,
      defaultTtlMs: def.ttlMs ?? 0,
      maxTtlMs: def.maxTtlMs,
      maxValueBytes: def.maxValueBytes,
      hardMaxValueBytes: def.hardMaxValueBytes,
      sustainedHz: def.publishRate?.sustainedHz ?? 20,
      burst: def.publishRate?.burst ?? 60,
      dispatchMs: def.delivery?.dispatchMs ?? 33,
      publish: serializeAccessPolicy(def.publish),
      subscribe: serializeAccessPolicy(def.subscribe),
      maxPendingEphemeralKeys: def.maxPendingEphemeralKeys,
    });
  }
  return collections;
}

function keyMode(key) {
  return {
    connection: 'Connection',
    session: 'Session',
    user: 'User',
    custom: 'Custom',
  }[key] ?? null;
}

/// The Contract read descriptor for one ephemeral collection (ENG-22479;
/// Exact LLP 0284 §2.4/§2.5): the queries-map entry the runtime's
/// subscribeEphemeral resolves. Field shape mirrors the Exact conformance
/// fixture descriptor (ephemeral+mode:'live'+livePush+initialSnapshot with
/// the delivery-budget facts riding along).
function contractEphemeralDescriptor(collection, schemaDef) {
  const def = schemaDef.ephemeral?.collections?.[collection.name];
  return {
    name: collection.name,
    args: argDescriptors(def?.scope ?? {}),
    argOrder: Object.keys(def?.scope ?? {}),
    result: { kind: 'list', row: { shape: 'unknown' } },
    serverRunnable: false,
    localRunnable: true,
    subscription: 'initial-snapshot',
    ephemeral: true,
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
    defaultLive: true,
    maxDeltaRateHz: Math.round(1_000 / collection.dispatchMs),
    coalesce: true,
    keyMode: collection.keyMode,
    scopeFields: collection.scopeFields,
    defaultTtlMs: collection.defaultTtlMs,
    maxTtlMs: collection.maxTtlMs,
  };
}

/// Contract-manifest ephemeral facts (LLP 0034 D3; Exact LLP 0284 §2.4/§2.5.1).
///
/// The read-side delivery budget is derived from the collection's dispatch
/// window: latest-state coalescing on a 33 ms dispatch tick delivers at most
/// ~30 map updates/s per entry, so `maxDeltaRateHz = round(1000 / dispatchMs)`
/// and `coalesce: true` (LLP 0013 latest-state semantics). The publish budget
/// facts ride along so Exact LLP 0281's rated `publish` can compile against
/// them; the `*.ephemeral.ts` / `*.publish.ts` descriptor-kind migration is
/// deferred until Exact ships an `ephemeral` binding (LLP 0034 §4, deferred).
function contractEphemeralSection(ephemeralCollections) {
  const section = dict();
  for (const collection of ephemeralCollections) {
    section[collection.name] = {
      name: collection.name,
      ephemeral: true,
      keyMode: collection.keyMode,
      scopeFields: collection.scopeFields,
      routingFields: collection.routingFields,
      defaultTtlMs: collection.defaultTtlMs,
      maxTtlMs: collection.maxTtlMs,
      deliveryMode: 'latest',
      maxDeltaRateHz: Math.round(1_000 / collection.dispatchMs),
      coalesce: true,
      publishBudget: {
        sustainedHz: collection.sustainedHz,
        burst: collection.burst,
        maxValueBytes: collection.maxValueBytes,
      },
    };
  }
  return section;
}

function serializeAccessPolicy(policy) {
  if (!policy || !policy.__accessPolicy) return 'AllowAll';
  if (policy.kind === 'RequireRoomPermission') {
    return { RequireRoomPermission: { prefix: policy.prefix } };
  }
  return 'AllowAll';
}

// --- serialization helpers ---------------------------------------------------

function serializeExpr(expr) {
  if (expr.kind === 'AuthUserId') return 'AuthUserId';
  if (expr.kind === 'RuntimeId') return 'RuntimeId';
  if (expr.kind === 'RuntimeNow') return 'RuntimeNow';
  if ('Arg' in expr) return { Arg: expr.Arg };
  if ('Literal' in expr) return { Literal: expr.Literal };
  if ('Binding' in expr) return { Binding: expr.Binding };
  throw new Error(`unserializable expr ${JSON.stringify(expr)}`);
}

function serializeQueryPlan(plan) {
  return {
    table: plan.table,
    filters: plan.filters.map((f) => ({ field: f.field, op: f.op, value: serializeExpr(f.value) })),
    order: plan.order.map((o) => ({ field: o.field, direction: o.direction })),
    limit: plan.limit,
    indexed_by: plan.index,
  };
}

function serializeMutationPlan(plan) {
  const steps = plan.steps.map((step) => {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'Insert') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { Insert: { table: body.table, values, bind_id_as: body.bind_id_as } };
    }
    if (kind === 'Patch') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { Patch: { table: body.table, id: serializeExpr(body.id), values } };
    }
    return { Delete: { table: body.table, id: serializeExpr(body.id) } };
  });
  let return_value = null;
  const rv = plan.return_value;
  if (rv) {
    if (rv.kind === 'ChangedCount') return_value = 'ChangedCount';
    else if ('Binding' in rv) return_value = { Binding: rv.Binding };
    else if ('Literal' in rv) return_value = { Literal: rv.Literal };
    else if ('Document' in rv) return_value = { Document: { table: rv.Document.table, id: serializeExpr(rv.Document.id) } };
  }
  return { steps, return_value };
}

function serializeActionPlan(plan, functionName, err) {
  if (!plan || !Array.isArray(plan.steps)) {
    err('ACTION_INVALID_PLAN', 'function', `${functionName}: action plan must have steps`, { function: functionName });
    return { steps: [], returnValue: null };
  }
  const steps = plan.steps.map((step) => {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind !== 'RunMutation') {
      err('ACTION_UNSUPPORTED_STEP', 'function', `${functionName}: unsupported action step ${kind}`, { function: functionName, step: kind });
      return null;
    }
    const args = dict();
    for (const [k, e] of Object.entries(body.args ?? {})) {
      if (!e || !e.__expr) {
        err('ACTION_INVALID_EXPR', 'function', `${functionName}: runMutation arg ${k} is not a value expression`, { function: functionName, arg: k });
        continue;
      }
      args[k] = serializeExpr(e);
    }
    return { RunMutation: { name: body.name, args, bind_result_as: body.bind_result_as } };
  }).filter(Boolean);
  let return_value = null;
  const rv = plan.return_value;
  if (rv) {
    if (rv.kind === 'ChangedCount') return_value = 'ChangedCount';
    else if (rv.kind === 'LastMutationResult') return_value = 'LastMutationResult';
    else if ('Binding' in rv) return_value = { Binding: rv.Binding };
    else if ('Literal' in rv) return_value = { Literal: rv.Literal };
  }
  return { steps, returnValue: return_value };
}

function buildCronJobs(cronDefs, functions, err) {
  const functionKinds = new Map(functions.map((fn) => [fn.name, fn.kind]));
  const jobs = [];
  const seen = new Set();
  for (const { def } of cronDefs) {
    for (const [name, spec] of Object.entries(def.jobs)) {
      if (seen.has(name)) {
        err('CRON_DUPLICATE_JOB', 'cron', `duplicate cron job ${name}`, { jobName: name });
        continue;
      }
      seen.add(name);
      if (!IDENT.test(name)) {
        err('CRON_INVALID_IDENTIFIER', 'cron', `invalid cron job identifier ${name}`, { jobName: name });
        continue;
      }
      const schedule = normalizeCronSchedule(name, spec.schedule, err);
      const action = spec.action;
      if (typeof action !== 'string' || action.length === 0) {
        err('CRON_ACTION_MISSING', 'cron', `${name}: cron job requires an action`, { jobName: name });
      } else if (!functionKinds.has(action)) {
        err('CRON_ACTION_UNKNOWN', 'cron', `${name}: unknown action ${action}`, { jobName: name, action });
      } else if (functionKinds.get(action) !== 'Action') {
        err('CRON_ACTION_KIND_MISMATCH', 'cron', `${name}: ${action} is not an action`, { jobName: name, action, kind: functionKinds.get(action) });
      }
      jobs.push({
        name,
        schedule,
        action,
        enabled: spec.enabled ?? true,
        activation: normalizeActivation(spec.activation),
        jitterPolicy: normalizeJitterPolicy(spec.schedule, spec),
        overlapPolicy: spec.overlapPolicy ?? 'NoOverlap',
        retryPolicy: spec.retryPolicy ?? { mode: 'NextTick' },
        requiredCapabilities: ['cron', 'cron_action_run_mutation'],
        targetWakeup: normalizeTargetWakeup(schedule, spec.activation),
        sourceSpan: null,
      });
    }
  }
  return jobs;
}

// @ref LLP 0036#declared-configuration-in-the-manifest — config entries are
// validated the way cron jobs are: duplicates, bad identifiers, unknown or
// non-action probes, and (v1) non-secret entries all fail closed here, before
// the server validates the same facts again at manifest load.
function buildConfigEntries(configDefs, functions, err) {
  const functionKinds = new Map(functions.map((fn) => [fn.name, fn.kind]));
  const declared = new Set();
  const entries = [];
  const CONFIG_IDENT = /^[A-Za-z0-9_-]+$/;
  for (const { def } of configDefs) {
    for (const [name, spec] of Object.entries(def.entries)) {
      if (declared.has(name)) {
        err('CONFIG_DUPLICATE_ENTRY', 'config', `duplicate config entry ${name}`, { entry: name });
        continue;
      }
      declared.add(name);
      if (!CONFIG_IDENT.test(name)) {
        err('CONFIG_INVALID_IDENTIFIER', 'config', `invalid config entry name ${name}`, { entry: name });
        continue;
      }
      if (spec.secret === false) {
        err('CONFIG_NON_SECRET_UNIMPLEMENTED', 'config', `${name}: non-secret config entries are not implemented yet (LLP 0036 v1 is secret entries only)`, { entry: name });
        continue;
      }
      if (spec.default !== undefined) {
        err('CONFIG_DEFAULT_UNIMPLEMENTED', 'config', `${name}: defaults belong to non-secret entries, which are not implemented yet`, { entry: name });
        continue;
      }
      if (spec.probe !== undefined) {
        if (!functionKinds.has(spec.probe)) {
          err('CONFIG_PROBE_UNKNOWN', 'config', `${name}: unknown probe ${spec.probe}`, { entry: name, probe: spec.probe });
          continue;
        }
        if (functionKinds.get(spec.probe) !== 'Action') {
          err('CONFIG_PROBE_KIND_MISMATCH', 'config', `${name}: probe ${spec.probe} is not an action`, { entry: name, probe: spec.probe, kind: functionKinds.get(spec.probe) });
          continue;
        }
      }
      entries.push({
        name,
        description: spec.description ?? null,
        purpose: spec.purpose ?? null,
        secret: true,
        required: spec.required ?? true,
        pool: Boolean(spec.pool),
        probe: spec.probe ?? null,
        howToGet: spec.howToGet ?? null,
        // Omitted (not null) when absent: the server treats an explicit null
        // acquisition as present-but-empty rather than absent.
        ...(spec.acquisition !== undefined ? { acquisition: spec.acquisition } : {}),
        sourceSpan: null,
      });
    }
  }
  // D8: every `uses` grant names a declared entry; an unknown name would fail
  // at runtime with SNAPBACK_CONFIG_UNDECLARED, so catch it at codegen time.
  for (const fn of functions) {
    for (const name of fn.uses ?? []) {
      if (!declared.has(name)) {
        err('CONFIG_USES_UNKNOWN', 'config', `${fn.name}: uses names ${name}, which is not a declared config entry`, { function: fn.name, entry: name });
      }
    }
  }
  return entries;
}

function normalizeCronSchedule(name, schedule, err) {
  if (!schedule || typeof schedule !== 'object') {
    err('CRON_INVALID_SCHEDULE', 'cron', `${name}: cron job requires a schedule object`, { jobName: name });
    return {};
  }
  const hasEvery = Number.isInteger(schedule.everyMs);
  const hasCron = typeof schedule.cron === 'string';
  if (hasEvery === hasCron) {
    err('CRON_INVALID_SCHEDULE', 'cron', `${name}: specify exactly one of schedule.everyMs or schedule.cron`, { jobName: name });
    return {};
  }
  if (hasEvery) {
    if (schedule.everyMs < 1_000) {
      err('CRON_TARGET_CADENCE_UNSUPPORTED', 'cron', `${name}: local cron floor is 1000ms`, { jobName: name, everyMs: schedule.everyMs });
    }
    return { everyMs: schedule.everyMs };
  }
  if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(schedule.cron.trim())) {
    err('CRON_INVALID_EXPRESSION', 'cron', `${name}: cron expression must have five fields`, { jobName: name, cron: schedule.cron });
  }
  return { cron: schedule.cron.trim() };
}

function normalizeActivation(value) {
  if (!value || value === 'always') {
    return { kind: 'Always', whileLive: [] };
  }
  if (value.whileLive) {
    return { kind: 'WhileLive', whileLive: [...value.whileLive] };
  }
  return { kind: 'Always', whileLive: [] };
}

function normalizeJitterPolicy(schedule, spec) {
  const explicit = spec.jitter ?? schedule?.jitter;
  const enabled = explicit === false ? false : true;
  return { enabled, maxOffsetMs: spec.jitterMaxMs ?? 0 };
}

function normalizeTargetWakeup(schedule, activation) {
  if (schedule.everyMs) {
    return {
      kind: schedule.everyMs < 60_000 || activation?.whileLive ? 'DynamicAlarm' : 'IntervalMs',
      needsDurableRunner: true,
    };
  }
  return { kind: 'CronExpression', needsDurableRunner: true };
}

function validateActionPlans(functions, err) {
  const functionKinds = new Map(functions.map((fn) => [fn.name, fn.kind]));
  for (const fn of functions) {
    const steps = fn.runtime?.HostPlan?.Action?.steps ?? [];
    for (const step of steps) {
      const call = step.RunMutation;
      if (!call) {
        err('ACTION_UNSUPPORTED_STEP', 'function', `${fn.name}: unsupported action step`, { function: fn.name, step });
        continue;
      }
      if (!functionKinds.has(call.name)) {
        err('ACTION_MUTATION_UNKNOWN', 'function', `${fn.name}: unknown mutation ${call.name}`, { function: fn.name, mutation: call.name });
      } else if (functionKinds.get(call.name) !== 'Mutation') {
        err('ACTION_MUTATION_KIND_MISMATCH', 'function', `${fn.name}: ${call.name} is not a mutation`, { function: fn.name, mutation: call.name, kind: functionKinds.get(call.name) });
      }
    }
  }
}

function mutationReadTables(plan) {
  const reads = new Set();
  for (const step of plan.steps) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'Patch' || kind === 'Delete') reads.add(body.table);
  }
  return [...reads];
}

// Nested v.object field names are emitted as unquoted TS property names by
// typeForValidator (api.d.ts, runtime-links.ts, per-binding Args types) and as
// manifest keys, so they must satisfy IDENT like every other codegen
// namespace. Recurses through nested objects; reports each bad name once via
// the caller-supplied diagnostic emitter (reserved words are fine here —
// property positions accept them).
function checkObjectValidatorFieldIdents(val, where, report) {
  if (!val?.__validator || val.primitive !== 'object') return;
  for (const [fieldName, field] of Object.entries(val.fields ?? {})) {
    if (!IDENT.test(fieldName)) {
      report(fieldName, where);
      continue;
    }
    checkObjectValidatorFieldIdents(field, `${where}.${fieldName}`, report);
  }
}

function argDescriptors(args) {
  const out = dict();
  for (const [name, val] of Object.entries(args)) {
    out[name] = validatorDescriptor(val);
  }
  return out;
}

function validatorDescriptor(val) {
  let descriptor;
  if (!val || val.primitive === 'unknown') {
    descriptor = { shape: 'unknown' };
  } else if (val.primitive === 'object') {
    descriptor = { shape: 'object', fields: argDescriptors(val.fields ?? {}) };
  } else {
    descriptor = { shape: 'primitive', name: val.primitive };
  }
  if (val?.optional) descriptor.optional = true;
  return descriptor;
}

// JS-handler query results are typed only when declared (LLP 0032 P3): a
// ctx.db handler can return any shape, so the earlier first-read-table guess
// (which typed egress-probe's `{fetchState, config}` rows as `probe` rows) is
// replaced by the declared `result` row validator — app fields, with the
// system fields every row carries merged in — or an honest unknown.
function jsQueryRowDescriptor(def, name, err) {
  if (!def.result) return { shape: 'unknown' };
  const declared = validatorRowDescriptor(def.result);
  if (!declared) {
    err('FUNCTION_INVALID_RESULT', 'function', `${name}: result must be a v.object(...) row validator`, { function: name });
    return { shape: 'unknown' };
  }
  return {
    shape: 'object',
    fields: {
      _id: { shape: 'primitive', name: 'string' },
      _version: { shape: 'primitive', name: 'number' },
      _createdAt: { shape: 'primitive', name: 'number' },
      _updatedAt: { shape: 'primitive', name: 'number' },
      ...declared.fields,
    },
  };
}

function rowDescriptor(table) {
  const fields = dict();
  Object.assign(fields, {
    _id: { shape: 'primitive', name: 'string' },
    _version: { shape: 'primitive', name: 'number' },
    _createdAt: { shape: 'primitive', name: 'number' },
    _updatedAt: { shape: 'primitive', name: 'number' },
  });
  for (const f of table.fields) {
    const prim = { String: 'string', Boolean: 'boolean', Integer: 'number', Real: 'number' }[f.field_type];
    const descriptor = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
    if (f.optional) descriptor.optional = true;
    fields[f.name] = descriptor;
  }
  return { shape: 'object', fields };
}

function decorateFunctions(appId, functions) {
  return functions.map((fn) => {
    const reads = readSummary(fn);
    const writes = writeSummary(fn);
    return {
      id: `${appId}:${fn.name}`,
      name: fn.name,
      exportedName: fn.name,
      kind: fn.kind,
      sourceSpan: null,
      requiredCapabilities: requiredCapabilities(fn),
      authRequirement: 'optional-user',
      syncabilityClass: syncabilityClass(fn),
      readSetSummary: reads,
      writeSetSummary: writes,
      bundleEntrypoint: fn.name,
      uses: fn.uses ?? [],
      runtime: fn.runtime,
    };
  });
}

function readSummary(fn) {
  if (fn.declaredReads) {
    return { mode: fn.runtime?.IbexModule ? 'handlerDeclared' : (fn.declaredReads.length ? 'singleTable' : 'none'), primaryTable: fn.declaredReads[0] ?? null, tables: fn.declaredReads, authScopeField: fn.authScopeField ?? null };
  }
  const plan = fn.runtime?.HostPlan;
  if (plan?.Query) {
    return { mode: 'singleTable', primaryTable: plan.Query.table, tables: [plan.Query.table] };
  }
  if (plan?.Mutation) {
    const tables = new Set();
    for (const step of plan.Mutation.steps ?? []) {
      const kind = Object.keys(step)[0];
      if (kind === 'Patch' || kind === 'Delete') tables.add(step[kind].table);
    }
    return { mode: tables.size ? 'pointWritePrecondition' : 'none', primaryTable: [...tables][0] ?? null, tables: [...tables] };
  }
  return { mode: 'opaque', primaryTable: null, tables: [] };
}

function writeSummary(fn) {
  if (fn.declaredWrites) {
    return { mode: fn.runtime?.IbexModule ? 'handlerDeclared' : (fn.declaredWrites.length ? 'mutationPlan' : 'none'), primaryTable: fn.declaredWrites[0] ?? null, tables: fn.declaredWrites };
  }
  const plan = fn.runtime?.HostPlan;
  if (plan?.Action) return { mode: 'actionRunMutation', primaryTable: null, tables: [] };
  if (!plan?.Mutation) return { mode: 'none', primaryTable: null, tables: [] };
  const tables = new Set();
  for (const step of plan.Mutation.steps ?? []) {
    const kind = Object.keys(step)[0];
    tables.add(step[kind].table);
  }
  return { mode: 'mutationPlan', primaryTable: [...tables][0] ?? null, tables: [...tables] };
}

function requiredCapabilities(fn) {
  const runtimeCapability = fn.runtime?.IbexModule ? 'ibex_ctx_db_host_bridge' : 'host_plan_runtime';
  if (fn.kind === 'LiveQuery') return ['live_subscriptions', runtimeCapability];
  if (fn.kind === 'Mutation') return [runtimeCapability, 'mutation_read_set_validation'];
  if (fn.kind === 'Action') return [runtimeCapability, 'cron_action_run_mutation'];
  return [runtimeCapability];
}

function syncabilityClass(fn) {
  if (fn.syncabilityClass) return fn.syncabilityClass;
  if (fn.kind === 'LiveQuery') return 'syncable-live';
  if (fn.kind === 'Query') return 'online-only';
  if (fn.kind === 'Action') return 'action';
  return 'mutation';
}

// Outbound action egress (fetch/timers) is an opt-in DX relaxation that mirrors
// the runtime's SNAPBACK_OUTBOUND_ACTIONS seam. The runtime — not codegen — is the
// security boundary and still gates fetch by handler kind (LLP 0027 / LLP 0009).
function egressAllowedAtCodegen() {
  return /^(1|true)$/i.test(process.env.SNAPBACK_OUTBOUND_ACTIONS || '');
}

function scanUnsupportedHandlerSource(source) {
  const searchable = maskCommentsAndStrings(source);
  const allowEgress = egressAllowedAtCodegen();
  const checks = [
    ['BUNDLE_UNSUPPORTED_IMPORT', /\bimport\s*(?:\(|[\w*{])/u, 'import'],
    ['BUNDLE_UNSUPPORTED_EXPORT', /\bexport\s+/u, 'export'],
    ['BUNDLE_UNSUPPORTED_REQUIRE', /\brequire\s*\(/u, 'require'],
    ['BUNDLE_UNSUPPORTED_PROCESS', /\bprocess\b/u, 'process'],
    ...(allowEgress ? [] : [['BUNDLE_UNSUPPORTED_FETCH', /\bfetch\s*\(/u, 'fetch']]),
    ...(allowEgress ? [] : [['BUNDLE_UNSUPPORTED_TIMER', /\bset(?:Timeout|Interval)\s*\(/u, 'timer']]),
    ['BUNDLE_UNSUPPORTED_RANDOM', /\bMath\.random\s*\(/u, 'Math.random'],
    ['BUNDLE_UNSUPPORTED_TIME', /\b(?:Date\.now|new\s+Date)\b/u, 'Date'],
  ];
  return checks
    .map(([code, pattern, token]) => {
      const match = pattern.exec(searchable);
      if (!match) return null;
      return { code, token, message: `unsupported ambient dependency ${token}`, ...sourcePosition(source, match.index) };
    })
    .filter(Boolean);
}

function maskCommentsAndStrings(source) {
  const masked = maskSourceSegment(source, 0, null);
  return masked.out;
}

function maskSourceSegment(source, start, until) {
  let out = '';
  let i = start;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (until && c === until) break;
    if (c === '/' && n === '/') {
      out += '  ';
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '/' && isRegexLiteralStart(source, i)) {
      out += ' ';
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const current = source[i];
        out += current === '\n' ? '\n' : ' ';
        if (current === '\\' && i + 1 < source.length) {
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        i += 1;
        if (current === '/' && !inClass) {
          while (/[A-Za-z]/.test(source[i] ?? '')) {
            out += ' ';
            i += 1;
          }
          break;
        }
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += ' ';
      i += 1;
      while (i < source.length) {
        const current = source[i];
        out += current === '\n' ? '\n' : ' ';
        if (current === '\\' && i + 1 < source.length) {
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        i += 1;
        if (current === quote) break;
      }
      continue;
    }
    if (c === '`') {
      out += ' ';
      i += 1;
      while (i < source.length) {
        const current = source[i];
        const next = source[i + 1];
        if (current === '\\' && i + 1 < source.length) {
          out += ' ';
          out += next === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        if (current === '$' && next === '{') {
          out += '  ';
          i += 2;
          const expr = maskSourceSegment(source, i, '}');
          out += expr.out;
          i = expr.index;
          if (source[i] === '}') {
            out += ' ';
            i += 1;
          }
          continue;
        }
        out += current === '\n' ? '\n' : ' ';
        i += 1;
        if (current === '`') break;
      }
      continue;
    }
    if (c === '{' && until === '}') {
      out += c;
      i += 1;
      const inner = maskSourceSegment(source, i, '}');
      out += inner.out;
      i = inner.index;
      if (source[i] === '}') {
        out += '}';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return { out, index: i };
}

function isRegexLiteralStart(source, slashIndex) {
  let i = slashIndex - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 0) return true;
  const prev = source[i];
  if ('([{=,:;!&|?+-*~^<>%'.includes(prev)) return true;
  const prefix = source.slice(0, i + 1);
  const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(prefix)?.[1];
  return ['return', 'case', 'throw', 'typeof', 'delete', 'void', 'yield', 'await', 'in', 'of'].includes(word ?? '');
}

function sourcePosition(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function renderApiModule(appId, functions, ephemeralCollections) {
  const refs = dict();
  for (const fn of functions) {
    refs[fn.name] = {
      artifactKind: 'functionReference',
      schemaVersion: SCHEMA_VERSION,
      appId,
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
    };
  }
  const ephemeralRefs = dict();
  for (const collection of ephemeralCollections) {
    ephemeralRefs[collection.name] = {
      artifactKind: 'ephemeralCollectionReference',
      schemaVersion: SCHEMA_VERSION,
      appId,
      id: `${appId}:ephemeral:${collection.name}`,
      name: collection.name,
      keyMode: collection.keyMode,
      scopeFields: collection.scopeFields,
      routingFields: collection.routingFields,
      defaultTtlMs: collection.defaultTtlMs,
      maxTtlMs: collection.maxTtlMs,
      maxValueBytes: collection.maxValueBytes,
      deliveryMode: 'latest',
    };
  }
  refs.ephemeral = ephemeralRefs;
  return `${HEADER}\n` +
    `export const ephemeral = Object.freeze(${stableJson(ephemeralRefs)});\n` +
    `export const api = Object.freeze(${stableJson(refs)});\n` +
    `export default api;\n`;
}

function renderApiTypes(functions, functionsModule, ephemeralCollections, schemaDef) {
  const lines = [
    HEADER,
    "export type SchemaVersion = 'snapback.v0';",
    "export type FunctionKind = 'Query' | 'Mutation' | 'LiveQuery' | 'Action';",
    "export type EphemeralKeyMode = 'Connection' | 'Session' | 'User' | 'Custom';",
    'export interface FunctionReference<Name extends string, Kind extends FunctionKind, Args> {',
    "  artifactKind: 'functionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  kind: Kind;',
    '  readonly __args?: Args;',
    '}',
    'export interface EphemeralCollectionReference<Name extends string, Scope, Value> {',
    "  artifactKind: 'ephemeralCollectionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  keyMode: EphemeralKeyMode;',
    '  scopeFields: readonly string[];',
    '  routingFields: readonly string[];',
    '  defaultTtlMs: number;',
    '  maxTtlMs: number;',
    '  maxValueBytes: number;',
    "  deliveryMode: 'latest';",
    '  readonly __scope?: Scope;',
    '  readonly __value?: Value;',
    '}',
    'export interface GeneratedEphemeral {',
  ];
  for (const collection of ephemeralCollections) {
    const def = schemaDef.ephemeral?.collections?.[collection.name];
    lines.push(`  ${collection.name}: EphemeralCollectionReference<'${collection.name}', ${typeForScope(def?.scope ?? {})}, ${typeForValidator(def?.value)}>;`);
  }
  lines.push(
    '}',
    'export interface GeneratedApi {',
  );
  for (const fn of functions) {
    const def = functionsModule[fn.name];
    lines.push(`  ${fn.name}: FunctionReference<'${fn.name}', '${fn.kind}', ${typeForArgs(def?.args ?? {})}>;`);
  }
  lines.push('  ephemeral: GeneratedEphemeral;');
  lines.push('}');
  lines.push('export declare const ephemeral: GeneratedEphemeral;');
  lines.push('export declare const api: GeneratedApi;');
  lines.push('export default api;');
  return lines.join('\n') + '\n';
}

function renderContractModules(contractManifest, functions, functionsModule, ephemeralCollections = [], schemaDef = null) {
  const modules = [
    {
      file: 'runtime-links.ts',
      source: renderContractRuntimeLinks(functions, functionsModule, ephemeralCollections, schemaDef),
    },
  ];

  // Ephemeral descriptor pair (ENG-22479; Exact LLP 0284 §2.5 / LLP 0034
  // §4): the read descriptor (`ephemeral` binding target) and the
  // mutation-shaped publish callable carrying the LLP 0281 budget facts.
  for (const collection of ephemeralCollections) {
    const def = schemaDef?.ephemeral?.collections?.[collection.name];
    const binding = contractManifest.queries[collection.name];
    modules.push({
      file: `${collection.name}.ephemeral.ts`,
      source: renderContractEphemeralModule(collection, def),
    });
    modules.push({
      file: `${collection.name}.ephemeral.contract-meta.ts`,
      source: renderContractEphemeralMeta(collection.name, binding, def),
    });
    modules.push({
      file: `${collection.name}.publish.ts`,
      source: renderContractPublishModule(collection, def),
    });
    modules.push({
      file: `${collection.name}.publish.contract-meta.ts`,
      source: renderContractPublishMeta(collection),
    });
  }

  for (const fn of functions) {
    if (fn.kind === 'Action') continue;
    if (fn.kind === 'Mutation') {
      const binding = contractManifest.mutations[fn.name];
      modules.push({
        file: `${fn.name}.mutation.ts`,
        source: renderContractBindingModule(fn, functionsModule[fn.name], 'mutation'),
      });
      modules.push({
        file: `${fn.name}.mutation.contract-meta.ts`,
        source: renderContractMutationMeta(fn.name, binding),
      });
    } else {
      const binding = contractManifest.queries[fn.name];
      modules.push({
        file: `${fn.name}.query.ts`,
        source: renderContractBindingModule(fn, functionsModule[fn.name], 'query'),
      });
      modules.push({
        file: `${fn.name}.query.contract-meta.ts`,
        source: renderContractQueryMeta(fn.name, binding),
      });
    }
  }

  return modules;
}

function renderContractRuntimeLinks(functions, functionsModule, ephemeralCollections = [], schemaDef = null) {
  const entries = [];
  for (const fn of functions) {
    if (fn.kind === 'Action') continue;
    const def = functionsModule[fn.name];
    entries.push({ name: fn.name, argsType: typeForArgs(def?.args ?? {}) });
  }
  for (const collection of ephemeralCollections) {
    const def = schemaDef?.ephemeral?.collections?.[collection.name];
    entries.push({ name: collection.name, argsType: typeForScope(def?.scope ?? {}) });
    entries.push({ name: `${collection.name}Publish`, argsType: publishArgsType(def) });
  }
  return renderRuntimeLinksModule({
    header: HEADER,
    refLine: '// @ref LLP 0021#phase-1-specify-contractdatamanifest - Contract runtime links are projected from Snapback generated artifacts.',
    linksBaseName: 'SnapbackContract',
    errorMessage: 'Snapback Contract links were used before the browser bridge was configured.',
    entries,
  });
}

function renderContractBindingModule(fn, def, kind) {
  return renderBindingModule({
    header: HEADER,
    refLine: '// @ref LLP 0021#phase-1-specify-contractdatamanifest - per-binding Contract modules import ordinary query/mutation symbols.',
    bindingComment: `// Contract ${kind} binding for ${fn.id}.`,
    name: fn.name,
    argsType: typeForArgs(def?.args ?? {}),
    linksBaseName: 'SnapbackContract',
  });
}

function renderContractQueryMeta(name, binding) {
  const reads = readTablesFromBinding(binding);
  const readMode = binding?.subscription === 'initial-snapshot' ? 'sync' : 'async';
  const cacheKey = reads[0] ?? name;
  const row = binding?.result?.row;
  // An untyped row (undeclared JS-handler result) is emitted as an honest
  // `unknown` result with no shape entry, never an empty object shape.
  const rowIsTyped = row?.shape === 'object';
  const rowType = `${pascal(name)}Row`;
  const resultType = binding?.result?.kind === 'list'
    ? (rowIsTyped ? `${rowType}[]` : 'unknown[]')
    : (rowIsTyped ? rowType : 'unknown');
  return renderQueryMetaModule({
    header: HEADER,
    name,
    reads,
    readMode,
    cacheKey,
    resultType,
    shapeName: rowIsTyped ? rowType : null,
    shapeFields: rowIsTyped ? contractShapeFields(row) : null,
    extraFacts: livenessFactsLiteral(binding),
  });
}

// Exact 0284 §2.4 liveness facts, emitted into the contract-meta descriptor
// entries under EXACTLY these names (ENG-22527 item 4): the exact-side
// ENG-22526 compiler reads them for compile-time info diagnostics. Restricted
// to exact's six ImportLivenessFacts fields (packages/exact-contract
// compiler/ir.ts) — delivery facts (maxDeltaRateHz/coalesce) ride the
// contract-data manifest and the ephemeral module exports, never the
// descriptor entry, so the sidecars typecheck against the exact surface.
function livenessFactsLiteral(binding) {
  const facts = {
    mode: binding?.mode,
    livePush: binding?.livePush,
    initialSnapshot: binding?.initialSnapshot,
    ephemeral: binding?.ephemeral ?? false,
  };
  if (binding?.pollCadenceMs !== undefined) facts.pollCadenceMs = binding.pollCadenceMs;
  if (binding?.transport !== undefined) facts.transport = binding.transport;
  return Object.entries(facts)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ');
}

function renderContractMutationMeta(name, binding) {
  const writes = binding?.writes ?? [];
  return renderMutationMetaModule({
    header: HEADER,
    name,
    effects: writes.map((table) => `${table}.write`),
    invalidates: binding?.invalidates ?? writes,
  });
}

function renderContractEphemeralModule(collection, def) {
  const scopeType = typeForScope(def?.scope ?? {});
  const valueType = typeForValidator(def?.value);
  const pascalName = pascal(collection.name);
  return [
    HEADER,
    `// Ephemeral read descriptor for ${collection.name} (ENG-22479; Exact LLP 0284 §2.5):`,
    '// the `ephemeral` binding target. Entries are the typed presence map;',
    '// delivery facts ride the contract-data manifest (maxDeltaRateHz/coalesce).',
    '',
    "import { getSnapbackContractLinks } from './runtime-links';",
    '',
    `export const descriptor = '${collection.name}';`,
    `export const ephemeral = true;`,
    `export const keyMode = '${collection.keyMode}';`,
    `export const scopeFields = ${jsonLiteral(collection.scopeFields)};`,
    `export const defaultTtlMs = ${collection.defaultTtlMs};`,
    `export const maxTtlMs = ${collection.maxTtlMs};`,
    `export const maxDeltaRateHz = ${Math.round(1_000 / collection.dispatchMs)};`,
    `export const coalesce = true;`,
    `export type ${pascalName}Scope = ${scopeType};`,
    `export type ${pascalName}Value = ${valueType};`,
    '',
    `export function ${collection.name}(args: ${pascalName}Scope) {`,
    `  return getSnapbackContractLinks().${collection.name}(args);`,
    '}',
    '',
  ].join('\n');
}

function renderContractEphemeralMeta(name, binding, def) {
  const pascalName = pascal(name);
  // The REAL value shape from the collection's value schema (ENG-22527 item
  // 2): member reads through `c.value.<field>` get shape_unknown_member
  // exactly like durable rows, via the named-shape reference chain
  // Entry.value -> <Pascal>Value. Optionality carries over.
  const valueFields = shapeFieldsFromValidator(def?.value);
  const entryFields = {
    key: 'string',
    value: valueFields ? `${pascalName}Value` : 'unknown',
    updatedAt: 'number',
    expiresAt: { type: 'number', optional: true },
    sourceClientId: 'string',
    self: 'boolean',
  };
  const lines = [
    HEADER,
    "import { defineContractModule, shape } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.ephemeral.ts', {`,
    `  ${name}: { kind: 'ephemeral', reads: ${jsonLiteral([name])}, result: '${pascalName}Entry[]', ${livenessFactsLiteral(binding)} },`,
    `  ${pascalName}Entry: shape({ fields: ${jsonLiteral(entryFields)} }),`,
  ];
  if (valueFields) {
    lines.push(`  ${pascalName}Value: shape({ fields: ${jsonLiteral(valueFields)} }),`);
  }
  lines.push('});', '');
  return lines.join('\n');
}

// A value-schema validator's object fields as shape() field descriptors,
// carrying optionality (`{ type, optional }`); non-object validators yield
// null (the entry's value falls back to 'unknown').
function shapeFieldsFromValidator(validator) {
  if (!validator || validator.primitive !== 'object') return null;
  const fields = dict();
  for (const [name, field] of Object.entries(validator.fields ?? {})) {
    const type = { string: 'string', number: 'number', boolean: 'boolean' }[field.primitive] ?? 'unknown';
    fields[name] = field.optional ? { type, optional: true } : type;
  }
  return fields;
}

function renderContractPublishModule(collection, def) {
  const pascalName = pascal(collection.name);
  return [
    HEADER,
    `// Publish descriptor for ${collection.name} (ENG-22479; LLP 0034 §4): the`,
    '// budget facts Exact LLP 0281 rated `publish` compiles against. The',
    '// sidecar declares the publish descriptor KIND (ENG-22525 shape:',
    '// `publish({ effects, budget })`); a channel publishes through this',
    '// at a declared rate the analyzer checks against sustainedHz.',
    '',
    "import { getSnapbackContractLinks } from './runtime-links';",
    '',
    `export const descriptor = '${collection.name}';`,
    `export const sustainedHz = ${collection.sustainedHz};`,
    `export const burst = ${collection.burst};`,
    `export const maxValueBytes = ${collection.maxValueBytes};`,
    `export const hardMaxValueBytes = ${collection.hardMaxValueBytes};`,
    `export type ${pascalName}PublishArgs = ${publishArgsType(def)};`,
    '',
    `export function ${collection.name}Publish(args: ${pascalName}PublishArgs) {`,
    `  return getSnapbackContractLinks().${collection.name}Publish(args);`,
    '}',
    '',
  ].join('\n');
}

function renderContractPublishMeta(collection) {
  const name = collection.name;
  // `budget` is the descriptor fact Exact LLP 0281 stage 0's rated
  // `publish` compiles against: the analyzer rejects a channel that
  // declares rate above sustainedHz (channel_rate_exceeds_budget). The
  // descriptor-kind migration (ENG-22525): `publish({ effects, budget })`,
  // no longer mutation-shaped.
  const budget = {
    sustainedHz: collection.sustainedHz,
    burst: collection.burst,
    maxValueBytes: collection.maxValueBytes,
  };
  return [
    HEADER,
    "import { defineContractModule, publish } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.publish.ts', {`,
    `  ${name}Publish: publish({ effects: ${jsonLiteral([`ephemeral:${name}`])}, budget: ${jsonLiteral(budget)} }),`,
    '});',
    '',
  ].join('\n');
}

function publishArgsType(def) {
  const scope = Object.entries(def?.scope ?? {})
    .map(([name, val]) => `${name}: ${typeForValidator(val)}`)
    .join('; ');
  const valueType = typeForValidator(def?.value);
  return `{ ${scope}${scope ? '; ' : ''}value: ${valueType}; ttlMs?: number }`;
}

function validatorRowDescriptor(validator) {
  if (!validator || validator.primitive !== 'object') return null;
  const fields = dict();
  for (const [name, field] of Object.entries(validator.fields ?? {})) {
    const descriptor = { shape: 'primitive', name: { string: 'string', number: 'number', boolean: 'boolean' }[field.primitive] ?? 'unknown' };
    if (field.optional) descriptor.optional = true;
    fields[name] = descriptor;
  }
  return { shape: 'object', fields };
}

function readTablesFromBinding(binding) {
  return binding?.reads ?? [];
}

function contractShapeFields(row) {
  if (!row || row.shape !== 'object' || !row.fields) return {};
  const out = dict();
  for (const [name, descriptor] of Object.entries(row.fields)) {
    out[name] = contractShapeField(descriptor);
  }
  return out;
}

function contractShapeField(descriptor) {
  let type = 'unknown';
  if (descriptor?.shape === 'primitive') {
    type = descriptor.name ?? 'unknown';
  }
  return descriptor?.optional ? { type, optional: true } : type;
}

function typeForArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => typeProperty(name, val)).join('; ')} }`;
}

function typeForScope(scope) {
  const entries = Object.entries(scope);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => typeProperty(name, val)).join('; ')} }`;
}

function typeProperty(name, val) {
  return `${name}${val?.optional ? '?' : ''}: ${typeForValidator(val).replace(/ \| undefined$/, '')}`;
}

function typeForValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  let type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  if (val.primitive === 'object') {
    type = `{ ${Object.entries(val.fields ?? {}).map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${typeForValidator(field).replace(/ \| undefined$/, '')}`).join('; ')} }`;
  }
  return val.optional ? `${type} | undefined` : type;
}

function inferAppId(backendDir) {
  return resolve(backendDir).split(/[\\/]/).slice(-2, -1)[0] || 'local-app';
}

function readDemoAppMetadata(backendDir, appId, diagnostics) {
  const demoManifestPath = resolve(backendDir, '..', 'demo.snapback.json');
  if (!existsSync(demoManifestPath)) return { source: null, identity: null };
  let source;
  try {
    source = readFileSync(demoManifestPath, 'utf8');
  } catch (cause) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_READ_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} could not be read: ${cause.message}`,
      path: demoManifestPath,
    });
    return { source: null, identity: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (cause) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_INVALID_JSON',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} is not valid JSON: ${cause.message}`,
      path: demoManifestPath,
    });
    return { source, identity: null };
  }
  const app = manifest.app && typeof manifest.app === 'object' ? manifest.app : {};
  const identity = cleanObject({
    name: readString(app.name) ?? readString(manifest.title),
    description: readString(app.description) ?? readString(manifest.description),
    iconUrl: readString(app.iconUrl) ?? readString(app.icon_url) ?? readString(manifest.iconUrl) ?? readString(manifest.icon_url),
    wordmarkUrl: readString(app.wordmarkUrl) ?? readString(app.wordmark_url) ?? readString(manifest.wordmarkUrl) ?? readString(manifest.wordmark_url),
  });
  if (identity.name === appId) delete identity.name;
  return { source, identity: Object.keys(identity).length === 0 ? null : identity };
}

function readString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function cleanObject(value) {
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && entry !== undefined) out[key] = entry;
  }
  return out;
}

function generatedAtMillis() {
  if (process.env.SNAPBACK_GENERATED_AT_MS) return Number(process.env.SNAPBACK_GENERATED_AT_MS);
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH) * 1000;
  return 0;
}

// Deterministic JSON with recursively sorted object keys (stable diffs).
function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = dict();
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function dict() {
  return Object.create(null);
}

function readRequiredSource(path, diagnostics, { code, subsystem, message }) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    diagnostics.push({ code, severity: 'error', subsystem, message: `${message}: ${error.message}`, path, error: error.message });
    return '';
  }
}

function moduleUrlWithSourceHash(path, source) {
  const url = pathToFileURL(path);
  url.searchParams.set('snapback_codegen', sha256(source).slice(0, 16));
  return url.href;
}

function validateContractModuleFilenames(modules, err) {
  const seen = new Map();
  for (const module of modules) {
    const key = module.file.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      err('CODEGEN_CONTRACT_MODULE_FILENAME_COLLISION', 'contract', `${module.file} collides case-insensitively with ${prior}`, { file: module.file, collidesWith: prior });
    } else {
      seen.set(key, module.file);
    }
  }
}

function writeGeneratedOutput(outDir, {
  schemaManifest,
  functionManifest,
  capabilityManifest,
  contractManifest,
  apiModule,
  apiTypes,
  contractModules,
  packageJson,
  artifactIndex,
}) {
  const contractOutDir = join(outDir, 'contract');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(contractOutDir, { recursive: true });
  writeFileSync(join(outDir, 'schema.manifest.json'), stableJson(schemaManifest) + '\n');
  writeFileSync(join(outDir, 'functions.manifest.json'), stableJson(functionManifest) + '\n');
  writeFileSync(join(outDir, 'capability.manifest.json'), stableJson(capabilityManifest) + '\n');
  writeFileSync(join(outDir, 'contract-data.manifest.json'), stableJson(contractManifest) + '\n');
  writeFileSync(join(outDir, 'api.mjs'), apiModule);
  writeFileSync(join(outDir, 'api.d.ts'), apiTypes);
  for (const module of contractModules) {
    writeFileSync(join(contractOutDir, module.file), module.source);
  }
  writeFileSync(join(outDir, 'package.json'), stableJson(packageJson) + '\n');
  writeFileSync(join(outDir, 'artifacts.json'), stableJson(artifactIndex) + '\n');
}

function replaceDirectory(tmpDir, outDir) {
  const backupDir = `${outDir}.bak-${process.pid}-${Date.now()}`;
  rmSync(backupDir, { recursive: true, force: true });
  const hadExisting = existsSync(outDir);
  if (hadExisting) renameSync(outDir, backupDir);
  try {
    renameSync(tmpDir, outDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (hadExisting && !existsSync(outDir) && existsSync(backupDir)) {
      renameSync(backupDir, outDir);
    }
    throw error;
  }
}

function packageDir() {
  return dirname(fileURLToPath(import.meta.url));
}

// The server-declared capability manifest for the local target (LLP 0032 P2 /
// LLP 0037): generated from the Rust core by tests/capability_v0.rs
// (SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_) and embedded — this
// module asserts nothing about server capabilities on its own.
function canonicalCapabilityManifestPath() {
  return join(packageDir(), '..', '..', 'schemas', 'capability.manifest.local-dev-sqlite-ibex.json');
}

function loadCanonicalCapabilityManifest(err) {
  const path = canonicalCapabilityManifestPath();
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    err('CODEGEN_CAPABILITY_MANIFEST_MISSING', 'capability', `the server-declared capability manifest could not be read; regenerate with SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_`, { path, error: error.message });
    return { source: '', manifest: null };
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    err('CODEGEN_CAPABILITY_MANIFEST_INVALID', 'capability', `the server-declared capability manifest is not valid JSON`, { path, error: error.message });
    return { source: '', manifest: null };
  }
  if (manifest?.artifactKind !== 'capabilityManifest' || manifest?.targetProfileId !== TARGET_PROFILE) {
    err('CODEGEN_CAPABILITY_MANIFEST_MISMATCH', 'capability', `expected a capabilityManifest for ${TARGET_PROFILE}`, {
      path,
      artifactKind: manifest?.artifactKind ?? null,
      targetProfileId: manifest?.targetProfileId ?? null,
    });
    return { source: '', manifest: null };
  }
  return { source, manifest };
}

// --- CLI ---------------------------------------------------------------------

// Exported so the demos/_kit/codegen.mjs compatibility shim can delegate its
// own `node demos/_kit/codegen.mjs <backendDir>` invocation here.
export async function runCodegenCli(argv = process.argv) {
  const backendDir = resolve(argv[2] ?? join(packageDir(), '..', '..', 'demos', 'todo', 'snapback'));
  const result = await generate(backendDir);
  for (const d of result.diagnostics) {
    console.error(`[${d.severity}] ${d.code} (${d.subsystem}) ${d.message}`);
  }
  if (result.ok) {
    console.log(`codegen ok: ${backendDir}/generated  (inputsHash ${result.inputsHash.slice(0, 12)}…)`);
  } else {
    console.error('codegen failed: no artifacts written (no silent stale output).');
    process.exit(1);
  }
}

function isDirectCliInvocation(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return metaUrl === pathToFileURL(argv1).href;
  }
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  await runCodegenCli(process.argv);
}
