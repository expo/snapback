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
import { fork, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseJavaScript } from 'acorn';
import { computeEffectCeiling } from './effect-ceiling.mjs';
import { build as esbuild } from 'esbuild';
import ts from 'typescript';
import { OUTGREW_IR_CLASSES, PINNED_FUNCTIONS } from './define.mjs';
import {
  decodeUtf8Source,
  resolveFileReadCapability,
  resolveHandlerSourceCapability,
} from './file-read-capability.mjs';
import { SNAPBACK_CONTRACT_RECEIPT_CAPABILITY } from '@snapback/contract/capabilities';
import {
  generatedByHeader,
  jsonLiteral,
  pascal,
  renderBindingModule,
  renderMutationMetaModule,
  renderQueryMetaModule,
  renderRuntimeLinksModule,
} from './contract-emitter.mjs';
import {
  CONTRACT_DATA_MANIFEST_VERSION,
  createProviderBindingMetadata,
  createSnapbackProviderIntrospection,
  projectContractDataManifest,
  renderProviderBindingTypes,
  serializeProviderBindingMetadata,
  serializeProviderIntrospection,
  validateContractDataManifestProjection,
  validateProviderIntrospection,
  validateSnapbackIntrospectionSource,
} from './provider-introspection.mjs';

const HEADER = generatedByHeader();

