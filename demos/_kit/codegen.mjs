// Snapback demo codegen: one source of truth -> generated manifests.
//
// @ref LLP 0012#versioning — a single source-of-truth definition feeds both the
//   Snapback server manifests and the Contract data manifest, instead of two
//   hand-synced files that drift (Valet's protocol.ts/protocol.rs trap).
// @ref LLP 0010#generated-artifacts — no silent drops: anything that cannot be
//   resolved emits a structured diagnostic with a stable code; generated output is
//   deterministic and carries an inputsHash staleness marker.
//
// Usage: node demos/_kit/codegen.mjs [backendDir]   (default: demos/todo/snapback)
// Emits <backendDir>/generated/{schema,functions,contract-data}.manifest.json + artifacts.json.
// Exits non-zero (writing nothing) if any error diagnostic is produced.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isFunctionDef } from './define.mjs';

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function generate(backendDir) {
  const diagnostics = [];
  const err = (code, subsystem, message, extra = {}) =>
    diagnostics.push({ code, severity: 'error', subsystem, message, ...extra });

  const schemaPath = join(backendDir, 'schema.mjs');
  const functionsPath = join(backendDir, 'functions.mjs');
  const seedPath = join(backendDir, 'seed.json');

  const schemaModule = await import(pathToFileURL(schemaPath).href);
  const functionsModule = await import(pathToFileURL(functionsPath).href);

  const schemaDef = schemaModule.default;
  if (!schemaDef || !schemaDef.__schema) {
    err('SCHEMA_NO_DEFAULT_EXPORT', 'schema', `${schemaPath} must default-export defineSchema(...)`);
    return { ok: false, diagnostics };
  }

  // --- Build + validate schema ------------------------------------------------
  const tables = {};
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
  const functions = [];
  const contractQueries = {};
  const contractMutations = {};

  const fieldNames = (t) => new Set(tables[t]?.fields.map((f) => f.name) ?? []);
  const isKnownField = (t, f) => SYSTEM_FIELDS.includes(f) || fieldNames(t).has(f);

  for (const [name, def] of Object.entries(functionsModule)) {
    if (!isFunctionDef(def)) continue;
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

    if (def.__kind === 'Query' || def.__kind === 'LiveQuery') {
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
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        result: { kind: 'list', row: rowDescriptor(tables[t]) },
        serverRunnable: true,
        localRunnable: false,
        subscription: def.__kind === 'LiveQuery' ? 'initial-snapshot' : 'none',
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
      });
      contractMutations[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes: [...writes],
        optimistic: false,
        serverRunnable: true,
      };
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Hashes + emit ----------------------------------------------------------
  const inputs = [readFileSync(schemaPath, 'utf8'), readFileSync(functionsPath, 'utf8')];
  if (existsSync(seedPath)) inputs.push(readFileSync(seedPath, 'utf8'));
  inputs.push(readFileSync(join(kitDir(), 'define.mjs'), 'utf8'));
  const inputsHash = sha256(inputs.join(' '));

  const schemaManifest = { schema_hash: `sha256:${inputsHash.slice(0, 16)}`, tables: Object.values(tables) };
  const functionManifest = { bundle_hash: `sha256:${inputsHash.slice(0, 16)}`, functions };
  const contractManifest = {
    manifestVersion: 1,
    provider: 'snapback',
    inputsHash,
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
    queries: contractQueries,
    mutations: contractMutations,
  };

  const outDir = join(backendDir, 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'schema.manifest.json'), stableJson(schemaManifest) + '\n');
  writeFileSync(join(outDir, 'functions.manifest.json'), stableJson(functionManifest) + '\n');
  writeFileSync(join(outDir, 'contract-data.manifest.json'), stableJson(contractManifest) + '\n');
  writeFileSync(
    join(outDir, 'artifacts.json'),
    stableJson({
      schemaVersion: 'snapback.v0',
      inputsHash,
      schemaHash: schemaManifest.schema_hash,
      bundleHash: functionManifest.bundle_hash,
      artifacts: ['schema.manifest.json', 'functions.manifest.json', 'contract-data.manifest.json'],
      tables: Object.keys(tables),
      functions: functions.map((f) => ({ name: f.name, kind: f.kind })),
    }) + '\n',
  );

  return { ok: true, diagnostics, inputsHash, outDir, schemaManifest, functionManifest, contractManifest };
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
      const values = {};
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { Insert: { table: body.table, values, bind_id_as: body.bind_id_as } };
    }
    if (kind === 'Patch') {
      const values = {};
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

function argDescriptors(args) {
  const out = {};
  for (const [name, val] of Object.entries(args)) {
    out[name] = val.primitive === 'unknown' ? { shape: 'unknown' } : { shape: 'primitive', name: val.primitive };
  }
  return out;
}

function rowDescriptor(table) {
  const fields = {
    _id: { shape: 'primitive', name: 'string' },
    _version: { shape: 'primitive', name: 'number' },
    _createdAt: { shape: 'primitive', name: 'number' },
    _updatedAt: { shape: 'primitive', name: 'number' },
  };
  for (const f of table.fields) {
    const prim = { String: 'string', Boolean: 'boolean', Integer: 'number', Real: 'number' }[f.field_type];
    fields[f.name] = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
  }
  return { shape: 'object', fields };
}

// Deterministic JSON with recursively sorted object keys (stable diffs).
function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
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

function kitDir() {
  return dirname(fileURLToPath(import.meta.url));
}

// --- CLI ---------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const backendDir = resolve(process.argv[2] ?? join(kitDir(), '..', 'todo', 'snapback'));
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
