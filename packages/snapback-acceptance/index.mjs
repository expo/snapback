import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @ref LLP 0275#d9-public-starter-acceptance-runner-author-ruling-2026-08-22
// — platform lifecycle and receipt compatibility live here; app assertions
// remain inside the bounded callbacks supplied by each acceptance source.
// @ref LLP 0010#test-surfaces-and-harness — the default owns one real isolated
// server and does not turn an empty callback into a passing product journey.

export const STARTER_ACCEPTANCE_DEFINITION_VERSION =
  'snapback.starter-acceptance-definition.v1';
export const STARTER_ACCEPTANCE_SCHEMA_VERSION = 'snapback.starter-acceptance.v1';
export const STARTER_LIFECYCLE_ADAPTER_VERSION =
  'snapback.starter-lifecycle-adapter.v1';

const PATH_KINDS = new Set([
  'success',
  'failure',
  'action',
  'relational',
  'search',
  'snapshot-bundle',
]);
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 180_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 20_000;
const MAX_CLEANUP_CALLBACKS = 64;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_STEP_DETAIL_BYTES = 16 * 1024;
const MAX_STEP_DETAIL_ITEMS = 256;
const MAX_STEP_DETAIL_DEPTH = 8;
const MAX_STEP_STRING_CHARS = 4_096;
const PATH_TOKEN = Symbol('snapback.starter-acceptance.path');
const DEFINITION = Symbol('snapback.starter-acceptance.definition');
const STARTER_ACCEPTANCE_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'expectedCheckCount',
  'executedCheckCount',
  'checks',
  'identity',
  'lifecycle',
  'operations',
  'cleanup',
  'diagnostic',
]);

const STARTER_ACCEPTANCE_MAX_INVALID_PATHS = 64;
const STARTER_ACCEPTANCE_MAX_OPERATION_PATHS = 16;
const STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS = 256;
const GENERATION_KEYS = Object.freeze([
  'schemaVersion',
  'appId',
  'schemaHash',
  'bundleHash',
  'inputsHash',
]);
const FUNCTION_REFERENCE_KINDS = new Set(['Query', 'Mutation', 'LiveQuery', 'Action']);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveInteger(value, label) {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function filePath(value, label) {
  if (value instanceof URL) {
    assert.equal(value.protocol, 'file:', `${label} URL must use file:`);
    return fileURLToPath(value);
  }
  assert(typeof value === 'string' && value.length > 0, `${label} must be a path or file URL`);
  if (value.startsWith('file:')) return fileURLToPath(new URL(value));
  return resolve(value);
}

function artifactGeneration(artifacts, label = 'artifacts') {
  assert.equal(artifacts?.artifactKind, 'artifactIndex', `${label}.artifactKind must be artifactIndex`);
  const generation = Object.fromEntries(GENERATION_KEYS.map((generationKey) => {
    const value = artifacts?.[generationKey];
    assert(
      typeof value === 'string' && value.length > 0,
      `${label}.${generationKey} must be a non-empty generated identity`,
    );
    return [generationKey, value];
  }));
  return Object.freeze(generation);
}

function normalizeOperationReference(operation, artifacts, label) {
  assert(plainObject(operation), `${label} must be a generated operation reference object`);
  assert.equal(operation.artifactKind, 'functionReference', `${label}.artifactKind must be functionReference`);
  assert(typeof operation.id === 'string' && operation.id.length > 0, `${label}.id must be non-empty`);
  assert(typeof operation.name === 'string' && operation.name.length > 0, `${label}.name must be non-empty`);
  assert(FUNCTION_REFERENCE_KINDS.has(operation.kind), `${label}.kind must be a generated function kind`);
  assert(
    typeof operation.schemaVersion === 'string' && operation.schemaVersion.length > 0,
    `${label}.schemaVersion must be non-empty`,
  );
  assert.equal(operation.appId, artifacts.appId, `${label}.appId must match artifacts.appId`);
  assert(plainObject(operation.expectedGeneration), `${label}.expectedGeneration must be generated`);
  const expectedGeneration = artifactGeneration(artifacts);
  for (const generationKey of GENERATION_KEYS) {
    assert.equal(
      operation.expectedGeneration[generationKey],
      expectedGeneration[generationKey],
      `${label}.expectedGeneration.${generationKey} must match artifacts.${generationKey}`,
    );
  }
  return operation;
}

function normalizePath(path, key, artifacts) {
  assert(plainObject(path), `paths.${key} must be an object`);
  assert(typeof path.id === 'string' && path.id.length > 0, `paths.${key}.id must be non-empty`);
  assert(PATH_KINDS.has(path.kind), `paths.${key}.kind is unsupported`);
  assert(
    typeof path.targetProfileId === 'string' && path.targetProfileId.length > 0,
    `paths.${key}.targetProfileId must be non-empty`,
  );
  assert(
    Object.hasOwn(path, 'operation'),
    `paths.${key}.operation must explicitly be a generated reference or null`,
  );
  const operation = path.operation;
  if (operation !== null) normalizeOperationReference(operation, artifacts, `paths.${key}.operation`);
  assert(
    path.provenance === undefined || path.provenance === 'baseline' || path.provenance === 'none',
    `paths.${key}.provenance must be baseline or none`,
  );
  const timeoutMs = path.timeoutMs === undefined
    ? null
    : positiveInteger(path.timeoutMs, `paths.${key}.timeoutMs`);
  return Object.freeze({
    [PATH_TOKEN]: true,
    key,
    id: path.id,
    kind: path.kind,
    targetProfileId: path.targetProfileId,
    operation,
    functionId: operation?.id ?? null,
    provenance: path.provenance ?? 'none',
    timeoutMs,
  });
}

export function defineStarterAcceptance(options) {
  assert(plainObject(options), 'starter acceptance definition must be an object');
  const acceptanceFile = filePath(options.acceptanceFile, 'acceptanceFile');
  const appRoot = options.appRoot === undefined
    ? dirname(acceptanceFile)
    : filePath(options.appRoot, 'appRoot');
  assert(plainObject(options.artifacts), 'artifacts must be a generated artifact index');
  const generatedArtifacts = Object.freeze({
    artifactKind: 'artifactIndex',
    ...artifactGeneration(options.artifacts),
  });
  assert(typeof options.journey === 'function', 'journey must be a bounded callback');
  assert(
    options.preflight === undefined || typeof options.preflight === 'function',
    'preflight must be a bounded callback when present',
  );
  const paths = Object.fromEntries(Object.entries(options.paths ?? {}).map(([key, path]) => [
    key,
    normalizePath(path, key, generatedArtifacts),
  ]));
  assert(
    new Set(Object.values(paths).map(({ id }) => id)).size === Object.keys(paths).length,
    'starter acceptance path ids must be unique',
  );
  assert(
    Object.values(paths).some(({ functionId }) => functionId !== null),
    'starter acceptance must bind at least one path to a generated operation reference',
  );
  const overallTimeoutMs = options.overallTimeoutMs === undefined
    ? DEFAULT_OVERALL_TIMEOUT_MS
    : positiveInteger(options.overallTimeoutMs, 'overallTimeoutMs');
  const cleanupTimeoutMs = options.cleanupTimeoutMs === undefined
    ? DEFAULT_CLEANUP_TIMEOUT_MS
    : positiveInteger(options.cleanupTimeoutMs, 'cleanupTimeoutMs');
  assert(
    cleanupTimeoutMs < overallTimeoutMs,
    'cleanupTimeoutMs must be smaller than overallTimeoutMs',
  );
  return Object.freeze({
    [DEFINITION]: true,
    schemaVersion: STARTER_ACCEPTANCE_DEFINITION_VERSION,
    acceptanceFile,
    appRoot,
    artifacts: generatedArtifacts,
    paths: Object.freeze(paths),
    stepTimeoutMs: options.stepTimeoutMs === undefined
      ? DEFAULT_STEP_TIMEOUT_MS
      : positiveInteger(options.stepTimeoutMs, 'stepTimeoutMs'),
    readinessTimeoutMs: options.readinessTimeoutMs === undefined
      ? DEFAULT_READINESS_TIMEOUT_MS
      : positiveInteger(options.readinessTimeoutMs, 'readinessTimeoutMs'),
    overallTimeoutMs,
    cleanupTimeoutMs,
    preflight: options.preflight ?? null,
    journey: options.journey,
  });
}

function assertDefinition(definition) {
  assert(
    definition?.[DEFINITION] === true
      && definition.schemaVersion === STARTER_ACCEPTANCE_DEFINITION_VERSION,
    'expected a defineStarterAcceptance() result',
  );
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-MAX_CHILD_OUTPUT_BYTES);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function signalError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return codedError(
    'SNAPBACK_STARTER_ACCEPTANCE_INTERRUPTED',
    `starter acceptance interrupted${signal?.reason ? `: ${signal.reason}` : ''}`,
  );
}

