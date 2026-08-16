// @expo/snapback-vite — mode-aware backend lifecycle for the managed dev plugin.
//
// The controller is deliberately Vite-free: the plugin in index.mjs is a thin
// projection of this module, so every mode decision is testable without a dev
// server. All process/handshake mechanics are the @expo/snapback-cli helpers — the
// plugin must not grow a second lifecycle dialect (LLP 0041's boundary with
// LLP 0030: same ready-file/host-ops surface, neither embeds the other).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  diagnosticError,
  managedAdminToken,
  native,
  readReadyDescriptor,
  resolveRuntimeBinary,
  scrubDynamicLoaderEnvironment,
  resolveGeneratedArtifact,
  validateDevTarget,
  waitForReady,
} from '@expo/snapback-cli';

export const LIFECYCLE_MODES = Object.freeze(['off', 'external', 'attach', 'managed', 'auto']);
const RESET_POLICIES = Object.freeze(['if-new', 'always', 'never']);
const HOST_OPS_SCHEMA_VERSION = 'snapback.v0';

function canonicalFilesystemPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function readOwnerOnlyDevIdentityFile(path) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_READY_FILE_INVALID',
      `the dev-identity capability file is missing or unreadable: ${path}`,
      { path },
    );
    error.cause = cause;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_READY_FILE_INVALID',
      `the dev-identity capability file must be an owner-only regular file: ${path}`,
      { path, observedMode: (metadata.mode & 0o7777).toString(8).padStart(4, '0') },
    );
  }
  const capability = readFileSync(path, 'utf8').trim();
  if (!capability) {
    throw diagnosticError('SNAPBACK_DEV_READY_FILE_INVALID', `the dev-identity capability file is empty: ${path}`, { path });
  }
  return capability;
}

// Kept as a small pure seam so relay tests can use fixture descriptors while
// the server-side descriptor field is landing in parallel.
export function readManagedDevIdentityCapability({ readyFile, database }) {
  const descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
  const advertised = descriptor.devIdentityCapabilityFile;
  if (typeof advertised !== 'string') return { descriptor, capability: null };
  const expected = canonicalFilesystemPath(`${database}.dev-identity`);
  if (canonicalFilesystemPath(advertised) !== expected) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names an unexpected dev-identity capability carrier',
      { expectedDevIdentityCapabilityFile: expected, observedDevIdentityCapabilityFile: canonicalFilesystemPath(advertised) },
    );
  }
  return { descriptor, capability: readOwnerOnlyDevIdentityFile(expected) };
}

export function createDiagnosticsChannel({ onEvent = null, logJson = true } = {}) {
  return {
    emit(event) {
      const payload = {
        schemaVersion: 'snapback.vite-dev.v1',
        subsystem: 'vite-plugin',
        ...event,
      };
      try {
        onEvent?.(payload);
      } catch {
        // A listener failure must never take down the dev loop.
      }
      if (logJson) process.stderr.write(`${JSON.stringify(payload)}\n`);
      return payload;
    },
  };
}

function normalizeSetup(setup, projectRoot) {
  if (setup === undefined || setup === null || setup === false) return null;
  if (typeof setup !== 'object') {
    throw diagnosticError('SNAPBACK_DEV_SETUP_INVALID', 'setup must be an object, false, or omitted');
  }
  const backendDirectory = setup.backendDirectory ? resolve(projectRoot, setup.backendDirectory) : null;
  const generated = backendDirectory ? join(backendDirectory, 'generated') : null;
  const schema = setup.schema
    ? resolve(projectRoot, setup.schema)
    : (generated ? resolveGeneratedArtifact(generated, 'schema.manifest.json') : null);
  const functions = setup.functions
    ? resolve(projectRoot, setup.functions)
    : (generated ? resolveGeneratedArtifact(generated, 'functions.manifest.json') : null);
  const seed = setup.seed
    ? resolve(projectRoot, setup.seed)
    : (backendDirectory ? join(backendDirectory, 'seed.json') : null);
  let seedArtifact = null;
  if (generated) {
    try {
      seedArtifact = resolveGeneratedArtifact(generated, 'seed.artifact.json');
    } catch {
      // Legacy generated graphs intentionally have no versioned seed export.
    }
  }
  const capabilities = generated
    ? resolveGeneratedArtifact(generated, 'capability.manifest.json')
    : null;
  const reset = setup.reset ?? 'if-new';
  if (!RESET_POLICIES.includes(reset)) {
    throw diagnosticError('SNAPBACK_DEV_SETUP_INVALID', `setup.reset must be one of ${RESET_POLICIES.join(', ')}`, { reset });
  }
  if (!schema && !functions && reset === 'never') return null;
  return {
    backendDirectory,
    schema,
    functions,
    seed,
    seedArtifact,
    capabilities,
    reset,
    allowAttached: setup.allowAttached === true,
  };
}

