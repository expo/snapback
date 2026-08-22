// @expo/snapback-vite — mode-aware backend lifecycle for the managed dev plugin.
//
// The controller is deliberately Vite-free: the plugin in index.mjs is a thin
// projection of this module, so every mode decision is testable without a dev
// server. All process/handshake mechanics are the @expo/snapback-cli helpers — the
// plugin must not grow a second lifecycle dialect (LLP 0041's boundary with
// LLP 0030: same ready-file/host-ops surface, neither embeds the other).

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  diagnosticError,
  managedAdminToken,
  readApplicationReadyReceipt,
  readReadyDescriptor,
  resolveGeneratedArtifact,
  runDev,
  validateDevTarget,
  verifyDevAttach,
} from '@expo/snapback-cli';

export const LIFECYCLE_MODES = Object.freeze(['off', 'external', 'attach', 'managed', 'auto']);
const RESET_POLICIES = Object.freeze(['if-new', 'always', 'never']);

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
  };
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
  const applicationReadyFile = resolve(
    projectRoot,
    options.applicationReadyFile ?? `${readyFile}.application-ready`,
  );
  const externalUrl = options.url ?? null;
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const channel = options.channel ?? createDiagnosticsChannel(options);
  const setup = normalizeSetup(options.setup, projectRoot);
  const lifecycleEnv = options.env ?? process.env;
  const devIdentityHandoff = typeof lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE === 'string'
    && lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE.length > 0
    ? resolve(projectRoot, lifecycleEnv.SNAPBACK_DEV_IDENTITY_FILE)
    : null;

  let dev = null;
  let descriptor = null;
  let applicationReceipt = null;
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

  function updateApplicationReceipt(receipt) {
    const previousBinding = JSON.stringify(applicationReceipt?.binding ?? null);
    applicationReceipt = receipt;
    if (JSON.stringify(receipt.binding) !== previousBinding) {
      try {
        options.onBindingRefresh?.(receipt.binding);
      } catch {
        // A projection listener cannot own or interrupt the backend lifecycle.
      }
    }
    return receipt;
  }

  function refreshApplicationReceiptProjection() {
    return updateApplicationReceipt(readApplicationReadyReceipt(applicationReadyFile));
  }

  async function readVerifiedApplicationReceipt(candidate) {
    const expectedClientOrigin = options.clientOrigin ? new URL(options.clientOrigin).origin : null;
    const fixedPort = Number(new URL(candidate.serverUrl).port);
    const receipt = await verifyDevAttach({
      descriptor: candidate,
      readyFile,
      applicationReadyFile,
      adminToken: managedAdminToken(candidate, database),
      generatedRoot: join(setup.backendDirectory, 'generated'),
      requiredClientOrigins: expectedClientOrigin === null ? [] : [expectedClientOrigin],
      fixedPort,
    });
    return updateApplicationReceipt(receipt);
  }

  // Attach-shaped bring-up reuses runDev's complete identity cut. The only
  // post-cut mutations are the canonical idempotent generated load and a fresh
  // binding/receipt issuance; reset and seed remain forbidden.
  async function attachTo({ shape }) {
    if (!existsSync(readyFile)) {
      throw diagnosticError('SNAPBACK_DEV_READY_FILE_REQUIRED', `attach mode requires a readiness descriptor at ${readyFile}`, {
        readyFile,
      });
    }
    const candidate = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
    if (!setup?.backendDirectory) {
      throw diagnosticError(
        'SNAPBACK_DEV_SETUP_INVALID',
        'receipt-bound Vite attach requires setup.backendDirectory so the CLI identity cut can verify the intended generated application and reissue expired bindings',
        { supportedProfile: 'snapbackDev({ setup: { backendDirectory }, server: { mode: "attach", port } })' },
      );
    }
    if (setup.reset === 'always') {
      throw diagnosticError(
        'SNAPBACK_DEV_SETUP_REFUSED',
        'attached Vite consumers never reset or seed the existing lifecycle',
        { shape, serverUrl: candidate.serverUrl, database, reset: setup.reset },
      );
    }
    // Perform the complete read-only receipt/live-readiness cut before the
    // shared CLI path is allowed to reissue a binding or load artifacts.
    const observedReceipt = await readVerifiedApplicationReceipt(candidate);
    const backendPort = Number(new URL(candidate.serverUrl).port);
    dev = await runDev({
      backendDirectory: setup.backendDirectory,
      projectRoot,
      readyFile,
      applicationReadyFile,
      database,
      runtimeBinary: options.runtimeBinary,
      qualifiedRuntimeBinary: options.qualifiedRuntimeBinary,
      port: backendPort,
      externalClientOrigins: observedReceipt.clientOrigins,
      env: options.env,
      attach: true,
      watch: false,
      serverStdio: options.serverStdio ?? 'inherit',
      onEvent(event) {
        if (event.state === 'generated-and-loaded') refreshApplicationReceiptProjection();
        emit({
          event: 'backend-lifecycle',
          severity: event.ok === false ? 'error' : 'note',
          backend: event,
        });
      },
    });
    if (dev?.ok !== true) {
      const refusal = dev?.diagnostics?.[0] ?? {};
      throw diagnosticError(
        refusal.code ?? 'SNAPBACK_DEV_SERVER_START_FAILED',
        refusal.message ?? 'the canonical attach lifecycle did not become application-ready',
        refusal.details ?? { state: dev?.state ?? null },
      );
    }
    descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
    await readVerifiedApplicationReceipt(descriptor);
    state.shape = shape;
    state.serverUrl = descriptor.serverUrl;
    state.pid = descriptor.pid ?? null;
    state.ready = true;
    emit({
      event: 'server-setup',
      severity: 'note',
      source: 'snapback.application-ready.v1',
      loadedSchema: true,
      loadedFunctions: true,
      bindingReissued: true,
      reset: false,
      resetPolicy: setup.reset,
    });
  }

  async function spawnManaged() {
    if (existsSync(readyFile)) {
      throw diagnosticError(
        'SNAPBACK_DEV_SERVER_DB_OWNED',
        `managed mode refuses an existing lifecycle descriptor at ${readyFile}; use attach or auto mode`,
        { readyFile, database, safety: 'the existing listener and descriptor were not adopted or removed' },
      );
    }
    if (!setup?.backendDirectory) {
      throw diagnosticError(
        'SNAPBACK_DEV_SETUP_INVALID',
        'managed Vite lifecycle requires setup.backendDirectory so snapback dev owns generation and application readiness',
        { supportedProfile: 'snapbackDev({ setup: { backendDirectory }, server: { mode: "managed", port } })' },
      );
    }
    const databaseExisted = existsSync(database);
    try {
      // @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — Vite consumes the fixed profile of snapback dev and its application-ready receipt; it does not spawn native start or manufacture a parallel binding.
      dev = await runDev({
        backendDirectory: setup.backendDirectory,
        projectRoot,
        readyFile,
        applicationReadyFile,
        database,
        runtimeBinary: options.runtimeBinary,
        qualifiedRuntimeBinary: options.qualifiedRuntimeBinary,
        port: options.port,
        externalClientOrigin: options.clientOrigin,
        env: options.env,
        watch: true,
        serverStdio: options.serverStdio ?? 'inherit',
        onEvent(event) {
          if (event.state === 'generated-and-loaded') refreshApplicationReceiptProjection();
          emit({
            event: 'backend-lifecycle',
            severity: event.ok === false ? 'error' : 'note',
            backend: event,
          });
        },
      });
      if (dev?.ok !== true) {
        const refusal = dev?.diagnostics?.[0] ?? {};
        throw diagnosticError(
          refusal.code ?? 'SNAPBACK_DEV_SERVER_START_FAILED',
          refusal.message ?? 'the canonical Snapback development lifecycle did not become application-ready',
          refusal.details ?? { state: dev?.state ?? null },
        );
      }
      descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
      await readVerifiedApplicationReceipt(descriptor);
      state.shape = 'managed';
      state.managed = true;
      state.serverUrl = descriptor.serverUrl;
      state.pid = descriptor.pid ?? null;
      state.ready = true;
      if (setup.reset === 'always') {
        const reset = await dev.verbs['dev-fresh']({ requestId: `vite-${randomUUID()}` });
        if (reset?.ok !== true) {
          throw diagnosticError(
            'SNAPBACK_DEV_SERVER_SETUP_FAILED',
            'the explicitly requested Vite managed reset did not settle',
            { diagnostics: reset?.diagnostics ?? [] },
          );
        }
        descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
        await readVerifiedApplicationReceipt(descriptor);
        state.serverUrl = descriptor.serverUrl;
        state.pid = descriptor.pid ?? null;
      }
      emit({
        event: 'server-setup',
        severity: 'note',
        source: 'snapback.application-ready.v1',
        loadedSchema: true,
        loadedFunctions: true,
        reset: setup.reset === 'always'
          || (setup.reset === 'if-new' && !databaseExisted),
        resetPolicy: setup.reset,
      });
    } catch (error) {
      await dev?.close?.().catch(() => {});
      dev = null;
      throw error;
    }
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
          if (error?.code !== 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER') throw error;
          emit({
            event: 'diagnostic',
            code: 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER',
            severity: 'error',
            message: 'auto mode refuses a stale descriptor without removing or replacing its unverified lifecycle',
            readyFile,
          });
          throw error;
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
  // working without restarting the client process. Attach-shaped refresh
  // repeats the canonical CLI cut and binding reissue; managed refresh checks
  // the complete receipt against live OperationalReadinessV1.
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
        if (state.shape === 'attach') {
          await dev?.close?.();
          dev = null;
          await attachTo({ shape: 'attach' });
          return publicState();
        }
        const candidate = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
        const probe = await probeHealth(candidate.serverUrl);
        const staleNonce = typeof candidate.startupNonce === 'string'
          && probe.ok
          && probe.health?.binary?.startupNonce !== candidate.startupNonce;
        if (!probe.ok || staleNonce) return null;
        await readVerifiedApplicationReceipt(candidate);
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
    if (dev !== null) {
      await dev.close();
      dev = null;
      if (state.managed) {
        emit({ event: 'server-stopped', severity: 'note', pid: state.pid });
      }
    }
    state.ready = false;
    applicationReceipt = null;
  }

  return {
    mode,
    projectRoot,
    database,
    readyFile,
    applicationReadyFile,
    start,
    close,
    refreshTarget,
    readDevIdentityCapability,
    binding() { return applicationReceipt?.binding ?? null; },
    state: publicState,
  };
}