const SYSTEM_FIELDS = ['_id', '_version', '_createdAt', '_updatedAt'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// @ref LLP 0057#reservation — SQLite folds ASCII identifier case, so every
// spelling of the protected auth namespace is rejected at authoring time.
const isAuthReservedIdentifier = (name) => {
  const folded = name.toLowerCase();
  return folded === '_auth' || folded.startsWith('_auth_');
};
const MAX_EPHEMERAL_COLLECTION_NAME_BYTES = 64;
const MAX_EPHEMERAL_SCOPE_FIELDS = 16;
const MAX_EPHEMERAL_SCOPE_KEY_BYTES = 64;
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
const SESSIONS_SCHEMA_VERSION = 'snapback.v1';
const AUTH_MODES = new Set(['dev', 'sessions']);
const AUTH_REQUIREMENTS = new Set(['public', 'optional-user', 'authenticated']);
const TARGET_CAPABILITY_IDS = new Set([
  'auth.sessions.v1',
  'bounded_response_stream_v1',
  'cron',
  'cron_action_run_mutation',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'live_subscriptions',
  'mutation_read_set_validation',
  'permission_epoch_resync',
  'relational_query_v1',
]);
// @ref LLP 0058#capability-maturity — mirror of the Rust registry's
// non-stable maturity table (src/manifest.rs TargetCapabilityId::maturity).
// Codegen derives requirements from the closed capability table above, so it
// also emits the matching experimental acknowledgment: the generated artifact
// knowingly binds to the not-yet-Accepted contract, and admission refuses an
// experimental requirement with no acknowledgment.
// Remove an id here in the same change that promotes it to stable in Rust
// (bounded_response_stream_v1 left this set when LLP 0076 was Accepted,
// 2026-07-25).
const EXPERIMENTAL_TARGET_CAPABILITY_IDS = new Set([
  // Empty since 2026-07-26: `relational_query_v1` left this set as LLP
  // 0080/0081's Implemented act (coupled suite green, admitted Step 5
  // fixture witnesses complete), mirroring src/manifest.rs's non-stable
  // table. Generated bundles stop acknowledging promoted ids; surviving
  // pre-promotion acknowledgments are a no-op at admission.
]);
const LOCAL_MAX_PENDING_EPHEMERAL_KEYS = 1_024;
const TARGET_PROFILE_LOCAL = 'local-dev-sqlite-ibex';
const TARGET_PROFILE_REMOTE = 'remote-service-sqlite-ibex';
const TARGET_PROFILES = new Map([
  [TARGET_PROFILE_LOCAL, {
    capabilityManifest: 'capability.manifest.local-dev-sqlite-ibex.json',
    outputDirectory: 'generated',
  }],
  [TARGET_PROFILE_REMOTE, {
    capabilityManifest: 'capability.manifest.remote-service-sqlite-ibex.json',
    outputDirectory: 'generated-remote-service',
  }],
]);
const REMOTE_SERVICE_WIRE_SCHEMAS = Object.freeze({
  queryInput: 'schemas/query.input.schema.json',
  mutationInput: 'schemas/mutation.input.schema.json',
  mutationOutput: 'schemas/mutation.output.schema.json',
  liveEnvelope: 'schemas/live.envelope.schema.json',
  liveSubscribeInput: 'schemas/live.subscribe.input.schema.json',
  liveSubscribeOutput: 'schemas/live.subscribe.output.schema.json',
  liveResumeInput: 'schemas/live.resume.input.schema.json',
  liveResumeOutput: 'schemas/live.resume.output.schema.json',
  liveUnsubscribeInput: 'schemas/live.unsubscribe.input.schema.json',
  liveUnsubscribeOutput: 'schemas/live.unsubscribe.output.schema.json',
  connectionGrant: 'schemas/connection.grant.schema.json',
  connectionOpenInput: 'schemas/connection.open.input.schema.json',
  receipt: 'schemas/receipt.schema.json',
  errorResponse: 'schemas/error.response.schema.json',
});

// Contract data manifest v2 (LLP 0034 D3; Exact LLP 0284 §2.4).
//
// manifestVersion 2 adds the per-descriptor liveness/cost facts additively:
// old consumers ignore the new fields, and the legacy `subscription` field is
// still emitted during the migration (0284 §2.4's emit-both rule). The
// provider-owned poll-fallback floor is the demos' existing 1500 ms cadence.
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
// A source checkout reads the Rust-derived public artifacts in place so tests
// always see the newest committed bytes. Published packages carry the same
// tree under runtime-artifacts/; in an install, REPO_ROOT is node_modules and
// has no repository-level schemas directory.
const TOOLCHAIN_ARTIFACT_ROOT = existsSync(join(REPO_ROOT, 'schemas'))
  ? REPO_ROOT
  : join(dirname(fileURLToPath(import.meta.url)), 'runtime-artifacts');
const DEFINITION_PACKAGE_IMPORTS = new Map([
  ['@snapback/codegen/define', join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')],
  ['@snapback/codegen/standard-patterns', join(dirname(fileURLToPath(import.meta.url)), 'standard-patterns.mjs')],
]);
const CONTRACT_CAPABILITIES_PATH = fileURLToPath(import.meta.resolve('@snapback/contract/capabilities'));

function loadCommittedSchema(schemaFile) {
  const path = join(TOOLCHAIN_ARTIFACT_ROOT, 'schemas', schemaFile);
  if (!existsSync(path)) {
    return { missing: `committed schema not found at ${path}` };
  }
  try {
    const bytes = resolveFileReadCapability(path, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'CODEGEN_COMMITTED_SCHEMA',
    }).read();
    return { schema: JSON.parse(decodeUtf8Source(bytes, path, 'CODEGEN_COMMITTED_SCHEMA')) };
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

function validateSchemaAuthDefinition(schemaDef, err) {
  const auth = schemaDef.auth;
  if (auth === undefined) {
    validateAuthoredRequiredCapabilities(schemaDef.requiredCapabilities, err);
    return 'dev';
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    err('SCHEMA_AUTH_MODE_INVALID', 'auth', 'schema auth must be an object containing only mode', {});
    return 'dev';
  }
  const keys = Object.keys(auth);
  if (keys.length !== 1 || keys[0] !== 'mode' || !AUTH_MODES.has(auth.mode)) {
    err('SCHEMA_AUTH_MODE_INVALID', 'auth', 'schema auth accepts exactly mode: dev | sessions', { authMode: auth.mode });
  }
  validateAuthoredRequiredCapabilities(schemaDef.requiredCapabilities, err);
  return AUTH_MODES.has(auth.mode) ? auth.mode : 'dev';
}

function validateAuthoredRequiredCapabilities(required, err) {
  if (required === undefined) return;
  if (!Array.isArray(required)) {
    err('SCHEMA_REQUIRED_CAPABILITIES_INVALID', 'capability', 'schema requiredCapabilities must be an array', {});
    return;
  }
  for (const capability of required) {
    if (typeof capability !== 'string' || !TARGET_CAPABILITY_IDS.has(capability)) {
      err('SNAPBACK_CAPABILITY_UNSUPPORTED', 'capability', `unknown required target capability ${String(capability)}`, { capability });
    }
  }
}

function validateTargetArtifactAuthSupport(manifest, version, authMode, required, err) {
  for (const problem of targetArtifactAuthProblems(manifest, version, authMode, required)) {
    err(problem.code, 'capability', problem.message, problem.details);
  }
}

export function targetArtifactAuthProblems(manifest, version, authMode, required) {
  // @ref LLP 0058#the-two-admissible-tuples — dimension arrays do not grant
  // their Cartesian product; the exact pair and every positive capability do.
  const problems = [];
  const versions = Array.isArray(manifest.supportedArtifactVersions)
    ? manifest.supportedArtifactVersions
    : [];
  const modes = Array.isArray(manifest.supportedAuthModes)
    ? manifest.supportedAuthModes
    : [];
  const pairs = Array.isArray(manifest.supportedArtifactAuthPairs)
    ? manifest.supportedArtifactAuthPairs
    : [];
  const supported = new Set(Array.isArray(manifest.supportedCapabilities)
    ? manifest.supportedCapabilities
    : []);

  const pairSupported = versions.includes(version)
    && modes.includes(authMode)
    && pairs.some((pair) => pair?.schemaVersion === version && pair?.authMode === authMode);
  if (!pairSupported) {
    problems.push({
      code: 'CODEGEN_ARTIFACT_AUTH_PAIR_UNSUPPORTED',
      message: `target ${manifest.targetProfileId ?? 'unknown'} does not support ${version} + ${authMode}`,
      details: { schemaVersion: version, authMode },
    });
  }

  for (const capability of required) {
    if (!TARGET_CAPABILITY_IDS.has(capability) || !supported.has(capability)) {
      problems.push({
        code: 'SNAPBACK_CAPABILITY_UNSUPPORTED',
        message: `target ${manifest.targetProfileId ?? 'unknown'} does not support required capability ${capability}`,
        details: { capability },
      });
    }
  }
  return problems;
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

// Public API calls run generation in a fresh process. Native ESM caches every
// transitive module by URL; changing a helper while keeping schema.mjs itself
// unchanged otherwise reuses stale objects on the second generate() call.
export async function generate(backendDir, options = {}) {
  const workerPath = fileURLToPath(new URL('./generate-worker.mjs', import.meta.url));
  return new Promise((resolveResult) => {
    const child = fork(workerPath, [resolve(backendDir), JSON.stringify(options)], {
      // The cache-busting worker is a deterministic tool boundary. Caller
      // flags such as --eval/--input-type/--require/--inspect are not valid
      // worker arguments, and NODE_OPTIONS/preload credentials are not inputs.
      execArgv: [],
      cwd: REPO_ROOT,
      env: codegenWorkerEnvironment(),
      // No inherited stdin/stdout; stderr remains the human diagnostic lane,
      // while the single structured result travels over the dedicated IPC fd.
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let settled = false;
    child.once('message', (result) => {
      settled = true;
      resolveResult(result);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolveResult(codegenWorkerFailure(error));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      resolveResult(codegenWorkerFailure(new Error(`codegen worker exited before returning a result (code ${code}, signal ${signal})`)));
    });
  });
}

function codegenWorkerEnvironment() {
  const allowed = new Set([
    // Explicit codegen inputs.
    'SNAPBACK_OUTBOUND_ACTIONS',
    'SNAPBACK_GENERATED_AT_MS',
    'SOURCE_DATE_EPOCH',
    // Minimal process-launch/temp plumbing, preserving the host's key casing.
    'PATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]);
  const environment = Object.create(null);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) environment[key] = value;
  }
  return environment;
}

export async function generateInProcess(backendDir, options = {}) {
  const diagnostics = [];
  // Non-blocking info diagnostics carried into the generated function
  // manifest (today: the MUTATION_OUTGREW_IR tier-ladder declarations).
  const infoDiagnostics = [];
  const err = (code, subsystem, message, extra = {}) =>
    diagnostics.push({ code, severity: 'error', subsystem, message, ...extra });

  const targetProfile = options?.targetProfile ?? TARGET_PROFILE_LOCAL;
  const targetConfig = TARGET_PROFILES.get(targetProfile);
  if (!targetConfig || Object.keys(options ?? {}).some((key) => key !== 'targetProfile')) {
    err('CODEGEN_TARGET_PROFILE_UNSUPPORTED', 'codegen', `unsupported target profile ${String(targetProfile)}`, {
      targetProfile,
      supported: [...TARGET_PROFILES.keys()],
    });
    return { ok: false, diagnostics };
  }

  let backendRoot;
  try {
    backendRoot = realpathSync(backendDir);
  } catch (error) {
    err('CODEGEN_BACKEND_UNREADABLE', 'codegen', `backend directory ${backendDir} could not be resolved: ${error.message}`, { path: backendDir });
    return { ok: false, diagnostics };
  }
  const schemaPath = join(backendRoot, 'schema.mjs');
  const functionsPath = join(backendRoot, 'functions.mjs');
  const seedPath = join(backendRoot, 'seed.json');
  const handlerSourceCache = new Map();

  // @ref LLP 0010#generated-artifacts — the AST resolver defines the complete
  // hashed graph; evaluation happens only from those bundled bytes, never by
  // letting Node's ambient loader discover a second, unaccounted-for graph.
  // @ref LLP 0009#capability-model — static analysis is defense in depth. The
  // actual boundary is a capability-empty evaluator process plus a VM context
  // with string/Wasm code generation and nondeterministic globals disabled.
  const schemaBuild = await buildDefinitionBundle(schemaPath, backendRoot, diagnostics, 'schema', 'schema');
  const functionsBuild = await buildDefinitionBundle(functionsPath, backendRoot, diagnostics, 'function', 'functions');
  // The optional route→query manifest declaration (LLP 0092 §0C.1): compiled
  // under the same hashed-graph + isolated-evaluation discipline when
  // `snapback/routes.mjs` exists.
  const routesPath = join(backendRoot, 'routes.mjs');
  const routesBuild = existsSync(routesPath)
    ? await buildDefinitionBundle(routesPath, backendRoot, diagnostics, 'routes', 'routes')
    : null;
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  const evaluated = await evaluateDefinitionBundles(schemaBuild, functionsBuild, diagnostics, routesBuild);
  if (!evaluated || diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const schemaGraph = schemaBuild.graph;
  const functionsGraph = functionsBuild.graph;
  const schemaModule = { default: evaluated.schema };
  const functionsModule = evaluated.functions;
  const routesModule = routesBuild ? evaluated.routes : null;

  const schemaDef = schemaModule.default;
  if (!schemaDef || !schemaDef.__schema) {
    err('SCHEMA_NO_DEFAULT_EXPORT', 'schema', `${schemaPath} must default-export defineSchema(...)`);
    return { ok: false, diagnostics };
  }
  const authMode = validateSchemaAuthDefinition(schemaDef, err);
  const artifactVersion = authMode === 'sessions' ? SESSIONS_SCHEMA_VERSION : SCHEMA_VERSION;
  const schemaRequiredCapabilities = [...new Set(schemaDef.requiredCapabilities ?? [])];
  if (authMode === 'sessions' && !schemaRequiredCapabilities.includes('auth.sessions.v1')) {
    schemaRequiredCapabilities.unshift('auth.sessions.v1');
  }
  if (authMode === 'dev' && schemaRequiredCapabilities.includes('auth.sessions.v1')) {
    err('SCHEMA_AUTH_CAPABILITY_INVALID', 'auth', 'a dev schema must not require auth.sessions.v1', { authMode });
  }
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Build + validate schema ------------------------------------------------
  const tables = dict();
  const seenTables = new Set();
  for (const [name, table] of Object.entries(schemaDef.tables)) {
    if (!IDENT.test(name) || name.startsWith('_snapback') || isAuthReservedIdentifier(name)) {
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
      validateAuthoringValidator(val, `${name}.${fieldName}`, (message) => {
        err('SCHEMA_INVALID_VALIDATOR', 'schema', message, { table: name, field: fieldName });
      });
      const idTable = idFieldTypeTable(val.fieldType);
      if (idTable !== null && !Object.hasOwn(schemaDef.tables, idTable)) {
        err('SCHEMA_ID_TARGET_UNKNOWN', 'schema', `${name}.${fieldName} references unknown id table ${idTable}`, {
          table: name,
          field: fieldName,
          targetTable: idTable,
        });
      }
      fields.push({ name: fieldName, field_type: val.fieldType, optional: val.optional });
    }

    const indexes = [];
    const seenIndexes = new Set();
    for (const index of table.indexes) {
      if (!IDENT.test(index.name) || index.name.startsWith('_snapback') || isAuthReservedIdentifier(index.name)) {
        err('SCHEMA_INVALID_IDENTIFIER', 'schema', `invalid index identifier ${name}.${index.name}`, { table: name, index: index.name });
      }
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
        } else if (index.unique && table.fields[f].optional) {
          err('SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD', 'schema', `unique index ${name}.${index.name} field ${f} must be required so uniqueness is total`, { table: name, index: index.name, field: f });
        }
      }
      indexes.push({ name: index.name, fields: index.fields, ...(index.unique ? { unique: true } : {}) });
    }

    if (table.permissionFields !== undefined && !table.permissionBackingDeclared) {
      err('SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING', 'schema', `table ${name} declares permissionFields without permissionBacking`, { table: name });
    }
    if (table.permissionFields !== undefined && !Array.isArray(table.permissionFields)) {
      err('SCHEMA_PERMISSION_FIELDS_INVALID', 'schema', `table ${name} permissionFields must be an array`, { table: name });
    }
    if (Array.isArray(table.permissionFields)) {
      const seenPermissionFields = new Set();
      for (const field of table.permissionFields) {
        if (!seenFields.has(field)) {
          err('SCHEMA_PERMISSION_FIELD_UNKNOWN', 'schema', `table ${name} permissionFields references unknown field ${field}`, { table: name, field });
        }
        if (seenPermissionFields.has(field)) {
          err('SCHEMA_PERMISSION_FIELD_DUPLICATE', 'schema', `table ${name} permissionFields repeats field ${field}`, { table: name, field });
        }
        seenPermissionFields.add(field);
      }
    }

    let membership;
    if (table.membershipDeclaration !== undefined) {
      const declaration = table.membershipDeclaration;
      if (table.permissionBackingDeclared || table.permissionFields !== undefined) {
        err('SCHEMA_MEMBERSHIP_PERMISSION_BACKING_CONFLICT', 'schema', `table ${name} cannot combine membership with permissionBacking`, { table: name });
      }
      const axis = (fieldName, axisName) => {
        const source = table.fields[fieldName];
        if (!source) {
          err('SCHEMA_MEMBERSHIP_UNKNOWN_FIELD', 'schema', `table ${name} membership ${axisName} references unknown field ${String(fieldName)}`, {
            table: name,
            axis: axisName,
            field: fieldName ?? null,
          });
          return null;
        }
        if (source.optional) {
          err('SCHEMA_MEMBERSHIP_OPTIONAL_AXIS', 'schema', `table ${name} membership ${axisName} field ${fieldName} must be required`, {
            table: name,
            axis: axisName,
            field: fieldName,
          });
        }
        return source;
      };
      const principal = axis(declaration.principal, 'principal');
      if (principal && principal.fieldType !== 'Principal') {
        err('SCHEMA_MEMBERSHIP_PRINCIPAL_TYPE', 'schema', `table ${name} membership principal must use v.principal()`, {
          table: name,
          field: declaration.principal,
        });
      }
      const role = axis(declaration.role, 'role');
      if (role && role.fieldType !== 'String') {
        err('SCHEMA_MEMBERSHIP_ROLE_TYPE', 'schema', `table ${name} membership role must use v.string()`, {
          table: name,
          field: declaration.role,
        });
      }
      const declaredRoles = new Set(declaration.roles);
      const vocabulary = [...declaration.roles, ...(declaration.pendingRoles ?? [])];
      for (const field of ['grantedByActor', 'grantedByEffective', 'grantedByGrant']) {
        if (Object.hasOwn(table.fields, field)) {
          err('SCHEMA_MEMBERSHIP_PROVENANCE_FIELD_RESERVED', 'schema', `table ${name} field ${field} is host-managed membership provenance`, {
            table: name,
            declaration: declaration.id ?? name,
            field,
          });
        }
      }
      const foldedRoles = new Map();
      for (const roleName of vocabulary) {
        if (roleName === 'self' || roleName === 'none') {
          err('SCHEMA_MEMBERSHIP_RESERVED_ROLE', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} is a reserved caller class`, {
            table: name,
            role: roleName,
          });
        }
        if (roleName.includes(':')) {
          err('SCHEMA_MEMBERSHIP_ROLE_RESERVED_SEPARATOR', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} contains the reserved ':' separator`, {
            table: name,
            role: roleName,
          });
        }
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(roleName)) {
          err('SCHEMA_MEMBERSHIP_ROLE_CONTROL_CHARACTER', 'schema', `table ${name} membership role ${JSON.stringify(roleName)} contains a control character`, {
            table: name,
            role: roleName,
          });
        }
        const folded = roleName.toLowerCase();
        const prior = foldedRoles.get(folded);
        if (prior !== undefined && prior !== roleName) {
          err('SCHEMA_MEMBERSHIP_CONFUSABLE_ROLES', 'schema', `table ${name} membership roles ${JSON.stringify(prior)} and ${JSON.stringify(roleName)} differ only by case`, {
            table: name,
            roles: [prior, roleName],
          });
        } else {
          foldedRoles.set(folded, roleName);
        }
      }
      if (declaration.bootstrapRole !== undefined && !declaredRoles.has(declaration.bootstrapRole)) {
        err('SCHEMA_MEMBERSHIP_BOOTSTRAP_ROLE_UNKNOWN', 'schema', `table ${name} membership bootstrapRole must name a declared non-pending role`, {
          table: name,
          role: declaration.bootstrapRole,
        });
      }
      if (declaration.scope === 'app' && declaration.bootstrapRole !== undefined) {
        err('SCHEMA_MEMBERSHIP_BOOTSTRAP_APP_SCOPE', 'schema', `table ${name} cannot declare bootstrapRole for app scope`, {
          table: name,
          role: declaration.bootstrapRole,
        });
      }
      if (declaration.lastHolder !== undefined) {
        if (declaration.scope === 'app') {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_APP_SCOPE', 'schema', `table ${name} cannot declare lastHolder for app scope`, {
            table: name,
          });
        }
        if (!declaredRoles.has(declaration.lastHolder.protect)) {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_ROLE_UNKNOWN', 'schema', `table ${name} membership lastHolder.protect must name a declared non-pending role`, {
            table: name,
            role: declaration.lastHolder.protect,
          });
        }
        if (declaration.bootstrapRole !== declaration.lastHolder.protect) {
          err('SCHEMA_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH', 'schema', `table ${name} membership lastHolder.protect requires the same bootstrapRole`, {
            table: name,
            protectedRole: declaration.lastHolder.protect,
            bootstrapRole: declaration.bootstrapRole ?? null,
          });
        }
      }
      if (declaration.expiry !== undefined) {
        const expiry = table.fields[declaration.expiry.field];
        if (!expiry) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_UNKNOWN', 'schema', `table ${name} membership expiry references unknown field ${declaration.expiry.field}`, {
            table: name,
            field: declaration.expiry.field,
          });
        } else if ([declaration.principal, declaration.resource, declaration.role].includes(declaration.expiry.field)) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_AXIS', 'schema', `table ${name} membership expiry cannot name an authorization axis`, {
            table: name,
            field: declaration.expiry.field,
          });
        } else if (expiry.fieldType !== 'Integer' || expiry.optional !== true) {
          err('SCHEMA_MEMBERSHIP_EXPIRY_FIELD_TYPE', 'schema', `table ${name} membership expiry field ${declaration.expiry.field} must use v.optional(v.integer())`, {
            table: name,
            field: declaration.expiry.field,
          });
        }
      }
      for (const incidental of declaration.incidental ?? []) {
        if (!Object.hasOwn(table.fields, incidental)) {
          err('SCHEMA_MEMBERSHIP_INCIDENTAL_UNKNOWN', 'schema', `table ${name} membership incidental references unknown field ${incidental}`, {
            table: name,
            field: incidental,
          });
        } else if ([declaration.principal, declaration.resource, declaration.role].includes(incidental)) {
          err('SCHEMA_MEMBERSHIP_INCIDENTAL_FLOOR', 'schema', `table ${name} membership incidental cannot name an authorization axis`, {
            table: name,
            field: incidental,
          });
        }
      }
      for (const transition of declaration.transitions) {
        const hasRoleCaller = transition.by.some((caller) => vocabulary.includes(caller));
        if (transition.target === 'self' && hasRoleCaller) {
          err('SCHEMA_MEMBERSHIP_TRANSITION_GRAMMAR', 'schema', `table ${name} membership ${transition.op} transition combines a role caller with target self, which is unreachable`, {
            table: name,
            declaration: declaration.id ?? name,
            op: transition.op,
          });
        }
        if (transition.target === 'other' && transition.by.includes('self')) {
          err('SCHEMA_MEMBERSHIP_TRANSITION_SELF_ON_OTHER', 'schema', `table ${name} membership ${transition.op} transition combines caller self with target other`, {
            table: name,
            declaration: declaration.id ?? name,
            op: transition.op,
          });
        }
        for (const fieldName of transition.fields ?? []) {
          if (!Object.hasOwn(table.fields, fieldName)) {
            err('SCHEMA_MEMBERSHIP_TRANSITION_FIELD_UNKNOWN', 'schema', `table ${name} membership transition references unknown patch field ${fieldName}`, {
              table: name,
              field: fieldName,
            });
          } else if ([declaration.principal, declaration.resource, declaration.role].includes(fieldName)) {
            err('SCHEMA_MEMBERSHIP_TRANSITION_AXIS_FIELD', 'schema', `table ${name} membership transition cannot patch authorization axis ${fieldName}`, {
              table: name,
              declaration: declaration.id ?? name,
              op: transition.op,
              field: fieldName,
            });
          }
        }
      }
      let resourceTable;
      if (declaration.scope === 'resource') {
        const resource = axis(declaration.resource, 'resource');
        resourceTable = idFieldTypeTable(resource?.fieldType);
        if (resource && resourceTable === null) {
          err('SCHEMA_MEMBERSHIP_RESOURCE_TYPE', 'schema', `table ${name} membership resource must use v.id(table)`, {
            table: name,
            field: declaration.resource,
          });
        }
      }
      membership = {
        ...declaration,
        ...(resourceTable !== null && resourceTable !== undefined ? { resourceTable } : {}),
      };
    }

    tables[name] = {
      name,
      fields,
      indexes,
      syncable: table.syncable,
      ...(table.permissionBackingDeclared ? { permissionBacking: true } : {}),
      ...(Array.isArray(table.permissionFields) ? { permissionFields: table.permissionFields } : {}),
      ...(membership ? { membership } : {}),
    };
  }

  // SQLite index names are database-global and the physical spelling joins
  // table/index with `_`. Reserve the two declaration-derived membership
  // indexes in the same namespace as user indexes before emitting artifacts.
  // @ref LLP 0056#declaring-a-membership-table — generated membership indexes
  //   are true schema objects, so a colliding author declaration must fail.
  const physicalIndexNames = new Map();
  for (const table of Object.values(tables)) {
    const entries = table.indexes.map((index) => ({ name: index.name, generatedMembership: false }));
    if (table.membership) {
      entries.push(
        { name: '_membership_pk', generatedMembership: true },
        { name: '_membership_reverse', generatedMembership: true },
      );
    }
    for (const entry of entries) {
      const physicalName = `${table.name}_${entry.name}`;
      const current = { table: table.name, index: entry.name, generatedMembership: entry.generatedMembership };
      const previous = physicalIndexNames.get(physicalName);
      if (previous) {
        const membershipCollision = previous.generatedMembership || current.generatedMembership;
        err(
          membershipCollision ? 'SCHEMA_MEMBERSHIP_INDEX_NAME_COLLISION' : 'SCHEMA_INDEX_NAME_COLLISION',
          'schema',
          `index ${table.name}.${entry.name} collides with ${previous.table}.${previous.index} at physical name ${physicalName}`,
          {
            table: table.name,
            index: entry.name,
            physicalName,
            declarations: [`${previous.table}.${previous.index}`, `${table.name}.${entry.name}`],
          },
        );
      } else {
        physicalIndexNames.set(physicalName, current);
      }
    }
  }

  const membershipDeclarations = new Map();
  const membershipGeneratedSymbols = new Map();
  for (const table of Object.values(tables)) {
    if (!table.membership) continue;
    const declaration = table.membership.id ?? table.name;
    if (!IDENT.test(declaration)) {
      err('SCHEMA_MEMBERSHIP_INVALID_ID', 'schema', `table ${table.name} membership declaration id ${declaration} is invalid`, {
        table: table.name,
        declaration,
      });
    }
    const prior = membershipDeclarations.get(declaration);
    if (prior) {
      err('SCHEMA_MEMBERSHIP_DUPLICATE_ID', 'schema', `membership declaration ${declaration} is used by both ${prior.table.name} and ${table.name}`, {
        declaration,
        tables: [prior.table.name, table.name],
      });
    } else {
      membershipDeclarations.set(declaration, { table, membership: table.membership });
    }
    if (typeof declaration === 'string' && IDENT.test(declaration)) {
      const generatedSymbol = `${pascal(declaration)}Role`;
      const priorSymbol = membershipGeneratedSymbols.get(generatedSymbol);
      if (priorSymbol && priorSymbol.declaration !== declaration) {
        err(
          'SCHEMA_MEMBERSHIP_GENERATED_SYMBOL_COLLISION',
          'schema',
          `membership declarations ${JSON.stringify(priorSymbol.declaration)} and ${JSON.stringify(declaration)} both generate TypeScript symbol ${generatedSymbol}`,
          {
            declaration,
            generatedSymbol,
            declarations: [priorSymbol.declaration, declaration],
            tables: [priorSymbol.table.name, table.name],
          },
        );
      } else if (!priorSymbol) {
        membershipGeneratedSymbols.set(generatedSymbol, { declaration, table });
      }
    }
  }

  // --- Build + validate functions --------------------------------------------
  const ephemeralCollections = buildEphemeralCollections(schemaDef.ephemeral, err, targetProfile);
  const functions = [];
  const contractQueries = dict();
  const contractMutations = dict();
  const cronDefs = [];
  const configDefs = [];
  const projectionDefs = [];

  const fieldNames = (t) => new Set(tables[t]?.fields.map((f) => f.name) ?? []);
  const isKnownField = (t, f) => SYSTEM_FIELDS.includes(f) || fieldNames(t).has(f);
  const validateIdReferences = (validator, where, details) => {
    const target = idFieldTypeTable(validator?.fieldType);
    if (target !== null && !tables[target]) {
      err('FUNCTION_ID_TARGET_UNKNOWN', 'function', `${where} references unknown id table ${target}`, {
        ...details,
        targetTable: target,
      });
    }
    if (validator?.primitive === 'object') {
      for (const [field, nested] of Object.entries(validator.fields ?? {})) {
        validateIdReferences(nested, `${where}.${field}`, { ...details, field });
      }
    }
  };

  for (const [name, def] of Object.entries(functionsModule)) {
    if (isIsolatedDefinition(def, 'cron')) {
      cronDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'config')) {
      configDefs.push({ exportName: name, def });
      continue;
    }
    if (isIsolatedDefinition(def, 'maintained-projection')) {
      projectionDefs.push({ exportName: name, def });
      continue;
    }
    if (!isIsolatedDefinition(def, 'function')) continue;
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
      validateAuthoringValidator(argVal, `${name} arg ${argName}`, (message) => {
        err('FUNCTION_INVALID_VALIDATOR', 'function', message, { function: name, arg: argName });
      });
      validateIdReferences(argVal, `${name} arg ${argName}`, { function: name, arg: argName });
      checkObjectValidatorFieldIdents(argVal, `arg ${argName}`, (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, arg: argName, field: fieldName });
      });
    }
    if (def.result) {
      validateAuthoringValidator(def.result, `${name} result`, (message) => {
        err('FUNCTION_INVALID_VALIDATOR', 'function', message, { function: name });
      });
      checkObjectValidatorFieldIdents(def.result, 'result', (fieldName, where) => {
        err('FUNCTION_INVALID_IDENTIFIER', 'function', `${name}: ${where} has invalid field identifier ${fieldName}`, { function: name, field: fieldName });
      });
      validateIdReferences(def.result, `${name} result`, { function: name });
    }
    if (GENERATED_API_RESERVED_EXPORTS.has(name)) {
      err('FUNCTION_RESERVED_EXPORT', 'function', `${name}: function export collides with a generated API namespace`, { function: name });
      continue;
    }
    validateFunctionAuthDefinition(name, def, err);
    validateProtectedAndRetainabilityDefinition(name, def, err);
    const argNames = new Set(Object.keys(def.args));

    // Recursive fail-closed validation of the closed v1 expression profile
    // (LLP 0051 D2): undeclared args, non-expressions, and functions outside
    // the pinned library are authoring errors, never silent passthrough.
    const checkExpr = (expr, where) => {
      if (!expr || !expr.__expr) {
        err('FUNCTION_INVALID_EXPR', 'function', `${name}: ${where} is not a value expression`, { function: name });
        return;
      }
      if ('Arg' in expr && !argNames.has(expr.Arg)) {
        err('FUNCTION_UNKNOWN_ARG', 'function', `${name}: ${where} references undeclared arg "${expr.Arg}"`, { function: name });
      }
      if ('Field' in expr) {
        // argOpt() lowers to Field over the Args root; check declared args at
        // the first hop so optional-arg typos still fail closed.
        if (expr.Field.base?.kind === 'Args' && !argNames.has(expr.Field.key)) {
          err('FUNCTION_UNKNOWN_ARG', 'function', `${name}: ${where} references undeclared arg "${expr.Field.key}"`, { function: name });
        }
        checkExpr(expr.Field.base, where);
      }
      if ('Binary' in expr) {
        checkExpr(expr.Binary.left, where);
        checkExpr(expr.Binary.right, where);
      }
      if ('Unary' in expr) checkExpr(expr.Unary.expr, where);
      if ('If' in expr) {
        checkExpr(expr.If.cond, where);
        checkExpr(expr.If.then, where);
        checkExpr(expr.If.else, where);
      }
      if ('Concat' in expr) for (const part of expr.Concat) checkExpr(part, where);
      if ('Call' in expr) {
        if (!PINNED_FUNCTIONS.includes(expr.Call.func)) {
          err('MUTATION_UNSUPPORTED_FUNCTION', 'function', `${name}: ${where} calls ${expr.Call.func}, which is not in the pinned v1 library`, { function: name, calledFunction: expr.Call.func });
        }
        for (const argExpr of expr.Call.args) checkExpr(argExpr, where);
      }
      if ('Record' in expr) for (const fieldExpr of Object.values(expr.Record.fields)) checkExpr(fieldExpr, where);
    };

    if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.js) {
      const readTables = def.js.reads ?? [];
      for (const table of readTables) {
        if (!tables[table]) {
          err('FUNCTION_UNKNOWN_TABLE', 'function', `${name}: handler declares unknown read table ${table}`, { function: name, table });
        }
      }
      if (def.js.authScopeField != null) {
        const primaryTable = readTables[0];
        if (!primaryTable || !isKnownField(primaryTable, def.js.authScopeField)) {
          err('FUNCTION_UNKNOWN_FIELD', 'function', `${name}: authScopeField references unknown field ${primaryTable ?? '<missing>'}.${def.js.authScopeField}`, {
            function: name,
            table: primaryTable ?? null,
            field: def.js.authScopeField,
          });
        }
      }
      const handlerSource = loadHandlerSource(def.js.source, name);
      if (handlerSource) {
        for (const problem of scanStaticallyInvalidJsQueryResults(
          handlerSource,
          def.js.exportName,
        )) {
          err(
            'FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS',
            'function',
            `${name}: JavaScript query handler ${def.js.exportName} returns an object literal, but query handlers must return a rows array. Wrap a point read as [row] (or return [] when absent).`,
            {
              function: name,
              handler: def.js.exportName,
              source: def.js.source,
              line: problem.line,
              column: problem.column,
              sourceSpan: {
                file: def.js.source,
                line: problem.line,
                column: problem.column,
              },
            },
          );
        }
      }
      if (handlerSource && isProtectedQueryDefinition(def)) {
        for (const problem of scanProtectedHandlerReachableSource(
          handlerSource,
          def.js.exportName,
        )) {
          err(problem.code, 'auth', `${name}: ${problem.message}`, {
            function: name,
            inputKind: problem.inputKind,
            line: problem.line,
            column: problem.column,
          });
        }
      }
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { IbexModule: { source: handlerSource ?? '', export: def.js.exportName } },
        declaredReads: readTables,
        declaredWrites: [],
        authScopeField: def.js.authScopeField ?? null,
        authorizationDependence: jsAuthorizationDependence(def),
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
        ...(def.retainable === true ? { retainable: true } : {}),
        ...contractQueryLivenessFields(def),
      };
    } else if ((def.__kind === 'Query' || def.__kind === 'LiveQuery') && def.relationalPlan) {
      // @ref LLP 0080#1-closed-relational-plan — the authoring surface
      //   already proved the closed shape against installed builders; this
      //   branch serializes the normalized plan and nothing else. Activation
      //   on the server re-proves schema binding and the cardinality claim.
      const plan = def.relationalPlan;
      const serializeFilters = (filters) => filters.map((f) => ({
        field: f.field,
        op: f.op,
        value: serializeExpr(f.value),
      }));
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: {
          HostPlan: {
            RelationalQuery: {
              root: plan.root,
              rootAlias: plan.rootAlias,
              joined: plan.joined,
              joinedAlias: plan.joinedAlias,
              joinKind: plan.joinKind,
              joinOn: plan.joinOn,
              rootFilters: [],
              rootVisibility: serializeFilters(plan.rootVisibility),
              joinedVisibility: serializeFilters(plan.joinedVisibility),
              projection: plan.projection,
              order: plan.order.map((o) => ({ field: o.field, direction: o.direction })),
              take: plan.take,
              rootIndex: plan.rootIndex,
              joinedIndex: plan.joinedIndex,
            },
          },
        },
        declaredReads: [plan.root, plan.joined],
        declaredWrites: [],
        authScopeField: null,
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        // The implicit continuation-cursor argument (LLP 0080 §2) is part of
        // the callable contract even though authors declare no args in v1.
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: [plan.root, plan.joined],
        result: { kind: 'list', row: relationalRowDescriptor(plan, tables) },
        serverRunnable: true,
        localRunnable: false,
        ...contractQueryLivenessFields(def),
      };
    } else if (def.__kind === 'Query' || def.__kind === 'LiveQuery') {
      const t = def.plan.table;
      const membershipReads = [];
      if (!tables[t]) {
        err('QUERY_UNKNOWN_TABLE', 'function', `${name}: unknown table ${t}`, { function: name, table: t });
      } else {
        if (def.authScopeField != null && !isKnownField(t, def.authScopeField)) {
          err('QUERY_UNKNOWN_FIELD', 'function', `${name}: authScopeField references unknown field ${t}.${def.authScopeField}`, { function: name, table: t, field: def.authScopeField });
        }
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
        for (const predicate of def.plan.membershipFilters ?? []) {
          if (!predicate || predicate.__membershipPredicate !== true) {
            err('QUERY_MEMBERSHIP_INVALID', 'function', `${name}: membership predicate must come from a declaration-bound helper`, { function: name });
            continue;
          }
          const found = membershipDeclarations.get(predicate.declaration);
          if (!found) {
            err('QUERY_MEMBERSHIP_UNKNOWN_DECLARATION', 'function', `${name}: membership predicate names unknown declaration ${String(predicate.declaration)}`, {
              function: name,
              declaration: predicate.declaration ?? null,
            });
            continue;
          }
          if (!membershipReads.includes(found.table.name)) membershipReads.push(found.table.name);
          if (predicate.roles !== null) {
            if (!Array.isArray(predicate.roles) || predicate.roles.length === 0) {
              err('QUERY_MEMBERSHIP_EMPTY_ROLES', 'function', `${name}: hasRole must name at least one role`, {
                function: name,
                declaration: predicate.declaration,
              });
            } else {
              const vocabulary = new Set([
                ...found.membership.roles,
                ...(found.membership.pendingRoles ?? []),
              ]);
              for (const roleName of predicate.roles) {
                if (!vocabulary.has(roleName)) {
                  err('QUERY_MEMBERSHIP_UNKNOWN_ROLE', 'function', `${name}: ${predicate.declaration}.hasRole names undeclared role ${String(roleName)}`, {
                    function: name,
                    declaration: predicate.declaration,
                    role: roleName,
                  });
                }
              }
            }
          }
          const resource = predicate.resource;
          if (!resource || resource.__membershipResourceRef !== true) {
            err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership resource reference is invalid`, {
              function: name,
              declaration: predicate.declaration,
            });
            continue;
          }
          if (found.membership.scope === 'app') {
            if (resource.kind !== 'app') {
              err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: app-scoped declaration ${predicate.declaration} requires the app singleton`, {
                function: name,
                declaration: predicate.declaration,
              });
            }
            continue;
          }
          const expectedTable = found.membership.resourceTable;
          let actualTable = null;
          if (resource.kind === 'rowField') {
            const field = tables[t].fields.find((candidate) => candidate.name === resource.field);
            if (!field) {
              err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership row field ${String(resource.field)} does not exist on ${t}`, {
                function: name,
                declaration: predicate.declaration,
                field: resource.field ?? null,
              });
              continue;
            }
            actualTable = idFieldTypeTable(field.field_type);
          } else if (resource.kind === 'arg') {
            const segments = typeof resource.path === 'string' ? resource.path.split('.') : [];
            let validator = segments.length > 0 ? def.args[segments[0]] : null;
            for (const segment of segments.slice(1)) {
              validator = validator?.primitive === 'object' ? validator.fields?.[segment] : null;
            }
            if (!validator) {
              err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: membership argument ${String(resource.path)} is not declared`, {
                function: name,
                declaration: predicate.declaration,
                arg: resource.path ?? null,
              });
              continue;
            }
            actualTable = idFieldTypeTable(validator.fieldType);
          } else {
            err('QUERY_MEMBERSHIP_RESOURCE_REF_INVALID', 'function', `${name}: resource-scoped declaration ${predicate.declaration} requires an argument or row field reference`, {
              function: name,
              declaration: predicate.declaration,
            });
            continue;
          }
          if (actualTable !== expectedTable) {
            err('QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH', 'function', `${name}: ${predicate.declaration} expects Id<${expectedTable}> but the helper received ${actualTable === null ? 'a non-id value' : `Id<${actualTable}>`}`, {
              function: name,
              declaration: predicate.declaration,
              expectedTable,
              actualTable,
            });
          }
        }
      }
      const queryReads = [...new Set([t, ...membershipReads])];
      functions.push({
        name,
        kind: def.__kind,
        ...authoredFunctionManifestFields(def),
        runtime: { HostPlan: { Query: serializeQueryPlan(def.plan, membershipDeclarations) } },
        declaredReads: queryReads,
        declaredWrites: [],
        authScopeField: def.authScopeField ?? null,
        ...(def.standardPattern ? { standardPattern: def.standardPattern } : {}),
        authorizationDependence: hostPlanAuthorizationDependence(def),
        syncabilityClass: def.__kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
      });
      contractQueries[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        reads: queryReads,
        result: { kind: 'list', row: rowDescriptor(tables[t]) },
        serverRunnable: true,
        localRunnable: false,
        ...(def.retainable === true ? { retainable: true } : {}),
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
        ...authoredFunctionManifestFields(def, writes, tables),
        runtime: { IbexModule: { source: handlerSource ?? '', export: def.js.exportName } },
        declaredReads: reads,
        declaredWrites: writes,
        syncabilityClass: 'mutation',
      });
      // The class-specific "outgrew the IR" diagnostic (LLP 0051 D2 /
      // Increment 3 gate c): a JS-tier mutation that declares WHY it is out
      // of the IR profile gets that reason recorded in the generated
      // manifest as a normal info diagnostic pointing at the JS/WASM path —
      // the tier ladder stays explicit, and profile-creep pressure has a
      // named class to argue against instead of vibes.
      if (def.outgrewIr) {
        infoDiagnostics.push({
          code: 'MUTATION_OUTGREW_IR',
          severity: 'info',
          subsystem: 'function',
          message: `${name} outgrew the IR: ${def.outgrewIr.replaceAll('-', ' ')} — ${OUTGREW_IR_CLASSES[def.outgrewIr]}; stays on the JS/WASM tier (LLP 0051 D2)`,
          details: { function: name, class: def.outgrewIr },
        });
      }
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
      const checkValuesMap = (t, values, where) => {
        for (const [field, expr] of Object.entries(values)) {
          if (!fieldNames(t).has(field)) err('QUERY_UNKNOWN_FIELD', 'function', `${name}: ${where} sets unknown field ${t}.${field}`, { function: name, table: t, field });
          checkExpr(expr, `${where} ${field}`);
        }
      };
      const checkRequiredFields = (t, values, where) => {
        for (const f of tables[t].fields) {
          if (!f.optional && !(f.name in values)) {
            err('FUNCTION_MISSING_REQUIRED_FIELD', 'function', `${name}: ${where} into ${t} omits required field ${f.name}`, { function: name, table: t, field: f.name });
          }
        }
      };
      for (const step of def.plan.steps) {
        const kind = Object.keys(step)[0];
        const body = step[kind];
        // Guard/Let carry no table; every other step names one.
        const t = body.table;
        if (t !== undefined && !tables[t]) {
          err('QUERY_UNKNOWN_TABLE', 'function', `${name}: ${kind} on unknown table ${t}`, { function: name, table: t });
          continue;
        }
        if (kind === 'Insert') {
          writes.add(t);
          checkValuesMap(t, body.values, 'insert');
          checkRequiredFields(t, body.values, 'insert');
        } else if (kind === 'Patch') {
          writes.add(t);
          checkExpr(body.id, 'patch id');
          checkValuesMap(t, body.values, 'patch');
        } else if (kind === 'Delete') {
          writes.add(t);
          checkExpr(body.id, 'delete id');
        } else if (kind === 'Get') {
          checkExpr(body.id, 'get id');
        } else if (kind === 'Guard') {
          checkExpr(body.cond, 'guard condition');
        } else if (kind === 'Let') {
          checkExpr(body.expr, 'let expression');
        } else if (kind === 'DeleteWhere') {
          writes.add(t);
          for (const filter of body.filter) {
            if (!fieldNames(t).has(filter.field) && !SYSTEM_FIELDS.includes(filter.field)) {
              err('QUERY_UNKNOWN_FIELD', 'function', `${name}: deleteWhere filters unknown field ${t}.${filter.field}`, { function: name, table: t, field: filter.field });
            }
            checkExpr(filter.value, `deleteWhere ${filter.field}`);
          }
        } else if (kind === 'InsertEach') {
          writes.add(t);
          checkExpr(body.source, 'insertEach source');
          checkValuesMap(t, body.values, 'insertEach');
          checkRequiredFields(t, body.values, 'insertEach');
        } else {
          err('MUTATION_UNSUPPORTED_STEP', 'function', `${name}: unsupported mutation step ${kind}`, { function: name, step: kind });
        }
      }
      if (def.plan.return_value && 'Expr' in def.plan.return_value) {
        checkExpr(def.plan.return_value.Expr, 'return expression');
      }
      const serializedPlan = serializeMutationPlan(def.plan, name, err);
      functions.push({
        name,
        kind: 'Mutation',
        ...authoredFunctionManifestFields(def, writes, tables),
        runtime: { HostPlan: { Mutation: serializedPlan } },
        declaredReads: mutationReadTables(def.plan),
        declaredWrites: [...writes],
        syncabilityClass: 'mutation',
        ...(def.standardPattern ? { standardPattern: def.standardPattern } : {}),
      });
      contractMutations[name] = {
        name,
        args: argDescriptors(def.args),
        argOrder: Object.keys(def.args),
        writes: [...writes],
        invalidates: [...writes],
        // IR-tier mutations embed their plan (Exact LLP 0329 E-B): the
        // adapter derives the default optimistic overlay from it, so the
        // descriptor honestly claims `optimistic` (additive manifest v2
        // extension per Exact LLP 0284 §2.4). JS-tier mutations keep
        // `optimistic: false` — their overlays are app reducers the
        // manifest cannot see.
        optimistic: true,
        plan: serializedPlan,
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
        ...authoredFunctionManifestFields(def, writes, tables),
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
        ...authoredFunctionManifestFields(def, writes, tables),
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
  const projections = buildMaintainedProjections(projectionDefs, functions, err);
  const configEntries = buildConfigEntries(configDefs, functions, err);
  // @ref LLP 0080#7-generated-authoring-surface — a maintained projection
  // has no function carrier, so its dependence on the relational engine
  // rides the schema-level requirement: a target without
  // `relational_query_v1` refuses at generation (below) and again at
  // admission, never as a late activation surprise.
  if (projections.length > 0 && !schemaRequiredCapabilities.includes('relational_query_v1')) {
    schemaRequiredCapabilities.push('relational_query_v1');
  }

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // --- Hashes + emit ----------------------------------------------------------
  let seedSource = null;
  if (existsSync(seedPath)) {
    try {
      seedSource = resolveFileReadCapability(seedPath, {
        allowedRoots: [backendRoot],
        codePrefix: 'SEED_SOURCE',
      }).read();
    } catch (error) {
      err(error.codegenCode ?? 'SEED_SOURCE_UNREADABLE', 'seed', error.message, error.details ?? {});
    }
  }
  let contractCapabilitiesSource = Buffer.alloc(0);
  try {
    contractCapabilitiesSource = resolveFileReadCapability(CONTRACT_CAPABILITIES_PATH, {
      allowedRoots: [REPO_ROOT],
      codePrefix: 'CODEGEN_CONTRACT_CAPABILITY_SOURCE',
    }).read();
  } catch (error) {
    err(error.codegenCode ?? 'CODEGEN_CONTRACT_CAPABILITY_SOURCE_UNREADABLE', 'codegen', error.message, error.details ?? {});
  }
  const canonicalCapability = loadCanonicalCapabilityManifest(err, targetProfile, targetConfig);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const demoMetadata = readDemoAppMetadata(backendRoot, diagnostics);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  // A nearest-ancestor demo manifest is the stable app-identity authority.
  // Layouts such as <demo>/backends/snapback must not become app "backends"
  // merely because codegen was moved one directory deeper. Bare external
  // backends retain the legacy immediate-parent fallback.
  //
  // @ref LLP 0004#first-slice-api-decisions — appId feeds stable function ids.
  const appId = demoMetadata.appId ?? inferAppId(backendRoot);
  const decoratedFunctionDefinitions = decorateFunctions(appId, functions);
  const requiredTargetCapabilities = new Set(schemaRequiredCapabilities);
  for (const fn of decoratedFunctionDefinitions) {
    for (const capability of fn.requiredCapabilities) requiredTargetCapabilities.add(capability);
  }
  for (const job of cronJobs) {
    for (const capability of job.requiredCapabilities) requiredTargetCapabilities.add(capability);
  }
  validateTargetArtifactAuthSupport(
    canonicalCapability.manifest,
    artifactVersion,
    authMode,
    [...requiredTargetCapabilities],
    err,
  );
  const remoteServiceInputs = loadRemoteServiceInputs(backendRoot, appId, targetProfile, err);
  // Compile the optional route→query manifest (LLP 0092 §0C.1) against the
  // authored functions: unknown/non-query functions, pattern grammar,
  // overlap, `params-v1` mapping rules, per-reference arg-schema typing, and
  // required-arg coverage all refuse at compile time — the same rules the
  // served instance re-enforces at ensure.
  const routesManifest = routesModule
    ? compileRoutesManifest(routesModule, functionsModule, appId, err)
    : null;
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  // Hash inputs use the MANIFEST-RELATIVE handler path (LLP 0034 review fix
  // 4): keying by absolute path baked the checkout location into inputsHash /
  // bundleHash, so committed artifacts only reproduced from the checkout that
  // generated them.
  const handlerInputs = [];
  for (const [sourcePath, entry] of [...handlerSourceCache.entries()].sort(([a], [b]) => compareCodeUnits(a, b))) {
    handlerInputs.push(sourcePath, entry.bytes);
  }
  const schemaGraphInputs = moduleGraphIdentity(schemaGraph, backendRoot);
  const functionsGraphInputs = moduleGraphIdentity(functionsGraph, backendRoot);
  // Path/source pairs prove which bytes were admitted. Canonical isolated
  // values prove what those bytes meant under the current AST transformer and
  // evaluator. Binding both closes the case where a toolchain semantic change
  // emits different definitions from identical source under an old hash.
  const schemaEvaluation = stableJson(schemaDef);
  const functionsEvaluation = stableJson(functionsModule);
  const routesGraphInputs = routesBuild ? moduleGraphIdentity(routesBuild.graph, backendRoot) : null;
  const inputs = [
    'schema-graph',
    ...schemaGraphInputs,
    'schema-isolated-evaluation',
    schemaEvaluation,
    'functions-graph',
    ...functionsGraphInputs,
    'functions-isolated-evaluation',
    functionsEvaluation,
    // Routes participate in the staleness marker only (never in schemaHash /
    // bundleHash — the manifest has its own canonical routeManifestHash
    // identity, LLP 0091 §0A.6); apps without routes.mjs hash identically to
    // before the artifact existed.
    ...(routesGraphInputs === null
      ? []
      : ['routes-graph', ...routesGraphInputs, 'routes-isolated-evaluation', stableJson(routesModule)]),
    ...(seedSource === null ? [] : [seedSource]),
    ...(demoMetadata.source === null ? [] : [demoMetadata.source]),
    contractCapabilitiesSource,
    canonicalCapability.source,
    ...(remoteServiceInputs?.identityInputs ?? []),
    ...handlerInputs,
  ];
  // @ref LLP 0010#generated-artifacts — every identity item is framed
  // independently. A sentinel delimiter is insufficient because JavaScript
  // and handler source may legally contain that byte: an author could otherwise
  // move `\0<next path>\0` between two
  // adjacent sources and preserve the hash while changing the emitted bundle.
  // Distinct domains also prevent the three identity contracts from becoming
  // interchangeable when their framed item sequences happen to match.
  const schemaContentItems = [
    ...schemaGraphInputs,
    'schema-isolated-evaluation',
    schemaEvaluation,
  ];
  const bundleContentItems = [
    ...functionsGraphInputs,
    'functions-isolated-evaluation',
    functionsEvaluation,
    ...handlerInputs,
  ];
  const generatedAt = generatedAtMillis();
  const appIdentity = demoMetadata.identity;
  const { inputsHash, schemaHash, bundleHash } = computeArtifactIdentityStrings({
    artifactVersion,
    authMode,
    appId,
    sharedInputItems: inputs,
    schemaContentItems,
    bundleContentItems,
  });
  const schemaManifest = {
    artifactKind: 'schemaManifest',
    schemaVersion: artifactVersion,
    appId,
    ...(appIdentity ? { app: appIdentity } : {}),
    ...(schemaDef.auth !== undefined ? { auth: { mode: authMode } } : {}),
    ...(schemaRequiredCapabilities.length > 0
      ? { requiredCapabilities: schemaRequiredCapabilities }
      : {}),
    schemaHash,
    inputsHash,
    generatedAt,
    targetProfile,
    portabilityFlags: [],
    artifactDiagnostics: [],
    ephemeralCollections,
    tables: Object.values(tables),
  };
  // @ref LLP 0058#capability-maturity — the artifact pair's experimental
  // acknowledgments: exactly the experimental ids this pair requires
  // (functions, cron, and schema-level requirements — schema and functions
  // are one generated unit). Emitting them is truthful because the same
  // closed table derived the requirements; admission still refuses any
  // requirement the served instance does not positively support.
  const acknowledgedExperimentalCapabilities = [...new Set(
    [
      ...decoratedFunctionDefinitions.flatMap((fn) => fn.requiredCapabilities ?? []),
      ...cronJobs.flatMap((job) => job.requiredCapabilities ?? []),
      ...schemaRequiredCapabilities,
    ].filter((capability) => EXPERIMENTAL_TARGET_CAPABILITY_IDS.has(capability)),
  )].sort();
  const functionManifest = {
    artifactKind: 'functionManifest',
    schemaVersion: artifactVersion,
    appId,
    bundleHash,
    inputsHash,
    generatedAt,
    unsupportedDependencyDiagnostics: infoDiagnostics,
    ...(acknowledgedExperimentalCapabilities.length > 0
      ? { acknowledgedExperimentalCapabilities }
      : {}),
    functions: decoratedFunctionDefinitions,
    cronJobs,
    config: configEntries,
    ...(projections.length > 0 ? { projections } : {}),
  };
  // Server-declared, never authored here (LLP 0032 P2 / LLP 0037): the
  // selected committed schemas/ instance is generated from the Rust core's
  // target declaration, drift-gated by tests/capability_v0.rs, and embedded
  // verbatim.
  const capabilityManifest = canonicalCapability.manifest;
  // Exact LLP 0329 E-B: IR-tier mutations embed their plan, so the adapter
  // can derive default optimistic overlays from the generated artifact alone
  // — the flags below claim exactly that and nothing more.
  const hasDerivedOverlayMutations = Object.values(contractMutations).some(
    (descriptor) => descriptor.plan !== undefined,
  );
  const allMutationsReplayable = Object.values(contractMutations).length > 0
    && Object.values(contractMutations).every((descriptor) => descriptor.plan !== undefined);
  // Keep the pre-introspection projection during the migration as an
  // independent emit-both witness. The neutral producer below must reproduce
  // this Exact-owned consumer document exactly or codegen fails before writing.
  const legacyContractManifest = {
    artifactKind: 'contractDataManifest',
    // Contract consumes the same schema/function pair as the server. Session
    // artifacts therefore carry v1 here too; pinning this adjacent artifact
    // to v0 makes the adapter correctly reject an otherwise coherent build.
    schemaVersion: artifactVersion,
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
      // True exactly when some mutation carries a derivable IR plan: the
      // adapter's generated default overlay backs the claim (LLP 0329 §E5).
      optimisticMutations: hasDerivedOverlayMutations,
      // LLP 0051 D6: the same closed IR plans now drive both the derived
      // overlay and the D1-ledgered durable client queue. A manifest with no
      // IR mutation cannot claim offline replay.
      derivedOptimisticOverlays: hasDerivedOverlayMutations,
      offlineReplay: allMutationsReplayable,
      rowSyncState: true,
      serverRunnableQueries: true,
      forceStates: true,
      branchableFixtures: false,
      headlessBoot: true,
    },
    // Shared with the adapter that exposes the kit's mutation/subscription
    // receipt ring. This must never drift back to a generator-only default.
    receipts: SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
    queries: contractQueries,
    mutations: contractMutations,
    ephemeral: contractEphemeralSection(ephemeralCollections),
  };
  for (const [name, binding] of Object.entries(contractQueries)) {
    // Migration cross-check (0284 §2.4): fail loudly, write nothing, if the
    // legacy `subscription` field and the v2 liveness fields ever disagree.
    diagnostics.push(...crossCheckContractQueryBinding(name, binding));
  }

  // @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop
  //   — Snapback is the first deterministic producer of the neutral provider
  //   declaration; ContractDataManifest is a validated projection, not the
  //   provider-native source.
  const introspectionSource = {
    queries: contractQueries,
    mutations: contractMutations,
    ephemeral: legacyContractManifest.ephemeral,
  };
  diagnostics.push(...validateSnapbackIntrospectionSource(introspectionSource));
  const providerIntrospection = createSnapbackProviderIntrospection({
    artifactVersion,
    inputsHash,
    schemaHash,
    bundleHash,
    capabilities: legacyContractManifest.capabilities,
    receipts: legacyContractManifest.receipts,
    ...introspectionSource,
  });
  diagnostics.push(...validateProviderIntrospection(providerIntrospection));
  diagnostics.push(...validateContractDataManifestProjection(
    providerIntrospection,
    legacyContractManifest,
  ));
  const providerBindingResult = createProviderBindingMetadata(providerIntrospection);
  diagnostics.push(...providerBindingResult.diagnostics);
  const providerBindingMetadata = providerBindingResult.metadata;
  const contractManifest = projectContractDataManifest(providerIntrospection);

  // DK-7 (LLP 0037): validate the Snapback-owned artifacts against the committed
  // Rust-derived schemas before writing. Fail closed (write nothing) on any
  // mismatch. The Exact-owned contract-data manifest is out of scope (scope fence).
  for (const [schemaFile, instance, expected] of [
    ['schema.manifest.schema.json', schemaManifest, { artifactKind: 'schemaManifest', schemaVersion: artifactVersion }],
    ['functions.manifest.schema.json', functionManifest, { artifactKind: 'functionManifest', schemaVersion: artifactVersion }],
    ['capability.manifest.schema.json', capabilityManifest, { artifactKind: 'capabilityManifest', schemaVersion: SCHEMA_VERSION }],
    ...(routesManifest ? [['routes.manifest.schema.json', routesManifest, {}]] : []),
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

  const outDir = join(backendRoot, targetConfig.outputDirectory);
  const apiModule = renderApiModule(appId, functionManifest.functions, ephemeralCollections);
  const apiTypes = renderApiTypes(
    functionManifest.functions,
    functionsModule,
    ephemeralCollections,
    schemaDef,
    providerBindingMetadata,
  );
  const providerBindingTypes = renderProviderBindingTypes(providerBindingMetadata);
  const contractModules = renderContractModules(contractManifest, functionManifest.functions, functionsModule, ephemeralCollections, schemaDef);
  const operationSchemas = renderOperationSchemas(appId, functionManifest.functions, functionsModule);
  validateContractModuleFilenames(contractModules, err);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  const remoteServicePublication = remoteServiceInputs
    ? buildRemoteServicePublication({
        outDir,
        publicationRoot: applicationRepositoryRoot(backendRoot),
        appId,
        targetProfile,
        schemaManifest,
        functionManifest,
        capabilityManifest,
        operationSchemas,
        inputs: remoteServiceInputs,
        err,
      })
    : null;
  for (const artifact of remoteServicePublication?.artifacts ?? []) {
    const { missing, problems } = validateArtifactAgainstSchema(
      artifact.schemaFile,
      artifact.value,
      { artifactKind: artifact.value.artifactKind, schemaVersion: SCHEMA_VERSION },
    );
    if (missing) {
      err('CODEGEN_ARTIFACT_SCHEMA_MISSING', 'codegen',
        `cannot validate ${artifact.value.artifactKind} against committed schema: ${missing}`,
        { artifact: artifact.value.artifactKind, schema: `schemas/${artifact.schemaFile}` });
    } else if (problems.length > 0) {
      err('CODEGEN_ARTIFACT_SCHEMA_INVALID', 'codegen',
        `${artifact.value.artifactKind} does not match committed schemas/${artifact.schemaFile}: ${problems.join('; ')}`,
        { artifact: artifact.value.artifactKind, schema: `schemas/${artifact.schemaFile}`, problems });
    }
  }
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
      './provider-introspection': './provider-introspection.json',
      './provider-bindings': {
        types: './provider-bindings.d.ts',
        default: './provider-bindings.json',
      },
      ...(routesManifest ? { './routes': './routes.manifest.json' } : {}),
      './operations/*': './operations/*',
      './contract/*': './contract/*',
      ...(remoteServicePublication ? {
        './remote-service-profile': './remote-service.profile.json',
        './remote-auth-capability': './remote-auth-capability.manifest.json',
        './remote-data-capability': './remote-data-capability.manifest.json',
      } : {}),
    },
  };
  const contractArtifactFiles = contractModules.map((module) => `contract/${module.file}`);
  const operationArtifactFiles = operationSchemas.map((schema) => `operations/${schema.file}`);
  const remoteServiceArtifactFiles = remoteServicePublication?.artifacts.map((artifact) => artifact.file) ?? [];
  const artifactIndex = {
    artifactKind: 'artifactIndex',
    schemaVersion: SCHEMA_VERSION,
    appId,
    inputsHash,
    generatedAt,
    schemaHash,
    bundleHash,
    artifacts: ['schema.manifest.json', 'functions.manifest.json', 'capability.manifest.json', 'provider-introspection.json', 'provider-bindings.json', 'provider-bindings.d.ts', 'contract-data.manifest.json', 'api.mjs', 'api.d.ts', 'package.json', ...(routesManifest ? ['routes.manifest.json'] : []), ...operationArtifactFiles, ...remoteServiceArtifactFiles, ...contractArtifactFiles],
    tables: Object.keys(tables),
    ephemeralCollections: ephemeralCollections.map((collection) => collection.name),
    functions: functionManifest.functions.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
    cronJobs: cronJobs.map((job) => ({ name: job.name, action: job.action, enabled: job.enabled })),
    // Names and requirement flags only — the index mirrors declarations,
    // never values (LLP 0036).
    config: configEntries.map((entry) => ({ name: entry.name, required: entry.required, pool: entry.pool })),
  };
  const tmpOutDir = join(backendRoot, `.generated.tmp-${process.pid}-${Date.now()}`);
  try {
    writeGeneratedOutput(tmpOutDir, {
      schemaManifest,
      functionManifest,
      capabilityManifest,
      routesManifest,
      providerIntrospection,
      providerBindingMetadata,
      providerBindingTypes,
      contractManifest,
      apiModule,
      apiTypes,
      operationSchemas,
      remoteServicePublication,
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

  return {
    ok: true,
    diagnostics,
    inputsHash,
    outDir,
    schemaManifest,
    functionManifest,
    capabilityManifest,
    providerIntrospection,
    providerBindingMetadata,
    contractManifest,
  };

  // Cache and hash by the fd-attested target's canonical backend-relative POSIX
  // identity, never an authored alias or absolute checkout path.
  function loadHandlerSource(sourcePath, functionName) {
    let capability;
    try {
      capability = resolveHandlerSourceCapability(backendRoot, sourcePath);
    } catch (error) {
      err(error.codegenCode ?? 'BUNDLE_SOURCE_UNREADABLE', 'bundle', `${functionName}: ${error.message}`, {
        function: functionName,
        source: sourcePath,
        ...(error.details ?? {}),
      });
      return null;
    }
    if (!handlerSourceCache.has(capability.identity)) {
      let bytes;
      let source;
      try {
        bytes = capability.read();
        source = decodeUtf8Source(bytes, capability.identity, 'BUNDLE_SOURCE');
      } catch (error) {
        err(error.codegenCode ?? 'BUNDLE_SOURCE_UNREADABLE', 'bundle', `${functionName}: ${error.message}`, {
          function: functionName,
          source: sourcePath,
          identity: capability.identity,
          ...(error.details ?? {}),
        });
        return null;
      }
      const blocked = scanUnsupportedHandlerSource(source, capability.identity);
      if (blocked.length > 0) {
        for (const issue of blocked) {
          err(issue.code, 'bundle', `${functionName}: ${issue.message}`, {
            function: functionName,
            source: capability.identity,
            token: issue.token,
            sourceSpan: { file: capability.identity, line: issue.line, column: issue.column },
          });
        }
      }
      handlerSourceCache.set(capability.identity, { bytes, source });
    }
    return handlerSourceCache.get(capability.identity).source;
  }
}

function buildEphemeralCollections(ephemeralDef, err, targetProfile) {
  if (!ephemeralDef) return [];

  // @ref LLP 0013#agent-and-developer-diagnostics — missing TTL/auth/routing
  // and unsupported targets must be generated diagnostics, not silent drops.
  const collections = [];
  for (const [name, def] of Object.entries(ephemeralDef.collections ?? {})) {
    if (!IDENT.test(name) || Buffer.byteLength(name) > MAX_EPHEMERAL_COLLECTION_NAME_BYTES) {
      err('EPHEMERAL_INVALID_IDENTIFIER', 'ephemeral', `invalid ephemeral collection identifier ${name}`, { collection: name });
      continue;
    }
    if (!isIsolatedDefinition(def, 'ephemeral-collection')) {
      err('EPHEMERAL_INVALID_COLLECTION', 'ephemeral', `${name} must be ephemeral.collection(...)`, { collection: name });
      continue;
    }

    const scopeFields = Object.keys(def.scope ?? {});
    if (scopeFields.length === 0) {
      err('EPHEMERAL_EMPTY_SCOPE', 'ephemeral', `${name} needs at least one scope field`, { collection: name });
    }
    if (scopeFields.length > MAX_EPHEMERAL_SCOPE_FIELDS) {
      err('EPHEMERAL_SCOPE_TOO_WIDE', 'ephemeral', `${name} has too many scope fields`, {
        collection: name,
        fields: scopeFields.length,
        maximum: MAX_EPHEMERAL_SCOPE_FIELDS,
      });
    }
    for (const field of scopeFields) {
      if (!IDENT.test(field) || Buffer.byteLength(field) > MAX_EPHEMERAL_SCOPE_KEY_BYTES) {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} has invalid scope field ${field}`, { collection: name, field });
        continue;
      }
      validateAuthoringValidator(def.scope?.[field], `${name} scope ${field}`, (message) => {
        err('EPHEMERAL_INVALID_VALIDATOR', 'ephemeral', message, { collection: name, field });
      });
      checkObjectValidatorFieldIdents(def.scope?.[field], `scope field ${field}`, (fieldName, where) => {
        err('EPHEMERAL_INVALID_SCOPE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
      });
    }
    validateAuthoringValidator(def.value, `${name} value`, (message) => {
      err('EPHEMERAL_INVALID_VALIDATOR', 'ephemeral', message, { collection: name });
    });
    // The value validator's nested v.object field names reach the emitted
    // scope/value TS types (typeForValidator) unescaped, same as scope fields.
    checkObjectValidatorFieldIdents(def.value, 'value', (fieldName, where) => {
      err('EPHEMERAL_INVALID_VALUE_FIELD', 'ephemeral', `${name} ${where} has invalid field identifier ${fieldName}`, { collection: name, field: fieldName });
    });

    const requestedRoutingFields = def.routing ?? scopeFields;
    const routingFields = Array.isArray(requestedRoutingFields) ? requestedRoutingFields : [];
    if (routingFields.length === 0) {
      err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} needs at least one routing field`, { collection: name });
    }
    const seenRoutingFields = new Set();
    for (const field of routingFields) {
      if (seenRoutingFields.has(field)) {
        err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} needs unique routing fields`, { collection: name, field });
      }
      seenRoutingFields.add(field);
      if (!scopeFields.includes(field)) {
        err('EPHEMERAL_UNSAFE_ROUTING', 'ephemeral', `${name} routes by ${field}, which is not in its scope`, { collection: name, field, scopeFields });
      }
    }

    if (!isPositiveSafeInteger(def.ttlMs)) {
      err('EPHEMERAL_MISSING_TTL', 'ephemeral', `${name} needs a positive ttlMs`, { collection: name });
    }
    if (!isPositiveSafeInteger(def.maxTtlMs)) {
      err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} maxTtlMs must be a positive integer`, { collection: name, field: 'maxTtlMs', value: def.maxTtlMs });
    } else if (def.maxTtlMs > 30_000) {
      err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} maxTtlMs exceeds the local paved-path ceiling`, { collection: name, field: 'maxTtlMs', value: def.maxTtlMs, maximum: 30_000 });
    } else if (def.maxTtlMs < def.ttlMs) {
      err('EPHEMERAL_INVALID_TTL', 'ephemeral', `${name} maxTtlMs is below ttlMs`, { collection: name, ttlMs: def.ttlMs, maxTtlMs: def.maxTtlMs });
    }
    for (const [field, value, maximum] of [
      ['maxValueBytes', def.maxValueBytes, 4_096],
      ['hardMaxValueBytes', def.hardMaxValueBytes, 4_096],
      ['sustainedHz', def.publishRate?.sustainedHz, 0xffff_ffff],
      ['burst', def.publishRate?.burst, 0xffff_ffff],
      ['dispatchMs', def.delivery?.dispatchMs, Number.MAX_SAFE_INTEGER],
      ['maxPendingEphemeralKeys', def.maxPendingEphemeralKeys, LOCAL_MAX_PENDING_EPHEMERAL_KEYS],
    ]) {
      if (!isPositiveSafeInteger(value) || value > maximum) {
        err('EPHEMERAL_INVALID_BUDGET', 'ephemeral', `${name} ${field} must be a positive integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ''}`, {
          collection: name,
          field,
          value: Number.isFinite(value) ? value : String(value),
          ...(maximum < Number.MAX_SAFE_INTEGER ? { maximum } : {}),
        });
      }
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
    } else {
      for (const [operation, policy] of [['publish', def.publish], ['subscribe', def.subscribe]]) {
        if (
          policy.kind === 'RequireRoomPermission'
          && (
            !IDENT.test(policy.prefix ?? '')
            || Buffer.byteLength(policy.prefix ?? '') > MAX_EPHEMERAL_SCOPE_KEY_BYTES
          )
        ) {
          err('EPHEMERAL_INVALID_AUTH', 'ephemeral', `${name} ${operation} room-permission prefix must be a portable identifier`, {
            collection: name,
            operation,
            prefix: policy.prefix,
          });
        } else if (policy.kind !== 'AllowAll' && policy.kind !== 'RequireRoomPermission') {
          err('EPHEMERAL_INVALID_AUTH', 'ephemeral', `${name} ${operation} uses an unsupported access policy`, {
            collection: name,
            operation,
            policyKind: policy.kind,
          });
        }
      }
    }
    for (const target of def.targets ?? []) {
      if (!TARGET_PROFILES.has(target)) {
        err('EPHEMERAL_UNSUPPORTED_TARGET', 'ephemeral', `${name} declares unsupported ephemeral target ${target}`, { collection: name, target });
      }
    }
    if (!(def.targets ?? []).includes(targetProfile)) {
      err('EPHEMERAL_TARGET_NOT_DECLARED', 'ephemeral', `${name} is not declared for selected target ${targetProfile}`, { collection: name, targetProfile });
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

export function serializeExpr(expr) {
  if (expr.kind === 'AuthUserId') return 'AuthUserId';
  if (expr.kind === 'AuthKind') return 'AuthKind';
  if (expr.kind === 'AuthActorKind') return 'AuthActorKind';
  if (expr.kind === 'AuthIsDelegated') return 'AuthIsDelegated';
  if (expr.kind === 'RuntimeId') return 'RuntimeId';
  if (expr.kind === 'RuntimeNow') return 'RuntimeNow';
  if (expr.kind === 'Args') return 'Args';
  if ('Arg' in expr) return { Arg: expr.Arg };
  if ('Literal' in expr) return { Literal: expr.Literal };
  if ('Binding' in expr) return { Binding: expr.Binding };
  if ('Field' in expr) {
    return { Field: { base: serializeExpr(expr.Field.base), key: expr.Field.key } };
  }
  if ('Binary' in expr) {
    return { Binary: { op: expr.Binary.op, left: serializeExpr(expr.Binary.left), right: serializeExpr(expr.Binary.right) } };
  }
  if ('Unary' in expr) {
    return { Unary: { op: expr.Unary.op, expr: serializeExpr(expr.Unary.expr) } };
  }
  if ('If' in expr) {
    return { If: { cond: serializeExpr(expr.If.cond), then: serializeExpr(expr.If.then), else: serializeExpr(expr.If.else) } };
  }
  if ('Concat' in expr) return { Concat: expr.Concat.map(serializeExpr) };
  if ('Call' in expr) {
    return { Call: { func: expr.Call.func, args: expr.Call.args.map(serializeExpr) } };
  }
  if ('Record' in expr) {
    const fields = dict();
    for (const [key, fieldExpr] of Object.entries(expr.Record.fields)) fields[key] = serializeExpr(fieldExpr);
    return { Record: { fields } };
  }
  throw new Error(`unserializable expr ${JSON.stringify(expr)}`);
}

function serializeQueryPlan(plan, membershipDeclarations) {
  return {
    table: plan.table,
    filters: plan.filters.map((f) => ({ field: f.field, op: f.op, value: serializeExpr(f.value) })),
    membershipFilters: (plan.membershipFilters ?? []).map((predicate) => {
      const membership = membershipDeclarations.get(predicate.declaration)?.membership;
      return {
        declaration: predicate.declaration,
        resource: predicate.resource.kind === 'rowField'
          ? { rowField: predicate.resource.field }
          : {
              arg: {
                path: predicate.resource.kind === 'app' ? '__snapbackApp' : predicate.resource.path,
                resourceTable: membership?.resourceTable ?? null,
              },
            },
        ...(predicate.roles === null ? {} : { roles: predicate.roles }),
      };
    }),
    order: plan.order.map((o) => ({ field: o.field, direction: o.direction })),
    limit: plan.limit,
    indexed_by: plan.index,
  };
}

// Declared plan bounds — the JS mirror of `src/value_expr.rs` (the corpus
// pins both sides). Authoring over bounds fails closed here, before the
// server would reject the same plan at execution (LLP 0051 D2).
const MAX_PLAN_STEPS = 64;
const MAX_EXPR_DEPTH = 32;
const MAX_PLAN_SERIALIZED_BYTES = 65_536;

function exprDepth(expr) {
  if (typeof expr === 'string') return 1;
  if ('Field' in expr) return 1 + exprDepth(expr.Field.base);
  if ('Binary' in expr) return 1 + Math.max(exprDepth(expr.Binary.left), exprDepth(expr.Binary.right));
  if ('Unary' in expr) return 1 + exprDepth(expr.Unary.expr);
  if ('If' in expr) return 1 + Math.max(exprDepth(expr.If.cond), exprDepth(expr.If.then), exprDepth(expr.If.else));
  if ('Concat' in expr) return 1 + Math.max(0, ...expr.Concat.map(exprDepth));
  if ('Call' in expr) return 1 + Math.max(0, ...expr.Call.args.map(exprDepth));
  if ('Record' in expr) return 1 + Math.max(0, ...Object.values(expr.Record.fields).map(exprDepth));
  return 1;
}

function planExprs(serialized) {
  const exprs = [];
  for (const step of serialized.steps) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (kind === 'Insert' || kind === 'InsertEach') exprs.push(...Object.values(body.values));
    if (kind === 'InsertEach') exprs.push(body.source);
    if (kind === 'Patch') exprs.push(body.id, ...Object.values(body.values));
    if (kind === 'Delete' || kind === 'Get') exprs.push(body.id);
    if (kind === 'Guard') exprs.push(body.cond);
    if (kind === 'Let') exprs.push(body.expr);
    if (kind === 'DeleteWhere') exprs.push(...body.filter.map((f) => f.value));
  }
  const rv = serialized.return_value;
  if (rv && typeof rv === 'object') {
    if ('Document' in rv) exprs.push(rv.Document.id);
    if ('Expr' in rv) exprs.push(rv.Expr);
  }
  return exprs;
}

export function serializeMutationPlan(plan, functionName, err) {
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
    if (kind === 'Get') {
      return { Get: { table: body.table, id: serializeExpr(body.id), bind_as: body.bind_as, else_error: body.else_error } };
    }
    if (kind === 'Guard') {
      return { Guard: { cond: serializeExpr(body.cond), else_error: body.else_error } };
    }
    if (kind === 'Let') {
      return { Let: { bind_as: body.bind_as, expr: serializeExpr(body.expr) } };
    }
    if (kind === 'DeleteWhere') {
      return { DeleteWhere: { table: body.table, filter: body.filter.map((f) => ({ field: f.field, op: f.op, value: serializeExpr(f.value) })) } };
    }
    if (kind === 'InsertEach') {
      const values = dict();
      for (const [k, e] of Object.entries(body.values)) values[k] = serializeExpr(e);
      return { InsertEach: { table: body.table, source: serializeExpr(body.source), item_as: body.item_as, values } };
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
    else if ('Expr' in rv) return_value = { Expr: serializeExpr(rv.Expr) };
  }
  const serialized = { steps, return_value };
  if (functionName && err) {
    if (steps.length > MAX_PLAN_STEPS) {
      err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: plan has ${steps.length} steps; the declared bound is ${MAX_PLAN_STEPS}`, { function: functionName });
    }
    const bytes = JSON.stringify(serialized).length;
    if (bytes > MAX_PLAN_SERIALIZED_BYTES) {
      err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: plan serializes to ${bytes} bytes; the declared bound is ${MAX_PLAN_SERIALIZED_BYTES}`, { function: functionName });
    }
    for (const expr of planExprs(serialized)) {
      if (exprDepth(expr) > MAX_EXPR_DEPTH) {
        err('MUTATION_PLAN_BOUNDS', 'function', `${functionName}: expression depth exceeds the declared bound (${MAX_EXPR_DEPTH})`, { function: functionName });
        break;
      }
    }
  }
  return serialized;
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
  const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
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
      } else if (!functionsByName.has(action)) {
        err('CRON_ACTION_UNKNOWN', 'cron', `${name}: unknown action ${action}`, { jobName: name, action });
      } else if (functionsByName.get(action).kind !== 'Action') {
        err('CRON_ACTION_KIND_MISMATCH', 'cron', `${name}: ${action} is not an action`, { jobName: name, action, kind: functionsByName.get(action).kind });
      } else if ((functionsByName.get(action).authRequirement ?? 'optional-user') === 'authenticated') {
        err('CRON_AUTH_REQUIREMENT_INVALID', 'cron', `${name}: authenticated action ${action} cannot run as system authority`, {
          jobName: name,
          action,
          authRequirement: 'authenticated',
        });
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
    if (kind === 'Patch' || kind === 'Delete' || kind === 'Get' || kind === 'DeleteWhere') {
      reads.add(body.table);
    }
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

// One recursive gate for every authoring position that accepts a validator:
// schema fields, function args/results, and ephemeral scope/value shapes.
// Builders catch ordinary mistakes early, but definition objects are mutable
// JavaScript; codegen must re-establish the closed vocabulary before emitting.
function validateAuthoringValidator(val, where, report, seen = new Set()) {
  if (!val || typeof val !== 'object' || val.__validator !== true) {
    report(`${where} must be a Snapback validator (v.string(), v.object(), ...)`);
    return false;
  }
  if (seen.has(val)) {
    report(`${where} contains a cyclic validator shape`);
    return false;
  }
  const primitives = new Map([
    ['string', new Set(['String', 'Principal'])],
    ['boolean', new Set(['Boolean'])],
    ['number', new Set(['Integer', 'Real'])],
    ['unknown', new Set(['Json'])],
    ['object', new Set(['Json'])],
  ]);
  const idTable = idFieldTypeTable(val.fieldType);
  if (!primitives.get(val.primitive)?.has(val.fieldType) && !(val.primitive === 'string' && idTable !== null)) {
    report(`${where} has unsupported validator primitive/field type ${JSON.stringify(val.primitive)}/${JSON.stringify(val.fieldType)}`);
    return false;
  }
  if (typeof val.optional !== 'boolean') {
    report(`${where} validator optional must be boolean`);
    return false;
  }
  if (val.primitive !== 'object') return true;
  if (!val.fields || typeof val.fields !== 'object' || Array.isArray(val.fields)) {
    report(`${where} object validator must have a fields object`);
    return false;
  }
  seen.add(val);
  let valid = true;
  for (const [name, field] of Object.entries(val.fields)) {
    if (!validateAuthoringValidator(field, `${where}.${name}`, report, seen)) valid = false;
  }
  seen.delete(val);
  return valid;
}

function idFieldTypeTable(fieldType) {
  if (!fieldType || typeof fieldType !== 'object' || Array.isArray(fieldType)) return null;
  if (Object.keys(fieldType).length !== 1 || !Object.hasOwn(fieldType, 'Id')) return null;
  const id = fieldType.Id;
  if (!id || typeof id !== 'object' || Array.isArray(id)) return null;
  if (Object.keys(id).length !== 1 || typeof id.table !== 'string' || id.table.length === 0) return null;
  return id.table;
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
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

// Operation argument schemas are a client/publication artifact, not a second
// function definition. They are projected from the exact validator objects
// that also feed generated API types, so consumers never have to re-author an
// app function's request shape (ENG-24556).
function renderOperationSchemas(appId, functions, functionsModule) {
  return functions.map((fn) => ({
    file: `${fn.name}.args.schema.json`,
    value: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `https://schemas.snapback.dev/apps/${encodeURIComponent(appId)}/${encodeURIComponent(fn.name)}.args.schema.json`,
      title: `${appId}:${fn.name} arguments`,
      type: 'object',
      additionalProperties: false,
      ...jsonSchemaObjectProperties(functionsModule[fn.name]?.args ?? {}),
    },
  }));
}

