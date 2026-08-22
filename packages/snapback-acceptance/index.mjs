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
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_STEP_DETAIL_BYTES = 16 * 1024;
const MAX_STEP_DETAIL_ITEMS = 256;
const MAX_STEP_DETAIL_DEPTH = 8;
const MAX_STEP_STRING_CHARS = 4_096;
const PATH_TOKEN = Symbol('snapback.starter-acceptance.path');
const DEFINITION = Symbol('snapback.starter-acceptance.definition');

const STARTER_ACCEPTANCE_MAX_INVALID_PATHS = 64;
const STARTER_ACCEPTANCE_MAX_OPERATION_PATHS = 16;
const STARTER_ACCEPTANCE_MAX_REMEDIATION_ID_CHARS = 256;

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

function normalizePath(path, key) {
  assert(plainObject(path), `paths.${key} must be an object`);
  assert(typeof path.id === 'string' && path.id.length > 0, `paths.${key}.id must be non-empty`);
  assert(PATH_KINDS.has(path.kind), `paths.${key}.kind is unsupported`);
  assert(
    typeof path.targetProfileId === 'string' && path.targetProfileId.length > 0,
    `paths.${key}.targetProfileId must be non-empty`,
  );
  const operation = path.operation ?? null;
  assert(
    operation === null || (plainObject(operation) && typeof operation.id === 'string'
      && operation.id.length > 0),
    `paths.${key}.operation must be a generated operation reference object, never a raw id`,
  );
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
  assert(
    typeof options.artifacts.appId === 'string' && options.artifacts.appId.length > 0,
    'artifacts.appId must be non-empty',
  );
  assert(typeof options.journey === 'function', 'journey must be a bounded callback');
  assert(
    options.preflight === undefined || typeof options.preflight === 'function',
    'preflight must be a bounded callback when present',
  );
  const paths = Object.fromEntries(Object.entries(options.paths ?? {}).map(([key, path]) => [
    key,
    normalizePath(path, key),
  ]));
  assert(
    new Set(Object.values(paths).map(({ id }) => id)).size === Object.keys(paths).length,
    'starter acceptance path ids must be unique',
  );
  assert(
    Object.values(paths).some(({ functionId }) => functionId !== null),
    'starter acceptance must bind at least one path to a generated operation reference',
  );
  return Object.freeze({
    [DEFINITION]: true,
    schemaVersion: STARTER_ACCEPTANCE_DEFINITION_VERSION,
    acceptanceFile,
    appRoot,
    artifacts: options.artifacts,
    paths: Object.freeze(paths),
    stepTimeoutMs: options.stepTimeoutMs === undefined
      ? DEFAULT_STEP_TIMEOUT_MS
      : positiveInteger(options.stepTimeoutMs, 'stepTimeoutMs'),
    readinessTimeoutMs: options.readinessTimeoutMs === undefined
      ? DEFAULT_READINESS_TIMEOUT_MS
      : positiveInteger(options.readinessTimeoutMs, 'readinessTimeoutMs'),
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

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit) => {
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      resolveExit(true);
      return;
    }
    const timer = setTimeout(() => {
      child.off('close', closed);
      resolveExit(false);
    }, timeoutMs);
    const closed = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once('close', closed);
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
    async start({ appRoot, stateRoot, readinessTimeoutMs, environment }) {
      assert.equal(child, null, 'managed lifecycle adapters are single-use');
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
      const exit = await new Promise((resolveExit, reject) => {
        waiter.once('error', reject);
        waiter.once('close', (code, signal) => resolveExit({ code, signal }));
      });
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
        lifecycleEvents: Object.freeze(lifecycleEvents),
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
    async stop() {
      if (child === null) return Object.freeze({ exited: true });
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (!(await waitForExit(child, 10_000))) child.kill('SIGKILL');
      return Object.freeze({ exited: await waitForExit(child, 5_000) });
    },
  });
}