function readJsonArtifact(path, label) {
  if (!path || !existsSync(path)) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_SETUP_FAILED',
      `${label} artifact is missing; run \`snapback generate\` first — the plugin loads generated artifacts, it does not run codegen`,
      { path, label },
    );
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_DEV_SERVER_SETUP_FAILED', `${label} artifact is not valid JSON`, { path, label });
    error.cause = cause;
    throw error;
  }
}

async function probeHealth(serverUrl) {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/health`);
    if (!response.ok) return { ok: false, cause: `HTTP ${response.status}` };
    return { ok: true, health: await response.json() };
  } catch (cause) {
    return { ok: false, cause: cause?.message ?? String(cause) };
  }
}

async function postHostOp(serverUrl, adminToken, body) {
  // Managed bring-up speaks the same host-ops HTTP surface the CLI and MCP
  // server use — one lifecycle dialect, projected over
  // `POST /_snapback/api/host-ops` with the minted admin token.
  //
  // @ref LLP 0030#backend-setup-ownership — schema/function/seed loading is a
  //   server-side bring-up step, never a browser call through the app proxy.
  const url = `${serverUrl.replace(/\/$/, '')}/_snapback/api/host-ops`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
      },
      body: JSON.stringify({
        schemaVersion: HOST_OPS_SCHEMA_VERSION,
        requestId: `vite-${randomUUID()}`,
        ...body,
      }),
    });
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_DEV_SERVER_SETUP_FAILED', `host-ops request to ${url} failed: ${cause.message}`, {
      operation: body.operation,
    });
    error.cause = cause;
    throw error;
  }
  let envelope;
  try {
    envelope = await response.json();
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_SERVER_SETUP_FAILED',
      `host-ops response for ${body.operation} was not JSON (HTTP ${response.status})`,
      { operation: body.operation, status: response.status },
    );
    error.cause = cause;
    throw error;
  }
  if (envelope?.ok !== true) {
    throw diagnosticError('SNAPBACK_DEV_SERVER_SETUP_FAILED', `${body.operation} was refused by the server`, {
      operation: body.operation,
      status: response.status,
      diagnostics: envelope?.diagnostics ?? envelope?.diagnostic ?? null,
    });
  }
  return envelope;
}

function operationIdV7() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSnapbackViteLifecycle(options = {}) {
  const mode = options.mode ?? 'auto';
  if (!LIFECYCLE_MODES.includes(mode)) {
    throw diagnosticError('SNAPBACK_DEV_SERVER_MODE_INVALID', `unknown Snapback dev mode ${mode}`, {
      mode,
      supported: [...LIFECYCLE_MODES],
    });
  }
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const stateRoot = join(projectRoot, '.snapback');
  const database = resolve(projectRoot, options.database ?? join(stateRoot, 'dev.sqlite3'));
  const readyFile = resolve(projectRoot, options.readyFile ?? join(stateRoot, 'dev.ready.json'));
  const externalUrl = options.url ?? null;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const channel = options.channel ?? createDiagnosticsChannel(options);
  const setup = normalizeSetup(options.setup, projectRoot);
  const lifecycleEnv = options.env ?? process.env;
  const devIdentityHandoff = typeof lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE === 'string'
    && lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE.length > 0
    ? resolve(projectRoot, lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE)
    : null;

  let child = null;
  let runtime = null;
  let descriptor = null;
  let adminToken = null;
  let closed = false;
  let missingDevIdentityHandoffWarned = false;
  let devIdentityReadWarning = null;
  const state = {
    mode,
    shape: null,
    ready: false,
    managed: false,
    serverUrl: null,
    pid: null,
  };

  const emit = (event) => channel.emit({ mode, ...event });

  function warnMissingDevIdentityHandoff() {
    if (state.shape === 'managed' || state.shape === 'off' || devIdentityHandoff || missingDevIdentityHandoffWarned) return;
    missingDevIdentityHandoffWarned = true;
    emit({
      event: 'dev-identity-handoff-missing',
      severity: 'warning',
      message: 'browser dev identity will require SNAPBACK_DEV_IDENTITY_FILE when capability enforcement is enabled',
    });
  }

  function capabilityReadFailed(error) {
    const code = error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_DEV_READY_FILE_INVALID';
    const signature = `${code}:${error?.message ?? String(error)}`;
    if (devIdentityReadWarning === signature) return;
    devIdentityReadWarning = signature;
    emit({
      event: 'diagnostic',
      code,
      severity: 'warning',
      message: error?.message ?? String(error),
    });
  }

  // @ref LLP 0262#d2-carriers-per-shipped-topology — managed relays read the
  //   descriptor and sidecar on every forward, so a startup-nonce rotation on
  //   the same port cannot be hidden behind connection-error-only refresh.
  //   Attach/external processes instead receive an explicit custody handoff.
  function readDevIdentityCapability() {
    try {
      if (state.shape !== 'managed') {
        return devIdentityHandoff ? readOwnerOnlyDevIdentityFile(devIdentityHandoff) : null;
      }
      const currentNonce = descriptor?.startupNonce;
      const resolvedCapability = readManagedDevIdentityCapability({ readyFile, database });
      const candidate = resolvedCapability.descriptor;
      const changed = currentNonce !== candidate.startupNonce
        || state.serverUrl !== candidate.serverUrl
        || state.pid !== (candidate.pid ?? null);
      descriptor = candidate;
      state.serverUrl = candidate.serverUrl;
      state.pid = candidate.pid ?? null;
      state.ready = true;
      if (changed) {
        emit({
          event: 'server-target-refreshed',
          severity: 'note',
          message: 'relay re-read its backend target and dev-identity capability after descriptor rotation',
          serverUrl: state.serverUrl,
          pid: state.pid,
        });
      }
      devIdentityReadWarning = null;
      return resolvedCapability.capability;
    } catch (error) {
      capabilityReadFailed(error);
      return null;
    }
  }

  // Attach-shaped bring-up: validate, never mutate without explicit opt-in.
  //
  // @ref LLP 0030#lifecycle-modes — attach discovers/validates but never
  //   spawns; destructive reset/seed is allowed by default only for a
  //   plugin-spawned managed child.
  async function attachTo({ shape }) {
    if (!existsSync(readyFile)) {
      throw diagnosticError('SNAPBACK_DEV_READY_FILE_REQUIRED', `attach mode requires a readiness descriptor at ${readyFile}`, {
        readyFile,
      });
    }
    const candidate = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
    const probe = await probeHealth(candidate.serverUrl);
    const staleNonce = typeof candidate.startupNonce === 'string'
      && probe.ok
      && probe.health?.binary?.startupNonce !== candidate.startupNonce;
    if (!probe.ok || staleNonce) {
      // A stale ready file must never be accepted as current readiness.
      throw diagnosticError(
        'SNAPBACK_DEV_SERVER_STALE_DESCRIPTOR',
        staleNonce
          ? 'the live server does not report the descriptor startupNonce'
          : `the readiness descriptor's server did not answer /health (${probe.cause})`,
        { readyFile, serverUrl: candidate.serverUrl, database },
      );
    }
    descriptor = candidate;
    state.shape = shape;
    state.serverUrl = candidate.serverUrl;
    state.pid = candidate.pid ?? null;
    state.ready = true;
    if (setup) {
      if (!setup.allowAttached) {
        const refusal = {
          event: 'setup-refused',
          code: 'SNAPBACK_DEV_SETUP_REFUSED',
          severity: 'warning',
          message: 'setup is configured but this server was attached to, not spawned; set setup.allowAttached to opt in',
          shape,
          serverUrl: candidate.serverUrl,
          database,
          pid: candidate.pid ?? null,
        };
        if (setup.reset === 'always') {
          // An explicit always-reset demand cannot be silently skipped.
          throw diagnosticError('SNAPBACK_DEV_SETUP_REFUSED', refusal.message, {
            shape,
            serverUrl: candidate.serverUrl,
            database,
            reset: setup.reset,
          });
        }
        emit(refusal);
        return;
      }
      adminToken = managedAdminToken(candidate, database);
      emit({
        event: 'setup-attached-opt-in',
        severity: 'warning',
        message: 'running setup against an attached server because setup.allowAttached is set',
        serverUrl: candidate.serverUrl,
        database,
        pid: candidate.pid ?? null,
      });
      await runSetup({ dbExisted: true });
    }
  }

  async function spawnManaged() {
    if (existsSync(readyFile)) {
      // Never clobber a live server's descriptor; only a provably dead one.
      let liveProbe = { ok: false };
      try {
        const candidate = readReadyDescriptor(readyFile);
        liveProbe = await probeHealth(candidate.serverUrl);
      } catch {
        liveProbe = { ok: false };
      }
      if (liveProbe.ok) {
        throw diagnosticError(
          'SNAPBACK_DEV_SERVER_DB_OWNED',
          `a live server already owns ${readyFile}; use attach or auto mode instead of managed`,
          { readyFile, database },
        );
      }
      emit({
        event: 'stale-ready-file-removed',
        severity: 'note',
        message: 'removing a readiness descriptor whose server no longer answers',
        readyFile,
      });
      rmSync(readyFile, { force: true });
    }
    const dbExisted = existsSync(database);
    mkdirSync(dirname(readyFile), { recursive: true });
    mkdirSync(dirname(database), { recursive: true });
    runtime = resolveRuntimeBinary(options);
    child = spawn(runtime.binary, ['start', '--ready-file', readyFile, '--db', database], {
      cwd: projectRoot,
      env: {
        ...scrubDynamicLoaderEnvironment(options.env ?? process.env),
        // @ref LLP 0193#program — a plugin-managed child is a development
        // supervisor boundary. External/attach targets remain redacted by
        // default because this process does not control their launch policy.
        SNAPBACK_HANDLER_ERROR_EXPOSURE: 'development',
      },
      stdio: options.serverStdio ?? 'inherit',
    });
    try {
      descriptor = validateDevTarget(await waitForReady(readyFile, child, readyTimeoutMs), { readyFile, database });
      adminToken = managedAdminToken(descriptor, database);
      state.shape = 'managed';
      state.managed = true;
      state.serverUrl = descriptor.serverUrl;
      state.pid = descriptor.pid ?? null;
      state.ready = true;
      if (setup) await runSetup({ dbExisted });
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGTERM');
      child = null;
      throw error;
    }
  }

  async function runSetup({ dbExisted }) {
    const loaded = { schema: false, functions: false };
    const shouldReset = setup.reset === 'always' || (setup.reset === 'if-new' && !dbExisted);
    const versionedArtifact = setup.seedArtifact && existsSync(setup.seedArtifact)
      ? readJsonArtifact(setup.seedArtifact, 'seed.artifact.json')
      : null;
    if (versionedArtifact) {
      const capabilities = setup.capabilities
        ? readJsonArtifact(setup.capabilities, 'capability.manifest.json')
        : null;
      const supported = new Set(capabilities?.supportedCapabilities ?? []);
      const required = shouldReset ? 'versioned_seed_reset_v1' : 'versioned_seed_install_v1';
      if (!supported.has(required)) {
        throw diagnosticError(
          'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
          `generated target manifest does not advertise ${required}; versioned seed will not fall back to legacy reset/seed`,
          { capability: required },
        );
      }
    }
    if (setup.schema) {
      await postHostOp(state.serverUrl, adminToken, {
        operation: 'schema.load',
        schema: readJsonArtifact(setup.schema, 'schema.manifest.json'),
      });
      loaded.schema = true;
    }
    if (setup.functions) {
      await postHostOp(state.serverUrl, adminToken, {
        operation: 'functions.load',
        functions: readJsonArtifact(setup.functions, 'functions.manifest.json'),
      });
      loaded.functions = true;
    }
    if (versionedArtifact) {
      if (shouldReset) {
        const preview = await postHostOp(state.serverUrl, adminToken, {
          operation: 'app.seed.preview.v1',
          input: {
            formatVersion: 'snapback.seed.preview-request.v1',
            artifact: versionedArtifact,
            requestedMode: 'dev',
            operation: 'install',
          },
        });
        const stream = preview?.data?.requested?.dataVersionStream;
        const expectedDataVersionStream = typeof stream === 'string'
          ? { state: 'present', value: stream }
          : { state: 'absent' };
        await postHostOp(state.serverUrl, adminToken, {
          operation: 'app.seed.reset-install.v1',
          input: {
            formatVersion: 'snapback.seed.reset-request.v1',
            operationId: operationIdV7(),
            operation: 'resetInstall',
            requestedMode: 'dev',
            expectedDataVersionStream,
            artifact: versionedArtifact,
          },
        });
      } else {
        await postHostOp(state.serverUrl, adminToken, {
          operation: 'app.seed.ensure.v1',
          input: {
            formatVersion: 'snapback.seed.install-request.v1',
            operationId: operationIdV7(),
            artifact: versionedArtifact,
            requestedMode: 'dev',
          },
        });
      }
    } else if (shouldReset) {
      const seed = setup.seed && existsSync(setup.seed)
        ? readJsonArtifact(setup.seed, 'seed.json')
        : null;
      await postHostOp(state.serverUrl, adminToken, {
        operation: 'app.reset',
        ...(seed ? { seed } : {}),
      });
    }
    emit({
      event: 'server-setup',
      severity: 'note',
      loadedSchema: loaded.schema,
      loadedFunctions: loaded.functions,
      reset: shouldReset,
      resetPolicy: setup.reset,
    });
  }

  async function start() {
    if (mode === 'off') {
      state.shape = 'off';
      return publicState();
    }
    if (mode === 'external') {
      if (typeof externalUrl !== 'string' || externalUrl.length === 0) {
        throw diagnosticError('SNAPBACK_DEV_EXTERNAL_URL_REQUIRED', 'external mode requires server.url');
      }
      state.shape = 'external';
      state.serverUrl = externalUrl.replace(/\/$/, '');
      if (setup) {
        // External targets may be shared, staged, or long-lived; the MVP
        // plugin has no admin-token discovery for them and refuses all setup.
        if (setup.reset === 'always') {
          throw diagnosticError('SNAPBACK_DEV_SETUP_REFUSED', 'external targets are never reset or seeded by the plugin', {
            serverUrl: state.serverUrl,
          });
        }
        emit({
          event: 'setup-refused',
          code: 'SNAPBACK_DEV_SETUP_REFUSED',
          severity: 'warning',
          message: 'setup is configured but the external target is not plugin-managed; skipping load/reset/seed',
          serverUrl: state.serverUrl,
        });
      }
      const probe = await probeHealth(state.serverUrl);
      state.ready = probe.ok;
      if (!probe.ok) {
        emit({
          event: 'diagnostic',
          code: 'SNAPBACK_DEV_SERVER_UNREACHABLE',
          severity: 'error',
          message: `configured external Snapback target did not answer /health (${probe.cause})`,
          serverUrl: state.serverUrl,
        });
      }
    } else if (mode === 'attach') {
      await attachTo({ shape: 'attach' });
    } else if (mode === 'managed') {
      await spawnManaged();
    } else if (mode === 'auto') {
      if (existsSync(readyFile)) {
        try {
          await attachTo({ shape: 'attach' });
        } catch (error) {
          if (error?.code !== 'SNAPBACK_DEV_SERVER_STALE_DESCRIPTOR') throw error;
          // auto self-heals a descriptor whose server is provably gone;
          // spawnManaged re-verifies before removing it.
          emit({
            event: 'diagnostic',
            code: 'SNAPBACK_DEV_SERVER_STALE_DESCRIPTOR',
            severity: 'warning',
            message: 'stale readiness descriptor in auto mode; spawning a managed server instead',
            readyFile,
          });
          await spawnManaged();
        }
      } else {
        await spawnManaged();
      }
    }
    emit({
      event: 'server-ready',
      severity: 'note',
      shape: state.shape,
      managed: state.managed,
      serverUrl: state.serverUrl,
      pid: state.pid,
      ready: state.ready,
    });
    warnMissingDevIdentityHandoff();
    return publicState();
  }

  function publicState() {
    return { ...state };
  }

  // Re-resolve the backend target from the ready file after the relay hits a
  // refused connection: a `snapback dev` backend restart rewrites the
  // descriptor (possibly with a new port), and the running relay must keep
  // working without restarting the client process. Verified exactly like
  // attach — target fencing plus the live startupNonce probe — and never a
  // mutation path: no spawn, no setup, no ownership change. Returns the
  // refreshed state, or null when no live verified target exists.
  //
  // @ref LLP 0079#sc-2b-wire-the-client-arm-into-the-dev-loop-watch-process-from-llp-0078-r1-a3 —
  //   backend restart under a live relay re-resolves through the same
  //   ready-file surface instead of caching one target forever.
  let refreshInFlight = null;
  function refreshTarget() {
    if (closed || mode === 'off' || mode === 'external') return Promise.resolve(null);
    refreshInFlight ??= (async () => {
      try {
        if (!existsSync(readyFile)) return null;
        const candidate = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
        const probe = await probeHealth(candidate.serverUrl);
        const staleNonce = typeof candidate.startupNonce === 'string'
          && probe.ok
          && probe.health?.binary?.startupNonce !== candidate.startupNonce;
        if (!probe.ok || staleNonce) return null;
        const changed = state.serverUrl !== candidate.serverUrl || state.pid !== (candidate.pid ?? null);
        descriptor = candidate;
        state.serverUrl = candidate.serverUrl;
        state.pid = candidate.pid ?? null;
        state.ready = true;
        if (changed) {
          emit({
            event: 'server-target-refreshed',
            severity: 'note',
            message: 'relay re-resolved its backend target from the readiness descriptor',
            serverUrl: state.serverUrl,
            pid: state.pid,
          });
        }
        return publicState();
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function close() {
    if (closed) return;
    closed = true;
    // Teardown terminates only the child this session spawned; a server the
    // plugin merely attached or proxied to is never stopped.
    if (state.managed && child && child.exitCode === null) {
      const stop = native(runtime.binary, ['stop', '--ready-file', readyFile], { cwd: projectRoot });
      if (stop.status !== 0 && child.exitCode === null) {
        emit({
          event: 'diagnostic',
          code: 'SNAPBACK_DEV_SERVER_STOP_FAILED',
          severity: 'warning',
          message: 'nonce-verified stop failed; falling back to SIGTERM for the managed child',
          status: stop.status,
        });
        child.kill('SIGTERM');
      }
      const deadline = Date.now() + 5_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      emit({ event: 'server-stopped', severity: 'note', pid: state.pid });
    }
    state.ready = false;
  }

  return {
    mode,
    projectRoot,
    database,
    readyFile,
    start,
    close,
    refreshTarget,
    readDevIdentityCapability,
    state: publicState,
  };
}