function jsonSchemaObjectProperties(fields) {
  const properties = dict();
  const required = [];
  for (const [name, validator] of Object.entries(fields)) {
    properties[name] = jsonSchemaForValidator(validator);
    if (!validator?.optional) required.push(name);
  }
  return {
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function jsonSchemaForValidator(validator) {
  if (!validator || validator.primitive === 'unknown') return {};
  if (validator.primitive === 'object') {
    return {
      type: 'object',
      additionalProperties: false,
      ...jsonSchemaObjectProperties(validator.fields ?? {}),
    };
  }
  if (validator.primitive === 'string') return { type: 'string' };
  if (validator.primitive === 'boolean') return { type: 'boolean' };
  if (validator.primitive === 'number') {
    return { type: validator.fieldType === 'Integer' ? 'integer' : 'number' };
  }
  return {};
}

function buildRemoteServicePublication({
  outDir,
  publicationRoot,
  appId,
  targetProfile,
  schemaManifest,
  functionManifest,
  capabilityManifest,
  operationSchemas,
  inputs,
  err,
}) {
  if (targetProfile !== TARGET_PROFILE_REMOTE) return null;
  if (capabilityManifest.localServerLifecycle !== false
      || capabilityManifest.targetProfileId !== targetProfile) {
    err('REMOTE_SERVICE_CAPABILITY_MISMATCH', 'publication', 'remote target requires the server-declared no-lifecycle capability manifest');
    return null;
  }

  const dataTierProfile = inputs.dataTierProfile.value;
  const corpusManifest = inputs.corpusManifest.value;
  if (dataTierProfile.artifactKind !== 'dataTierProfile'
      || corpusManifest.artifactKind !== 'dataTierCorpusManifest'
      || dataTierProfile.corpus !== corpusManifest.corpus
      || dataTierProfile.profileVersion !== corpusManifest.profileVersion
      || dataTierProfile.corpusFormatVersion !== corpusManifest.corpusFormatVersion
      || dataTierProfile.ledgerVersion !== corpusManifest.ledgerVersion
      || !Array.isArray(corpusManifest.cases)) {
    err('REMOTE_SERVICE_DATA_TIER_INVALID', 'publication', 'remote profile data-tier identity is internally inconsistent');
    return null;
  }

  const schemaArtifact = generatedJsonArtifact(outDir, 'schema.manifest.json', schemaManifest, publicationRoot, err);
  const functionsArtifact = generatedJsonArtifact(outDir, 'functions.manifest.json', functionManifest, publicationRoot, err);
  const capabilityArtifact = generatedJsonArtifact(outDir, 'capability.manifest.json', capabilityManifest, publicationRoot, err);
  const operationSchemaByName = new Map(operationSchemas.map((schema) => [schema.file.replace(/\.args\.schema\.json$/, ''), schema]));
  const functionByName = new Map(functionManifest.functions.map((fn) => [fn.name, fn]));
  const operations = [];
  for (const name of inputs.config.operations ?? []) {
    const fn = functionByName.get(name);
    const argsSchema = operationSchemaByName.get(name);
    if (!fn || fn.kind !== 'Mutation' || !argsSchema || typeof fn.authRequirement !== 'string') {
      err('REMOTE_SERVICE_OPERATION_INVALID', 'publication', `${name} is not a generated mutation with an auth requirement and argument schema`, { function: name });
      continue;
    }
    const argumentsArtifact = generatedJsonArtifact(outDir, `operations/${argsSchema.file}`, argsSchema.value, publicationRoot, err);
    operations.push({
      name,
      functionId: fn.id,
      kind: fn.kind,
      authRequirement: fn.authRequirement,
      argumentsSchema: argumentsArtifact?.reference,
      requestSchema: inputs.wireSchemas.mutationInput.reference,
      responseSchema: inputs.wireSchemas.mutationOutput.reference,
      receiptSchema: inputs.wireSchemas.receipt.reference,
      errorSchema: inputs.wireSchemas.errorResponse.reference,
    });
  }
  if (operations.length !== inputs.config.operations?.length
      || !schemaArtifact || !functionsArtifact || !capabilityArtifact) {
    return null;
  }

  const authValue = {
    artifactKind: 'remoteAuthCapabilityManifest',
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: 1,
    capabilityId: inputs.config.authCapabilityId,
    appId,
    targetProfileId: targetProfile,
    credentialPolicy: {
      presentation: 'authorization-bearer',
      authority: 'host-private',
      valueInArtifacts: false,
      valueInArguments: false,
      valueInEnvironment: false,
      valueInInfoPlist: false,
      supportsRotation: true,
    },
  };
  const authArtifact = generatedJsonArtifact(outDir, 'remote-auth-capability.manifest.json', authValue, publicationRoot, err);
  const wireSchemas = dict();
  for (const [name, artifact] of Object.entries(inputs.wireSchemas)) {
    wireSchemas[name] = artifact.reference;
  }
  const dataValue = {
    artifactKind: 'remoteDataCapabilityManifest',
    schemaVersion: SCHEMA_VERSION,
    manifestVersion: 1,
    capabilityId: inputs.config.dataCapabilityId,
    appId,
    targetProfileId: targetProfile,
    schemaManifest: schemaArtifact.reference,
    functionManifest: functionsArtifact.reference,
    capabilityManifest: capabilityArtifact.reference,
    wireSchemas,
    operations,
  };
  const dataArtifact = generatedJsonArtifact(outDir, 'remote-data-capability.manifest.json', dataValue, publicationRoot, err);
  if (!authArtifact || !dataArtifact) return null;

  const profilePath = repositoryRelativePath(join(outDir, 'remote-service.profile.json'), publicationRoot, err);
  if (!profilePath) return null;
  const profileValue = {
    artifactKind: 'remoteServiceProfile',
    schemaVersion: SCHEMA_VERSION,
    profileVersion: 1,
    profileId: inputs.config.profileId,
    appId,
    targetProfileId: targetProfile,
    localServerLifecycle: false,
    publication: {
      kind: 'gitPinnedCheckout',
      addressing: 'commitSha',
      repository: dataTierProfile.publication.repository,
      profilePath,
    },
    endpointPolicy: {
      scheme: 'https',
      authority: 'host-private',
      valueInArtifacts: false,
      valueInArguments: false,
      valueInEnvironment: false,
      valueInInfoPlist: false,
      allowRedirects: false,
      allowAmbientProxy: false,
    },
    serverCapabilityManifest: capabilityArtifact.reference,
    authCapabilityManifest: authArtifact.reference,
    dataCapabilityManifest: dataArtifact.reference,
    dataTier: {
      corpus: dataTierProfile.corpus,
      profileVersion: dataTierProfile.profileVersion,
      corpusFormatVersion: dataTierProfile.corpusFormatVersion,
      ledgerVersion: dataTierProfile.ledgerVersion,
      caseCount: corpusManifest.cases.length,
      profile: inputs.dataTierProfile.reference,
      corpusManifest: inputs.corpusManifest.reference,
    },
  };
  const profileArtifact = generatedJsonArtifact(outDir, 'remote-service.profile.json', profileValue, publicationRoot, err);
  if (!profileArtifact) return null;
  return {
    artifacts: [
      { ...authArtifact, schemaFile: 'remote-service.auth-capability.manifest.schema.json' },
      { ...dataArtifact, schemaFile: 'remote-service.data-capability.manifest.schema.json' },
      { ...profileArtifact, schemaFile: 'remote-service.profile.schema.json' },
    ],
  };
}

function generatedJsonArtifact(outDir, file, value, publicationRoot, err) {
  const path = repositoryRelativePath(join(outDir, file), publicationRoot, err);
  if (!path) return null;
  const source = `${stableJson(value)}\n`;
  return {
    file,
    path,
    value,
    reference: { path, sha256: `sha256:${sha256(source)}` },
  };
}

function repositoryRelativePath(path, publicationRoot, err) {
  const repoRelative = relative(publicationRoot, path);
  if (!isPathInside(repoRelative)) {
    err('REMOTE_SERVICE_PUBLICATION_PATH_INVALID', 'publication', 'remote service publication output must live inside the repository', { path });
    return null;
  }
  return repoRelative.split(sep).join('/');
}

function applicationRepositoryRoot(backendRoot) {
  let candidate = resolve(backendRoot);
  for (;;) {
    if (existsSync(join(candidate, '.git'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  // The conventional app layout is <app>/snapback. A non-git consumer still
  // gets stable app-relative publication paths instead of package-install
  // paths from node_modules.
  return dirname(resolve(backendRoot));
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
    const prim = f.field_type === 'Principal' || idFieldTypeTable(f.field_type) !== null
      ? 'string'
      : { String: 'string', Boolean: 'boolean', Integer: 'number', Real: 'number' }[f.field_type];
    const descriptor = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
    if (f.optional) descriptor.optional = true;
    fields[f.name] = descriptor;
  }
  return { shape: 'object', fields };
}

// The projected relational row: declared leaves only — no system fields ride
// along (LLP 0080 §2's result is the projection, and the opaque cursor, not
// the row, carries pagination identity). Joined leaves are optional under a
// left join because an unmatched or invisible joined row nulls them.
function relationalRowDescriptor(plan, tables) {
  const primOf = (tableName, fieldName) => {
    const field = (tables[tableName]?.fields ?? []).find((f) => f.name === fieldName);
    if (!field) return { shape: 'unknown' };
    const prim = field.field_type === 'Principal' || idFieldTypeTable(field.field_type) !== null
      ? 'string'
      : { String: 'string', Boolean: 'boolean', Integer: 'number', Real: 'number' }[field.field_type];
    const descriptor = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
    if (field.optional) descriptor.optional = true;
    return descriptor;
  };
  const fields = dict();
  for (const leaf of plan.projection) {
    if (leaf.source.RootField) {
      fields[leaf.name] = primOf(plan.root, leaf.source.RootField);
    } else if (leaf.source.JoinedField) {
      const descriptor = primOf(plan.joined, leaf.source.JoinedField);
      if (plan.joinKind === 'Left') descriptor.optional = true;
      fields[leaf.name] = descriptor;
    } else {
      const literal = leaf.source.Literal;
      const prim = { string: 'string', number: 'number', boolean: 'boolean' }[typeof literal];
      fields[leaf.name] = prim ? { shape: 'primitive', name: prim } : { shape: 'unknown' };
    }
  }
  return { shape: 'object', fields };
}

function authoredFunctionManifestFields(def, declaredWrites = [], tables = {}) {
  // @ref LLP 0055#grants — static authority-creation is best-effort, while the
  // runtime write gate remains authoritative. Declared permission-backing
  // writes derive the marker by default; an explicit false supports a
  // bootstrap-only wrapper, whose dynamic host gate can perform only the
  // structurally non-authority-creating bootstrap operation. If such a
  // wrapper reaches any ordinary membership write, the host still refuses it.
  const authorityCreating = def.authorityCreating === true
    || (def.authorityCreating !== false && [...declaredWrites].some((table) => (
      tables[table]?.permissionBacking === true || tables[table]?.membership !== undefined
    )));
  return {
    ...(def.auth !== undefined ? { authRequirement: def.auth } : {}),
    ...(def.authorityIndependent === true ? { authorityIndependent: true } : {}),
    ...(def.publicInline === true ? { publicInline: true } : {}),
    ...(authorityCreating ? { authorityCreating: true } : {}),
    ...(def.retainable === true ? { retainable: true } : {}),
    ...(Array.isArray(def.authorizationDependence)
      ? { authorizationDependence: [...def.authorizationDependence] }
      : {}),
  };
}

function collectAuthoredAuthorizationDimensions(expr, dimensions) {
  if (!expr || typeof expr !== 'object') return;
  if (expr.kind === 'AuthUserId') dimensions.add('userId');
  if (expr.kind === 'AuthKind') dimensions.add('kind');
  if (expr.kind === 'AuthActorKind') dimensions.add('actorKind');
  if (expr.kind === 'AuthIsDelegated') dimensions.add('isDelegated');
  if ('Field' in expr) collectAuthoredAuthorizationDimensions(expr.Field.base, dimensions);
  if ('Binary' in expr) {
    collectAuthoredAuthorizationDimensions(expr.Binary.left, dimensions);
    collectAuthoredAuthorizationDimensions(expr.Binary.right, dimensions);
  }
  if ('Unary' in expr) collectAuthoredAuthorizationDimensions(expr.Unary.expr, dimensions);
  if ('If' in expr) {
    collectAuthoredAuthorizationDimensions(expr.If.cond, dimensions);
    collectAuthoredAuthorizationDimensions(expr.If.then, dimensions);
    collectAuthoredAuthorizationDimensions(expr.If.else, dimensions);
  }
  if ('Concat' in expr) for (const value of expr.Concat) collectAuthoredAuthorizationDimensions(value, dimensions);
  if ('Call' in expr) for (const value of expr.Call.args) collectAuthoredAuthorizationDimensions(value, dimensions);
  if ('Record' in expr) for (const value of Object.values(expr.Record.fields)) collectAuthoredAuthorizationDimensions(value, dimensions);
}

function hostPlanAuthorizationDependence(def) {
  const dimensions = new Set();
  for (const filter of def.plan?.filters ?? []) {
    collectAuthoredAuthorizationDimensions(filter.value, dimensions);
  }
  if ((def.plan?.membershipFilters?.length ?? 0) > 0) dimensions.add('userId');
  if (def.authScopeField != null) dimensions.add('userId');
  return [...dimensions].sort();
}

function jsAuthorizationDependence(def) {
  if (Array.isArray(def.authorizationDependence)) return [...def.authorizationDependence];
  if (def.js?.authScopeField != null) return ['userId'];
  return ['opaque'];
}

function isProtectedQueryDefinition(def) {
  return def.retainable === true
    || (def.__kind === 'LiveQuery' && def.authorityIndependent !== true);
}

function visitAuthoredExpr(expr, visit) {
  if (!expr || typeof expr !== 'object') return;
  visit(expr);
  if ('Field' in expr) visitAuthoredExpr(expr.Field.base, visit);
  if ('Binary' in expr) {
    visitAuthoredExpr(expr.Binary.left, visit);
    visitAuthoredExpr(expr.Binary.right, visit);
  }
  if ('Unary' in expr) visitAuthoredExpr(expr.Unary.expr, visit);
  if ('If' in expr) {
    visitAuthoredExpr(expr.If.cond, visit);
    visitAuthoredExpr(expr.If.then, visit);
    visitAuthoredExpr(expr.If.else, visit);
  }
  if ('Concat' in expr) for (const value of expr.Concat) visitAuthoredExpr(value, visit);
  if ('Call' in expr) for (const value of expr.Call.args) visitAuthoredExpr(value, visit);
  if ('Record' in expr) for (const value of Object.values(expr.Record.fields)) visitAuthoredExpr(value, visit);
}

function validateProtectedAndRetainabilityDefinition(name, def, err) {
  if (isProtectedQueryDefinition(def) && def.plan) {
    for (const filter of def.plan.filters ?? []) {
      visitAuthoredExpr(filter.value, (expr) => {
        if (expr.kind === 'RuntimeNow') {
          err('SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'auth', `${name}: protected result depends on RuntimeNow`, { function: name, inputKind: 'RuntimeNow' });
        } else if (expr.kind === 'RuntimeId') {
          err('SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'auth', `${name}: protected result depends on RuntimeId`, { function: name, inputKind: 'RuntimeId' });
        }
      });
    }
  }

  if (def.retainable !== true) return;
  if (def.js) {
    err(
      'SNAPBACK_AUTH_UNDECLARABLE_RETENTION',
      'auth',
      `${name}: JavaScript handler retention is refused until ctx.auth and module-state reset equivalence are mechanically proved`,
      { function: name, reason: 'opaqueJavaScript', authorizationDependence: jsAuthorizationDependence(def) },
    );
    return;
  }

  const dependence = hostPlanAuthorizationDependence(def);
  const valid = def.authorityIndependent === true
    ? dependence.length === 0
    : (dependence.length === 1 && dependence[0] === 'userId')
      || (dependence.length === 2 && dependence[0] === 'kind' && dependence[1] === 'userId');
  if (!valid) {
    err(
      'SNAPBACK_AUTH_UNDECLARABLE_RETENTION',
      'auth',
      `${name}: retainable query must be authorityIndependent or depend on userId only`,
      { function: name, reason: 'notUserIdOnly', authorizationDependence: dependence },
    );
  }

}

function authoredExprUsesAuthorityOrAmbientInput(expr) {
  if (!expr || typeof expr !== 'object') return false;
  if (expr.kind === 'AuthUserId'
    || expr.kind === 'AuthKind'
    || expr.kind === 'AuthActorKind'
    || expr.kind === 'AuthIsDelegated'
    || expr.kind === 'RuntimeId'
    || expr.kind === 'RuntimeNow') return true;
  if ('Field' in expr) return authoredExprUsesAuthorityOrAmbientInput(expr.Field.base);
  if ('Binary' in expr) {
    return authoredExprUsesAuthorityOrAmbientInput(expr.Binary.left)
      || authoredExprUsesAuthorityOrAmbientInput(expr.Binary.right);
  }
  if ('Unary' in expr) return authoredExprUsesAuthorityOrAmbientInput(expr.Unary.expr);
  if ('If' in expr) {
    return authoredExprUsesAuthorityOrAmbientInput(expr.If.cond)
      || authoredExprUsesAuthorityOrAmbientInput(expr.If.then)
      || authoredExprUsesAuthorityOrAmbientInput(expr.If.else);
  }
  if ('Concat' in expr) return expr.Concat.some(authoredExprUsesAuthorityOrAmbientInput);
  if ('Call' in expr) return expr.Call.args.some(authoredExprUsesAuthorityOrAmbientInput);
  if ('Record' in expr) return Object.values(expr.Record.fields).some(authoredExprUsesAuthorityOrAmbientInput);
  return false;
}

function validateFunctionAuthDefinition(name, def, err) {
  if (def.auth !== undefined && !AUTH_REQUIREMENTS.has(def.auth)) {
    err('FUNCTION_AUTH_REQUIREMENT_INVALID', 'auth', `${name}: auth must be public, optional-user, or authenticated`, { function: name, authRequirement: def.auth });
  }
  if (def.authorityIndependent !== undefined && typeof def.authorityIndependent !== 'boolean') {
    err('FUNCTION_AUTHORITY_INDEPENDENT_INVALID', 'auth', `${name}: authorityIndependent must be boolean`, { function: name });
    return;
  }
  if (def.publicInline === true && def.authorityIndependent !== true) {
    // @ref LLP 0092#0c3-publicinline--a-codegen-compiled-disclosure-fact —
    // the disclosure fact is accepted only beside a valid
    // authorityIndependent declaration (which entails public); v1 keeps the
    // narrower rule fail-closed.
    err(
      'FUNCTION_PUBLIC_INLINE_INVALID',
      'auth',
      `${name}: publicInline requires a valid authorityIndependent: true declaration`,
      { function: name },
    );
  }
  if (def.authorityIndependent !== true) return;

  const queryKind = def.__kind === 'Query' || def.__kind === 'LiveQuery';
  const hostPlanQuery = queryKind && def.plan && !def.js;
  const publicRequirement = def.auth === 'public';
  // @ref LLP 0058#authority-independent-live-declaration — membership and
  // auth-scope declarations are authority dependencies even when the ordinary
  // filter expressions themselves contain no explicit auth value.
  const authorizationFree = hostPlanQuery
    && hostPlanAuthorizationDependence(def).length === 0;
  const ambientFree = hostPlanQuery
    && (def.plan.filters ?? []).every((filter) => !authoredExprUsesAuthorityOrAmbientInput(filter.value));
  if (!(queryKind && hostPlanQuery && publicRequirement && authorizationFree && ambientFree)) {
    err(
      'FUNCTION_AUTHORITY_INDEPENDENT_INVALID',
      'auth',
      `${name}: authorityIndependent requires a public HostPlan query with no auth, membership, auth-scope, runtime-clock, or runtime-id dependency`,
      { function: name, kind: def.__kind, authRequirement: def.auth ?? 'optional-user' },
    );
  }
}

// ---------------------------------------------------------------------------
// Route→query manifest compilation (LLP 0092 §0C.1 / §0E.6, ENG-25448).
// ---------------------------------------------------------------------------

const ROUTE_PARAM_IDENT = /^[A-Za-z0-9_]+$/;
const ROUTE_PARAM_PRIMITIVES = new Set(['string', 'number', 'boolean']);

/// Parse a v1 route pattern into its param names; null (with a diagnostic)
/// when the pattern violates the exact grammar: `/`-separated static
/// segments plus `:name` params, no wildcards/optional/trailing-slash forms.
function parseRoutePattern(pattern, err) {
  const invalid = (why) => {
    err('ROUTES_PATTERN_INVALID', 'routes', `route pattern ${pattern} is invalid: ${why}`, { route: pattern });
    return null;
  };
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return invalid('must start with /');
  if (pattern === '/') return [];
  if (pattern.endsWith('/')) return invalid('no trailing slash');
  const params = [];
  for (const segment of pattern.slice(1).split('/')) {
    if (segment.length === 0) return invalid('empty segment');
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!ROUTE_PARAM_IDENT.test(name)) return invalid(`bad param name ${segment}`);
      if (params.includes(name)) return invalid(`duplicate param ${name}`);
      params.push(name);
    } else if (segment.includes(':')) {
      return invalid(`mid-segment colon in ${segment}`);
    }
  }
  return params;
}

/// Two valid v1 patterns overlap when some concrete path matches both
/// (LLP 0092 §0C.1's unambiguity rule; mirrors src/bundle.rs).
function routePatternsOverlap(a, b) {
  const split = (pattern) => (pattern === '/' ? [] : pattern.slice(1).split('/'));
  const [left, right] = [split(a), split(b)];
  if (left.length !== right.length) return false;
  return left.every((segment, index) => (
    segment.startsWith(':') || right[index].startsWith(':') || segment === right[index]
  ));
}

function routeLiteralMatches(validator, value) {
  if (!validator || validator.primitive === 'unknown') return true;
  if (validator.primitive === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = validator.fields ?? {};
    for (const [name, field] of Object.entries(fields)) {
      if (value[name] === undefined) {
        if (!field?.optional) return false;
      } else if (!routeLiteralMatches(field, value[name])) return false;
    }
    return Object.keys(value).every((name) => name in fields);
  }
  return typeof value === validator.primitive;
}

/// Compile the authored routes declaration into the routes.manifest.json
/// artifact, validating against the authored functions (LLP 0092 §0C.1
/// admission, run at compile time): function exists and is a query; the
/// `params-v1` mapping grammar holds (references at top-level arg positions
/// only, sole-`$param`-key rule, every reference naming a pattern param);
/// each reference's target arg-schema type is string/number/boolean; literal
/// portions validate statically; every required arg is covered.
function compileRoutesManifest(routesModule, functionsModule, appId, err) {
  if (!isIsolatedDefinition(routesModule, 'routes')) {
    err('ROUTES_NO_DEFAULT_EXPORT', 'routes', 'snapback/routes.mjs must default-export defineRoutes([...])');
    return null;
  }
  const compiled = [];
  const seenPatterns = [];
  for (const entry of routesModule.routes ?? []) {
    const route = entry.route;
    const params = parseRoutePattern(route, err);
    if (params === null) continue;
    for (const prior of seenPatterns) {
      if (routePatternsOverlap(prior, route)) {
        err('ROUTES_PATTERN_OVERLAP', 'routes', `route patterns ${prior} and ${route} can match the same path`, { routes: [prior, route] });
      }
    }
    seenPatterns.push(route);
    const queries = entry.queries ?? [];
    if (queries.length === 0 || queries.length > 32) {
      err('ROUTES_QUERY_COUNT_INVALID', 'routes', `route ${route} must declare 1..32 queries`, { route, count: queries.length });
      continue;
    }
    for (const spec of queries) {
      const fn = functionsModule[spec.function];
      const fail = (code, message, extra = {}) =>
        err(code, 'routes', `route ${route} query ${spec.function}: ${message}`, { route, function: spec.function, ...extra });
      if (!fn || (fn.__kind !== 'Query' && fn.__kind !== 'LiveQuery')) {
        fail('ROUTES_FUNCTION_INVALID', 'names an unknown or non-query function');
        continue;
      }
      const fnArgs = fn.args ?? {};
      const mapping = spec.args ?? {};
      const assertLiteral = (value, where) => {
        if (value && typeof value === 'object') {
          if (!Array.isArray(value) && Object.hasOwn(value, '$param')) {
            fail('ROUTES_ARGS_INVALID', `a $param reference at ${where} is nested inside a literal; references are typable only at top-level arg positions`);
            return;
          }
          for (const [key, inner] of Object.entries(value)) assertLiteral(inner, `${where}.${key}`);
        }
      };
      if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) {
        if (Object.hasOwn(mapping, '$param')) {
          fail('ROUTES_ARGS_INVALID', 'a bare top-level $param reference has no named arg position');
          continue;
        }
        for (const [key, value] of Object.entries(mapping)) {
          const validator = fnArgs[key];
          if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, '$param')) {
            if (Object.keys(value).length !== 1 || typeof value.$param !== 'string') {
              fail('ROUTES_ARGS_INVALID', `the reference at ${key} must be a sole-key {"$param": name} object`);
            } else if (!params.includes(value.$param)) {
              fail('ROUTES_ARGS_INVALID', `references :${value.$param}, which is not in the route pattern`);
            } else if (!validator || !ROUTE_PARAM_PRIMITIVES.has(validator.primitive)) {
              fail('ROUTES_ARGS_INVALID', `references param into arg ${key}, whose schema type is not string/number/boolean`);
            }
          } else {
            assertLiteral(value, key);
            if (validator && !routeLiteralMatches(validator, value)) {
              fail('ROUTES_ARGS_INVALID', `literal for arg ${key} does not match its arg schema`);
            }
          }
        }
        for (const [name, validator] of Object.entries(fnArgs)) {
          if (!validator?.optional && mapping[name] === undefined) {
            fail('ROUTES_ARGS_INVALID', `required arg ${name} is not covered by the mapping`);
          }
        }
      } else {
        assertLiteral(mapping, 'args');
      }
    }
    compiled.push({
      route,
      queries: queries.map((spec) => ({ function: spec.function, args: spec.args ?? {} })),
      ...(entry.persist === false ? { persist: false } : {}),
    });
  }
  return { formatVersion: 1, app: appId, routes: compiled };
}

// The stable function id: a pure function of (appId, exported name), so
// regenerating unchanged source is byte-identical and a rename mints a new id
// (the old id is retired with the old name, never re-pointed at a different
// function). Grants and consent key on this id; determinism means deleting and
// re-adding a same-named function reproduces the same id, so revival of stale
// authority is refused by the grant's durable basis generation (LLP 0055),
// which this deterministic scheme deliberately leaves room for.
//
// @ref LLP 0004#first-slice-api-decisions — Function ids: required, emitted as
//   `{appId}:{exportedName}`, deterministic across regeneration of unchanged
//   source; a rename is a different function.
function functionId(appId, name) {
  if (typeof appId !== 'string' || appId === '' || typeof name !== 'string' || name === '') {
    // Fail closed: emitting a function without a stable id would produce a
    // manifest the server refuses to load (LLP 0012 requires the id).
    throw new Error(`codegen internal error: cannot derive a stable function id from appId=${JSON.stringify(appId)} name=${JSON.stringify(name)}`);
  }
  return `${appId}:${name}`;
}

function decorateFunctions(appId, functions) {
  return functions.map((fn) => {
    const reads = readSummary(fn);
    const writes = writeSummary(fn);
    // @ref LLP 0065#1-fact-classes — fail closed: a plan node the ceiling
    //   walker does not recognize aborts generation instead of shipping a
    //   function whose effects escaped the recorded ceiling.
    let effectCeiling;
    try {
      effectCeiling = computeEffectCeiling(fn);
    } catch (error) {
      throw new Error(`${fn.name}: ${error.message}`, { cause: error });
    }
    return {
      id: functionId(appId, fn.name),
      name: fn.name,
      exportedName: fn.name,
      kind: fn.kind,
      sourceSpan: null,
      requiredCapabilities: requiredCapabilities(fn),
      authRequirement: fn.authRequirement ?? 'optional-user',
      ...(fn.authorityIndependent === true ? { authorityIndependent: true } : {}),
      ...(fn.publicInline === true ? { publicInline: true } : {}),
      ...(fn.authorityCreating === true ? { authorityCreating: true } : {}),
      ...(fn.retainable === true ? { retainable: true } : {}),
      ...(Array.isArray(fn.authorizationDependence) && fn.authorizationDependence.length > 0
        ? { authorizationDependence: fn.authorizationDependence }
        : {}),
      syncabilityClass: syncabilityClass(fn),
      readSetSummary: reads,
      writeSetSummary: writes,
      effectCeiling,
      ...(fn.standardPattern ? { standardPattern: fn.standardPattern } : {}),
      bundleEntrypoint: fn.name,
      uses: fn.uses ?? [],
      runtime: fn.runtime,
    };
  });
}

function readSummary(fn) {
  // The relational read summary names its own mode and both declared
  // sources in root-then-joined order (LLP 0080 §4; retention admission
  // validates this exact shape).
  const relationalPlan = fn.runtime?.HostPlan?.RelationalQuery;
  if (relationalPlan) {
    return {
      mode: 'relational',
      primaryTable: relationalPlan.root,
      tables: [relationalPlan.root, relationalPlan.joined],
      authScopeField: null,
    };
  }
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
  // @ref LLP 0080#2-portable-evaluation-semantics — a target that cannot
  //   execute the relational plan refuses at generation with a
  //   machine-readable capability gap, never at runtime.
  if (fn.runtime?.HostPlan?.RelationalQuery) {
    const relational = [runtimeCapability, 'relational_query_v1'];
    return fn.kind === 'LiveQuery' ? ['live_subscriptions', ...relational] : relational;
  }
  if (fn.kind === 'LiveQuery') return ['live_subscriptions', runtimeCapability];
  if (fn.kind === 'Mutation') return [runtimeCapability, 'mutation_read_set_validation'];
  if (fn.kind === 'Action') {
    const required = [runtimeCapability, 'cron_action_run_mutation'];
    // @ref LLP 0076#target-contract — a streamed action must be refused at
    // artifact admission on targets without the named reader profile, before
    // the handler reaches an external effect. IbexModule source is the closed
    // bundle codegen already owns; the AST-derived detection below can
    // over-require sibling actions but can never invent target authority.
    if (moduleUsesFetchStream(fn.runtime?.IbexModule?.source ?? '')) {
      required.push('bounded_response_stream_v1');
    }
    return required;
  }
  return [runtimeCapability];
}

// @ref LLP 0076#target-contract — AST-derived rather than textual: a
// `fetchStream` member access (`ctx.fetchStream(...)`, computed string
// access, or a destructuring alias `const { fetchStream } = ctx`) marks the
// module as stream-requiring; comments and unrelated string literals do not.
// An unparseable bundle falls back to the conservative textual scan, which
// can over-require but never widens target authority.
function moduleUsesFetchStream(source) {
  if (!source) return false;
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
    });
  } catch (_) {
    return /\bfetchStream\s*\(/u.test(source);
  }
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'MemberExpression') {
      const property = node.property;
      if (
        (!node.computed && property?.type === 'Identifier' && property.name === 'fetchStream')
        || (node.computed && property?.type === 'Literal' && property.value === 'fetchStream')
      ) {
        found = true;
        return;
      }
    }
    if (node.type === 'Property') {
      const key = node.key;
      if (
        (key?.type === 'Identifier' && key.name === 'fetchStream')
        || (key?.type === 'Literal' && key.value === 'fetchStream')
      ) {
        found = true;
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (found) return;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value);
      }
    }
  };
  walk(program);
  return found;
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