function waitForExit(child, timeoutMs, signal = null) {
  return new Promise((resolveExit) => {
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      resolveExit(true);
      return;
    }
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', closed);
      signal?.removeEventListener('abort', aborted);
      resolveExit(exited);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    const closed = () => finish(true);
    const aborted = () => finish(false);
    child.once('close', closed);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

// @ref LLP 0224#phases — the managed adapter waits on the server-owned
// application-readiness projection, and the first authority-bearing app call
// happens after that wait with no runner retry.
export function createManagedDevLifecycleAdapter() {
  let child = null;
  let stdout = '';
  let stderr = '';
  let stdoutRemainder = '';
  let spawnError = null;
  const lifecycleEvents = [];
  return Object.freeze({
    schemaVersion: STARTER_LIFECYCLE_ADAPTER_VERSION,
    async start({ appRoot, stateRoot, readinessTimeoutMs, environment, signal }) {
      assert.equal(child, null, 'managed lifecycle adapters are single-use');
      if (signal?.aborted) throw signalError(signal);
      const readyFile = join(stateRoot, 'dev.ready.json');
      const database = join(stateRoot, 'dev.sqlite3');
      const executable = join(
        appRoot,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'snapback.cmd' : 'snapback',
      );
      child = spawn(executable, [
        'dev', 'snapback', '--db', database, '--ready-file', readyFile,
      ], {
        cwd: appRoot,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdout = appendBounded(stdout, chunk);
        stdoutRemainder = `${stdoutRemainder}${text}`.slice(-MAX_CHILD_OUTPUT_BYTES);
        for (;;) {
          const newline = stdoutRemainder.indexOf('\n');
          if (newline === -1) break;
          const line = stdoutRemainder.slice(0, newline).trim();
          stdoutRemainder = stdoutRemainder.slice(newline + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
          } catch {
            // Non-event output remains only in the bounded unsafe diagnostic.
          }
        }
      });
      child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
      child.once('error', (error) => { spawnError = error; });

      const waiter = spawn(executable, [
        'wait', '--ready-file', readyFile,
        '--level', 'application', '--timeout-ms', String(readinessTimeoutMs),
      ], {
        cwd: appRoot,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let waitStdout = '';
      let waitStderr = '';
      waiter.stdout.on('data', (chunk) => { waitStdout = appendBounded(waitStdout, chunk); });
      waiter.stderr.on('data', (chunk) => { waitStderr = appendBounded(waitStderr, chunk); });
      const abortStartedChildren = () => {
        if (waiter.exitCode === null && waiter.signalCode === null) waiter.kill('SIGKILL');
        if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      };
      signal?.addEventListener('abort', abortStartedChildren, { once: true });
      let exit;
      try {
        exit = await new Promise((resolveExit, reject) => {
          waiter.once('error', reject);
          waiter.once('close', (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
        });
      } finally {
        signal?.removeEventListener('abort', abortStartedChildren);
      }
      if (signal?.aborted) throw signalError(signal);
      let envelope = null;
      try { envelope = JSON.parse(waitStdout); } catch {}
      if (exit.code !== 0 || envelope?.ok !== true) {
        throw new Error(
          `application readiness wait failed (${exit.code ?? exit.signal}): `
            + `${JSON.stringify(envelope?.diagnostics ?? waitStdout.trim())}`
            + `${waitStderr ? `\n${waitStderr}` : ''}`,
        );
      }
      if (spawnError) throw spawnError;
      const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
      assert.equal(ready.ready, true, 'managed lifecycle ready descriptor is not ready');
      const adminToken = typeof ready.adminTokenFile === 'string'
        ? readFileSync(ready.adminTokenFile, 'utf8').trim()
        : null;
      return Object.freeze({
        ready,
        readyFile,
        executable,
        adminToken,
        lifecycleEvents: Object.freeze([...lifecycleEvents]),
        lifecycleEvidence: Object.freeze({
          owned: true,
          waitLevel: 'application',
          firstQueryRetries: 0,
        }),
        health() {
          const running = child !== null
            && child.exitCode === null
            && child.signalCode === null
            && spawnError === null;
          return Object.freeze({
            running,
            diagnostic: running
              ? null
              : `managed dev exited ${child?.exitCode ?? child?.signalCode ?? spawnError?.message ?? 'before readiness'}`
                + `\n${stdout}\n${stderr}`,
          });
        },
      });
    },
    async stop(_state, { signal = null } = {}) {
      if (child === null) return Object.freeze({ exited: true });
      const killImmediately = () => {
        if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      };
      signal?.addEventListener('abort', killImmediately, { once: true });
      try {
        if (signal?.aborted) killImmediately();
        else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        if (!(await waitForExit(child, 10_000, signal))) killImmediately();
        return Object.freeze({ exited: await waitForExit(child, 5_000, signal) });
      } finally {
        signal?.removeEventListener('abort', killImmediately);
      }
    },
  });
}

function abortError(signal) {
  return signalError(signal);
}

function withTimeout(operation, timeoutMs, code, message, parentSignal = null) {
  assert(typeof operation === 'function', 'withTimeout requires a cancellable operation');
  positiveInteger(timeoutMs, 'withTimeout timeoutMs');
  if (parentSignal?.aborted) return Promise.reject(abortError(parentSignal));
  const controller = new AbortController();
  const timeoutError = codedError(code, message);
  const relayAbort = () => controller.abort(abortError(parentSignal));
  parentSignal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(signalError(controller.signal)), {
      once: true,
    });
  });
  const running = Promise.resolve().then(() => operation(controller.signal));
  return Promise.race([running, aborted]).finally(() => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relayAbort);
  });
}

function abortableDelay(timeoutMs, signal) {
  return new Promise((resolveDelay, reject) => {
    if (signal?.aborted) {
      reject(signalError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolveDelay();
    }, timeoutMs);
    const aborted = () => {
      clearTimeout(timer);
      reject(signalError(signal));
    };
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function jsonSafeDetail(value, state = { items: 0 }, depth = 0) {
  if (depth > MAX_STEP_DETAIL_DEPTH) throw new TypeError('step detail exceeds maximum depth');
  state.items += 1;
  if (state.items > MAX_STEP_DETAIL_ITEMS) throw new TypeError('step detail exceeds item limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STEP_STRING_CHARS) throw new TypeError('step detail string is too long');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => jsonSafeDetail(entry, state, depth + 1));
  if (plainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (key.length > 256) throw new TypeError('step detail key is too long');
      return [key, jsonSafeDetail(entry, state, depth + 1)];
    }));
  }
  throw new TypeError('step detail must be bounded JSON-safe data');
}

function normalizeStepDetail(value) {
  const normalized = value === undefined ? null : jsonSafeDetail(value);
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_STEP_DETAIL_BYTES) {
    throw new TypeError('step detail exceeds byte limit');
  }
  return normalized;
}

function normalizeFailure(error, fallbackCode = 'SNAPBACK_STARTER_ACCEPTANCE_FAILED') {
  const candidate = error?.diagnostic?.code ?? error?.code;
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,255}$/u.test(candidate)
    ? candidate
    : fallbackCode;
  return Object.freeze({
    code,
    message: String(error?.message ?? error).slice(0, 4_096),
  });
}