function abortError(signal) {
  const error = new Error(`starter acceptance interrupted${signal.reason ? `: ${signal.reason}` : ''}`);
  error.code = 'SNAPBACK_STARTER_ACCEPTANCE_INTERRUPTED';
  return error;
}

function withTimeout(promise, timeoutMs, code, message, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, timeoutMs);
    const aborted = () => reject(abortError(signal));
    signal?.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        reject(error);
      },
    );
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

async function defaultLoadedIdentity(lifecycleState) {
  if (lifecycleState.loadedIdentity !== undefined && lifecycleState.loadedIdentity !== null) {
    return { loadedIdentity: lifecycleState.loadedIdentity, adminClient: lifecycleState.adminClient ?? null };
  }
  if (lifecycleState.adminClient !== undefined && lifecycleState.adminClient !== null) {
    const inspected = await lifecycleState.adminClient.inspect();
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
  const inspected = await adminClient.inspect();
  return {
    loadedIdentity: {
      appId: inspected.functions?.appId,
      bundleHash: inspected.functions?.bundleHash,
    },
    adminClient,
  };
}

async function spawnSessionMint(lifecycleState, appRoot, environment, email) {
  assert(
    typeof lifecycleState.executable === 'string'
      && typeof lifecycleState.readyFile === 'string'
      && typeof lifecycleState.adminToken === 'string',
    'selected lifecycle does not support ordinary-session minting',
  );
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
  const exit = await new Promise((resolveExit, reject) => {
    mint.once('error', reject);
    mint.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  if (exit.code !== 0) {
    throw new Error(`ordinary session mint failed (${exit.code ?? exit.signal}): ${stderr}`);
  }
  const envelope = JSON.parse(stdout);
  assert.equal(envelope?.ok, true, 'ordinary session mint returned a failed envelope');
  assert.equal(envelope?.operation, 'auth.mintSession');
  assert.equal(envelope?.data?.tokenType, 'Bearer');
  assert(typeof envelope?.data?.token === 'string' && envelope.data.token.length > 0);
  return Object.freeze({ token: envelope.data.token });
}

export function projectStarterAcceptanceReceipt(outcome) {
  assert(plainObject(outcome), 'starter receipt outcome must be an object');
  const artifact = outcome.artifacts;
  const loadedIdentity = outcome.loadedIdentity;
  return Object.freeze({
    schemaVersion: STARTER_ACCEPTANCE_SCHEMA_VERSION,
    status: outcome.passed ? 'passed' : 'failed',
    expectedCheckCount: outcome.checks.length,
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
      owned: true,
      applicationReadyObserved: outcome.applicationReadyObserved,
      waitLevel: 'application',
      firstQueryRetries: 0,
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
  const signal = options.signal ?? null;
  const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-starter-acceptance-'));
  const checks = [];
  const operations = {};
  const seenSteps = new Set();
  const cleanupStack = [];
  const sessionClients = [];
  let lifecycleState = null;
  let adminClient = null;
  let loadedIdentity = null;
  let applicationReadyObserved = false;
  let failure = null;
  const cleanup = {
    attempted: false,
    clientResourcesReleased: false,
    devExited: false,
    temporaryStateRemoved: false,
    ok: false,
  };

  const health = () => {
    if (signal?.aborted) throw abortError(signal);
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
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      health();
      const value = await predicate();
      if (value) return value;
      await withTimeout(
        new Promise((resolveWait) => setTimeout(resolveWait, intervalMs)),
        intervalMs + 1_000,
        'SNAPBACK_STARTER_ACCEPTANCE_RETRY_WAIT_FAILED',
        `${label}: retry wait failed`,
        signal,
      );
    }
    const error = new Error(`${label}: timed out after ${timeoutMs}ms`);
    error.code = 'SNAPBACK_STARTER_ACCEPTANCE_RETRY_TIMEOUT';
    throw error;
  };
  const step = async (pathOrId, callback, stepOptions = {}) => {
    const path = pathOrId?.[PATH_TOKEN] === true ? pathOrId : null;
    const id = path?.id ?? pathOrId;
    assert(typeof id === 'string' && id.length > 0, 'step id must be non-empty');
    assert(typeof callback === 'function', `step ${id} callback must be a function`);
    assert.equal(seenSteps.has(id), false, `step ${id} was executed more than once`);
    seenSteps.add(id);
    const timeoutMs = stepOptions.timeoutMs ?? path?.timeoutMs ?? definition.stepTimeoutMs;
    positiveInteger(timeoutMs, `step ${id} timeoutMs`);
    let details;
    try {
      const result = await withTimeout(
        Promise.resolve().then(callback),
        timeoutMs,
        'SNAPBACK_STARTER_ACCEPTANCE_STEP_TIMEOUT',
        `starter acceptance step ${id} exceeded ${timeoutMs}ms`,
        signal,
      );
      details = normalizeStepDetail(result);
    } catch (error) {
      if (error instanceof TypeError && error.code === undefined) {
        error.code = 'SNAPBACK_STARTER_ACCEPTANCE_STEP_RESULT_INVALID';
      }
      throw error;
    }
    checks.push(Object.freeze({ id, status: 'passed', details }));
    if (path?.functionId !== null && path?.functionId !== undefined) {
      operations[path.id] = path.functionId;
    }
    return details;
  };
  const defer = (callback) => {
    assert(typeof callback === 'function', 'defer requires a cleanup callback');
    cleanupStack.push(callback);
  };
  const mintSession = async ({ email }) => {
    assert(typeof email === 'string' && email.length > 0, 'session email must be non-empty');
    assert(lifecycleState !== null, 'session minting requires a started lifecycle');
    return spawnSessionMint(lifecycleState, definition.appRoot, environment, email);
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
        Promise.resolve().then(() => definition.preflight(context)),
        definition.stepTimeoutMs * 4,
        'SNAPBACK_STARTER_ACCEPTANCE_PREFLIGHT_TIMEOUT',
        'starter acceptance preflight timed out',
        signal,
      );
    }
    lifecycleState = await lifecycle.start(Object.freeze({
      appRoot: definition.appRoot,
      stateRoot,
      readinessTimeoutMs: definition.readinessTimeoutMs,
      environment,
    }));
    assert.equal(lifecycleState?.ready?.ready, true, 'lifecycle did not return a ready application');
    applicationReadyObserved = true;
    ({ loadedIdentity, adminClient } = await defaultLoadedIdentity(lifecycleState));
    assert.equal(loadedIdentity?.appId, definition.artifacts.appId, 'loaded app id differs from generated artifacts');
    if (typeof definition.artifacts.bundleHash === 'string') {
      assert.equal(
        loadedIdentity?.bundleHash,
        definition.artifacts.bundleHash,
        'loaded bundle hash differs from generated artifacts',
      );
    }
    await definition.journey(context);
    if (checks.length === 0) {
      const error = new Error('starter acceptance journey completed without an application assertion step');
      error.code = 'SNAPBACK_STARTER_ACCEPTANCE_VACUOUS';
      throw error;
    }
  } catch (error) {
    failure = normalizeFailure(error);
  } finally {
    cleanup.attempted = true;
    let resourceCleanupOk = true;
    for (const callback of [...cleanupStack].reverse()) {
      try {
        await withTimeout(
          Promise.resolve().then(callback),
          10_000,
          'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_TIMEOUT',
          'starter acceptance resource cleanup timed out',
          null,
        );
      } catch (error) {
        resourceCleanupOk = false;
        failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
      }
    }
    for (const client of [adminClient, ...sessionClients]) {
      if (client === null || client === undefined || typeof client.inspect !== 'function') continue;
      try {
        const inspected = await client.inspect();
        assert.equal(inspected.subscriptions?.length ?? 0, 0, 'client subscriptions remained after cleanup');
      } catch (error) {
        resourceCleanupOk = false;
        failure ??= normalizeFailure(error, 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED');
      }
    }
    cleanup.clientResourcesReleased = resourceCleanupOk;
    try {
      const stopped = await lifecycle.stop(lifecycleState);
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
  }

  const passed = failure === null
    && applicationReadyObserved
    && loadedIdentity !== null
    && cleanup.ok;
  const receipt = projectStarterAcceptanceReceipt({
    passed,
    checks,
    operations,
    artifacts: definition.artifacts,
    loadedIdentity,
    applicationReadyObserved,
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

function operationReceiptPath(key) {
  const boundedKey = key.slice(0, 128);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(boundedKey)
    ? `$.operations.${boundedKey}`
    : `$.operations[${JSON.stringify(boundedKey)}]`;
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
  const invalidPaths = [];
  let invalidPathCount = 0;
  const add = (entry) => {
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

  const expectedCheckCount = requireLiteral(
    '$.expectedCheckCount', receipt, 'expectedCheckCount', 'integer', 'positive',
    (value) => Number.isInteger(value) && value > 0,
  );
  const executedCheckCount = requireLiteral(
    '$.executedCheckCount', receipt, 'executedCheckCount', 'integer', 'present', Number.isInteger,
  );
  if (
    expectedCheckCount.present
    && Number.isInteger(expectedCheckCount.value)
    && expectedCheckCount.value > 0
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
      && expectedCheckCount.value > 0
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

  const lifecycle = receiptLeaf(receipt, 'lifecycle').value;
  requireLiteral('$.lifecycle.owned', lifecycle, 'owned', 'boolean', 'true', (value) => value === true);
  requireLiteral(
    '$.lifecycle.applicationReadyObserved', lifecycle, 'applicationReadyObserved',
    'boolean', 'true', (value) => value === true,
  );
  requireLiteral(
    '$.lifecycle.waitLevel', lifecycle, 'waitLevel', 'string', 'application',
    (value) => value === 'application',
  );
  requireLiteral(
    '$.lifecycle.firstQueryRetries', lifecycle, 'firstQueryRetries', 'integer', 'zero',
    (value) => value === 0,
  );

  const operationsLeaf = receiptLeaf(receipt, 'operations');
  const operations = operationsLeaf.value;
  const currentOperationIds = generatedOperationIds(artifact);
  const registeredOperationPaths = registeredPaths.filter(({ functionId }) => functionId !== null);
  const registeredOperationIds = new Set(registeredOperationPaths.map(({ functionId }) => functionId));
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
      const registered = registeredOperationIds.has(functionId);
      if (!current && !registered) continue;
      if (!current) {
        add(invalidReceiptPath(
          path, 'string', 'current-generated-operation-reference-id', functionId, true,
          'stale-or-unknown-operation',
        ));
      }
      observations.push(Object.freeze({ path, functionId, current }));
    }
  }
  const observedCurrentIds = new Set(
    observations.filter(({ current }) => current).map(({ functionId }) => functionId),
  );
  const observedPathIds = new Set(registeredPaths.flatMap(({ id, functionId }) => (
    (functionId === null ? passedCheckIds.has(id) : observedCurrentIds.has(functionId))
      ? [id]
      : []
  )));
  const staleRegistrationPaths = registeredOperationPaths.filter(({ functionId }) => (
    currentOperationIds !== null && !currentOperationIds.has(functionId)
  ));
  const unobservedRegistrationPaths = registeredOperationPaths.filter(({ functionId }) => (
    currentOperationIds?.has(functionId) === true
    && !observedCurrentIds.has(functionId)
  ));
  const unobservedJourneyPaths = registeredPaths.filter(({ id, functionId }) => (
    functionId === null && !passedCheckIds.has(id)
  ));
  const unclaimedObservations = observations.filter(({ functionId, current }) => (
    current && !registeredOperationIds.has(functionId)
  ));
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