// @ref LLP 0051#d1-the-ctx-answer-ledger-recordable-replayable-deterministic-ops — ambient time and entropy are
// refused before bundle load, so the diagnostic must steer authors to the
// host-recorded context values that preserve replay.
function unsupportedAmbientDependencyMessage(code, token) {
  const guide = 'guide/backend/trusted-runtime-values.md';
  if (code === 'BUNDLE_UNSUPPORTED_TIME') {
    return `unsupported ambient dependency ${token}; use ctx.runtime.now() for a trusted integer timestamp (${guide})`;
  }
  if (code === 'BUNDLE_UNSUPPORTED_RANDOM') {
    return `unsupported ambient dependency ${token}; use ctx.runtime.id() for a fresh identifier, or pass an explicit deterministic input for other values (${guide})`;
  }
  if (code === 'BUNDLE_UNSUPPORTED_TIMER') {
    return `unsupported ambient dependency ${token}; do not wait on ambient timers in this handler—use ctx.runtime.now() only when you need a trusted timestamp (${guide})`;
  }
  return `unsupported ambient dependency ${token}`;
}

function scanUnsupportedHandlerSource(source, sourcePath = 'handler.mjs') {
  if (/\.(?:ts|mts)$/iu.test(sourcePath)) {
    return scanUnsupportedTypeScriptHandlerSource(source, sourcePath);
  }
  const allowEgress = egressAllowedAtCodegen();
  let program;
  try {
    // Handler files are closed single-file scripts, not modules. Permit
    // import/export syntax only so the walker can return the stable authored
    // diagnostic instead of degrading it into a parser exception. Runtime
    // execution remains strict and rejects those forms independently.
    //
    // @ref LLP 0009#capability-model — authoring checks are AST-based
    // defense-in-depth; aliases and reflective constructor walks remain the
    // runtime boundary's responsibility.
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      locations: true,
    });
  } catch (error) {
    const line = Number.isInteger(error?.loc?.line) ? error.loc.line : 1;
    const column = Number.isInteger(error?.loc?.column) ? error.loc.column + 1 : 1;
    const message = String(error?.message ?? error).replace(/\s*\(\d+:\d+\)\s*$/u, '');
    return [{
      code: 'BUNDLE_HANDLER_PARSE_FAILED',
      token: 'syntax',
      message: `handler source is not valid JavaScript: ${message}`,
      line,
      column,
    }];
  }

  const issues = [];
  const seen = new Set();
  const functionConstructors = new Set([
    'Function',
    'AsyncFunction',
    'GeneratorFunction',
    'AsyncGeneratorFunction',
  ]);
  const timerFunctions = new Set([
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'requestAnimationFrame',
  ]);

  function addIssue(code, token, node, message = unsupportedAmbientDependencyMessage(code, token)) {
    const key = `${code}\0${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      code,
      token,
      message,
      line: node?.loc?.start?.line ?? 1,
      column: (node?.loc?.start?.column ?? 0) + 1,
      offset: node?.start ?? 0,
    });
  }

  function staticMemberName(node) {
    if (!node || node.type !== 'MemberExpression') return null;
    if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
    if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
      return node.property.value;
    }
    if (
      node.computed
      && node.property?.type === 'TemplateLiteral'
      && node.property.expressions.length === 0
    ) {
      return node.property.quasis[0]?.value?.cooked ?? null;
    }
    return null;
  }

  function unwrapCallable(node) {
    let current = node;
    while (current?.type === 'ChainExpression') current = current.expression;
    if (current?.type === 'SequenceExpression' && current.expressions.length > 0) {
      return unwrapCallable(current.expressions.at(-1));
    }
    return current;
  }

  // Resolve only an explicit global spelling. This deliberately does not try
  // to follow variables: runtime denial owns aliases and constructor walks.
  function explicitGlobalName(node) {
    const target = unwrapCallable(node);
    if (target?.type === 'Identifier') return target.name;
    if (
      target?.type === 'MemberExpression'
      && unwrapCallable(target.object)?.type === 'Identifier'
      && unwrapCallable(target.object).name === 'globalThis'
    ) {
      return staticMemberName(target);
    }
    return null;
  }

  function explicitGlobalNode(node) {
    const target = unwrapCallable(node);
    if (target?.type === 'MemberExpression') return target.property;
    return target;
  }

  function invokedGlobal(node) {
    const target = unwrapCallable(node);
    const direct = explicitGlobalName(target);
    if (direct) return { name: direct, node: explicitGlobalNode(target) };
    if (target?.type === 'MemberExpression') {
      const method = staticMemberName(target);
      if (method === 'call' || method === 'apply' || method === 'bind') {
        const name = explicitGlobalName(target.object);
        if (name) return { name, node: explicitGlobalNode(target.object) };
      }
    }
    return null;
  }

  function matchesGlobalMember(node, holder, member) {
    const target = unwrapCallable(node);
    return target?.type === 'MemberExpression'
      && staticMemberName(target) === member
      && explicitGlobalName(target.object) === holder;
  }

  function isNonReferenceIdentifier(node, parent, key) {
    if (!parent) return false;
    if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
    if (
      (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition')
      && key === 'key'
      && !parent.computed
    ) return true;
    if (parent.type === 'VariableDeclarator' && key === 'id') return true;
    if (
      (parent.type === 'FunctionDeclaration'
        || parent.type === 'FunctionExpression'
        || parent.type === 'ArrowFunctionExpression')
      && (key === 'id' || key === 'params')
    ) return true;
    if ((parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && key === 'id') return true;
    if (parent.type === 'CatchClause' && key === 'param') return true;
    if (
      (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')
      && key === 'label'
    ) return true;
    if (parent.type.startsWith('Import') || parent.type === 'ExportSpecifier') return true;
    if (parent.type === 'MetaProperty') return true;
    return false;
  }

  function visit(node, parent, key) {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ImportExpression':
        addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
        break;
      case 'MetaProperty':
        if (node.meta?.name === 'import') {
          addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
        }
        break;
      case 'ExportAllDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        addIssue('BUNDLE_UNSUPPORTED_EXPORT', 'export', node);
        break;
      case 'WithStatement':
        addIssue(
          'BUNDLE_UNSUPPORTED_WITH',
          'with',
          node,
          'unsupported dynamic scope statement with',
        );
        break;
      case 'Identifier':
        if (!isNonReferenceIdentifier(node, parent, key)) {
          if (node.name === 'process') {
            addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node);
          } else if (node.name === 'WebAssembly') {
            addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node);
          }
        }
        break;
      case 'MemberExpression': {
        if (unwrapCallable(node.object)?.type === 'Identifier' && unwrapCallable(node.object).name === 'globalThis') {
          const name = staticMemberName(node);
          if (name === 'process') {
            addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node.property);
          } else if (name === 'WebAssembly') {
            addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node.property);
          }
        }
        break;
      }
      case 'CallExpression': {
        const invoked = invokedGlobal(node.callee);
        if (invoked?.name === 'eval') {
          addIssue(
            'BUNDLE_UNSUPPORTED_EVAL',
            'eval',
            invoked.node,
            'unsupported dynamic code evaluation eval',
          );
        } else if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        } else if (invoked?.name === 'require') {
          addIssue('BUNDLE_UNSUPPORTED_REQUIRE', 'require', invoked.node);
        } else if (!allowEgress && invoked?.name === 'fetch') {
          addIssue('BUNDLE_UNSUPPORTED_FETCH', 'fetch', invoked.node);
        } else if (!allowEgress && timerFunctions.has(invoked?.name)) {
          addIssue('BUNDLE_UNSUPPORTED_TIMER', 'timer', invoked.node);
        }

        // Obvious reflective spellings are still authored direct uses. More
        // complex aliases intentionally fall through to the runtime boundary.
        if (
          matchesGlobalMember(node.callee, 'Reflect', 'apply')
          || matchesGlobalMember(node.callee, 'Reflect', 'construct')
        ) {
          const reflected = explicitGlobalName(node.arguments[0]);
          const reflectedNode = explicitGlobalNode(node.arguments[0]);
          if (reflected === 'eval') {
            addIssue(
              'BUNDLE_UNSUPPORTED_EVAL',
              'eval',
              reflectedNode,
              'unsupported dynamic code evaluation eval',
            );
          } else if (functionConstructors.has(reflected)) {
            addIssue(
              'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
              reflected,
              reflectedNode,
              `unsupported dynamic code constructor ${reflected}`,
            );
          }
        }

        if (matchesGlobalMember(node.callee, 'Math', 'random')) {
          addIssue('BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', unwrapCallable(node.callee));
        }
        if (matchesGlobalMember(node.callee, 'Date', 'now')) {
          addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', unwrapCallable(node.callee));
        }
        break;
      }
      case 'NewExpression': {
        const invoked = invokedGlobal(node.callee);
        if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        }
        if (invoked?.name === 'Date') {
          addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', invoked.node);
        }
        break;
      }
      case 'TaggedTemplateExpression': {
        const invoked = invokedGlobal(node.tag);
        if (functionConstructors.has(invoked?.name)) {
          addIssue(
            'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
            invoked.name,
            invoked.node,
            `unsupported dynamic code constructor ${invoked.name}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  function walk(node, parent = null, key = null) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    visit(node, parent, key);
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey === 'loc' || childKey === 'start' || childKey === 'end') continue;
      if (Array.isArray(child)) {
        for (const item of child) walk(item, node, childKey);
      } else {
        walk(child, node, childKey);
      }
    }
  }

  walk(program);
  return issues
    .sort((left, right) => left.offset - right.offset || left.code.localeCompare(right.code))
    .map(({ offset: _offset, ...issue }) => issue);
}