function bindSupervisedApp(app, ready, offeredCapabilities = [], supervisorGeneration = null) {
  assert(plainObject(app?.identity), 'bindingFor requires a generated app descriptor');
  const now = Date.now();
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: ready.serverUrl,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([
        ...(app.capabilities?.required ?? []),
        ...offeredCapabilities,
      ])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: supervisorGeneration
        ?? `starter-acceptance-${process.pid}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

async function inspectClient(client, signal) {
  if (signal?.aborted) throw signalError(signal);
  const abortInspection = () => {
    try {
      Promise.resolve(client.dispose?.()).catch(() => {});
    } catch {}
  };
  signal?.addEventListener('abort', abortInspection, { once: true });
  try {
    return await client.inspect({ signal });
  } finally {
    signal?.removeEventListener('abort', abortInspection);
  }
}

async function defaultLoadedIdentity(lifecycleState, signal) {
  if (lifecycleState.loadedIdentity !== undefined && lifecycleState.loadedIdentity !== null) {
    return { loadedIdentity: lifecycleState.loadedIdentity, adminClient: lifecycleState.adminClient ?? null };
  }
  if (lifecycleState.adminClient !== undefined && lifecycleState.adminClient !== null) {
    const inspected = await inspectClient(lifecycleState.adminClient, signal);
    return {
      loadedIdentity: {
        appId: inspected.functions?.appId,
        bundleHash: inspected.functions?.bundleHash,
      },
      adminClient: lifecycleState.adminClient,
    };
  }
  const { SnapbackClient } = await import('@expo/snapback-client');
  const adminClient = new SnapbackClient(lifecycleState.ready.serverUrl, {
    adminToken: lifecycleState.adminToken,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    custody: 'anonymous-public',
    rqsStore: null,
    offlineQueue: false,
  });
  const inspected = await inspectClient(adminClient, signal);
  return {
    loadedIdentity: {
      appId: inspected.functions?.appId,
      bundleHash: inspected.functions?.bundleHash,
    },
    adminClient,
  };
}

async function spawnSessionMint(lifecycleState, appRoot, environment, email, signal, timeoutMs) {
  assert(
    typeof lifecycleState.executable === 'string'
      && typeof lifecycleState.readyFile === 'string'
      && typeof lifecycleState.adminToken === 'string',
    'selected lifecycle does not support ordinary-session minting',
  );
  return withTimeout(async (mintSignal) => {
    const mint = spawn(lifecycleState.executable, [
      'session', 'mint', '--email', email, '--ready-file', lifecycleState.readyFile,
    ], {
      cwd: appRoot,
      env: { ...environment, SNAPBACK_ADMIN_TOKEN: lifecycleState.adminToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    mint.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    mint.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    const killMint = () => {
      if (mint.exitCode === null && mint.signalCode === null) mint.kill('SIGKILL');
    };
    mintSignal.addEventListener('abort', killMint, { once: true });
    let exit;
    try {
      exit = await new Promise((resolveExit, reject) => {
        mint.once('error', reject);
        mint.once('close', (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
      });
    } finally {
      mintSignal.removeEventListener('abort', killMint);
    }
    if (mintSignal.aborted) throw signalError(mintSignal);
    if (exit.code !== 0) {
      throw new Error(`ordinary session mint failed (${exit.code ?? exit.signal}): ${stderr}`);
    }
    const envelope = JSON.parse(stdout);
    assert.equal(envelope?.ok, true, 'ordinary session mint returned a failed envelope');
    assert.equal(envelope?.operation, 'auth.mintSession');
    assert.equal(envelope?.data?.tokenType, 'Bearer');
    assert(typeof envelope?.data?.token === 'string' && envelope.data.token.length > 0);
    return Object.freeze({ token: envelope.data.token });
  }, timeoutMs, 'SNAPBACK_STARTER_ACCEPTANCE_SESSION_MINT_TIMEOUT',
  `ordinary session mint exceeded ${timeoutMs}ms`, signal);
}

function normalizeLifecycleEvidence(value) {
  if (value === undefined || value === null) return Object.freeze({});
  assert(plainObject(value), 'lifecycleEvidence must be an object when supplied');
  const allowed = new Set(['owned', 'waitLevel', 'firstQueryRetries']);
  assert(
    Object.keys(value).every((key) => allowed.has(key)),
    'lifecycleEvidence contains an unsupported receipt claim',
  );
  if (Object.hasOwn(value, 'owned')) {
    assert(typeof value.owned === 'boolean', 'lifecycleEvidence.owned must be boolean');
  }
  if (Object.hasOwn(value, 'waitLevel')) {
    assert(
      typeof value.waitLevel === 'string' && value.waitLevel.length > 0,
      'lifecycleEvidence.waitLevel must be non-empty',
    );
  }
  if (Object.hasOwn(value, 'firstQueryRetries')) {
    assert(
      Number.isSafeInteger(value.firstQueryRetries) && value.firstQueryRetries >= 0,
      'lifecycleEvidence.firstQueryRetries must be a non-negative integer',
    );
  }
  return Object.freeze({ ...value });
}

export function projectStarterAcceptanceReceipt(outcome) {
  assert(plainObject(outcome), 'starter receipt outcome must be an object');
  const artifact = outcome.artifacts;
  const loadedIdentity = outcome.loadedIdentity;
  return Object.freeze({
    schemaVersion: STARTER_ACCEPTANCE_SCHEMA_VERSION,
    status: outcome.passed ? 'passed' : 'failed',
    expectedCheckCount: outcome.declaredPathCount,
    executedCheckCount: outcome.checks.length,
    checks: Object.freeze([...outcome.checks]),
    identity: Object.freeze({
      artifact: Object.freeze({
        appId: artifact.appId,
        ...(typeof artifact.inputsHash === 'string' ? { inputsHash: artifact.inputsHash } : {}),
        ...(typeof artifact.schemaHash === 'string' ? { schemaHash: artifact.schemaHash } : {}),
        ...(typeof artifact.bundleHash === 'string' ? { bundleHash: artifact.bundleHash } : {}),
      }),
      loaded: loadedIdentity,
    }),
    lifecycle: Object.freeze({
      applicationReadyObserved: outcome.applicationReadyObserved,
      ...normalizeLifecycleEvidence(outcome.lifecycleEvidence),
    }),
    operations: Object.freeze({ ...outcome.operations }),
    cleanup: Object.freeze({ ...outcome.cleanup }),
    diagnostic: outcome.failure,
  });
}

export async function runStarterAcceptance(definition, options = {}) {
  assertDefinition(definition);
  const lifecycle = options.lifecycle ?? createManagedDevLifecycleAdapter();
  assert.equal(
    lifecycle?.schemaVersion,
    STARTER_LIFECYCLE_ADAPTER_VERSION,
    `lifecycle.schemaVersion must be ${STARTER_LIFECYCLE_ADAPTER_VERSION}`,
  );
  assert(typeof lifecycle.start === 'function' && typeof lifecycle.stop === 'function');
  const environment = { ...process.env, ...(options.environment ?? {}) };
  const externalSignal = options.signal ?? null;
  const startedAt = Date.now();
  const overallDeadline = startedAt + definition.overallTimeoutMs;
  const executionDeadline = overallDeadline - definition.cleanupTimeoutMs;
  const executionController = new AbortController();
  const overallTimeoutError = codedError(
    'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
    `starter acceptance exceeded its ${definition.overallTimeoutMs}ms overall deadline`,
  );
  const interruptExecution = () => executionController.abort(abortError(externalSignal));
  externalSignal?.addEventListener('abort', interruptExecution, { once: true });
  if (externalSignal?.aborted) interruptExecution();
  const executionTimer = setTimeout(
    () => executionController.abort(overallTimeoutError),
    Math.max(1, executionDeadline - Date.now()),
  );
  const signal = executionController.signal;
  const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-starter-acceptance-'));
  const checks = [];
  const operations = {};
  const seenSteps = new Set();
  const passedSteps = new Set();
  const cleanupStack = [];
  const sessionClients = [];
  let lifecycleState = null;
  let adminClient = null;
  let loadedIdentity = null;
  let applicationReadyObserved = false;
  let failure = null;
  let activePhaseSignal = null;
  let activeStepSignal = null;
  const cleanup = {
    attempted: false,
    clientResourcesReleased: false,
    devExited: false,
    temporaryStateRemoved: false,
    ok: false,
  };

  const remaining = (deadline) => Math.max(1, deadline - Date.now());
  const health = (healthSignal = signal) => {
    if (healthSignal?.aborted) throw abortError(healthSignal);
    if (typeof lifecycleState?.health === 'function') {
      const state = lifecycleState.health();
      if (state?.running === false) throw new Error(state.diagnostic ?? 'managed lifecycle exited');
    }
  };
  const until = async (predicate, label, untilOptions = {}) => {
    const timeoutMs = untilOptions.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const intervalMs = untilOptions.intervalMs ?? 25;
    positiveInteger(timeoutMs, 'until timeoutMs');
    positiveInteger(intervalMs, 'until intervalMs');
    assert(typeof predicate === 'function', 'until predicate must be a function');
    assert(typeof label === 'string' && label.length > 0, 'until label must be non-empty');
    const executionSignal = activeStepSignal ?? activePhaseSignal ?? signal;
    const parentSignal = untilOptions.signal == null
      ? executionSignal
      : AbortSignal.any([untilOptions.signal, executionSignal]);
    return withTimeout(async (untilSignal) => {
      for (;;) {
        health(untilSignal);
        const value = await predicate(untilSignal);
        if (value) return value;
        await abortableDelay(intervalMs, untilSignal);
      }
    }, timeoutMs, 'SNAPBACK_STARTER_ACCEPTANCE_RETRY_TIMEOUT',
    `${label}: timed out after ${timeoutMs}ms`, parentSignal);
  };
  const step = async (pathToken, callback, stepOptions = {}) => {
    const path = pathToken?.[PATH_TOKEN] === true
      && Object.values(definition.paths).includes(pathToken)
      ? pathToken
      : null;
    assert(path !== null, 'step accepts only a path token issued by this acceptance definition');
    const id = path.id;
    assert(typeof callback === 'function', `step ${id} callback must be a function`);
    assert.equal(seenSteps.has(id), false, `step ${id} was executed more than once`);
    seenSteps.add(id);
    const timeoutMs = stepOptions.timeoutMs ?? path.timeoutMs ?? definition.stepTimeoutMs;
    positiveInteger(timeoutMs, `step ${id} timeoutMs`);
    let result;
    try {
      result = await withTimeout(
        async (stepSignal) => {
          activeStepSignal = stepSignal;
          try {
            return await callback(stepSignal);
          } finally {
            if (activeStepSignal === stepSignal) activeStepSignal = null;
          }
        },
        timeoutMs,
        'SNAPBACK_STARTER_ACCEPTANCE_STEP_TIMEOUT',
        `starter acceptance step ${id} exceeded ${timeoutMs}ms`,
        activePhaseSignal ?? signal,
      );
    } finally {
      activeStepSignal = null;
    }
    let details;
    try {
      details = normalizeStepDetail(result);
    } catch (error) {
      if (error instanceof TypeError && error.code === undefined) {
        error.code = 'SNAPBACK_STARTER_ACCEPTANCE_STEP_RESULT_INVALID';
      }
      throw error;
    }
    checks.push(Object.freeze({ id, status: 'passed', details }));
    passedSteps.add(id);
    if (path?.functionId !== null && path?.functionId !== undefined) {
      operations[path.id] = path.functionId;
    }
    return details;
  };
  const defer = (callback) => {
    assert(typeof callback === 'function', 'defer requires a cleanup callback');
    assert(cleanupStack.length < MAX_CLEANUP_CALLBACKS, 'too many deferred cleanup callbacks');
    cleanupStack.push(callback);
  };
  const mintSession = async ({ email }) => {
    assert(typeof email === 'string' && email.length > 0, 'session email must be non-empty');
    assert(lifecycleState !== null, 'session minting requires a started lifecycle');
    return spawnSessionMint(
      lifecycleState,
      definition.appRoot,
      environment,
      email,
      activeStepSignal ?? activePhaseSignal ?? signal,
      definition.stepTimeoutMs,
    );
  };
  const createSessionClient = async ({ email, clientOptions = {} }) => {
    const { token } = await mintSession({ email });
    const { createExternalSessionClient } = await import('@expo/snapback-client');
    const client = createExternalSessionClient(lifecycleState.ready.serverUrl, {
      bearerToken: token,
      authInvalidationProtocol: 1,
      rqsStore: null,
      offlineQueue: false,
      ...clientOptions,
    });
    sessionClients.push(client);
    return client;
  };
  const context = Object.freeze({
    appRoot: definition.appRoot,
    stateRoot,
    get signal() { return activeStepSignal ?? activePhaseSignal ?? signal; },
    get ready() { return lifecycleState?.ready ?? null; },
    get adminClient() { return adminClient; },
    paths: definition.paths,
    artifacts: definition.artifacts,
    bindingFor(app, bindingOptions = {}) {
      assert(lifecycleState?.ready, 'bindingFor requires a started lifecycle');
      return bindSupervisedApp(
        app,
        lifecycleState.ready,
        bindingOptions.offeredCapabilities ?? [],
        bindingOptions.supervisorGeneration ?? null,
      );
    },
    step,
    until,
    defer,
    mintSession,
    createSessionClient,
  });

  try {
    if (definition.preflight !== null) {
      await withTimeout(
        async (preflightSignal) => {
          activePhaseSignal = preflightSignal;
          try {
            await definition.preflight(context, preflightSignal);
          } finally {
            if (activePhaseSignal === preflightSignal) activePhaseSignal = null;
          }
        },
        Math.min(definition.stepTimeoutMs * 4, remaining(executionDeadline)),
        'SNAPBACK_STARTER_ACCEPTANCE_PREFLIGHT_TIMEOUT',
        'starter acceptance preflight timed out',
        signal,
      );
    }
    lifecycleState = await withTimeout(
      (startSignal) => lifecycle.start(Object.freeze({
        appRoot: definition.appRoot,
        stateRoot,
        readinessTimeoutMs: definition.readinessTimeoutMs,
        environment,
        signal: startSignal,
      })),
      Math.min(definition.readinessTimeoutMs + 10_000, remaining(executionDeadline)),
      'SNAPBACK_STARTER_ACCEPTANCE_LIFECYCLE_START_TIMEOUT',
      'starter acceptance lifecycle start timed out',
      signal,
    );
    assert.equal(lifecycleState?.ready?.ready, true, 'lifecycle did not return a ready application');
    applicationReadyObserved = true;
    ({ loadedIdentity, adminClient } = await withTimeout(
      (inspectionSignal) => defaultLoadedIdentity(lifecycleState, inspectionSignal),
      Math.min(definition.stepTimeoutMs, remaining(executionDeadline)),
      'SNAPBACK_STARTER_ACCEPTANCE_CLIENT_INSPECTION_TIMEOUT',
      'starter acceptance loaded-identity inspection timed out',
      signal,
    ));
    assert.equal(loadedIdentity?.appId, definition.artifacts.appId, 'loaded app id differs from generated artifacts');
    if (typeof definition.artifacts.bundleHash === 'string') {
      assert.equal(
        loadedIdentity?.bundleHash,
        definition.artifacts.bundleHash,
        'loaded bundle hash differs from generated artifacts',
      );
    }
    await withTimeout(
      async (journeySignal) => {
        activePhaseSignal = journeySignal;
        try {
          await definition.journey(context, journeySignal);
        } finally {
          if (activePhaseSignal === journeySignal) activePhaseSignal = null;
        }
      },
      remaining(executionDeadline),
      'SNAPBACK_STARTER_ACCEPTANCE_OVERALL_TIMEOUT',
      `starter acceptance exceeded its ${definition.overallTimeoutMs}ms overall deadline`,
      signal,
    );
    const missingPathIds = Object.values(definition.paths)
      .filter(({ id }) => !passedSteps.has(id))
      .map(({ id }) => id);
    if (missingPathIds.length > 0) {
      const error = codedError(
        'SNAPBACK_STARTER_ACCEPTANCE_PATH_NOT_OBSERVED',
        `starter acceptance did not produce passed checks for declared paths: ${missingPathIds.join(', ')}`,
      );
      throw error;
    }
  } catch (error) {
    failure = normalizeFailure(error);
  } finally {
    clearTimeout(executionTimer);
    cleanup.attempted = true;
    // External cancellation ends execution, but cleanup owns the reserved
    // remainder through a fresh deadline so lifecycle.stop can terminate
    // managed children even when the run signal is already aborted.
    const cleanupController = new AbortController();
    const cleanupDeadline = Math.min(overallDeadline, Date.now() + definition.cleanupTimeoutMs);
    const cleanupTimer = setTimeout(
      () => cleanupController.abort(overallTimeoutError),
      remaining(cleanupDeadline),
    );
    const cleanupSignal = cleanupController.signal;
    let resourceCleanupOk = true;
    for (const callback of [...cleanupStack].reverse()) {
      try {
        await withTimeout(
          (callbackSignal) => callback(callbackSignal),
          Math.min(10_000, remaining(cleanupDeadline)),
          'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_TIMEOUT',
          'starter acceptance resource cleanup timed out',
          cleanupSignal,
        );
      } catch (error) {
        resourceCleanupOk = false;
        failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
      }
    }
    for (const client of [adminClient, ...sessionClients]) {
      if (client === null || client === undefined || typeof client.inspect !== 'function') continue;
      try {
        const inspected = await withTimeout(
          (inspectionSignal) => inspectClient(client, inspectionSignal),
          Math.min(10_000, remaining(cleanupDeadline)),
          'SNAPBACK_STARTER_ACCEPTANCE_CLIENT_INSPECTION_TIMEOUT',
          'starter acceptance cleanup inspection timed out',
          cleanupSignal,
        );
        assert.equal(inspected.subscriptions?.length ?? 0, 0, 'client subscriptions remained after cleanup');
      } catch (error) {
        resourceCleanupOk = false;
        failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
      }
    }
    cleanup.clientResourcesReleased = resourceCleanupOk;
    try {
      // Stop owns an independent last-chance controller. If callbacks or
      // inspection spend the shared cleanup reserve, remaining() gives this
      // call a bounded terminal slice whose abort drives managed children
      // through their immediate-kill path instead of skipping stop entirely.
      const stopped = await withTimeout(
        (stopSignal) => lifecycle.stop(lifecycleState, Object.freeze({ signal: stopSignal })),
        Math.min(15_000, remaining(cleanupDeadline)),
        'SNAPBACK_STARTER_ACCEPTANCE_LIFECYCLE_STOP_TIMEOUT',
        'starter acceptance lifecycle stop timed out',
      );
      cleanup.devExited = stopped?.exited === true;
      if (!cleanup.devExited) {
        failure ??= Object.freeze({
          code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
          message: 'managed lifecycle did not exit during bounded cleanup',
        });
      }
    } catch (error) {
      cleanup.devExited = false;
      failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
    }
    try {
      rmSync(stateRoot, { recursive: true, force: true });
      cleanup.temporaryStateRemoved = !existsSync(stateRoot);
    } catch (error) {
      failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
    }
    cleanup.ok = cleanup.clientResourcesReleased
      && cleanup.devExited
      && cleanup.temporaryStateRemoved
      && failure === null;
    clearTimeout(cleanupTimer);
  }
  externalSignal?.removeEventListener('abort', interruptExecution);

  const passed = failure === null
    && passedSteps.size === Object.keys(definition.paths).length
    && applicationReadyObserved
    && loadedIdentity !== null
    && cleanup.ok;
  const receipt = projectStarterAcceptanceReceipt({
    passed,
    checks,
    operations,
    declaredPathCount: Object.keys(definition.paths).length,
    artifacts: definition.artifacts,
    loadedIdentity,
    applicationReadyObserved,
    lifecycleEvidence: lifecycleState?.lifecycleEvidence ?? null,
    cleanup,
    failure,
  });
  if (options.emit === true) process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return Object.freeze({ receipt, exitCode: passed ? 0 : 1 });
}

function isMainModule(meta) {
  const url = typeof meta === 'string' ? meta : meta?.url;
  if (typeof url !== 'string' || typeof process.argv[1] !== 'string') return false;
  return url === pathToFileURL(resolve(process.argv[1])).href;
}

export async function runStarterAcceptanceIfMain(meta, definition, options = {}) {
  if (!isMainModule(meta)) return null;
  const controller = new AbortController();
  let interrupted = null;
  const onSignal = (signal) => {
    interrupted ??= signal;
    controller.abort(signal);
  };
  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);
  try {
    const result = await runStarterAcceptance(definition, {
      ...options,
      emit: options.emit ?? true,
      signal: controller.signal,
    });
    process.exitCode = result.exitCode;
    return result.receipt;
  } finally {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
    if (interrupted !== null) process.exitCode = 1;
  }
}

export function starterVerifyProfileOptions(definition, options) {
  assertDefinition(definition);
  assert(plainObject(options), 'starter verify profile options must be an object');
  assert(typeof options.id === 'string' && options.id.length > 0, 'profile id must be non-empty');
  const paths = Object.values(definition.paths).map((path) => Object.freeze({
    id: path.id,
    kind: path.kind,
    targetProfileId: path.targetProfileId,
    functionId: path.functionId,
  }));
  return Object.freeze({
    id: options.id,
    title: options.title ?? options.id,
    acceptanceFile: definition.acceptanceFile,
    additionalTestFiles: Object.freeze([
      ...(options.additionalTestFiles ?? []),
      new URL(import.meta.url),
    ]),
    requiredCapabilities: Object.freeze([...(options.requiredCapabilities ?? [])]),
    paths: Object.freeze(paths),
    provenanceBaseline: Object.freeze(Object.values(definition.paths)
      .filter(({ provenance }) => provenance === 'baseline')
      .map(({ id }) => id)),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

export function starterConformanceProjection(paths) {
  return Object.freeze(paths.map(({ id }) => Object.freeze({
    pathId: id,
    status: 'observed',
    report: Object.freeze({
      missingReads: Object.freeze([]),
      missingWrites: Object.freeze([]),
      extraReads: Object.freeze([]),
      extraWrites: Object.freeze([]),
      readProvenance: 'unsupported',
      writeProvenance: 'unsupported',
    }),
  })));
}

function receiptValueKind(value, present = true) {
  if (!present) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function receiptLeaf(parent, key) {
  const present = plainObject(parent) && Object.hasOwn(parent, key);
  return { present, value: present ? parent[key] : undefined };
}

function invalidReceiptPath(path, expectedKind, expectedState, value, present, observedState) {
  return Object.freeze({
    path,
    expected: Object.freeze({ kind: expectedKind, state: expectedState }),
    observed: Object.freeze({
      kind: receiptValueKind(value, present),
      state: present ? observedState : 'missing',
    }),
  });
}

export function parseStarterAcceptanceReceipt(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return Object.freeze({ kind: 'missing-receipt', receipt: null, invalidPaths: Object.freeze([
      invalidReceiptPath('$', 'object', 'starter-acceptance-receipt-present', undefined, false, 'missing'),
    ]) });
  }
  const lines = trimmed.split('\n');
  let lastJson;
  let sawJson = false;
  let lastLineLooksLikeJson = false;
  for (const [reverseIndex, line] of [...lines].reverse().entries()) {
    const candidateLine = line.trim();
    if (reverseIndex === 0) {
      lastLineLooksLikeJson = candidateLine.startsWith('{') || candidateLine.startsWith('[');
    }
    try {
      const candidate = JSON.parse(candidateLine);
      if (!sawJson) {
        lastJson = candidate;
        sawJson = true;
      }
      if (candidate?.schemaVersion === STARTER_ACCEPTANCE_SCHEMA_VERSION) {
        return Object.freeze({ kind: 'receipt', receipt: candidate, invalidPaths: Object.freeze([]) });
      }
    } catch {
      // Human output is never structured receipt evidence.
    }
  }
  if (sawJson) {
    const schemaVersion = receiptLeaf(lastJson, 'schemaVersion');
    return Object.freeze({
      kind: 'malformed-receipt',
      receipt: null,
      invalidPaths: Object.freeze([
        plainObject(lastJson)
          ? invalidReceiptPath(
            '$.schemaVersion',
            'string',
            STARTER_ACCEPTANCE_SCHEMA_VERSION,
            schemaVersion.value,
            schemaVersion.present,
            'unexpected',
          )
          : invalidReceiptPath('$', 'object', 'starter-acceptance-receipt', lastJson, true, 'wrong-kind'),
      ]),
    });
  }
  if (lastLineLooksLikeJson) {
    return Object.freeze({ kind: 'malformed-receipt', receipt: null, invalidPaths: Object.freeze([
      invalidReceiptPath('$', 'object', 'valid-json', '', true, 'invalid-json'),
    ]) });
  }
  return Object.freeze({ kind: 'missing-receipt', receipt: null, invalidPaths: Object.freeze([
    invalidReceiptPath('$', 'object', 'starter-acceptance-receipt-present', undefined, false, 'missing'),
  ]) });
}

function receiptObjectPath(parent, key) {
  const boundedKey = key.slice(0, 128);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(boundedKey)
    ? `${parent}.${boundedKey}`
    : `${parent}[${JSON.stringify(boundedKey)}]`;
}

function operationReceiptPath(key) {
  return receiptObjectPath('$.operations', key);
}

function boundedRemediationId(key, value) {
  const truncated = value.length > STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS;
  return {
    [key]: value.slice(0, STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS),
    [`${key}Truncated`]: truncated,
  };
}

function remediationRegisteredPath(path) {
  return Object.freeze({
    ...boundedRemediationId('pathId', path.id),
    ...(path.functionId === null ? {} : boundedRemediationId('functionId', path.functionId)),
  });
}

function remediationObservedPath({ path, functionId }) {
  return Object.freeze({
    receiptPath: path,
    ...boundedRemediationId('functionId', functionId),
  });
}

function generatedOperationIds(artifact) {
  const functions = artifact?.manifests?.functions?.functions;
  if (!Array.isArray(functions)) return null;
  return new Set(functions.flatMap((entry) => (
    typeof entry?.id === 'string' ? [entry.id] : []
  )));
}

// @ref LLP 0275#d5-make-acceptance-profiles-single-source-and-staleness-aware
// — validation compares builder-derived registrations with observations of the
// same generated references and emits the typed stale-registration repair.
export function validatePassingStarterReceipt(receipt, registeredPaths, artifact) {
  assert(Array.isArray(registeredPaths), 'registeredPaths must be an array');
  const invalidPaths = [];
  const invalidPathNames = new Set();
  let invalidPathCount = 0;
  const add = (entry) => {
    if (invalidPathNames.has(entry.path)) return;
    invalidPathNames.add(entry.path);
    invalidPathCount += 1;
    if (invalidPaths.length < STARTER_ACCEPTANCE_MAX_INVALID_PATHS) invalidPaths.push(entry);
  };
  const requireLiteral = (path, parent, key, expectedKind, expectedState, predicate) => {
    const leaf = receiptLeaf(parent, key);
    if (!leaf.present || !predicate(leaf.value)) {
      add(invalidReceiptPath(
        path,
        expectedKind,
        expectedState,
        leaf.value,
        leaf.present,
        leaf.present && receiptValueKind(leaf.value) !== expectedKind ? 'wrong-kind' : 'unexpected',
      ));
    }
    return leaf;
  };

  if (plainObject(receipt)) {
    for (const key of Object.keys(receipt)) {
      if (STARTER_ACCEPTANCE_RECEIPT_KEYS.includes(key)) continue;
      add(invalidReceiptPath(
        receiptObjectPath('$', key),
        'absent',
        'package-projector-owned-fields-only',
        receipt[key],
        true,
        'unexpected-field',
      ));
    }
  }

  requireLiteral(
    '$.schemaVersion', receipt, 'schemaVersion', 'string', STARTER_ACCEPTANCE_SCHEMA_VERSION,
    (value) => value === STARTER_ACCEPTANCE_SCHEMA_VERSION,
  );
  requireLiteral(
    '$.status', receipt, 'status', 'string', 'passed', (value) => value === 'passed',
  );

  const expectedCheckCount = requireLiteral(
    '$.expectedCheckCount', receipt, 'expectedCheckCount', 'integer',
    `registered-path-count:${registeredPaths.length}`,
    (value) => Number.isInteger(value) && value === registeredPaths.length,
  );
  const executedCheckCount = requireLiteral(
    '$.executedCheckCount', receipt, 'executedCheckCount', 'integer', 'present', Number.isInteger,
  );
  if (
    expectedCheckCount.present
    && Number.isInteger(expectedCheckCount.value)
    && expectedCheckCount.value >= 0
    && executedCheckCount.present
    && Number.isInteger(executedCheckCount.value)
    && executedCheckCount.value !== expectedCheckCount.value
  ) {
    add(invalidReceiptPath(
      '$.executedCheckCount',
      'integer',
      'matches-$.expectedCheckCount',
      executedCheckCount.value,
      true,
      'count-mismatch',
    ));
  }

  const checks = receiptLeaf(receipt, 'checks');
  const passedCheckIds = new Set();
  if (!checks.present || !Array.isArray(checks.value)) {
    add(invalidReceiptPath(
      '$.checks', 'array', 'present', checks.value, checks.present,
      checks.present ? 'wrong-kind' : 'missing',
    ));
  } else {
    if (
      expectedCheckCount.present
      && Number.isInteger(expectedCheckCount.value)
      && expectedCheckCount.value >= 0
      && checks.value.length !== expectedCheckCount.value
    ) {
      add(invalidReceiptPath(
        '$.checks.length',
        'integer',
        'matches-$.expectedCheckCount',
        checks.value.length,
        true,
        'count-mismatch',
      ));
    }
    for (const [index, check] of checks.value.entries()) {
      requireLiteral(
        `$.checks[${index}].id`, check, 'id', 'string', 'registered-path-id',
        (value) => typeof value === 'string' && value.length > 0,
      );
      requireLiteral(
        `$.checks[${index}].status`, check, 'status', 'string', 'passed',
        (value) => value === 'passed',
      );
      if (typeof check?.id === 'string' && check.id.length > 0 && check.status === 'passed') {
        passedCheckIds.add(check.id);
      }
    }
  }

  const identity = receiptLeaf(receipt, 'identity').value;
  const artifactIdentity = receiptLeaf(identity, 'artifact').value;
  const loadedIdentity = receiptLeaf(identity, 'loaded').value;
  const artifactAppId = requireLiteral(
    '$.identity.artifact.appId', artifactIdentity, 'appId', 'string', 'present',
    (value) => typeof value === 'string',
  );
  let artifactBundleHash = receiptLeaf(artifactIdentity, 'bundleHash');
  const loadedAppId = requireLiteral(
    '$.identity.loaded.appId', loadedIdentity, 'appId', 'string', 'present',
    (value) => typeof value === 'string',
  );
  let loadedBundleHash = receiptLeaf(loadedIdentity, 'bundleHash');
  if (artifactBundleHash.present || loadedBundleHash.present) {
    artifactBundleHash = requireLiteral(
      '$.identity.artifact.bundleHash', artifactIdentity, 'bundleHash', 'string', 'present',
      (value) => typeof value === 'string',
    );
    loadedBundleHash = requireLiteral(
      '$.identity.loaded.bundleHash', loadedIdentity, 'bundleHash', 'string', 'present',
      (value) => typeof value === 'string',
    );
  }
  if (
    artifactAppId.present && typeof artifactAppId.value === 'string'
    && loadedAppId.present && typeof loadedAppId.value === 'string'
    && loadedAppId.value !== artifactAppId.value
  ) {
    add(invalidReceiptPath(
      '$.identity.loaded.appId', 'string', 'matches-$.identity.artifact.appId',
      loadedAppId.value, true, 'identity-mismatch',
    ));
  }
  if (
    artifactBundleHash.present && typeof artifactBundleHash.value === 'string'
    && loadedBundleHash.present && typeof loadedBundleHash.value === 'string'
    && loadedBundleHash.value !== artifactBundleHash.value
  ) {
    add(invalidReceiptPath(
      '$.identity.loaded.bundleHash', 'string', 'matches-$.identity.artifact.bundleHash',
      loadedBundleHash.value, true, 'identity-mismatch',
    ));
  }
  const expectedArtifactIdentity = plainObject(artifact?.identity)
    ? artifact.identity
    : plainObject(artifact) && artifact.artifactKind === 'artifactIndex'
      ? artifact
      : null;
  if (expectedArtifactIdentity !== null) {
    for (const key of ['appId', 'inputsHash', 'schemaHash', 'bundleHash']) {
      if (typeof expectedArtifactIdentity[key] !== 'string') continue;
      const observed = receiptLeaf(artifactIdentity, key);
      if (!observed.present || observed.value !== expectedArtifactIdentity[key]) {
        add(invalidReceiptPath(
          `$.identity.artifact.${key}`,
          'string',
          `matches-generated-artifact.${key}`,
          observed.value,
          observed.present,
          observed.present ? 'identity-mismatch' : 'missing',
        ));
      }
    }
  }

  const lifecycle = receiptLeaf(receipt, 'lifecycle').value;
  requireLiteral(
    '$.lifecycle.applicationReadyObserved', lifecycle, 'applicationReadyObserved',
    'boolean', 'true', (value) => value === true,
  );
  if (Object.hasOwn(lifecycle ?? {}, 'owned')) {
    requireLiteral(
      '$.lifecycle.owned', lifecycle, 'owned', 'boolean', 'declared-by-lifecycle-adapter',
      (value) => typeof value === 'boolean',
    );
  }
  if (Object.hasOwn(lifecycle ?? {}, 'waitLevel')) {
    requireLiteral(
      '$.lifecycle.waitLevel', lifecycle, 'waitLevel', 'string', 'declared-by-lifecycle-adapter',
      (value) => typeof value === 'string' && value.length > 0,
    );
  }
  if (Object.hasOwn(lifecycle ?? {}, 'firstQueryRetries')) {
    requireLiteral(
      '$.lifecycle.firstQueryRetries', lifecycle, 'firstQueryRetries', 'integer',
      'declared-by-lifecycle-adapter',
      (value) => Number.isInteger(value) && value >= 0,
    );
  }

  const operationsLeaf = receiptLeaf(receipt, 'operations');
  const operations = operationsLeaf.value;
  const currentOperationIds = generatedOperationIds(artifact);
  const registeredOperationPaths = registeredPaths.filter(({ functionId }) => functionId !== null);
  const registeredOperationPathsById = new Map(registeredOperationPaths.map((path) => [path.id, path]));
  const observations = [];
  if (currentOperationIds === null) {
    add(invalidReceiptPath(
      '$.operations', 'generated-operation-manifest', 'available', operations,
      operationsLeaf.present, 'unavailable',
    ));
  }
  if (!operationsLeaf.present || !plainObject(operations)) {
    add(invalidReceiptPath(
      '$.operations', 'object', 'generated-operation-observations', operations,
      operationsLeaf.present, operationsLeaf.present ? 'wrong-kind' : 'missing',
    ));
  } else {
    for (const key of Object.keys(operations).sort()) {
      const path = operationReceiptPath(key);
      const functionId = operations[key];
      if (typeof functionId !== 'string') {
        add(invalidReceiptPath(
          path, 'string', 'generated-operation-reference-id', functionId, true, 'wrong-kind',
        ));
        continue;
      }
      const current = currentOperationIds?.has(functionId) === true;
      if (!current) {
        add(invalidReceiptPath(
          path, 'string', 'current-generated-operation-reference-id', functionId, true,
          'stale-or-unknown-operation',
        ));
      }
      observations.push(Object.freeze({ key, path, functionId, current }));
    }
  }
  const observedPathIds = new Set(registeredPaths.flatMap(({ id, functionId }) => (
    (passedCheckIds.has(id)
      && (functionId === null || (
        currentOperationIds?.has(functionId) === true
        && plainObject(operations)
        && operations[id] === functionId
      )))
      ? [id]
      : []
  )));
  const staleRegistrationPaths = registeredOperationPaths.filter(({ functionId }) => (
    currentOperationIds !== null && !currentOperationIds.has(functionId)
  ));
  const unobservedRegistrationPaths = registeredOperationPaths.filter(({ id, functionId }) => (
    currentOperationIds?.has(functionId) === true
    && (!plainObject(operations) || operations[id] !== functionId || !passedCheckIds.has(id))
  ));
  const unobservedJourneyPaths = registeredPaths.filter(({ id, functionId }) => (
    !passedCheckIds.has(id)
      || (functionId !== null && (!plainObject(operations) || operations[id] !== functionId))
  ));
  const unclaimedObservations = observations.filter(({ key, functionId, current }) => (
    current && registeredOperationPathsById.get(key)?.functionId !== functionId
  ));
  if (plainObject(operations)) {
    for (const path of registeredOperationPaths) {
      if (operations[path.id] === path.functionId) continue;
      const observed = receiptLeaf(operations, path.id);
      add(invalidReceiptPath(
        operationReceiptPath(path.id),
        'string',
        `exact-registered-function-id:${path.functionId}`,
        observed.value,
        observed.present,
        observed.present ? 'path-operation-mismatch' : 'registered-path-not-observed',
      ));
    }
  }
  let remediation = null;
  if (registeredOperationPaths.length === 0) {
    add(invalidReceiptPath(
      '$.operations',
      'generated-operation-registration',
      'profile-paths-bound',
      operations,
      operationsLeaf.present,
      'unbound-registration',
    ));
  } else if (staleRegistrationPaths.length > 0 || unobservedRegistrationPaths.length > 0) {
    add(invalidReceiptPath(
      '$.operations',
      'generated-operation-registration',
      'registered-identities-observed',
      operations,
      operationsLeaf.present,
      staleRegistrationPaths.length > 0 ? 'stale-registration' : 'registered-not-observed',
    ));
  }
  if (unobservedJourneyPaths.length > 0) {
    add(invalidReceiptPath(
      '$.checks', 'registered-journey-path-observations', 'all-registered-paths-observed',
      checks.value, checks.present, 'registered-path-not-observed',
    ));
  }
  if (staleRegistrationPaths.length > 0) {
    remediation = Object.freeze({
      kind: 'refresh-generated-operation-registration',
      staleRegistrationPaths: Object.freeze(staleRegistrationPaths
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationRegisteredPath)),
      staleRegistrationPathsTruncated:
        staleRegistrationPaths.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      registeredPaths: Object.freeze(registeredPaths
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationRegisteredPath)),
      registeredPathsTruncated: registeredPaths.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      unclaimedOperationPaths: Object.freeze(unclaimedObservations
        .slice(0, STARTER_ACCEPTANCE_MAX_OPERATION_PATHS)
        .map(remediationObservedPath)),
      unclaimedOperationPathsTruncated:
        unclaimedObservations.length > STARTER_ACCEPTANCE_MAX_OPERATION_PATHS,
      instruction: 'Refresh the starter acceptance registration from generated operation references and rerun snapback verify.',
    });
  }

  const cleanup = receiptLeaf(receipt, 'cleanup').value;
  requireLiteral('$.cleanup.attempted', cleanup, 'attempted', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.cleanup.clientResourcesReleased', cleanup, 'clientResourcesReleased',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral('$.cleanup.devExited', cleanup, 'devExited', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.cleanup.temporaryStateRemoved', cleanup, 'temporaryStateRemoved',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral('$.cleanup.ok', cleanup, 'ok', 'boolean', 'true', (value) => value === true);
  requireLiteral('$.diagnostic', receipt, 'diagnostic', 'null', 'null', (value) => value === null);

  return Object.freeze({
    complete: invalidPathCount === 0,
    invalidPathCount,
    invalidPaths: Object.freeze(invalidPaths),
    invalidPathsTruncated: invalidPathCount > invalidPaths.length,
    remediation,
    observedPathIds: Object.freeze([...observedPathIds]),
  });
}
