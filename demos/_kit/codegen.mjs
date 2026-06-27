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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isFunctionDef } from './define.mjs';

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCHEMA_VERSION = 'snapback.v0';
const TARGET_PROFILE = 'local-dev-sqlite-ibex';

export async function generate(backendDir) {
  const diagnostics = [];
  const err = (code, subsystem, message, extra = {}) =>
    diagnostics.push({ code, severity: 'error', subsystem, message, ...extra });

  const schemaPath = join(backendDir, 'schema.mjs');
  const functionsPath = join(backendDir, 'functions.mjs');
  const seedPath = join(backendDir, 'seed.json');
  const handlerSourceCache = new Map();

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
      const primary = readTables[0];
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        result: { kind: 'list', row: rowDescriptor(tables[primary]) },
        serverRunnable: true,
        localRunnable: false,
        subscription: def.__kind === 'LiveQuery' ? 'initial-snapshot' : 'none',
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
        subscription: def.__kind === 'LiveQuery' ? 'initial-snapshot' : 'none',
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
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Hashes + emit ----------------------------------------------------------
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const functionsSource = readFileSync(functionsPath, 'utf8');
  const seedSource = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : null;
  const defineSource = readFileSync(join(kitDir(), 'define.mjs'), 'utf8');
  const handlerInputs = [];
  for (const [absolute, source] of [...handlerSourceCache.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    handlerInputs.push(absolute, source ?? '');
  }
  const inputs = [schemaSource, functionsSource, ...(seedSource === null ? [] : [seedSource]), defineSource, ...handlerInputs];
  const inputsHash = sha256(inputs.join('\0'));
  const schemaContentHash = sha256(schemaSource);
  const bundleContentHash = sha256([functionsSource, defineSource, ...handlerInputs].join('\0'));

  const generatedAt = generatedAtMillis();
  const appId = inferAppId(backendDir);
  const schemaHash = `sha256:${schemaContentHash.slice(0, 16)}`;
  const bundleHash = `sha256:${bundleContentHash.slice(0, 16)}`;
  const schemaManifest = {
    artifactKind: 'schemaManifest',
    schemaVersion: SCHEMA_VERSION,
    appId,
    schemaHash,
    inputsHash,
    generatedAt,
    targetProfile: TARGET_PROFILE,
    portabilityFlags: [],
    artifactDiagnostics: [],
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
  };
  const capabilityManifest = {
    artifactKind: 'capabilityManifest',
    schemaVersion: SCHEMA_VERSION,
    targetProfileId: TARGET_PROFILE,
    storageEngine: 'sqlite',
    runtimeEngine: 'ibex',
    localServerLifecycle: true,
    liveSubscriptions: true,
    syncableLiveQueries: true,
    onlineOnlyQueries: true,
    replaceOnlyQueries: true,
    offlineRetention: false,
    optimisticReplay: false,
    mutationIsolationMode: 'handler-captured-read-set-validation',
    authImpersonation: true,
    permissionDiagnostics: false,
    assetUpload: false,
    outboundActions: false,
    cron: false,
    notifications: false,
    supportedQueryForms: ['host-plan-single-table-eq', 'host-plan-live-replace', 'ibex-ctx-db-single-table-eq', 'ibex-live-eq-replace'],
    portabilityOptOuts: [],
    resourceLimits: [
      { name: 'wall_clock_timeout', status: 'Missing' },
      { name: 'cpu_budget', status: 'Missing' },
      { name: 'maximum_result_size', status: 'Advisory' },
      { name: 'maximum_subscription_count', status: 'Advisory' },
    ],
    capabilityGaps: [
      'offline_mutation_replay',
      'postgres',
      'cloudflare',
      'hosted_untrusted_code',
      'external_auth',
      'assets',
      'cron',
      'notifications',
      'websocket_push_transport',
      'precise_realtime_query_range_matcher',
    ],
  };
  const contractManifest = {
    artifactKind: 'contractDataManifest',
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: 1,
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
    queries: contractQueries,
    mutations: contractMutations,
  };

  const outDir = join(backendDir, 'generated');
  const contractOutDir = join(outDir, 'contract');
  mkdirSync(outDir, { recursive: true });
  rmSync(contractOutDir, { recursive: true, force: true });
  mkdirSync(contractOutDir, { recursive: true });
  const apiModule = renderApiModule(appId, functionManifest.functions);
  const apiTypes = renderApiTypes(functionManifest.functions, functionsModule);
  const contractModules = renderContractModules(contractManifest, functionManifest.functions, functionsModule);
  writeFileSync(join(outDir, 'schema.manifest.json'), stableJson(schemaManifest) + '\n');
  writeFileSync(join(outDir, 'functions.manifest.json'), stableJson(functionManifest) + '\n');
  writeFileSync(join(outDir, 'capability.manifest.json'), stableJson(capabilityManifest) + '\n');
  writeFileSync(join(outDir, 'contract-data.manifest.json'), stableJson(contractManifest) + '\n');
  writeFileSync(join(outDir, 'api.mjs'), apiModule);
  writeFileSync(join(outDir, 'api.d.ts'), apiTypes);
  for (const module of contractModules) {
    writeFileSync(join(contractOutDir, module.file), module.source);
  }
  writeFileSync(join(outDir, 'package.json'), stableJson({
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
  }) + '\n');
  const contractArtifactFiles = contractModules.map((module) => `contract/${module.file}`);
  writeFileSync(
    join(outDir, 'artifacts.json'),
    stableJson({
      artifactKind: 'artifactIndex',
      schemaVersion: SCHEMA_VERSION,
      appId,
      inputsHash,
      generatedAt,
      schemaHash,
      bundleHash,
      artifacts: ['schema.manifest.json', 'functions.manifest.json', 'capability.manifest.json', 'contract-data.manifest.json', 'api.mjs', 'api.d.ts', 'package.json', ...contractArtifactFiles],
      tables: Object.keys(tables),
      functions: functionManifest.functions.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
    }) + '\n',
  );

  return { ok: true, diagnostics, inputsHash, outDir, schemaManifest, functionManifest, capabilityManifest, contractManifest };

  function loadHandlerSource(sourcePath, functionName) {
    const absolute = join(backendDir, sourcePath);
    if (!handlerSourceCache.has(absolute)) {
      let source = '';
      try {
        source = readFileSync(absolute, 'utf8');
      } catch (error) {
        err('BUNDLE_SOURCE_MISSING', 'bundle', `${functionName}: handler source ${sourcePath} could not be read`, { function: functionName, source: sourcePath, error: error.message });
        handlerSourceCache.set(absolute, null);
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
      handlerSourceCache.set(absolute, source);
    }
    return handlerSourceCache.get(absolute);
  }
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

function mutationReadTables(plan) {
  const reads = new Set();
  for (const step of plan.steps) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'Patch' || kind === 'Delete') reads.add(body.table);
  }
  return [...reads];
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
  return [runtimeCapability];
}

function syncabilityClass(fn) {
  if (fn.syncabilityClass) return fn.syncabilityClass;
  if (fn.kind === 'LiveQuery') return 'syncable-live';
  if (fn.kind === 'Query') return 'online-only';
  return 'mutation';
}

function scanUnsupportedHandlerSource(source) {
  const searchable = maskCommentsAndStrings(source);
  const checks = [
    ['BUNDLE_UNSUPPORTED_IMPORT', /\bimport\s*(?:\(|[\w*{])/u, 'import'],
    ['BUNDLE_UNSUPPORTED_EXPORT', /\bexport\s+/u, 'export'],
    ['BUNDLE_UNSUPPORTED_REQUIRE', /\brequire\s*\(/u, 'require'],
    ['BUNDLE_UNSUPPORTED_PROCESS', /\bprocess\b/u, 'process'],
    ['BUNDLE_UNSUPPORTED_FETCH', /\bfetch\s*\(/u, 'fetch'],
    ['BUNDLE_UNSUPPORTED_TIMER', /\bset(?:Timeout|Interval)\s*\(/u, 'timer'],
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
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
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
    if (c === '"' || c === "'" || c === '`') {
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
    out += c;
    i += 1;
  }
  return out;
}

function sourcePosition(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function renderApiModule(appId, functions) {
  const refs = {};
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
  return `// Generated by demos/_kit/codegen.mjs. Do not edit by hand.\n` +
    `export const api = Object.freeze(${stableJson(refs)});\n` +
    `export default api;\n`;
}

function renderApiTypes(functions, functionsModule) {
  const lines = [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    "export type SchemaVersion = 'snapback.v0';",
    "export type FunctionKind = 'Query' | 'Mutation' | 'LiveQuery';",
    'export interface FunctionReference<Name extends string, Kind extends FunctionKind, Args> {',
    "  artifactKind: 'functionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  kind: Kind;',
    '  readonly __args?: Args;',
    '}',
    'export interface GeneratedApi {',
  ];
  for (const fn of functions) {
    const def = functionsModule[fn.name];
    lines.push(`  ${fn.name}: FunctionReference<'${fn.name}', '${fn.kind}', ${typeForArgs(def?.args ?? {})}>;`);
  }
  lines.push('}');
  lines.push('export declare const api: GeneratedApi;');
  lines.push('export default api;');
  return lines.join('\n') + '\n';
}

function renderContractModules(contractManifest, functions, functionsModule) {
  const modules = [
    {
      file: 'runtime-links.ts',
      source: renderContractRuntimeLinks(functions, functionsModule),
    },
  ];

  for (const fn of functions) {
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

function renderContractRuntimeLinks(functions, functionsModule) {
  const lines = [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    '// @ref LLP 0021#phase-1-specify-contractdatamanifest - Contract runtime links are projected from Snapback generated artifacts.',
    '',
    'export interface SnapbackContractLinks {',
  ];
  for (const fn of functions) {
    const def = functionsModule[fn.name];
    lines.push(`  ${fn.name}(args: ${typeForArgs(def?.args ?? {})}): unknown;`);
  }
  lines.push('}');
  lines.push('');
  lines.push('let links: SnapbackContractLinks | null = null;');
  lines.push('');
  lines.push('export function configureSnapbackContractLinks(next: SnapbackContractLinks): void {');
  lines.push('  links = next;');
  lines.push('}');
  lines.push('');
  lines.push('export function resetSnapbackContractLinks(): void {');
  lines.push('  links = null;');
  lines.push('}');
  lines.push('');
  lines.push('export function getSnapbackContractLinks(): SnapbackContractLinks {');
  lines.push('  if (!links) {');
  lines.push("    throw new Error('Snapback Contract links were used before the browser bridge was configured.');");
  lines.push('  }');
  lines.push('  return links;');
  lines.push('}');
  return lines.join('\n') + '\n';
}

function renderContractBindingModule(fn, def, kind) {
  const argsType = typeForArgs(def?.args ?? {});
  const lines = [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    '// @ref LLP 0021#phase-1-specify-contractdatamanifest - per-binding Contract modules import ordinary query/mutation symbols.',
    '',
    "import { getSnapbackContractLinks } from './runtime-links';",
    '',
    `export const descriptor = '${fn.name}';`,
    `export type ${pascal(fn.name)}Args = ${argsType};`,
    '',
    `export function ${fn.name}(args: ${pascal(fn.name)}Args) {`,
    `  return getSnapbackContractLinks().${fn.name}(args);`,
    '}',
  ];
  if (kind === 'query') {
    lines.splice(2, 0, `// Contract query binding for ${fn.id}.`);
  } else {
    lines.splice(2, 0, `// Contract mutation binding for ${fn.id}.`);
  }
  return lines.join('\n') + '\n';
}

function renderContractQueryMeta(name, binding) {
  const reads = readTablesFromBinding(binding);
  const readMode = binding?.subscription === 'initial-snapshot' ? 'sync' : 'async';
  const cacheKey = reads[0] ?? name;
  return [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    "import { defineContractModule, query } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.query.ts', {`,
    `  ${name}: query({ reads: ${jsonLiteral(reads)}, readMode: '${readMode}', cacheKey: '${cacheKey}' }),`,
    '});',
    '',
  ].join('\n');
}

function renderContractMutationMeta(name, binding) {
  const writes = binding?.writes ?? [];
  const effects = writes.map((table) => `${table}.write`);
  return [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    "import { defineContractModule, mutation } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.mutation.ts', {`,
    `  ${name}: mutation({ effects: ${jsonLiteral(effects)}, invalidates: ${jsonLiteral(writes)} }),`,
    '});',
    '',
  ].join('\n');
}

function readTablesFromBinding(binding) {
  return binding?.reads ?? [];
}

function typeForArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => `${name}: ${typeForValidator(val)}`).join('; ')} }`;
}

function typeForValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  const type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  return val.optional ? `${type} | undefined` : type;
}

function pascal(value) {
  return value
    .replace(/(^|[^A-Za-z0-9])([A-Za-z0-9])/g, (_match, _sep, char) => char.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, '');
}

function jsonLiteral(value) {
  return JSON.stringify(value);
}

function inferAppId(backendDir) {
  return resolve(backendDir).split(/[\\/]/).slice(-2, -1)[0] || 'local-app';
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
