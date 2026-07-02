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
import { isCronDef, isEphemeralCollectionDef, isFunctionDef } from './define.mjs';

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
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
  const ephemeralCollections = buildEphemeralCollections(schemaDef.ephemeral, err);
  const functions = [];
  const contractQueries = {};
  const contractMutations = {};
  const cronDefs = [];

  const fieldNames = (t) => new Set(tables[t]?.fields.map((f) => f.name) ?? []);
  const isKnownField = (t, f) => SYSTEM_FIELDS.includes(f) || fieldNames(t).has(f);

  for (const [name, def] of Object.entries(functionsModule)) {
    if (isCronDef(def)) {
      cronDefs.push({ exportName: name, def });
      continue;
    }
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
        runtime: { HostPlan: { Action: serializeActionPlan(def.plan, name, err) } },
        declaredReads: [],
        declaredWrites: writes,
        syncabilityClass: 'action',
      });
    }
  }

  validateActionPlans(functions, err);
  const cronJobs = buildCronJobs(cronDefs, functions, err);

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
    ephemeralRealtime: true,
    ephemeralWebSocketPublish: true,
    ephemeralLocalRoomAuthority: true,
    ephemeralHostedAdapter: false,
    offlineRetention: false,
    optimisticReplay: false,
    mutationIsolationMode: 'handler-captured-read-set-validation',
    authImpersonation: true,
    permissionDiagnostics: false,
    assetUpload: false,
    outboundActions: false,
    cron: true,
    notifications: false,
    supportedQueryForms: ['host-plan-single-table-eq', 'host-plan-single-table-in', 'host-plan-single-table-range', 'host-plan-live-replace', 'ibex-ctx-db-single-table-eq', 'ibex-ctx-db-single-table-in', 'ibex-ctx-db-single-table-range', 'ibex-live-eq-replace', 'ibex-live-in-replace', 'ibex-live-range-replace', 'ibex-live-limited-boundary-replace', 'websocket-live-replace', 'ephemeral-latest-state-local', 'websocket-ephemeral-publish', 'cron-fixed-interval-local', 'cron-calendar-local', 'cron-action-run-mutation'],
    portabilityOptOuts: [],
    resourceLimits: [
      { name: 'wall_clock_timeout', status: 'Missing' },
      { name: 'cpu_budget', status: 'Missing' },
      { name: 'maximum_result_size', status: 'Advisory' },
      { name: 'maximum_subscription_count', status: 'Advisory' },
      { name: 'ephemeral_value_size', status: 'Enforced' },
      { name: 'ephemeral_publish_rate', status: 'Enforced' },
      { name: 'ephemeral_durable_lane_priority', status: 'Enforced' },
    ],
    capabilityGaps: [
      'offline_mutation_replay',
      'postgres',
      'cloudflare',
      'hosted_untrusted_code',
      'external_auth',
      'assets',
      'outbound_actions',
      'notifications',
      'ephemeral_hosted_adapter',
      'ephemeral_multi_instance_sticky_routing',
    ],
  };
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
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const outDir = join(backendDir, 'generated');
  const contractOutDir = join(outDir, 'contract');
  mkdirSync(outDir, { recursive: true });
  rmSync(contractOutDir, { recursive: true, force: true });
  mkdirSync(contractOutDir, { recursive: true });
  const apiModule = renderApiModule(appId, functionManifest.functions, ephemeralCollections);
  const apiTypes = renderApiTypes(functionManifest.functions, functionsModule, ephemeralCollections, schemaDef);
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
      ephemeralCollections: ephemeralCollections.map((collection) => collection.name),
      functions: functionManifest.functions.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
      cronJobs: cronJobs.map((job) => ({ name: job.name, action: job.action, enabled: job.enabled })),
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
      }
    }

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

    collections.push({
      name,
      scopeFields,
      keyMode: keyMode(def.key),
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
  }[key] ?? 'Connection';
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
  const section = {};
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
    const args = {};
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

function renderApiModule(appId, functions, ephemeralCollections) {
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
  const ephemeralRefs = {};
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
  return `// Generated by demos/_kit/codegen.mjs. Do not edit by hand.\n` +
    `export const ephemeral = Object.freeze(${stableJson(ephemeralRefs)});\n` +
    `export const api = Object.freeze(${stableJson(refs)});\n` +
    `export default api;\n`;
}

function renderApiTypes(functions, functionsModule, ephemeralCollections, schemaDef) {
  const lines = [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
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

function renderContractModules(contractManifest, functions, functionsModule) {
  const modules = [
    {
      file: 'runtime-links.ts',
      source: renderContractRuntimeLinks(functions, functionsModule),
    },
  ];

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

function renderContractRuntimeLinks(functions, functionsModule) {
  const lines = [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    '// @ref LLP 0021#phase-1-specify-contractdatamanifest - Contract runtime links are projected from Snapback generated artifacts.',
    '',
    'export interface SnapbackContractLinks {',
  ];
  for (const fn of functions) {
    if (fn.kind === 'Action') continue;
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
  const rowType = `${pascal(name)}Row`;
  const resultType = binding?.result?.kind === 'list' ? `${rowType}[]` : rowType;
  const shapeFields = contractShapeFields(binding?.result?.row);
  return [
    '// Generated by demos/_kit/codegen.mjs. Do not edit by hand.',
    "import { defineContractModule, query, shape } from '@exact/contract/exports';",
    '',
    `export default defineContractModule('./${name}.query.ts', {`,
    `  ${name}: query({ reads: ${jsonLiteral(reads)}, readMode: '${readMode}', cacheKey: '${cacheKey}', result: '${resultType}' }),`,
    `  ${rowType}: shape({ fields: ${jsonLiteral(shapeFields)} }),`,
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

function contractShapeFields(row) {
  if (!row || row.shape !== 'object' || !row.fields) return {};
  const out = {};
  for (const [name, descriptor] of Object.entries(row.fields)) {
    out[name] = contractShapeField(descriptor);
  }
  return out;
}

function contractShapeField(descriptor) {
  if (descriptor?.shape === 'primitive') {
    return descriptor.name ?? 'unknown';
  }
  return 'unknown';
}

function typeForArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => `${name}: ${typeForValidator(val)}`).join('; ')} }`;
}

function typeForScope(scope) {
  const entries = Object.entries(scope);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => `${name}: ${typeForValidator(val)}`).join('; ')} }`;
}

function typeForValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  let type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  if (val.primitive === 'object') {
    type = `{ ${Object.entries(val.fields ?? {}).map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${typeForValidator(field).replace(/ \| undefined$/, '')}`).join('; ')} }`;
  }
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