// TypeScript handler files are a declared authoring surface. Parse them with
// the pinned TypeScript AST so type syntax is accepted without losing authored
// source locations; the emitted JavaScript is still produced by esbuild later.
function scanUnsupportedTypeScriptHandlerSource(source, sourcePath) {
  const allowEgress = egressAllowedAtCodegen();
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostic = sourceFile.parseDiagnostics?.[0];
  if (parseDiagnostic) {
    const start = Number.isInteger(parseDiagnostic.start) ? parseDiagnostic.start : 0;
    const location = sourceFile.getLineAndCharacterOfPosition(start);
    return [{
      code: 'BUNDLE_HANDLER_PARSE_FAILED',
      token: 'syntax',
      message: `handler source is not valid TypeScript: ${ts.flattenDiagnosticMessageText(parseDiagnostic.messageText, '\n')}`,
      line: location.line + 1,
      column: location.character + 1,
    }];
  }

  const issues = [];
  const seen = new Set();
  const functionConstructors = new Set([
    'Function',
    'AsyncFunction',
    'GeneratorFunction',
    'AsyncGeneratorFunction',
  ]);
  const timerFunctions = new Set([
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'requestAnimationFrame',
  ]);

  function addIssue(code, token, node, message = unsupportedAmbientDependencyMessage(code, token)) {
    const key = `${code}\0${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    const offset = node?.getStart?.(sourceFile) ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(offset);
    issues.push({
      code,
      token,
      message,
      line: location.line + 1,
      column: location.character + 1,
      offset,
    });
  }

  function isMember(node) {
    return Boolean(node)
      && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node));
  }

  function memberObject(node) {
    return isMember(node) ? node.expression : null;
  }

  function memberNameNode(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name;
    return ts.isElementAccessExpression(node) ? node.argumentExpression : null;
  }

  function staticMemberName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (!ts.isElementAccessExpression(node)) return null;
    const argument = node.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return argument.text;
    }
    return null;
  }

  function unwrapCallable(node) {
    let current = node;
    while (
      current
      && (ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current)
        || ts.isNonNullExpression(current)
        || ts.isSatisfiesExpression(current))
    ) {
      current = current.expression;
    }
    if (current && ts.isCommaListExpression?.(current) && current.elements.length > 0) {
      return unwrapCallable(current.elements.at(-1));
    }
    if (current && ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return unwrapCallable(current.right);
    }
    return current;
  }

  function explicitGlobalName(node) {
    const target = unwrapCallable(node);
    if (!target) return null;
    if (ts.isIdentifier(target)) return target.text;
    if (
      isMember(target)
      && ts.isIdentifier(unwrapCallable(memberObject(target)))
      && unwrapCallable(memberObject(target)).text === 'globalThis'
    ) {
      return staticMemberName(target);
    }
    return null;
  }

  function explicitGlobalNode(node) {
    const target = unwrapCallable(node);
    return isMember(target) ? memberNameNode(target) : target;
  }

  function invokedGlobal(node) {
    const target = unwrapCallable(node);
    const direct = explicitGlobalName(target);
    if (direct) return { name: direct, node: explicitGlobalNode(target) };
    if (isMember(target)) {
      const method = staticMemberName(target);
      if (method === 'call' || method === 'apply' || method === 'bind') {
        const name = explicitGlobalName(memberObject(target));
        if (name) return { name, node: explicitGlobalNode(memberObject(target)) };
      }
    }
    return null;
  }

  function matchesGlobalMember(node, holder, member) {
    const target = unwrapCallable(node);
    return isMember(target)
      && staticMemberName(target) === member
      && explicitGlobalName(memberObject(target)) === holder;
  }

  function isNamedDeclarationIdentifier(node, parent) {
    if (parent?.name !== node) return false;
    return ts.isVariableDeclaration(parent)
      || ts.isParameter(parent)
      || ts.isBindingElement(parent)
      || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)
      || ts.isInterfaceDeclaration(parent)
      || ts.isTypeAliasDeclaration(parent)
      || ts.isEnumDeclaration(parent)
      || ts.isModuleDeclaration(parent)
      || ts.isImportClause(parent)
      || ts.isImportSpecifier(parent)
      || ts.isNamespaceImport(parent)
      || ts.isPropertyDeclaration(parent)
      || ts.isPropertySignature(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isMethodSignature(parent)
      || ts.isGetAccessorDeclaration(parent)
      || ts.isSetAccessorDeclaration(parent);
  }

  function isNonReferenceIdentifier(node, parent) {
    if (!parent) return false;
    if (ts.isTypeNode(parent) || isNamedDeclarationIdentifier(node, parent)) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
    if (
      (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent))
      && parent.name === node
    ) return true;
    if (ts.isLabeledStatement(parent) && parent.label === node) return true;
    if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return true;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
    if (ts.isMetaProperty(parent)) return true;
    return false;
  }

  function exportModifier(node) {
    if (!ts.canHaveModifiers(node)) return null;
    return ts.getModifiers(node)?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? null;
  }

  function visit(node) {
    const parent = node.parent;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
    } else if (
      ts.isExportDeclaration(node)
      || ts.isExportAssignment(node)
      || exportModifier(node)
    ) {
      addIssue('BUNDLE_UNSUPPORTED_EXPORT', 'export', exportModifier(node) ?? node);
    } else if (ts.isWithStatement(node)) {
      addIssue('BUNDLE_UNSUPPORTED_WITH', 'with', node, 'unsupported dynamic scope statement with');
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node);
    } else if (ts.isIdentifier(node) && !isNonReferenceIdentifier(node, parent)) {
      if (node.text === 'process') {
        addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', node);
      } else if (node.text === 'WebAssembly') {
        addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', node);
      }
    }

    if (isMember(node)) {
      const holder = unwrapCallable(memberObject(node));
      if (ts.isIdentifier(holder) && holder.text === 'globalThis') {
        const name = staticMemberName(node);
        if (name === 'process') {
          addIssue('BUNDLE_UNSUPPORTED_PROCESS', 'process', memberNameNode(node));
        } else if (name === 'WebAssembly') {
          addIssue('BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', memberNameNode(node));
        }
      }
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addIssue('BUNDLE_UNSUPPORTED_IMPORT', 'import', node.expression);
      }
      const invoked = invokedGlobal(node.expression);
      if (invoked?.name === 'eval') {
        addIssue('BUNDLE_UNSUPPORTED_EVAL', 'eval', invoked.node, 'unsupported dynamic code evaluation eval');
      } else if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      } else if (invoked?.name === 'require') {
        addIssue('BUNDLE_UNSUPPORTED_REQUIRE', 'require', invoked.node);
      } else if (!allowEgress && invoked?.name === 'fetch') {
        addIssue('BUNDLE_UNSUPPORTED_FETCH', 'fetch', invoked.node);
      } else if (!allowEgress && timerFunctions.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_TIMER', 'timer', invoked.node);
      }

      if (matchesGlobalMember(node.expression, 'Reflect', 'apply')
        || matchesGlobalMember(node.expression, 'Reflect', 'construct')) {
        const reflected = explicitGlobalName(node.arguments[0]);
        const reflectedNode = explicitGlobalNode(node.arguments[0]);
        if (reflected === 'eval') {
          addIssue('BUNDLE_UNSUPPORTED_EVAL', 'eval', reflectedNode, 'unsupported dynamic code evaluation eval');
        } else if (functionConstructors.has(reflected)) {
          addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', reflected, reflectedNode, `unsupported dynamic code constructor ${reflected}`);
        }
      }
      if (matchesGlobalMember(node.expression, 'Math', 'random')) {
        addIssue('BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', unwrapCallable(node.expression));
      }
      if (matchesGlobalMember(node.expression, 'Date', 'now')) {
        addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', unwrapCallable(node.expression));
      }
    } else if (ts.isNewExpression(node)) {
      const invoked = invokedGlobal(node.expression);
      if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      }
      if (invoked?.name === 'Date') addIssue('BUNDLE_UNSUPPORTED_TIME', 'Date', invoked.node);
    } else if (ts.isTaggedTemplateExpression(node)) {
      const invoked = invokedGlobal(node.tag);
      if (functionConstructors.has(invoked?.name)) {
        addIssue('BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', invoked.name, invoked.node, `unsupported dynamic code constructor ${invoked.name}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues
    .sort((left, right) => left.offset - right.offset || left.code.localeCompare(right.code))
    .map(({ offset: _offset, ...issue }) => issue);
}

function scanStaticallyInvalidJsQueryResults(source, exportName) {
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    // The handler bundle's existing syntax/evaluation path owns parse errors.
    return [];
  }

  const functions = [];
  const visitDeclarations = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      (node.type === 'FunctionDeclaration' && node.id?.name === exportName) ||
      (node.type === 'VariableDeclarator'
        && node.id?.name === exportName
        && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type))
    ) {
      functions.push(node.type === 'FunctionDeclaration' ? node : node.init);
      return;
    }
    if (
      node.type === 'Property'
      && !node.computed
      && (node.key?.name === exportName || node.key?.value === exportName)
      && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.value?.type)
    ) {
      functions.push(node.value);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visitDeclarations);
      else if (value && typeof value === 'object') visitDeclarations(value);
    }
  };
  visitDeclarations(program);

  const problems = [];
  const inspectBody = (node, rootFunction) => {
    if (!node || typeof node !== 'object') return;
    if (
      node !== rootFunction
      && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) return;
    if (node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression') {
      problems.push({
        line: node.argument.loc?.start.line ?? node.loc?.start.line ?? 1,
        column: (node.argument.loc?.start.column ?? node.loc?.start.column ?? 0) + 1,
      });
      return;
    }
    if (node === rootFunction && node.type === 'ArrowFunctionExpression' && node.body?.type === 'ObjectExpression') {
      problems.push({
        line: node.body.loc?.start.line ?? 1,
        column: (node.body.loc?.start.column ?? 0) + 1,
      });
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => inspectBody(child, rootFunction));
      else if (value && typeof value === 'object') inspectBody(value, rootFunction);
    }
  };
  functions.forEach((fn) => inspectBody(fn, fn));
  return problems;
}

function legacyProtectedHandlerSourceScan(source) {
  const searchable = maskCommentsAndStrings(source);
  const checks = [
    [
      'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY',
      /\bctx\s*\.\s*runtime\s*\.\s*now\s*\(/u,
      'RuntimeNow',
    ],
    [
      'SNAPBACK_AUTH_MUTABLE_INPUT_DENIED',
      /\bctx\s*\.\s*runtime\s*\.\s*id\s*\(/u,
      'RuntimeId',
    ],
  ];
  return checks
    .map(([code, pattern, inputKind]) => {
      const match = pattern.exec(searchable);
      if (!match) return null;
      return {
        code,
        inputKind,
        message: `protected result depends on denied mutable input ${inputKind}`,
        ...sourcePosition(source, match.index),
      };
    })
    .filter(Boolean);
}

// Attribute denied mutable inputs to one exported handler's conservative
// local call graph. Handler files cannot import modules, so the graph's
// relevant edges are declarations, local aliases, object methods, callbacks,
// `this` siblings, and nested closures. Every ambiguous edge on a known local
// helper object follows all possible methods; it never guesses one.
function scanProtectedHandlerReachableSource(source, exportName) {
  let program;
  try {
    program = parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: true,
      locations: true,
    });
  } catch {
    return legacyProtectedHandlerSourceScan(source);
  }

  const functionKinds = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
  ]);
  const directTargets = new Map();
  const aliasTargets = new Map();
  const objectTargets = new Map();
  const functionOwners = new WeakMap();
  const exportedFunctions = [];
  const addSetValue = (map, key, value) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  const propertyName = (property) => {
    if (!property?.computed && property?.key?.type === 'Identifier') return property.key.name;
    if (property?.key?.type === 'Literal' && typeof property.key.value === 'string') {
      return property.key.value;
    }
    return null;
  };
  const expressionKey = (expression) => {
    if (expression?.type === 'Identifier') return expression.name;
    if (expression?.type !== 'MemberExpression') return null;
    const base = expressionKey(expression.object);
    if (base === null) return null;
    const member = expression.computed
      ? (expression.property?.type === 'Literal' && typeof expression.property.value === 'string'
        ? expression.property.value
        : null)
      : (expression.property?.type === 'Identifier' ? expression.property.name : null);
    return member === null ? null : `${base}.${member}`;
  };
  const registerBinding = (key, value) => {
    if (!key || !value) return;
    if (functionKinds.has(value.type)) {
      addSetValue(directTargets, key, value);
      return;
    }
    const target = expressionKey(value);
    if (target !== null) addSetValue(aliasTargets, key, target);
  };
  const registerObject = (object, key = null) => {
    if (object?.type !== 'ObjectExpression') return;
    const owner = new Map();
    for (const property of object.properties ?? []) {
      if (property?.type !== 'Property') continue;
      const member = propertyName(property);
      if (member === null) continue;
      const ownerEntry = { functions: new Set(), keys: new Set() };
      if (functionKinds.has(property.value?.type)) {
        ownerEntry.functions.add(property.value);
        if (key !== null) {
          addSetValue(directTargets, `${key}.${member}`, property.value);
          addSetValue(objectTargets, key, property.value);
        }
      } else {
        const target = expressionKey(property.value);
        if (target !== null) {
          ownerEntry.keys.add(target);
          if (key !== null) addSetValue(aliasTargets, `${key}.${member}`, target);
        }
      }
      owner.set(member, ownerEntry);
    }
    for (const entry of owner.values()) {
      for (const fn of entry.functions) {
        if (!functionOwners.has(fn)) functionOwners.set(fn, new Set());
        functionOwners.get(fn).add(owner);
      }
    }
  };
  const indexFunctions = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier') {
      addSetValue(directTargets, node.id.name, node);
      if (node.id.name === exportName) exportedFunctions.push(node);
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      registerBinding(node.id.name, node.init);
      registerObject(node.init, node.id.name);
      if (node.id.name === exportName && functionKinds.has(node.init?.type)) {
        exportedFunctions.push(node.init);
      }
    } else if (node.type === 'VariableDeclarator' && node.id?.type === 'ObjectPattern') {
      const sourceKey = expressionKey(node.init);
      if (sourceKey !== null) {
        for (const property of node.id.properties ?? []) {
          if (property?.type !== 'Property') continue;
          const member = propertyName(property);
          const local = property.value?.type === 'Identifier' ? property.value.name : null;
          if (member !== null && local !== null) {
            addSetValue(aliasTargets, local, `${sourceKey}.${member}`);
          }
        }
      }
    } else if (
      node.type === 'Property'
      && propertyName(node) === exportName
      && functionKinds.has(node.value?.type)
    ) {
      exportedFunctions.push(node.value);
    } else if (node.type === 'AssignmentExpression') {
      const key = expressionKey(node.left);
      if (key !== null) {
        registerBinding(key, node.right);
        registerObject(node.right, key);
      }
    }
    if (node.type === 'ObjectExpression') registerObject(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) indexFunctions(child);
      } else if (value && typeof value === 'object') {
        indexFunctions(value);
      }
    }
  };
  indexFunctions(program);
  if (exportedFunctions.length === 0) return legacyProtectedHandlerSourceScan(source);

  const targetsForKey = (key, seen = new Set()) => {
    if (key === null || seen.has(key)) return new Set();
    seen.add(key);
    const targets = new Set(directTargets.get(key) ?? []);
    for (const alias of aliasTargets.get(key) ?? []) {
      for (const target of targetsForKey(alias, seen)) targets.add(target);
    }
    const dot = key.indexOf('.');
    if (dot > 0) {
      const base = key.slice(0, dot);
      const suffix = key.slice(dot);
      for (const alias of aliasTargets.get(base) ?? []) {
        for (const target of targetsForKey(`${alias}${suffix}`, seen)) targets.add(target);
      }
    }
    return targets;
  };
  const objectFunctionsForKey = (key, seen = new Set()) => {
    if (key === null || seen.has(key)) return new Set();
    seen.add(key);
    const targets = new Set(objectTargets.get(key) ?? []);
    for (const alias of aliasTargets.get(key) ?? []) {
      for (const target of objectFunctionsForKey(alias, seen)) targets.add(target);
    }
    return targets;
  };
  const pending = [...new Set(exportedFunctions)];
  const visited = new Set();
  const issues = [];
  const issueKinds = new Set();
  const addIssue = (code, inputKind, node) => {
    if (issueKinds.has(code)) return;
    issueKinds.add(code);
    issues.push({
      code,
      inputKind,
      message: `protected result depends on denied mutable input ${inputKind}`,
      line: node.loc?.start.line ?? 1,
      column: (node.loc?.start.column ?? 0) + 1,
    });
  };

  while (pending.length > 0) {
    const fn = pending.shift();
    if (visited.has(fn)) continue;
    visited.add(fn);
    const contextNames = new Set(['ctx']);
    const runtimeNames = new Set();
    const runtimeMethods = new Map();
    if (fn.params?.[0]?.type === 'Identifier') contextNames.add(fn.params[0].name);

    let aliasesChanged = true;
    while (aliasesChanged) {
      aliasesChanged = false;
      const collectAliases = (node, root) => {
        if (!node || typeof node !== 'object') return;
        if (node !== root && functionKinds.has(node.type)) return;
        if (node.type === 'VariableDeclarator') {
          if (node.id?.type === 'Identifier' && node.init?.type === 'Identifier') {
            if (contextNames.has(node.init.name) && !contextNames.has(node.id.name)) {
              contextNames.add(node.id.name);
              aliasesChanged = true;
            }
            if (runtimeNames.has(node.init.name) && !runtimeNames.has(node.id.name)) {
              runtimeNames.add(node.id.name);
              aliasesChanged = true;
            }
            const method = runtimeMethods.get(node.init.name);
            if (method && runtimeMethods.get(node.id.name) !== method) {
              runtimeMethods.set(node.id.name, method);
              aliasesChanged = true;
            }
          } else if (node.id?.type === 'Identifier' && node.init?.type === 'MemberExpression') {
            const base = node.init.object;
            const member = node.init.computed
              ? (node.init.property?.type === 'Literal' ? node.init.property.value : null)
              : node.init.property?.name;
            if (
              member === 'runtime'
              && base?.type === 'Identifier'
              && contextNames.has(base.name)
              && !runtimeNames.has(node.id.name)
            ) {
              runtimeNames.add(node.id.name);
              aliasesChanged = true;
            } else if (
              (member === 'now' || member === 'id')
              && base?.type === 'Identifier'
              && runtimeNames.has(base.name)
              && runtimeMethods.get(node.id.name) !== member
            ) {
              runtimeMethods.set(node.id.name, member);
              aliasesChanged = true;
            }
          } else if (node.id?.type === 'ObjectPattern') {
            const source = node.init;
            const sourceIsContext =
              source?.type === 'Identifier' && contextNames.has(source.name);
            const sourceIsRuntime = (
              source?.type === 'Identifier' && runtimeNames.has(source.name)
            ) || (
              source?.type === 'MemberExpression'
              && !source.computed
              && source.property?.name === 'runtime'
              && source.object?.type === 'Identifier'
              && contextNames.has(source.object.name)
            );
            for (const property of node.id.properties ?? []) {
              if (property?.type !== 'Property' || property.value?.type !== 'Identifier') continue;
              const member = propertyName(property);
              if (
                sourceIsContext
                && member === 'runtime'
                && !runtimeNames.has(property.value.name)
              ) {
                runtimeNames.add(property.value.name);
                aliasesChanged = true;
              } else if (
                sourceIsRuntime
                && (member === 'now' || member === 'id')
                && runtimeMethods.get(property.value.name) !== member
              ) {
                runtimeMethods.set(property.value.name, member);
                aliasesChanged = true;
              }
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) collectAliases(child, root);
          } else if (value && typeof value === 'object') {
            collectAliases(value, root);
          }
        }
      };
      collectAliases(fn, fn);
    }

    const isRuntimeInputCall = (node, method) => {
      if (node?.type !== 'CallExpression') return false;
      const callee = node.callee;
      if (callee?.type === 'Identifier' && runtimeMethods.get(callee.name) === method) {
        return true;
      }
      if (
        callee?.type !== 'MemberExpression'
        || callee.computed
        || callee.property?.type !== 'Identifier'
        || callee.property.name !== method
      ) return false;
      const runtime = callee.object;
      return (
        runtime?.type === 'Identifier'
        && runtimeNames.has(runtime.name)
      ) || (
        runtime?.type === 'MemberExpression'
        && !runtime.computed
        && runtime.property?.type === 'Identifier'
        && runtime.property.name === 'runtime'
        && runtime.object?.type === 'Identifier'
        && contextNames.has(runtime.object.name)
      );
    };
    const inspectReachableBody = (node, root) => {
      if (!node || typeof node !== 'object') return;
      if (node !== root && functionKinds.has(node.type)) {
        pending.push(node);
        return;
      }
      if (node.type === 'CallExpression') {
        if (isRuntimeInputCall(node, 'now')) {
          addIssue('SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'RuntimeNow', node);
        } else if (isRuntimeInputCall(node, 'id')) {
          addIssue('SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'RuntimeId', node);
        }
        const calleeKey = expressionKey(node.callee);
        for (const target of targetsForKey(calleeKey)) pending.push(target);
        if (functionKinds.has(node.callee?.type)) {
          pending.push(node.callee);
        } else if (node.callee?.type === 'MemberExpression') {
          if (node.callee.object?.type === 'ThisExpression') {
            const member = node.callee.computed
              ? (node.callee.property?.type === 'Literal' ? node.callee.property.value : null)
              : node.callee.property?.name;
            for (const owner of functionOwners.get(fn) ?? []) {
              const entries = member === null
                ? [...owner.values()]
                : [owner.get(member)].filter(Boolean);
              for (const entry of entries) {
                for (const target of entry.functions) pending.push(target);
                for (const key of entry.keys) {
                  for (const target of targetsForKey(key)) pending.push(target);
                }
              }
            }
          } else if (calleeKey === null || targetsForKey(calleeKey).size === 0) {
            const base = expressionKey(node.callee.object);
            for (const target of objectFunctionsForKey(base)) pending.push(target);
          }
        }
      }
      if (node.type === 'Identifier') {
        for (const target of targetsForKey(node.name)) pending.push(target);
      } else if (node.type === 'MemberExpression') {
        for (const target of targetsForKey(expressionKey(node))) pending.push(target);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) inspectReachableBody(child, root);
        } else if (value && typeof value === 'object') {
          inspectReachableBody(value, root);
        }
      }
    };
    inspectReachableBody(fn, fn);
  }
  return issues;
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

function renderApiTypes(
  functions,
  functionsModule,
  ephemeralCollections,
  schemaDef,
  providerBindingMetadata,
) {
  const lines = [
    HEADER,
    "export type SchemaVersion = 'snapback.v0';",
    "export type Principal = string & { readonly __snapbackPrincipal: unique symbol };",
    "export type Id<Table extends string> = string & { readonly __snapbackIdTable: Table };",
    "export type FunctionKind = 'Query' | 'Mutation' | 'LiveQuery' | 'Action';",
    "export type EphemeralKeyMode = 'Connection' | 'Session' | 'User' | 'Custom';",
    'export interface FunctionReference<Name extends string, Kind extends FunctionKind, Args, Result = unknown> {',
    "  artifactKind: 'functionReference';",
    '  schemaVersion: SchemaVersion;',
    '  appId: string;',
    '  id: string;',
    '  name: Name;',
    '  kind: Kind;',
    '  readonly __args?: Args;',
    '  readonly __result?: Result;',
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
    'export interface GeneratedDataModel {',
  ];
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const properties = Object.entries(table.fields ?? {}).map(([fieldName, validator]) => (
      `${fieldName}${validator.optional ? '?' : ''}: ${typeForGeneratedValidator(validator).replace(/ \| undefined$/, '')}`
    ));
    lines.push(`  ${tableName}: { _id: Id<'${tableName}'>; _version: number; _createdAt: number; _updatedAt: number${properties.length ? `; ${properties.join('; ')}` : ''} };`);
  }
  lines.push(
    '}',
    'export interface GeneratedPermissions {',
  );
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    const typeName = pascal(declaration);
    const resourceTable = membership.scope === 'resource'
      ? idFieldTypeTable(table.fields?.[membership.resource]?.fieldType)
      : null;
    const resourceType = resourceTable ? `Id<'${resourceTable}'>` : 'null';
    lines.push(`  ${declaration}: { requireRole(resource: ${resourceType}, role: ${typeName}Role, ...roles: ${typeName}Role[]): Promise<void> };`);
  }
  lines.push('}');
  const membershipAliases = [];
  const membershipMembers = [];
  for (const [tableName, table] of Object.entries(schemaDef.tables ?? {})) {
    const membership = table.membershipDeclaration;
    if (!membership) continue;
    const declaration = membership.id ?? tableName;
    const typeName = pascal(declaration);
    const roles = [...membership.roles, ...(membership.pendingRoles ?? [])];
    membershipAliases.push(`export type ${typeName}Role = ${roles.map((role) => JSON.stringify(role)).join(' | ') || 'never'};`);
    const insertFields = Object.entries(table.fields ?? {}).map(([fieldName, validator]) => {
      const fieldType = fieldName === membership.role
        ? `${typeName}Role`
        : typeForGeneratedValidator(validator).replace(/ \| undefined$/, '');
      return `${fieldName}${validator.optional ? '?' : ''}: ${fieldType}`;
    });
    const patchFields = Object.entries(table.fields ?? {})
      .filter(([fieldName]) => ![membership.principal, membership.resource, membership.role].includes(fieldName))
      .map(([fieldName, validator]) => `${fieldName}?: ${typeForGeneratedValidator(validator).replace(/ \| undefined$/, '')}`);
    membershipAliases.push(`export type ${typeName}Insert = { ${insertFields.join('; ')} };`);
    const patchType = patchFields.length === 0
      ? 'Record<string, never>'
      : `{ ${patchFields.join('; ')} }`;
    membershipAliases.push(`export type ${typeName}Patch = ${patchType};`);
    let bootstrapMethod = '';
    if (membership.bootstrapRole !== undefined && membership.scope === 'resource') {
      const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
      const resourceDefinition = resourceTable ? schemaDef.tables?.[resourceTable] : null;
      if (resourceTable && resourceDefinition) {
        const bootstrapFields = Object.entries(resourceDefinition.fields ?? {}).map(([fieldName, validator]) => (
          `${fieldName}${validator.optional ? '?' : ''}: ${typeForGeneratedValidator(validator).replace(/ \| undefined$/, '')}`
        ));
        membershipAliases.push(`export type ${typeName}Bootstrap = { ${bootstrapFields.join('; ')} };`);
        bootstrapMethod = `bootstrap(values: ${typeName}Bootstrap): Promise<Id<'${resourceTable}'>>; `;
      }
    }
    // @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default —
    // generated self variants expose the host-private resolver without
    // weakening the transition matrix or revealing a roster row id.
    const selfMethods = membership.scope === 'app'
      ? `setSelfRole(role: ${typeName}Role): Promise<unknown>; removeSelf(): Promise<unknown>; patchSelf(values: ${typeName}Patch): Promise<unknown>; `
      : (() => {
          const resourceTable = idFieldTypeTable(table.fields?.[membership.resource]?.fieldType);
          const resourceType = resourceTable ? `Id<'${resourceTable}'>` : 'string';
          return `setSelfRole(resource: ${resourceType}, role: ${typeName}Role): Promise<unknown>; removeSelf(resource: ${resourceType}): Promise<unknown>; patchSelf(resource: ${resourceType}, values: ${typeName}Patch): Promise<unknown>; `;
        })();
    membershipMembers.push(`  ${declaration}: { ${bootstrapMethod}insert(values: ${typeName}Insert): Promise<unknown>; ${selfMethods}setRole(memberId: Id<'${tableName}'>, role: ${typeName}Role): Promise<unknown>; remove(memberId: Id<'${tableName}'>): Promise<unknown>; patch(memberId: Id<'${tableName}'>, values: ${typeName}Patch): Promise<unknown> };`);
  }
  lines.push(...membershipAliases);
  lines.push('export interface GeneratedMembership {');
  lines.push(...membershipMembers);
  lines.push(
    '}',
    'export interface GeneratedQueryContext { readonly permissions: GeneratedPermissions }',
    'export interface GeneratedMutationContext extends GeneratedQueryContext { readonly membership: GeneratedMembership }',
    'export interface GeneratedActionContext {}',
    'export interface GeneratedFunctionContexts {',
  );
  for (const fn of functions) {
    const context = fn.kind === 'Mutation'
      ? 'GeneratedMutationContext'
      : fn.kind === 'Action'
        ? 'GeneratedActionContext'
        : 'GeneratedQueryContext';
    lines.push(`  ${fn.name}: ${context};`);
  }
  lines.push(
    '}',
    'export interface GeneratedEphemeral {',
  );
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
    const result = providerBindingMetadata?.bindings?.queries
      ?.find(({ name }) => name === fn.name)?.resultType ?? 'unknown';
    lines.push(`  ${fn.name}: FunctionReference<'${fn.name}', '${fn.kind}', ${typeForGeneratedArgs(def?.args ?? {})}, ${result}>;`);
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

function typeForGeneratedArgs(args) {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'Record<string, never>';
  return `{ ${entries.map(([name, val]) => `${name}${val?.optional ? '?' : ''}: ${typeForGeneratedValidator(val).replace(/ \| undefined$/, '')}`).join('; ')} }`;
}

function typeForGeneratedValidator(val) {
  if (!val || !val.__validator) return 'unknown';
  let type;
  const idTable = idFieldTypeTable(val.fieldType);
  if (val.fieldType === 'Principal') type = 'Principal';
  else if (idTable !== null) type = `Id<'${idTable}'>`;
  else type = { string: 'string', boolean: 'boolean', number: 'number', unknown: 'unknown' }[val.primitive] ?? 'unknown';
  if (val.primitive === 'object') {
    type = `{ ${Object.entries(val.fields ?? {}).map(([name, field]) => `${name}${field.optional ? '?' : ''}: ${typeForGeneratedValidator(field).replace(/ \| undefined$/, '')}`).join('; ')} }`;
  }
  return val.optional ? `${type} | undefined` : type;
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

function nearestDemoManifest(backendDir) {
  let directory = dirname(resolve(backendDir));
  while (true) {
    const candidate = join(directory, 'demo.snapback.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// The manifest id participates in stable function ids and unescaped schema
// URI path segments. Keep it a portable, case-stable slug rather than asking
// every downstream consumer to invent its own escaping or normalization rule.
const PORTABLE_DEMO_APP_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

function readDemoAppMetadata(backendDir, diagnostics) {
  const demoManifestPath = nearestDemoManifest(backendDir);
  if (demoManifestPath === null) return { source: null, identity: null, appId: null };
  let source;
  let sourceBytes;
  try {
    sourceBytes = resolveFileReadCapability(demoManifestPath, {
      allowedRoots: [dirname(demoManifestPath)],
      allowSymlink: false,
      codePrefix: 'DEMO_MANIFEST',
    }).read();
    source = decodeUtf8Source(sourceBytes, demoManifestPath, 'DEMO_MANIFEST');
  } catch (cause) {
    diagnostics.push({
      code: 'DEMO_MANIFEST_READ_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: `demo manifest ${demoManifestPath} could not be read: ${cause.message}`,
      path: demoManifestPath,
    });
    return { source: null, identity: null, appId: null };
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
    return { source: sourceBytes, identity: null, appId: null };
  }
  let appId = null;
  if (Object.hasOwn(manifest, 'id')) {
    if (
      typeof manifest.id !== 'string'
      || !PORTABLE_DEMO_APP_ID.test(manifest.id)
    ) {
      diagnostics.push({
        code: 'DEMO_MANIFEST_APP_ID_INVALID',
        severity: 'error',
        subsystem: 'codegen',
        message: `demo manifest ${demoManifestPath} id must be a 1-64 character lowercase ASCII slug that begins and ends with a letter or digit and otherwise contains only letters, digits, or hyphens`,
        path: demoManifestPath,
      });
    } else {
      appId = manifest.id;
    }
  }
  const app = manifest.app && typeof manifest.app === 'object' ? manifest.app : {};
  const identity = cleanObject({
    name: readString(app.name) ?? readString(manifest.title),
    description: readString(app.description) ?? readString(manifest.description),
    iconUrl: readString(app.iconUrl) ?? readString(app.icon_url) ?? readString(manifest.iconUrl) ?? readString(manifest.icon_url),
    wordmarkUrl: readString(app.wordmarkUrl) ?? readString(app.wordmark_url) ?? readString(manifest.wordmarkUrl) ?? readString(manifest.wordmark_url),
  });
  if (identity.name === appId) delete identity.name;
  return {
    source: sourceBytes,
    identity: Object.keys(identity).length === 0 ? null : identity,
    appId,
  };
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

function sha256Framed(domain, items) {
  const hash = createHash('sha256');
  const append = (value) => {
    const bytes = Buffer.from(value, 'utf8');
    hash.update(`${bytes.length}:`, 'ascii');
    hash.update(bytes);
  };
  append('snapback-codegen-framed-sha256/v1');
  append(domain);
  append(String(items.length));
  for (const item of items) append(item);
  return hash.digest('hex');
}

/** Pure identity authority used by codegen and golden-vector tests. V0 keeps
 * its historical domains/truncation byte-for-byte; only the closed v1+sessions
 * tuple enters the disjoint serialized namespaces from LLP 0012/0058. */
export function computeArtifactIdentityStrings({
  artifactVersion,
  authMode,
  appId,
  sharedInputItems,
  schemaContentItems,
  bundleContentItems,
}) {
  // @ref LLP 0058#disjoint-v1-identity-strings — preserve v0's domains and
  // truncation; v1 sessions uses the three exact full-digest namespaces.
  if (artifactVersion === SCHEMA_VERSION && authMode === 'dev') {
    return {
      inputsHash: sha256Framed('snapback-codegen/inputs-hash/v1', sharedInputItems),
      schemaHash: `sha256:${sha256Framed('snapback-codegen/schema-content-hash/v1', schemaContentItems).slice(0, 16)}`,
      bundleHash: `sha256:${sha256Framed('snapback-codegen/bundle-content-hash/v1', bundleContentItems).slice(0, 16)}`,
    };
  }
  if (artifactVersion !== SESSIONS_SCHEMA_VERSION || authMode !== 'sessions') {
    throw new Error(`unsupported artifact/auth identity tuple ${artifactVersion} + ${authMode}`);
  }
  const inputsDigest = sha256Framed(
    'snapback-codegen/inputs-hash/snapback.v1/sessions',
    ['schemaFunctionPair', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...sharedInputItems],
  );
  const schemaDigest = sha256Framed(
    'snapback-codegen/schema-content-hash/snapback.v1/sessions',
    ['schemaManifest', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...schemaContentItems],
  );
  const bundleDigest = sha256Framed(
    'snapback-codegen/bundle-content-hash/snapback.v1/sessions',
    ['functionManifest', SESSIONS_SCHEMA_VERSION, 'sessions', appId, ...bundleContentItems],
  );
  return {
    inputsHash: `${SESSIONS_SCHEMA_VERSION}:sessions:inputs:sha256:${inputsDigest}`,
    schemaHash: `${SESSIONS_SCHEMA_VERSION}:sessions:schema:sha256:${schemaDigest}`,
    bundleHash: `${SESSIONS_SCHEMA_VERSION}:sessions:function:sha256:${bundleDigest}`,
  };
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function dict() {
  return Object.create(null);
}

function codegenWorkerFailure(error) {
  return {
    ok: false,
    diagnostics: [{
      code: 'CODEGEN_WORKER_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: error instanceof Error ? error.message : String(error),
    }],
  };
}

const DEFINITION_EVALUATION_TIMEOUT_MS = 5_000;
const DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS = 15_000;
const DEFINITION_EVALUATOR_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// A second process is intentional even though generate() already uses a
// worker. The generation worker needs filesystem and output authority; this
// evaluator gets none. On the Node 24 LTS baseline, `--permission` denies
// filesystem, child, worker, addon, and inspector capabilities; the VM removes
// process and all network globals as the network boundary. Filesystem
// permission remains the backstop if a future V8/VM escape is discovered.
const ISOLATED_DEFINITION_EVALUATOR = String.raw`
import vm from 'node:vm';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message } }));
  process.exit(0);
}

if (typeof process.permission?.has !== 'function') {
  fail('Node permission isolation is unavailable');
}
for (const capability of ['fs.read', 'fs.write', 'child', 'worker', 'addons', 'inspector']) {
  if (process.permission.has(capability)) fail('isolated evaluator unexpectedly has ' + capability);
}

try {
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const values = Object.create(null);
  for (const item of request.items) {
    const sandbox = Object.create(null);
    const context = vm.createContext(sandbox, {
      name: 'snapback-codegen-' + item.label,
      codeGeneration: { strings: false, wasm: false },
    });
    vm.runInContext(
      "(() => {\n" +
        "const denied = (name) => () => { throw new Error('[snapback-codegen] ambient ' + name + ' is unavailable'); };\n" +
        "const denyMethod = (prototype, name) => Object.defineProperty(prototype, name, { value: denied(name), writable: false, configurable: false });\n" +
        "for (const [prototype, names] of [\n" +
          "[String.prototype, ['localeCompare', 'toLocaleLowerCase', 'toLocaleUpperCase']],\n" +
          "[Number.prototype, ['toLocaleString']],\n" +
          "[BigInt.prototype, ['toLocaleString']],\n" +
          "[Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']],\n" +
          "[Array.prototype, ['toLocaleString']],\n" +
          "[Object.prototype, ['toLocaleString']],\n" +
          "[Object.getPrototypeOf(Uint8Array.prototype), ['toLocaleString']],\n" +
        "]) for (const name of names) denyMethod(prototype, name);\n" +
        "Object.defineProperty(Math, 'random', { value: denied('Math.random'), writable: false, configurable: false });\n" +
        "Object.defineProperty(globalThis, 'Date', { value: undefined, writable: false, configurable: false });\n" +
        "Object.defineProperty(globalThis, 'Intl', { value: undefined, writable: false, configurable: false });\n" +
      "})()",
      context,
      { timeout: ${DEFINITION_EVALUATION_TIMEOUT_MS} },
    );
    vm.runInContext(item.bundle, context, {
      timeout: ${DEFINITION_EVALUATION_TIMEOUT_MS},
      displayErrors: false,
      filename: 'snapback-codegen-' + item.label + '.bundle.js',
    });
    const serialized = sandbox[item.resultKey];
    if (typeof serialized !== 'string') throw new Error(item.label + ' did not publish a serialized definition');
    values[item.label] = JSON.parse(serialized);
  }
  process.stdout.write(JSON.stringify({ ok: true, values }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: {
      name: error instanceof Error ? error.name : null,
      message: error instanceof Error ? error.message : String(error),
    },
  }));
}
`;

async function buildDefinitionBundle(entryPath, backendDir, diagnostics, subsystem, kind) {
  const graph = new Map();
  const resultKey = `__snapback_definition_${kind}_${sha256(entryPath).slice(0, 16)}`;
  const facadeNamespace = `snapback-definition-${kind}`;
  const facadePath = `${facadeNamespace}:entry`;
  const definePath = join(packageDir(), 'define.mjs');

  const problem = (code, text, detail = {}) => ({
    text,
    detail: { snapbackCode: code, ...detail },
  });

  const addGraphFile = (candidate, importedFrom = null) => {
    let capability;
    try {
      capability = resolveFileReadCapability(candidate, {
        allowedRoots: [backendDir, REPO_ROOT],
        codePrefix: 'CODEGEN_IMPORT',
      });
    } catch (error) {
      const isEntry = resolve(candidate) === entryPath;
      const code = error.codegenCode === 'CODEGEN_IMPORT_OUTSIDE_ROOT'
        ? 'CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT'
        : isEntry && error.codegenCode === 'CODEGEN_IMPORT_UNREADABLE'
          ? (kind === 'schema' ? 'SCHEMA_SOURCE_MISSING' : 'FUNCTION_SOURCE_MISSING')
          : error.codegenCode === 'CODEGEN_IMPORT_UNREADABLE'
            ? 'CODEGEN_IMPORT_UNRESOLVED'
            : (error.codegenCode ?? 'CODEGEN_IMPORT_UNRESOLVED');
      return { error: problem(code, `could not resolve local module ${candidate}: ${error.message}`, { path: candidate, importedFrom }) };
    }
    const path = capability.realPath;
    if (graph.has(path)) return { path, source: graph.get(path).source };
    const label = moduleIdentityLabel(path, backendDir);
    if (!label) {
      return { error: problem('CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT', `local module ${path} is outside the app, repository, and a package install; its identity would not be reproducible`, { path, importedFrom }) };
    }
    let bytes;
    let source;
    try {
      bytes = capability.read();
      source = decodeUtf8Source(bytes, path, 'CODEGEN_IMPORT');
    } catch (error) {
      return { error: problem(error.codegenCode ?? 'CODEGEN_IMPORT_UNREADABLE', `could not read local module ${path}: ${error.message}`, { path, importedFrom }) };
    }
    graph.set(path, { path, label, source, bytes });
    return { path, source, bytes };
  };

  const facade = definitionFacadeSource(entryPath, definePath, resultKey, kind);
  try {
    const result = await esbuild({
      absWorkingDir: REPO_ROOT,
      entryPoints: [facadePath],
      bundle: true,
      format: 'iife',
      platform: 'neutral',
      target: ['es2022'],
      treeShaking: false,
      write: false,
      logLevel: 'silent',
      legalComments: 'none',
      logOverride: { 'empty-import-meta': 'error' },
      banner: {
        js: [
          'const __snapbackApply = Reflect.apply;',
          'const __snapbackObjectKeys = Object.keys;',
          'const __snapbackObjectCreate = Object.create;',
          'const __snapbackObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;',
          'const __snapbackObjectGetPrototypeOf = Object.getPrototypeOf;',
          'const __snapbackObjectHasOwn = Object.prototype.hasOwnProperty;',
          'const __snapbackObjectIs = Object.is;',
          'const __snapbackObjectPrototype = Object.prototype;',
          'const __snapbackObjectSetPrototypeOf = Object.setPrototypeOf;',
          'const __snapbackArrayIsArray = Array.isArray;',
          'const __snapbackArrayPrototype = Array.prototype;',
          'const __snapbackNumberIsFinite = Number.isFinite;',
          'const __snapbackReflectOwnKeys = Reflect.ownKeys;',
          'const __snapbackString = String;',
          'const __snapbackSet = Set;',
          'const __snapbackSetHas = Set.prototype.has;',
          'const __snapbackSetAdd = Set.prototype.add;',
          'const __snapbackSetDelete = Set.prototype.delete;',
          'const __snapbackJsonStringify = JSON.stringify;',
        ].join('\n'),
      },
      plugins: [{
        name: 'snapback-definition-graph',
        setup(build) {
          build.onResolve({ filter: /^snapback-definition-(?:schema|functions|routes):entry$/ }, (args) => ({
            path: args.path,
            namespace: facadeNamespace,
          }));
          build.onLoad({ filter: /.*/, namespace: facadeNamespace }, () => ({
            contents: facade,
            loader: 'js',
            resolveDir: dirname(entryPath),
          }));
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'dynamic-import') {
              return { errors: [problem('CODEGEN_DYNAMIC_IMPORT_UNHASHABLE', `${args.importer || entryPath} uses dynamic import(); codegen cannot prove a complete dependency graph`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (args.kind === 'require-call' || args.kind === 'require-resolve') {
              return { errors: [problem('CODEGEN_COMMONJS_LOADER_UNHASHABLE', `${args.importer || entryPath} uses ${args.kind === 'require-resolve' ? 'require.resolve()' : 'require()'}; codegen cannot prove the dependency graph behind CommonJS loaders`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (args.path.startsWith('node:')) {
              return { errors: [problem('CODEGEN_AMBIENT_IMPORT_UNHASHABLE', `${args.importer || entryPath} imports ${args.path}; codegen definitions receive no host builtin capabilities`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            const definitionPackagePath = DEFINITION_PACKAGE_IMPORTS.get(args.path);
            if (!definitionPackagePath && !isLocalModuleSpecifier(args.path)) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} imports bare specifier ${JSON.stringify(args.path)}; use a deterministic relative or file URL`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            if (/[?#]/.test(args.path)) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} imports ${JSON.stringify(args.path)} with a query/hash identity that codegen does not support`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            let candidate;
            try {
              candidate = definitionPackagePath ?? (args.path.startsWith('file:')
                ? fileURLToPath(args.path)
                : isAbsolute(args.path)
                  ? args.path
                  : resolve(args.resolveDir || dirname(args.importer), args.path));
            } catch (error) {
              return { errors: [problem('CODEGEN_AMBIGUOUS_IMPORT', `${args.importer || entryPath} has invalid local import ${JSON.stringify(args.path)}: ${error.message}`, { path: args.importer || entryPath, specifier: args.path })] };
            }
            const loaded = addGraphFile(candidate, args.importer || null);
            if (loaded.error) return { errors: [loaded.error] };
            return { path: loaded.path, namespace: 'file' };
          });
          build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
            const loaded = addGraphFile(args.path);
            if (loaded.error) return { errors: [loaded.error] };
            if (!/\.(?:mjs|mts|cjs|cts|js|ts|json)$/i.test(loaded.path)) {
              return { errors: [problem('CODEGEN_IMPORT_UNSUPPORTED', `${loaded.path} is not a supported JavaScript, TypeScript, or JSON definition dependency`, { path: loaded.path })] };
            }
            const moduleFormat = graphModuleFormat(loaded.path);
            if (moduleFormat.packageJson) {
              const manifest = addGraphFile(moduleFormat.packageJson, loaded.path);
              if (manifest.error) return { errors: [manifest.error] };
              try {
                moduleFormat.commonJs = JSON.parse(manifest.source)?.type !== 'module';
              } catch {
                moduleFormat.commonJs = true;
              }
            }
            if (moduleFormat.commonJs) {
              return { errors: [problem('CODEGEN_COMMONJS_MODULE_UNHASHABLE', `${moduleIdentityLabel(loaded.path, backendDir)} is a CommonJS module${moduleFormat.packageJson ? ` under ${moduleFormat.packageJson}` : ''}; codegen cannot prove its transitive loader graph`, { path: loaded.path })] };
            }
            return {
              contents: loaded.source,
              loader: definitionLoader(loaded.path),
              resolveDir: dirname(loaded.path),
            };
          });
        },
      }],
    });
    const output = result.outputFiles?.[0]?.text;
    if (typeof output !== 'string') throw new Error('esbuild did not return the in-memory definition bundle');
    return { graph, bundle: output, resultKey };
  } catch (error) {
    const failures = Array.isArray(error?.errors) && error.errors.length > 0 ? error.errors : [error];
    for (const failure of failures) {
      const detail = failure?.detail && typeof failure.detail === 'object' ? failure.detail : {};
      const code = detail.snapbackCode
        ?? (failure?.text?.includes('Top-level await') && failure?.location?.lineText?.includes('import(')
          ? 'CODEGEN_DYNAMIC_IMPORT_UNHASHABLE'
          : 'CODEGEN_MODULE_PARSE_FAILED');
      diagnostics.push({
        code,
        severity: 'error',
        subsystem,
        message: failure?.text ?? failure?.message ?? String(failure),
        ...(detail.path ? { path: detail.path } : {}),
        ...(detail.importedFrom ? { importedFrom: detail.importedFrom } : {}),
        ...(detail.specifier ? { specifier: detail.specifier } : {}),
        ...(failure?.location ? {
          path: failure.location.file || detail.path,
          line: failure.location.line,
          column: failure.location.column + 1,
        } : {}),
      });
    }
    return null;
  }
}

function definitionFacadeSource(entryPath, definePath, resultKey, kind) {
  const entry = JSON.stringify(entryPath);
  const define = JSON.stringify(definePath);
  const imports = `import { isConfigDef, isCronDef, isEphemeralCollectionDef, isEphemeralDef, isFunctionDef, isMaintainedProjectionDef, isRoutesDef, isTableDef } from ${define};`;
  const normalization = String.raw`
function __snapbackDefinitionKind(value) {
  if (isFunctionDef(value)) return 'function';
  if (isCronDef(value)) return 'cron';
  if (isConfigDef(value)) return 'config';
  if (isEphemeralCollectionDef(value)) return 'ephemeral-collection';
  if (isRoutesDef(value)) return 'routes';
  if (isMaintainedProjectionDef(value)) return 'maintained-projection';
  return null;
}
function __snapbackKnownMarkerKind(value) {
  const definitionKind = __snapbackDefinitionKind(value);
  if (definitionKind !== null) return definitionKind;
  if (isTableDef(value)) return 'table';
  if (isEphemeralDef(value)) return 'ephemeral';
  return null;
}
function __snapbackOwnDescriptor(value, key) {
  return __snapbackApply(__snapbackObjectGetOwnPropertyDescriptor, null, [value, key]);
}
function __snapbackIsDataDescriptor(descriptor) {
  return __snapbackApply(__snapbackObjectHasOwn, descriptor, ['value']);
}
function __snapbackNormalize(value, stack = new __snapbackSet()) {
  const valueType = typeof value;
  if (value === null || valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    if (!__snapbackNumberIsFinite(value) || __snapbackObjectIs(value, -0)) {
      throw new Error('definition numbers must be finite canonical JSON numbers (negative zero is unavailable)');
    }
    return value;
  }
  if (valueType !== 'object') throw new Error('definition values must be strict JSON data; undefined, functions, symbols, and bigint are unavailable');
  if (__snapbackApply(__snapbackSetHas, stack, [value])) throw new Error('definition values must not contain cycles');
  __snapbackApply(__snapbackSetAdd, stack, [value]);
  let output;
  if (__snapbackArrayIsArray(value)) {
    if (__snapbackApply(__snapbackObjectGetPrototypeOf, null, [value]) !== __snapbackArrayPrototype) {
      throw new Error('definition arrays must use the intrinsic Array prototype');
    }
    const ownKeys = __snapbackApply(__snapbackReflectOwnKeys, null, [value]);
    if (ownKeys.length !== value.length + 1) {
      throw new Error('definition arrays must be dense and must not carry extra or symbol properties');
    }
    output = [];
    __snapbackApply(__snapbackObjectSetPrototypeOf, null, [output, null]);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = __snapbackOwnDescriptor(value, __snapbackString(index));
      if (!descriptor) throw new Error('definition arrays must not contain holes');
      if (!descriptor.enumerable || !__snapbackIsDataDescriptor(descriptor)) {
        throw new Error('definition arrays must contain enumerable data elements, not accessors');
      }
      output[index] = __snapbackNormalize(descriptor.value, stack);
    }
  } else {
    const markerKind = __snapbackKnownMarkerKind(value);
    const prototype = __snapbackApply(__snapbackObjectGetPrototypeOf, null, [value]);
    if (prototype !== null && prototype !== __snapbackObjectPrototype && markerKind !== 'table') {
      throw new Error('definition objects must be plain JSON objects');
    }
    output = __snapbackObjectCreate(null);
    let markerSeen = false;
    const ownKeys = __snapbackApply(__snapbackReflectOwnKeys, null, [value]);
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      const key = ownKeys[keyIndex];
      const descriptor = __snapbackOwnDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !__snapbackIsDataDescriptor(descriptor)) {
        throw new Error('definition objects must contain enumerable data properties, not accessors or hidden state');
      }
      if (typeof key === 'symbol') {
        if (markerKind === null || markerSeen || descriptor.value !== true) {
          throw new Error('definition objects must not contain symbol-keyed data');
        }
        markerSeen = true;
        continue;
      }
      if (markerKind !== null && key === '__snapbackDefinitionKind') {
        throw new Error('definition objects must not define the reserved __snapbackDefinitionKind field');
      }
      output[key] = __snapbackNormalize(descriptor.value, stack);
    }
    if (markerKind !== null && !markerSeen) throw new Error('definition builder marker must be an own data property');
    const definitionKind = __snapbackDefinitionKind(value);
    if (definitionKind !== null) output.__snapbackDefinitionKind = definitionKind;
  }
  __snapbackApply(__snapbackSetDelete, stack, [value]);
  return output;
}
`;
  if (kind === 'schema') {
    return `${imports}\nimport schema from ${entry};\n${normalization}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify(__snapbackNormalize(schema));\n`;
  }
  if (kind === 'routes') {
    // The route manifest declaration (LLP 0092 §0C.1): one default-exported
    // defineRoutes(...) value, normalized under the same isolation rules.
    return `${imports}\nimport routes from ${entry};\n${normalization}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify(__snapbackNormalize(routes));\n`;
  }
  return `${imports}\nimport * as definitions from ${entry};\n${normalization}\nconst output = __snapbackObjectCreate(null);\nconst definitionNames = __snapbackObjectKeys(definitions);\nfor (let nameIndex = 0; nameIndex < definitionNames.length; nameIndex += 1) {\n  const name = definitionNames[nameIndex];\n  if (__snapbackDefinitionKind(definitions[name]) !== null) output[name] = __snapbackNormalize(definitions[name]);\n}\nglobalThis[${JSON.stringify(resultKey)}] = __snapbackJsonStringify(output);\n`;
}

function definitionLoader(path) {
  if (/\.json$/i.test(path)) return 'json';
  if (/\.(?:ts|mts)$/i.test(path)) return 'ts';
  return 'js';
}

function evaluateDefinitionBundles(schemaBuild, functionsBuild, diagnostics, routesBuild = null) {
  if (!process.allowedNodeEnvironmentFlags.has('--permission')) {
    diagnostics.push({
      code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
      severity: 'error',
      subsystem: 'codegen',
      message: 'codegen requires Node 24 or newer for stable filesystem permission isolation',
    });
    return Promise.resolve(null);
  }
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ['--permission', '--input-type=module', '--eval', ISOLATED_DEFINITION_EVALUATOR], {
      cwd: REPO_ROOT,
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const fail = (message, extra = {}) => {
      if (settled) return;
      diagnostics.push({
        code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
        severity: 'error',
        subsystem: 'codegen',
        message,
        ...extra,
      });
      finish(null);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`isolated definition evaluation exceeded ${DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS} ms`);
    }, DEFINITION_EVALUATOR_PROCESS_TIMEOUT_MS);
    child.once('error', (error) => fail(`could not start the isolated definition evaluator: ${error.message}`, { error: error.message }));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > DEFINITION_EVALUATOR_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        fail('isolated definition evaluator output exceeded the 16 MiB protocol limit');
      }
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) <= 1024 * 1024) stderr += chunk;
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        fail(`isolated definition evaluator exited unsuccessfully (code ${code}, signal ${signal})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
        return;
      }
      let response;
      try {
        response = JSON.parse(stdout);
      } catch (error) {
        fail(`isolated definition evaluator returned invalid JSON: ${error.message}`);
        return;
      }
      if (!response?.ok) {
        diagnostics.push({
          code: 'CODEGEN_MODULE_EVALUATION_FAILED',
          severity: 'error',
          subsystem: 'codegen',
          message: response?.error?.message ?? 'isolated definition evaluation failed',
          ...(response?.error?.name ? { errorName: response.error.name } : {}),
        });
        finish(null);
        return;
      }
      if (!response.values || typeof response.values.schema !== 'object' || response.values.schema === null || typeof response.values.functions !== 'object' || response.values.functions === null) {
        fail('isolated definition evaluator returned an invalid result shape');
        return;
      }
      if (routesBuild && (typeof response.values.routes !== 'object' || response.values.routes === null)) {
        fail('isolated definition evaluator returned an invalid routes result shape');
        return;
      }
      finish({
        schema: response.values.schema,
        functions: response.values.functions,
        ...(routesBuild ? { routes: response.values.routes } : {}),
      });
    });
    child.stdin.on('error', (error) => fail(`could not send definition bundles to the isolated evaluator: ${error.message}`));
    child.stdin.end(JSON.stringify({
      items: [
        { label: 'schema', bundle: schemaBuild.bundle, resultKey: schemaBuild.resultKey },
        { label: 'functions', bundle: functionsBuild.bundle, resultKey: functionsBuild.resultKey },
        ...(routesBuild
          ? [{ label: 'routes', bundle: routesBuild.bundle, resultKey: routesBuild.resultKey }]
          : []),
      ],
    }));
  });
}

/// Cross-plan and cross-function validation for maintained projections
/// (LLP 0080 §5/§Acceptance): generation refuses chains/diamonds, duplicate
/// outputs, an unprovable per-source write budget, any function writing an
/// output table, a raw HostPlan read of an owner-visible output without its
/// visibility predicate, and opaque handler access to an output table. The
/// per-plan rules were already proved by defineMaintainedProjection against
/// the installed table builders; activation re-proves everything server-side.
function buildMaintainedProjections(projectionDefs, functions, err) {
  const projections = [];
  const seenIds = new Set();
  const outputs = new Map();
  for (const { exportName, def } of projectionDefs) {
    const plan = def.plan;
    if (seenIds.has(plan.id)) {
      err('PROJECTION_DUPLICATE_ID', 'projection', `${exportName}: duplicate projection id ${plan.id}`, { projection: plan.id });
      continue;
    }
    seenIds.add(plan.id);
    if (outputs.has(plan.outputTable)) {
      err('PROJECTION_OUTPUT_SHARED', 'projection', `${exportName}: output table ${plan.outputTable} already belongs to projection ${outputs.get(plan.outputTable)}`, { projection: plan.id, table: plan.outputTable });
      continue;
    }
    outputs.set(plan.outputTable, plan.id);
    projections.push(plan);
  }
  for (const plan of projections) {
    for (const source of [plan.root, plan.joined]) {
      if (outputs.has(source)) {
        err('PROJECTION_CHAIN_REFUSED', 'projection', `projection ${plan.id} sources ${source}, which is projection ${outputs.get(source)}'s output; chains and diamonds are refused at generation`, { projection: plan.id, table: source });
      }
    }
  }
  // Static per-source write budget: one direct write plus every plan's
  // worst-case output writes from a single-row non-key-moving mutation.
  const budget = new Map();
  for (const plan of projections) {
    budget.set(plan.root, (budget.get(plan.root) ?? 1) + 1);
    budget.set(plan.joined, (budget.get(plan.joined) ?? 1) + plan.fanOutLimit);
  }
  for (const [source, writes] of budget) {
    if (writes > 1_024) {
      err('PROJECTION_WRITE_BUDGET_EXCEEDED', 'projection', `a single-row mutation of ${source} could require ${writes} writes across direct effects and projections; the mutation bound is 1024`, { table: source, writes });
    }
  }
  if (projections.length === 0) return projections;
  const ownerOutputs = new Map(
    projections
      .filter((plan) => plan.outputVisibility !== 'public-read')
      .map((plan) => [plan.outputTable, plan.outputVisibility.owner.field]),
  );
  for (const fn of functions) {
    const hostPlan = fn.runtime?.HostPlan;
    const mutationSteps = hostPlan?.Mutation?.steps ?? [];
    for (const step of mutationSteps) {
      const target = Object.values(step)[0]?.table;
      if (target && outputs.has(target) && !('Get' in step) && !('Guard' in step) && !('Let' in step)) {
        err('PROJECTION_OUTPUT_WRITE_DENIED', 'projection', `${fn.name}: writes projection output table ${target}; outputs are maintained only by their source mutations`, { function: fn.name, table: target });
      }
    }
    const queryPlan = hostPlan?.Query;
    if (queryPlan && ownerOutputs.has(queryPlan.table)) {
      const ownerField = ownerOutputs.get(queryPlan.table);
      const enforced = (queryPlan.filters ?? []).some((filter) => (
        filter.field === ownerField && filter.op === 'Eq' && filter.value === 'AuthUserId'
      ));
      if (!enforced) {
        err('PROJECTION_OUTPUT_READ_UNENFORCED', 'projection', `${fn.name}: reads owner-visible projection output ${queryPlan.table} without composing its visibility predicate`, { function: fn.name, table: queryPlan.table });
      }
    }
    if (fn.runtime?.IbexModule) {
      for (const table of [...(fn.declaredReads ?? []), ...(fn.declaredWrites ?? [])]) {
        if (outputs.has(table)) {
          err('PROJECTION_OUTPUT_OPAQUE_ACCESS', 'projection', `${fn.name}: declares opaque access to projection output ${table}; nothing proves an opaque handler applies the output visibility predicate`, { function: fn.name, table });
        }
      }
    }
  }
  return projections;
}

function isIsolatedDefinition(value, expectedKind) {
  return Boolean(value && typeof value === 'object' && value.__snapbackDefinitionKind === expectedKind);
}

function graphModuleFormat(path) {
  if (/\.(?:cjs|cts)$/i.test(path)) return { commonJs: true, packageJson: null };
  if (!/\.(?:js|ts)$/i.test(path) || /\.(?:mjs|mts)$/i.test(path)) {
    return { commonJs: false, packageJson: null };
  }
  const packageJson = nearestPackageJson(path);
  if (!packageJson) return { commonJs: true, packageJson: null };
  // The caller loads and hashes this manifest through addGraphFile before
  // deciding the format, so classification and identity use the same fd bytes.
  return { commonJs: null, packageJson };
}

function nearestPackageJson(path) {
  let directory = dirname(path);
  for (;;) {
    // Node package scopes never inherit across a node_modules boundary. A
    // manifest-less dependency is therefore CommonJS even when the consuming
    // app has `type: module`; walking through this directory would classify
    // the bytes differently from Node and leave computed CJS loads unhashed.
    if (directory.split(sep).at(-1) === 'node_modules') return null;
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function moduleGraphIdentity(graph, backendDir) {
  return [...graph.values()]
    .map(({ path, bytes }) => [moduleIdentityLabel(path, backendDir), bytes])
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .flatMap(([label, source]) => [label, source]);
}

function moduleIdentityLabel(path, backendDir) {
  let appRoot;
  try {
    appRoot = realpathSync(backendDir);
  } catch {
    appRoot = resolve(backendDir);
  }
  const appRelative = relative(appRoot, path);
  if (isPathInside(appRelative)) return `app:${appRelative.split(sep).join('/')}`;
  const toolchainRelative = relative(packageDir(), path);
  if (isPathInside(toolchainRelative)) {
    return `toolchain:@snapback/codegen/${toolchainRelative.split(sep).join('/')}`;
  }
  const repoRelative = relative(REPO_ROOT, path);
  if (isPathInside(repoRelative)) return `repo:${repoRelative.split(sep).join('/')}`;
  const normalized = path.split(sep).join('/');
  const marker = '/node_modules/';
  const packageIndex = normalized.lastIndexOf(marker);
  if (packageIndex !== -1) return `package:${normalized.slice(packageIndex + marker.length)}`;
  return null;
}

function isPathInside(path) {
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isLocalModuleSpecifier(specifier) {
  return specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('file:')
    || isAbsolute(specifier);
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
  routesManifest,
  providerIntrospection,
  providerBindingMetadata,
  providerBindingTypes,
  contractManifest,
  apiModule,
  apiTypes,
  operationSchemas,
  remoteServicePublication,
  contractModules,
  packageJson,
  artifactIndex,
}) {
  const contractOutDir = join(outDir, 'contract');
  const operationsOutDir = join(outDir, 'operations');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(contractOutDir, { recursive: true });
  mkdirSync(operationsOutDir, { recursive: true });
  writeFileSync(join(outDir, 'schema.manifest.json'), stableJson(schemaManifest) + '\n');
  writeFileSync(join(outDir, 'functions.manifest.json'), stableJson(functionManifest) + '\n');
  writeFileSync(join(outDir, 'capability.manifest.json'), stableJson(capabilityManifest) + '\n');
  if (routesManifest) {
    writeFileSync(join(outDir, 'routes.manifest.json'), stableJson(routesManifest) + '\n');
  }
  writeFileSync(join(outDir, 'provider-introspection.json'), serializeProviderIntrospection(providerIntrospection));
  writeFileSync(join(outDir, 'provider-bindings.json'), serializeProviderBindingMetadata(providerBindingMetadata));
  writeFileSync(join(outDir, 'provider-bindings.d.ts'), providerBindingTypes);
  writeFileSync(join(outDir, 'contract-data.manifest.json'), stableJson(contractManifest) + '\n');
  writeFileSync(join(outDir, 'api.mjs'), apiModule);
  writeFileSync(join(outDir, 'api.d.ts'), apiTypes);
  for (const schema of operationSchemas) {
    writeFileSync(join(operationsOutDir, schema.file), stableJson(schema.value) + '\n');
  }
  for (const artifact of remoteServicePublication?.artifacts ?? []) {
    writeFileSync(join(outDir, artifact.file), stableJson(artifact.value) + '\n');
  }
  for (const module of contractModules) {
    writeFileSync(join(contractOutDir, module.file), module.source);
  }
  writeFileSync(join(outDir, 'package.json'), generatedPackageJson(packageJson) + '\n');
  writeFileSync(join(outDir, 'artifacts.json'), stableJson(artifactIndex) + '\n');
}

// Package export condition order is semantic: catch-all `default` must follow
// `types`, and type-aware tools should see `types` before runtime conditions.
// Keep every other object key recursively sorted for deterministic artifacts.
function generatedPackageJson(value) {
  const ordered = JSON.parse(stableJson(value));
  for (const [subpath, target] of Object.entries(ordered.exports ?? {})) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
    const conditions = {};
    for (const condition of ['types', 'import', 'require', 'default']) {
      if (Object.hasOwn(target, condition)) conditions[condition] = target[condition];
    }
    for (const condition of Object.keys(target)) {
      if (!Object.hasOwn(conditions, condition)) conditions[condition] = target[condition];
    }
    ordered.exports[subpath] = conditions;
  }
  return JSON.stringify(ordered, null, 2);
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

function loadRemoteServiceInputs(backendRoot, appId, targetProfile, err) {
  if (targetProfile !== TARGET_PROFILE_REMOTE) return null;

  const configPath = join(backendRoot, 'remote-service.publication.json');
  let configSource;
  let config;
  try {
    configSource = resolveFileReadCapability(configPath, {
      allowedRoots: [backendRoot],
      allowSymlink: false,
      codePrefix: 'REMOTE_SERVICE_PUBLICATION_CONFIG',
    }).read();
    config = JSON.parse(decodeUtf8Source(configSource, configPath, 'REMOTE_SERVICE_PUBLICATION_CONFIG'));
  } catch (error) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', `remote service publication config is unavailable or invalid: ${error.message}`, { path: configPath });
    return null;
  }

  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const expectedKeys = ['authCapabilityId', 'dataCapabilityId', 'operations', 'profileId', 'targetProfileId'];
  const actualKeys = Object.keys(config).sort();
  if (stableJson(actualKeys) !== stableJson(expectedKeys)) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'remote service publication config is not the closed record', { expectedKeys, actualKeys });
  }
  for (const key of ['profileId', 'targetProfileId', 'authCapabilityId', 'dataCapabilityId']) {
    if (typeof config[key] !== 'string' || !idPattern.test(config[key])) {
      err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', `${key} must be a bounded opaque id`, { field: key });
    }
  }
  if (config.profileId !== targetProfile || config.targetProfileId !== targetProfile) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'remote profile and target ids must match the selected target', {
      profileId: config.profileId,
      targetProfileId: config.targetProfileId,
      selectedTarget: targetProfile,
    });
  }
  if (!Array.isArray(config.operations) || config.operations.length === 0
      || new Set(config.operations).size !== config.operations.length
      || config.operations.some((name) => typeof name !== 'string' || !IDENT.test(name))) {
    err('REMOTE_SERVICE_PUBLICATION_CONFIG_INVALID', 'publication', 'operations must be a non-empty unique list of function identifiers');
  }

  const dataTierProfile = loadRepositoryArtifact('schemas/data-tier.profile.json', err);
  const corpusPath = dataTierProfile?.value?.publication?.corpusManifestPath;
  const corpusManifest = typeof corpusPath === 'string'
    ? loadRepositoryArtifact(corpusPath, err)
    : null;
  if (!corpusManifest) {
    err('REMOTE_SERVICE_DATA_TIER_INVALID', 'publication', 'data-tier profile does not resolve a corpus manifest');
  }
  const wireSchemas = dict();
  for (const [name, path] of Object.entries(REMOTE_SERVICE_WIRE_SCHEMAS)) {
    wireSchemas[name] = loadRepositoryArtifact(path, err);
  }
  if (!dataTierProfile || !corpusManifest || Object.values(wireSchemas).some((entry) => !entry)) {
    return null;
  }
  const identityEntries = [
    ['remote-service.publication.json', configSource],
    [dataTierProfile.path, dataTierProfile.source],
    [corpusManifest.path, corpusManifest.source],
    ...Object.values(wireSchemas).map((entry) => [entry.path, entry.source]),
  ];
  return {
    appId,
    config,
    dataTierProfile,
    corpusManifest,
    wireSchemas,
    identityInputs: identityEntries.flat(),
  };
}

function loadRepositoryArtifact(path, err) {
  const absolutePath = resolve(TOOLCHAIN_ARTIFACT_ROOT, path);
  try {
    const source = resolveFileReadCapability(absolutePath, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'REMOTE_SERVICE_PUBLICATION_INPUT',
    }).read();
    return {
      path,
      source,
      value: JSON.parse(decodeUtf8Source(source, absolutePath, 'REMOTE_SERVICE_PUBLICATION_INPUT')),
      reference: { path, sha256: `sha256:${sha256(source)}` },
    };
  } catch (error) {
    err('REMOTE_SERVICE_PUBLICATION_INPUT_INVALID', 'publication', `published input ${path} is unavailable or invalid: ${error.message}`, { path });
    return null;
  }
}

function packageDir() {
  return dirname(fileURLToPath(import.meta.url));
}

// The server-declared capability manifest for the selected target (LLP 0032
// P2 / LLP 0037): generated from the Rust core by tests/capability_v0.rs
// (SNAPBACK_UPDATE_CAPABILITY_MANIFEST=1 cargo test p2_) and embedded — this
// module asserts nothing about server capabilities on its own.
function canonicalCapabilityManifestPath(targetProfile, targetConfig) {
  const manifest = targetProfile === TARGET_PROFILE_LOCAL && egressAllowedAtCodegen()
    ? 'capability.manifest.local-dev-sqlite-ibex.outbound-actions.json'
    : targetConfig.capabilityManifest;
  return join(TOOLCHAIN_ARTIFACT_ROOT, 'schemas', manifest);
}

function loadCanonicalCapabilityManifest(err, targetProfile, targetConfig) {
  const path = canonicalCapabilityManifestPath(targetProfile, targetConfig);
  let source;
  let sourceBytes;
  try {
    sourceBytes = resolveFileReadCapability(path, {
      allowedRoots: [TOOLCHAIN_ARTIFACT_ROOT],
      allowSymlink: false,
      codePrefix: 'CODEGEN_CAPABILITY_MANIFEST',
    }).read();
    source = decodeUtf8Source(sourceBytes, path, 'CODEGEN_CAPABILITY_MANIFEST');
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
  if (manifest?.artifactKind !== 'capabilityManifest' || manifest?.targetProfileId !== targetProfile) {
    err('CODEGEN_CAPABILITY_MANIFEST_MISMATCH', 'capability', `expected a capabilityManifest for ${targetProfile}`, {
      path,
      artifactKind: manifest?.artifactKind ?? null,
      targetProfileId: manifest?.targetProfileId ?? null,
    });
    return { source: '', manifest: null };
  }
  return { source: sourceBytes, manifest };
}

// --- CLI ---------------------------------------------------------------------

// Exported so the demos/_kit/codegen.mjs compatibility shim can delegate its
// own `node demos/_kit/codegen.mjs <backendDir>` invocation here.
export async function runCodegenCli(argv = process.argv) {
  const args = argv.slice(2);
  const targetFlag = args.indexOf('--target-profile');
  let targetProfile = TARGET_PROFILE_LOCAL;
  if (targetFlag !== -1) {
    targetProfile = args[targetFlag + 1];
    args.splice(targetFlag, 2);
  }
  const backendDir = resolve(args[0] ?? join(packageDir(), '..', '..', 'demos', 'todo', 'snapback'));
  const result = await generate(backendDir, { targetProfile });
  for (const d of result.diagnostics) {
    console.error(`[${d.severity}] ${d.code} (${d.subsystem}) ${d.message}`);
  }
  if (result.ok) {
    console.log(`codegen ok: ${result.outDir}  (inputsHash ${result.inputsHash.slice(0, 12)}…)`);
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
