// The LLP 0129 Phase-2b first rung: a desktop application owns this
// supervisor in-process while the packaged Snapback runtime remains a normal
// child process and HTTP remains its data channel.
//
// @ref LLP 0129#phases — the desktop ladder starts with a sidecar and an
// acceptance gate; a stable in-process ABI is a later, separately gated rung.
// @ref LLP 0030#readiness-and-port-discovery — attach binds one owner-only
// descriptor snapshot to the live startup nonce and its capability siblings.

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inspect } from 'node:util';

import {
  native,
  readReadyDescriptor,
  resolveRuntimeBinary,
  spawnManagedRuntime,
  validateDevTarget,
  waitForReady,
} from '@expo/snapback-cli';

const SIDECAR_SCHEMA_VERSION = 'snapback.desktop-sidecar.v1';
const SWAP_JOURNAL_SCHEMA_VERSION = 'snapback.desktop-sidecar-swap.v1';
const MANAGED_START_FLAGS = new Set(['--db', '--port', '--ready-file']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const DEFAULT_UPGRADE_REQUIRED_CODES = new Set([
  'SNAPBACK_UPGRADE_REQUIRED',
  'SNAPBACK_CLIENT_UPGRADE_REQUIRED',
  'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
]);

const delay = (milliseconds) => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds);
});

const canonicalPath = (path) => {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
};

const errorCode = (error) => (
  error?.diagnostic?.code ?? error?.code ?? 'SIDECAR_OPERATION_FAILED'
);

const childAlive = (child) => (
  child !== null
  && child !== undefined
  && child.exitCode === null
  && child.signalCode == null
);

const safeRuntime = (runtime) => Object.freeze({
  binary: runtime.binary,
  source: runtime.source,
  platform: runtime.platform,
});

const freezeDeep = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) freezeDeep(member);
    Object.freeze(value);
  }
  return value;
};

const ARTIFACT_GENERATION_KEYS = Object.freeze([
  'schemaVersion',
  'appId',
  'schemaHash',
  'bundleHash',
  'inputsHash',
]);

const normalizedUrl = (value) => (
  typeof value === 'string' ? value.replace(/\/$/u, '') : null
);

const validArtifactGeneration = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === ARTIFACT_GENERATION_KEYS.length
  && Object.keys(value).every((key) => ARTIFACT_GENERATION_KEYS.includes(key))
  && ARTIFACT_GENERATION_KEYS.every(
    (key) => typeof value[key] === 'string' && value[key].length > 0,
  )
);

const sameArtifactGeneration = (left, right) => (
  validArtifactGeneration(left)
  && validArtifactGeneration(right)
  && ARTIFACT_GENERATION_KEYS.every((key) => left[key] === right[key])
);

const validFreshSnapshotBarrier = (value) => (
  value?.schemaVersion === 'snapback.outbox-fresh-snapshot-barrier.v1'
  && value.status === 'passed'
  && value.kind === 'full-snapshot'
);

const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

const validStoreHandoffSnapshot = (snapshot) => (
  snapshot?.schemaVersion === 'snapback.desktop-sidecar-store-handoff.v1'
  && typeof snapshot.clientStoreId === 'string'
  && snapshot.clientStoreId.length > 0
  && snapshot.writer === true
  && validArtifactGeneration(snapshot.artifactGeneration)
  && validCount(snapshot.pending)
  && validCount(snapshot.failed)
  && validCount(snapshot.quarantined)
  && validCount(snapshot.resultGone)
);

export class SidecarError extends Error {
  constructor(code, message, details = undefined, options = undefined) {
    super(message, options);
    this.name = 'SidecarError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export class SidecarChildDiedError extends SidecarError {
  constructor({ pid, exitCode, signal, generation, restartAttempt = 0 }) {
    super(
      'SIDECAR_CHILD_DIED',
      `Snapback sidecar child ${pid ?? 'unknown'} exited unexpectedly`,
      { pid: pid ?? null, exitCode: exitCode ?? null, signal: signal ?? null, generation, restartAttempt },
    );
    this.name = 'SidecarChildDiedError';
    this.pid = pid ?? null;
    this.exitCode = exitCode ?? null;
    this.signal = signal ?? null;
    this.generation = generation;
    this.restartAttempt = restartAttempt;
  }
}

export class SidecarSwapError extends SidecarError {
  constructor(message, { cause, attached, attachment = null, resumeErrorCode = null }) {
    super(
      'SIDECAR_SWAP_FAILED',
      message,
      {
        causeCode: errorCode(cause),
        attached,
        resumeErrorCode,
      },
      { cause },
    );
    this.name = 'SidecarSwapError';
    this.attached = attached;
    this.attachment = attachment;
  }
}

function validateOwnerOnlyRegularFile(path, expectedPath, kind) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new SidecarError(
      'SIDECAR_READY_DESCRIPTOR_INVALID',
      `readiness descriptor has no ${kind} capability path`,
      { kind },
    );
  }
  const expected = canonicalPath(expectedPath);
  const observed = canonicalPath(path);
  if (observed !== expected) {
    throw new SidecarError(
      'SIDECAR_CAPABILITY_PATH_INVALID',
      `${kind} capability is not the mechanically expected owner-only sibling`,
      { kind, expectedPath: expected, observedPath: observed },
    );
  }
  let metadata;
  try {
    metadata = lstatSync(expected);
  } catch (cause) {
    throw new SidecarError(
      'SIDECAR_CAPABILITY_FILE_INVALID',
      `${kind} capability file is missing or unreadable`,
      { kind, path: expected },
      { cause },
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new SidecarError(
      'SIDECAR_CAPABILITY_FILE_INVALID',
      `${kind} capability must be an owner-only regular file`,
      {
        kind,
        path: expected,
        observedMode: (metadata.mode & 0o7777).toString(8).padStart(4, '0'),
        regularFile: metadata.isFile(),
        symbolicLink: metadata.isSymbolicLink(),
      },
    );
  }
  return expected;
}

/** Validate the Rust-owned HostReadyDescriptor plus the desktop-specific
 * port, database-custody, child-identity, and capability-sibling invariants. */
export function validateHostReadyDescriptor(descriptor, {
  readyFile,
  database,
  childPid = null,
  allowNonLoopback = false,
} = {}) {
  if (!readyFile || !database) {
    throw new TypeError('validateHostReadyDescriptor requires readyFile and database');
  }
  validateOwnerOnlyRegularFile(readyFile, readyFile, 'readiness descriptor');
  const target = validateDevTarget(descriptor, { readyFile, database });
  const problems = [];
  if (target.schemaVersion !== 'snapback.v0') problems.push('schemaVersion');
  if (target.descriptorKind !== 'snapbackHostReady') problems.push('descriptorKind');
  if (target.ready !== true) problems.push('ready');
  if (typeof target.startupId !== 'string' || target.startupId.length === 0) problems.push('startupId');
  if (!Number.isInteger(target.pid) || target.pid <= 0) problems.push('pid');
  if (childPid !== null && target.pid !== childPid) problems.push('childPid');
  if (typeof target.startupNonce !== 'string' || target.startupNonce.length === 0) problems.push('startupNonce');
  if (!Number.isInteger(target.port) || target.port <= 0 || target.port > 65_535) problems.push('port');
  if (target.database?.mode !== 'file') problems.push('database.mode');
  if (typeof target.target?.targetProfile !== 'string' || target.target.targetProfile.length === 0) {
    problems.push('target.targetProfile');
  }

  let url;
  try {
    url = new URL(target.serverUrl);
  } catch {
    problems.push('serverUrl');
  }
  if (url) {
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    const urlPort = Number(url.port || (url.protocol === 'http:' ? 80 : 0));
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) {
      problems.push('serverUrl.origin');
    }
    if (url.pathname !== '/' && url.pathname !== '') problems.push('serverUrl.path');
    if (hostname !== target.host || urlPort !== target.port) problems.push('serverUrl.address');
    if (!allowNonLoopback && (!LOOPBACK_HOSTS.has(hostname) || !LOOPBACK_HOSTS.has(target.host))) {
      problems.push('serverUrl.loopback');
    }
  }
  if (target.target?.serverUrl != null && target.target.serverUrl !== target.serverUrl) {
    problems.push('target.serverUrl');
  }
  if (problems.length > 0) {
    throw new SidecarError(
      'SIDECAR_READY_DESCRIPTOR_INVALID',
      'Snapback readiness descriptor failed desktop-sidecar validation',
      { readyFile: resolve(readyFile), problems },
    );
  }

  const expectedAdminToken = `${resolve(database)}.admin-token`;
  const expectedSecretReadRoot = `${resolve(readyFile)}.secret-read-root`;
  const expectedImpersonation = `${resolve(readyFile)}.impersonation`;
  validateOwnerOnlyRegularFile(target.adminTokenFile, expectedAdminToken, 'admin-token');
  validateOwnerOnlyRegularFile(target.secretReadRootFile, expectedSecretReadRoot, 'secret-read-root');
  validateOwnerOnlyRegularFile(
    target.impersonationCapabilityFile,
    expectedImpersonation,
    'impersonation',
  );
  return freezeDeep(structuredClone(target));
}

async function probeHealth(fetchImplementation, descriptor, timeoutMs) {
  try {
    const response = await fetchImplementation(
      `${descriptor.serverUrl.replace(/\/$/u, '')}/health`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const health = await response.json();
    if (health?.binary?.startupNonce !== descriptor.startupNonce) {
      return { ok: false, reason: 'startupNonce mismatch', health };
    }
    return { ok: true, health };
  } catch (cause) {
    return { ok: false, reason: cause?.message ?? String(cause) };
  }
}

class OwnerOnlyCapabilityHandle {
  #assertCurrent;

  constructor(kind, path, assertCurrent) {
    this.kind = kind;
    this.path = path;
    this.available = true;
    this.#assertCurrent = assertCurrent;
    Object.freeze(this);
  }

  async read() {
    await this.#assertCurrent();
    validateOwnerOnlyRegularFile(this.path, this.path, this.kind);
    return readFileSync(this.path, 'utf8').trim();
  }

  toJSON() {
    return { kind: this.kind, path: this.path, available: true, secret: '[REDACTED]' };
  }

  [inspect.custom]() {
    return `OwnerOnlyCapabilityHandle { kind: ${this.kind}, path: ${this.path}, secret: [REDACTED] }`;
  }
}

function normalizeStartArgs(startArgs) {
  if (!Array.isArray(startArgs)) throw new TypeError('startArgs must be an array');
  const normalized = startArgs.map((argument) => String(argument));
  const managed = normalized.find((argument) => MANAGED_START_FLAGS.has(argument));
  if (managed) {
    throw new SidecarError(
      'SIDECAR_START_ARGUMENT_RESERVED',
      `${managed} is sidecar-owned and cannot be overridden`,
      { argument: managed },
    );
  }
  return Object.freeze(normalized);
}

function normalizeRestartPolicy(policy = {}) {
  const maxAttempts = policy.maxAttempts ?? 0;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 100) {
    throw new TypeError('restartPolicy.maxAttempts must be an integer from 0 through 100');
  }
  const decide = typeof policy.decide === 'function'
    ? policy.decide
    : () => (policy.mode === 'restart' ? 'restart' : 'surface');
  const backoff = policy.backoffMs ?? ((attempt) => Math.min(1_000, 50 * (2 ** (attempt - 1))));
  const backoffMs = (attempt) => {
    const value = typeof backoff === 'function' ? backoff(attempt) : backoff;
    if (!Number.isFinite(value) || value < 0 || value > 60_000) {
      throw new SidecarError(
        'SIDECAR_RESTART_POLICY_INVALID',
        'restart backoff must be between 0 and 60000 milliseconds',
        { attempt },
      );
    }
    return Math.trunc(value);
  };
  return Object.freeze({ maxAttempts, decide, backoffMs });
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

async function waitForChildExit(child, timeoutMs) {
  if (!childAlive(child)) return true;
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off?.('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    timer.unref?.();
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
}

async function waitUntil(predicate, timeoutMs, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return Boolean(await predicate());
}

export function isUpgradeRequiredRefusal(error, additionalCodes = []) {
  const codes = new Set([...DEFAULT_UPGRADE_REQUIRED_CODES, ...additionalCodes]);
  const code = errorCode(error);
  return codes.has(code) || /(?:^|_)UPGRADE_REQUIRED$/u.test(code);
}

export class SnapbackSidecarSupervisor {
  #attachment = null;
  #current = null;
  #fetch;
  #generation = 0;
  #journalPath;
  #lastError = null;
  #listeners = new Set();
  #operation = Promise.resolve();
  #outbox;
  #restartPolicy;
  #runtimeSelection;
  #state = 'idle';
  #upgradeRequiredCodes;

  constructor(options = {}) {
    if (typeof options.database !== 'string' || options.database.length === 0) {
      throw new TypeError('createSidecarSupervisor requires an absolute or project-relative database');
    }
    this.projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.database = resolve(this.projectRoot, options.database);
    this.stateDirectory = resolve(
      this.projectRoot,
      options.stateDirectory ?? `${this.database}.sidecar-state`,
    );
    this.readyFile = join(this.stateDirectory, 'runtime.ready.json');
    this.readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 10_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 2_000;
    this.startArgs = normalizeStartArgs(options.startArgs ?? []);
    this.serverStdio = options.serverStdio ?? ['ignore', 'ignore', 'ignore'];
    this.environment = options.env ?? process.env;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') throw new TypeError('sidecar requires fetch');
    this.#runtimeSelection = Object.freeze({
      ...(options.runtimeBinary ? { runtimeBinary: options.runtimeBinary } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
    });
    this.#restartPolicy = normalizeRestartPolicy(options.restartPolicy);
    this.#outbox = options.outbox ?? null;
    this.onUpgradeRequired = options.onUpgradeRequired ?? null;
    if (this.onUpgradeRequired !== null && typeof this.onUpgradeRequired !== 'function') {
      throw new TypeError('onUpgradeRequired must be a function');
    }
    this.#upgradeRequiredCodes = Object.freeze([...(options.upgradeRequiredCodes ?? [])]);

    mkdirSync(dirname(this.database), { recursive: true });
    mkdirSync(this.stateDirectory, { recursive: true, mode: 0o700 });
    chmodSync(this.stateDirectory, 0o700);
    this.#journalPath = join(this.stateDirectory, 'swap-journal.json');
  }

  get attachment() {
    return this.#attachment;
  }

  get lastError() {
    return this.#lastError;
  }

  status() {
    return Object.freeze({
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      state: this.#state,
      attachment: this.#attachment,
      lastError: this.#lastError,
      restartPolicy: Object.freeze({ maxAttempts: this.#restartPolicy.maxAttempts }),
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a listener');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    const payload = Object.freeze({
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      atMs: Date.now(),
      state: this.#state,
      ...event,
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(payload);
      } catch {
        // Observation cannot own the runtime lifecycle.
      }
    }
    return payload;
  }

  #withLock(operation) {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.catch(() => {});
    return result;
  }

  async #rebindAndResumeOutbox(lease, { outcome, attachment, snapshot }) {
    // @ref LLP 0043#milestone-2-queued-mutation-replay — the app-owned
    // client keeps the durable replay identity; lifecycle may select its
    // transport, but cannot claim success while that queue remains pending.
    if (typeof lease.rebind !== 'function') {
      throw new SidecarError(
        'SIDECAR_OUTBOX_ADAPTER_INVALID',
        'outbox lease must rebind the app client to the selected attachment before replay resumes',
      );
    }
    const context = Object.freeze({ outcome, attachment, snapshot });
    const binding = await lease.rebind(context);
    const attachedUrl = binding?.attachedUrl;
    if (
      typeof attachedUrl !== 'string'
      || normalizedUrl(attachedUrl) !== normalizedUrl(attachment.url)
    ) {
      throw new SidecarError(
        'SIDECAR_OUTBOX_REBIND_MISMATCH',
        'outbox rebind did not attest the selected runtime URL',
        {
          expectedUrl: attachment.url,
          observedUrl: typeof attachedUrl === 'string' ? attachedUrl : null,
        },
      );
    }
    const bindingV2 = binding?.schemaVersion === 'snapback.desktop-sidecar-binding.v2';
    if (!bindingV2) {
      // The v1 adapter remains valid only for the already-shipped cold swap:
      // a positively observed empty queue. Pending work requires the explicit
      // shared-store/generation/freshness handoff below.
      if (snapshot?.pending !== 0) {
        throw new SidecarError(
          'SIDECAR_OUTBOX_HANDOFF_REQUIRED',
          'pending work requires a v2 shared-store binding before candidate replay',
          { observedPending: validCount(snapshot?.pending) ? snapshot.pending : null },
        );
      }
    } else if (
      !validStoreHandoffSnapshot(snapshot)
      || binding.startupNonce !== attachment.healthyStart.startupNonce
      || binding.clientStoreId !== snapshot.clientStoreId
      || binding.writer !== true
      || !validFreshSnapshotBarrier(binding.freshSnapshotBarrier)
      || !sameArtifactGeneration(binding.artifactGeneration, snapshot.artifactGeneration)
    ) {
      throw new SidecarError(
        'SIDECAR_OUTBOX_REBIND_INVALID',
        'v2 outbox binding must attest the candidate URL/nonce, shared store writer, fresh snapshot, and exact artifact generation',
        {
          expectedUrl: attachment.url,
          expectedStartupNonce: attachment.healthyStart.startupNonce,
          expectedClientStoreId: snapshot?.clientStoreId ?? null,
        },
      );
    }
    const receipt = await lease.resume(Object.freeze({ ...context, binding }));
    const receiptV2 = receipt?.schemaVersion === 'snapback.desktop-sidecar-outbox-resume.v2';
    const validLegacyReceipt = !bindingV2
      && receipt?.schemaVersion === 'snapback.desktop-sidecar-outbox-resume.v1'
      && normalizedUrl(receipt.attachedUrl) === normalizedUrl(attachment.url)
      && validCount(receipt.replayed)
      && validCount(receipt.remaining);
    const validAdoptionReceipt = bindingV2
      && receiptV2
      && normalizedUrl(receipt.attachedUrl) === normalizedUrl(attachment.url)
      && receipt.startupNonce === attachment.healthyStart.startupNonce
      && receipt.clientStoreId === binding.clientStoreId
      && receipt.writer === true
      && validFreshSnapshotBarrier(receipt.freshSnapshotBarrier)
      && sameArtifactGeneration(receipt.artifactGeneration, binding.artifactGeneration)
      && validCount(receipt.pendingBefore)
      && receipt.pendingBefore === snapshot.pending
      && validCount(receipt.replayed)
      && receipt.replayed <= receipt.pendingBefore
      && validCount(receipt.failedDelta)
      && validCount(receipt.quarantinedDelta)
      && validCount(receipt.resultGoneDelta)
      && validCount(receipt.remaining)
      && typeof receipt.stopped === 'boolean';
    if (!validLegacyReceipt && !validAdoptionReceipt) {
      throw new SidecarError(
        'SIDECAR_OUTBOX_RESUME_INVALID',
        'outbox resume must return a binding-matched replay/adoption receipt',
        { expectedUrl: attachment.url },
      );
    }
    if (
      receipt.stopped === true
      || receipt.remaining !== 0
      || (receiptV2 && (
        receipt.stopped !== false
        || receipt.replayed !== receipt.pendingBefore
        || receipt.failedDelta !== 0
        || receipt.quarantinedDelta !== 0
        || receipt.resultGoneDelta !== 0
      ))
    ) {
      throw new SidecarError(
        'SIDECAR_OUTBOX_RESUME_INCOMPLETE',
        'outbox replay did not drain after binding to the selected runtime',
        {
          attachedUrl: receipt.attachedUrl,
          replayed: receipt.replayed,
          remaining: receipt.remaining,
          stopped: receipt.stopped === true,
          ...(receiptV2 ? {
            failedDelta: receipt.failedDelta,
            quarantinedDelta: receipt.quarantinedDelta,
            resultGoneDelta: receipt.resultGoneDelta,
          } : {}),
        },
      );
    }
    return freezeDeep(structuredClone(receipt));
  }

  start() {
    return this.#withLock(async () => {
      if (this.#attachment !== null && this.#state === 'attached') return this.#attachment;
      this.#state = 'starting';
      try {
        let record;
        if (existsSync(this.#journalPath)) {
          record = await this.#recoverSwapJournal();
        } else {
          const runtime = resolveRuntimeBinary(this.#runtimeSelection);
          record = await this.#spawnRecord(runtime, 'start');
        }
        this.#adoptRecord(record);
        this.#state = 'attached';
        this.#emit({ type: 'healthy-start', attachment: record.attachment });
        return record.attachment;
      } catch (error) {
        this.#state = 'failed';
        this.#emit({ type: 'start-failed', code: errorCode(error) });
        throw error;
      }
    });
  }

  stop() {
    return this.#withLock(async () => {
      if (this.#current === null) {
        this.#state = 'idle';
        return Object.freeze({
          schemaVersion: 'snapback.desktop-sidecar-stop.v1',
          alreadyStopped: true,
          graceful: true,
        });
      }
      this.#state = 'stopping';
      const record = this.#current;
      try {
        const receipt = await this.#stopRecord(record);
        this.#clearRecord(record);
        this.#state = 'idle';
        this.#emit({ type: 'stopped', receipt });
        return receipt;
      } catch (error) {
        const health = await probeHealth(this.#fetch, record.descriptor, this.healthTimeoutMs);
        if (health.ok) {
          record.expectedExit = false;
          this.#state = 'attached';
        } else {
          this.#clearRecord(record);
          this.#state = 'failed';
        }
        this.#emit({ type: 'stop-failed', code: errorCode(error) });
        throw error;
      }
    });
  }

  health() {
    return this.#withLock(async () => {
      if (this.#current === null) {
        throw new SidecarError('SIDECAR_NOT_ATTACHED', 'sidecar has no attached runtime');
      }
      return this.#attestRecord(this.#current);
    });
  }

  swap({ runtime = {}, verifyCandidate = null } = {}) {
    return this.#withLock(async () => {
      if (this.#current === null || this.#state !== 'attached') {
        throw new SidecarError('SIDECAR_NOT_ATTACHED', 'runtime swap requires an attached sidecar');
      }
      if (!this.#outbox || typeof this.#outbox.quiesce !== 'function') {
        throw new SidecarError(
          'SIDECAR_OUTBOX_ADAPTER_REQUIRED',
          'runtime swap requires the embedding app client-outbox quiesce adapter',
        );
      }
      if (verifyCandidate !== null && typeof verifyCandidate !== 'function') {
        throw new TypeError('verifyCandidate must be a function');
      }
      const old = this.#current;
      const selection = {
        ...(runtime.runtimeBinary ? { runtimeBinary: runtime.runtimeBinary } : {}),
        ...(runtime.platform ? { platform: runtime.platform } : {}),
      };
      const nextRuntime = resolveRuntimeBinary(selection);
      this.#state = 'swapping';
      this.#emit({
        type: 'swap-started',
        from: safeRuntime(old.runtime),
        to: safeRuntime(nextRuntime),
      });

      let lease;
      try {
        lease = await this.#outbox.quiesce(Object.freeze({
          reason: 'runtime-swap',
          attachment: old.attachment,
          from: safeRuntime(old.runtime),
          to: safeRuntime(nextRuntime),
        }));
      } catch (cause) {
        this.#state = 'attached';
        throw new SidecarSwapError('runtime swap was refused while quiescing the app outbox', {
          cause,
          attached: 'old',
          attachment: old.attachment,
        });
      }
      if (
        !lease
        || typeof lease !== 'object'
        || typeof lease.rebind !== 'function'
        || typeof lease.resume !== 'function'
      ) {
        this.#state = 'attached';
        throw new SidecarError(
          'SIDECAR_OUTBOX_ADAPTER_INVALID',
          'outbox.quiesce must return a lease with rebind() and resume()',
        );
      }
      let outboxSnapshot = lease.snapshot ?? null;
      try {
        await lease.settled?.();
        outboxSnapshot ??= await this.#outbox.status?.() ?? null;
      } catch (cause) {
        let resumeErrorCode = null;
        try {
          await this.#rebindAndResumeOutbox(lease, {
            outcome: 'unchanged',
            attachment: old.attachment,
            snapshot: outboxSnapshot,
          });
        } catch (resumeError) {
          resumeErrorCode = errorCode(resumeError);
        }
        this.#state = 'attached';
        throw new SidecarSwapError('runtime swap was refused while settling the app outbox', {
          cause,
          attached: 'old',
          attachment: old.attachment,
          resumeErrorCode,
        });
      }
      const journalBase = {
        schemaVersion: SWAP_JOURNAL_SCHEMA_VERSION,
        swapId: randomUUID(),
        database: this.database,
        readyFile: this.readyFile,
        oldRuntime: safeRuntime(old.runtime),
        newRuntime: safeRuntime(nextRuntime),
        startArgs: this.startArgs,
        preparedAtMs: Date.now(),
      };
      let oldStopped = false;
      let candidate = null;
      try {
        this.#writeJournal({ ...journalBase, stage: 'prepared' });
        await this.#stopRecord(old);
        oldStopped = true;
        this.#clearRecord(old);
        this.#writeJournal({ ...journalBase, stage: 'old-stopped' });

        candidate = await this.#spawnRecord(nextRuntime, 'swap-candidate', { watch: false });
        this.#writeJournal({
          ...journalBase,
          stage: 'candidate-attached',
          candidateStartupNonce: candidate.descriptor.startupNonce,
        });
        await verifyCandidate?.(candidate.attachment);
        await this.#attestRecord(candidate);
        const outboxResume = await this.#rebindAndResumeOutbox(lease, {
          outcome: 'swapped',
          attachment: candidate.attachment,
          snapshot: outboxSnapshot,
        });

        this.#writeJournal({
          ...journalBase,
          stage: 'new-attached',
          candidateStartupNonce: candidate.descriptor.startupNonce,
        });
        this.#adoptRecord(candidate);
        this.#runtimeSelection = Object.freeze(selection);
        this.#removeJournal();
        this.#state = 'attached';
        const receipt = Object.freeze({
          schemaVersion: 'snapback.desktop-sidecar-swap-receipt.v1',
          swapId: journalBase.swapId,
          outcome: 'swapped',
          fromPid: old.attachment.pid,
          toPid: candidate.attachment.pid,
          from: safeRuntime(old.runtime),
          to: safeRuntime(nextRuntime),
          attachment: candidate.attachment,
          outboxSnapshot,
          outboxResume,
        });
        this.#emit({ type: 'swap-completed', receipt });
        return receipt;
      } catch (cause) {
        if (isUpgradeRequiredRefusal(cause, this.#upgradeRequiredCodes)) {
          this.#emit({ type: 'upgrade-required', code: errorCode(cause) });
          try {
            await this.onUpgradeRequired?.(Object.freeze({
              error: cause,
              from: safeRuntime(old.runtime),
              attempted: safeRuntime(nextRuntime),
              outboxSnapshot,
            }));
          } catch (hookError) {
            this.#emit({ type: 'upgrade-required-hook-failed', code: errorCode(hookError) });
          }
        }

        if (!oldStopped && this.#current === old) {
          const oldHealth = await probeHealth(this.#fetch, old.descriptor, this.healthTimeoutMs);
          if (oldHealth.ok) {
            this.#removeJournal();
            let resumeErrorCode = null;
            try {
              await this.#rebindAndResumeOutbox(lease, {
                outcome: 'unchanged',
                attachment: old.attachment,
                snapshot: outboxSnapshot,
              });
            } catch (resumeError) {
              resumeErrorCode = errorCode(resumeError);
            }
            this.#state = 'attached';
            throw new SidecarSwapError('runtime swap failed before the old child stopped', {
              cause,
              attached: 'old',
              attachment: old.attachment,
              resumeErrorCode,
            });
          }
        }

        if (candidate && childAlive(candidate.child)) {
          try {
            await this.#stopRecord(candidate);
          } catch {
            // stopRecord already escalates only this candidate child.
          }
        }
        this.#clearRecord(candidate);
        this.#writeJournal({ ...journalBase, stage: 'rolling-back', causeCode: errorCode(cause) });
        const recovered = await this.#recoverOneOf([old.runtime, nextRuntime], 'swap-rollback');
        this.#adoptRecord(recovered);
        this.#removeJournal();
        let resumeErrorCode = null;
        try {
          await this.#rebindAndResumeOutbox(lease, {
            outcome: recovered.runtime.binary === old.runtime.binary ? 'rolled-back' : 'recovered-new',
            attachment: recovered.attachment,
            snapshot: outboxSnapshot,
          });
        } catch (resumeError) {
          resumeErrorCode = errorCode(resumeError);
        }
        this.#state = 'attached';
        const attached = recovered.runtime.binary === old.runtime.binary ? 'old' : 'new';
        this.#emit({
          type: 'swap-rolled-back',
          code: errorCode(cause),
          attached,
          attachment: recovered.attachment,
        });
        throw new SidecarSwapError(
          `runtime swap failed; the supervisor recovered the ${attached} runtime`,
          { cause, attached, attachment: recovered.attachment, resumeErrorCode },
        );
      }
    });
  }

  async #spawnRecord(runtime, purpose, { watch = true } = {}) {
    await this.#removeStaleReadyArtifacts();
    const generation = ++this.#generation;
    const childEnvironment = { ...this.environment };
    // @ref LLP 0301#2-origin-admission--the-path-split-implemented — the
    // posture is lifecycle-owner input, never ambient.
    delete childEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE;
    const child = spawnManagedRuntime(runtime.binary, [
      'start',
      '--ready-file', this.readyFile,
      '--db', this.database,
      '--port', '0',
      ...this.startArgs,
    ], {
      cwd: this.projectRoot,
      env: childEnvironment,
      stdio: this.serverStdio,
    });
    let descriptor;
    try {
      descriptor = validateHostReadyDescriptor(
        await waitForReady(this.readyFile, child, this.readyTimeoutMs),
        {
          readyFile: this.readyFile,
          database: this.database,
          childPid: child.pid ?? null,
        },
      );
      const record = await this.#recordFromDescriptor({
        runtime,
        child,
        descriptor,
        generation,
        purpose,
      });
      if (watch) this.#watchRecord(record);
      return record;
    } catch (cause) {
      if (childAlive(child)) child.kill('SIGTERM');
      if (!(await waitForChildExit(child, 1_000)) && childAlive(child)) child.kill('SIGKILL');
      throw new SidecarError(
        'SIDECAR_START_FAILED',
        'Snapback sidecar child did not reach validated healthy readiness',
        { purpose, runtime: safeRuntime(runtime), causeCode: errorCode(cause) },
        { cause },
      );
    }
  }

  async #recordFromDescriptor({ runtime, child, descriptor, generation, purpose }) {
    const health = await probeHealth(this.#fetch, descriptor, this.healthTimeoutMs);
    if (!health.ok) {
      throw new SidecarError(
        'SIDECAR_HEALTH_ATTESTATION_FAILED',
        'readiness descriptor did not match the live Snapback health identity',
        { reason: health.reason, serverUrl: descriptor.serverUrl },
      );
    }
    const assertCurrent = async () => {
      const probe = await probeHealth(this.#fetch, descriptor, this.healthTimeoutMs);
      if (!probe.ok) {
        throw new SidecarError(
          'SIDECAR_CAPABILITY_STALE',
          'capability read refused because the descriptor no longer names the live process',
          { kind: 'owner-only', reason: probe.reason },
        );
      }
    };
    const capabilities = Object.freeze({
      adminToken: new OwnerOnlyCapabilityHandle(
        'admin-token',
        descriptor.adminTokenFile,
        assertCurrent,
      ),
      secretReadRoot: new OwnerOnlyCapabilityHandle(
        'secret-read-root',
        descriptor.secretReadRootFile,
        assertCurrent,
      ),
      impersonation: new OwnerOnlyCapabilityHandle(
        'impersonation',
        descriptor.impersonationCapabilityFile,
        assertCurrent,
      ),
    });
    const descriptorSha256 = `sha256:${createHash('sha256')
      .update(JSON.stringify(descriptor))
      .digest('hex')}`;
    const attachment = Object.freeze({
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      generation,
      purpose,
      pid: descriptor.pid,
      url: descriptor.serverUrl,
      port: descriptor.port,
      database: Object.freeze({ mode: descriptor.database.mode, path: descriptor.database.path }),
      runtime: safeRuntime(runtime),
      descriptor,
      capabilities,
      healthyStart: Object.freeze({
        attested: true,
        checkedAtMs: Date.now(),
        descriptorSha256,
        startupNonce: descriptor.startupNonce,
        requestedPort: 0,
        actualPort: descriptor.port,
      }),
    });
    return {
      runtime,
      child,
      descriptor,
      generation,
      purpose,
      attachment,
      expectedExit: false,
      monitor: null,
    };
  }

  #adoptRecord(record) {
    this.#current = record;
    this.#attachment = record.attachment;
    this.#watchRecord(record);
  }

  #clearRecord(record) {
    if (!record) return;
    if (record.monitor && record.monitor.kind !== 'child-event') clearInterval(record.monitor);
    record.monitor = null;
    if (this.#current === record) this.#current = null;
    if (this.#attachment === record.attachment) this.#attachment = null;
  }

  #watchRecord(record) {
    if (!record || record.monitor) return;
    if (record.child) {
      const exited = (exitCode, signal) => {
        if (record.expectedExit) return;
        void this.#withLock(() => this.#handleUnexpectedExit(record, exitCode, signal));
      };
      record.child.once('exit', exited);
      record.monitor = { kind: 'child-event' };
      if (!childAlive(record.child)) {
        queueMicrotask(() => exited(record.child.exitCode, record.child.signalCode));
      }
      return;
    }
    let probing = false;
    let failures = 0;
    const timer = setInterval(async () => {
      if (probing || record.expectedExit || this.#current !== record) return;
      probing = true;
      try {
        const health = await probeHealth(this.#fetch, record.descriptor, this.healthTimeoutMs);
        failures = health.ok ? 0 : failures + 1;
        if (failures >= 2) {
          clearInterval(timer);
          record.monitor = null;
          void this.#withLock(() => this.#handleUnexpectedExit(record, null, 'health-lost'));
        }
      } finally {
        probing = false;
      }
    }, 500);
    timer.unref?.();
    record.monitor = timer;
  }

  async #handleUnexpectedExit(record, exitCode, signal) {
    if (record.expectedExit || this.#current !== record) return;
    this.#clearRecord(record);
    this.#state = 'failed';
    let died = new SidecarChildDiedError({
      pid: record.attachment.pid,
      exitCode,
      signal,
      generation: record.generation,
    });
    this.#lastError = died;
    this.#emit({ type: 'child-died', error: died });

    for (let attempt = 1; attempt <= this.#restartPolicy.maxAttempts; attempt += 1) {
      let decision;
      try {
        decision = await this.#restartPolicy.decide(Object.freeze({
          error: died,
          attempt,
          maxAttempts: this.#restartPolicy.maxAttempts,
        }));
      } catch (cause) {
        this.#emit({ type: 'restart-decision-failed', attempt, code: errorCode(cause), error: died });
        break;
      }
      if (decision !== 'restart') break;
      const backoffMs = this.#restartPolicy.backoffMs(attempt);
      this.#emit({ type: 'restart-scheduled', attempt, backoffMs, error: died });
      if (backoffMs > 0) await delay(backoffMs);
      try {
        const restarted = await this.#spawnRecord(record.runtime, 'crash-restart');
        this.#adoptRecord(restarted);
        this.#state = 'attached';
        this.#emit({ type: 'restarted', attempt, attachment: restarted.attachment, error: died });
        return;
      } catch (cause) {
        died = new SidecarChildDiedError({
          pid: null,
          exitCode: null,
          signal: errorCode(cause),
          generation: record.generation,
          restartAttempt: attempt,
        });
        this.#lastError = died;
        this.#emit({ type: 'restart-failed', attempt, error: died });
      }
    }
    this.#state = 'failed';
    this.#emit({ type: 'restart-exhausted', error: died });
  }

  async #attestRecord(record) {
    if (record.child && !childAlive(record.child)) {
      throw new SidecarChildDiedError({
        pid: record.attachment.pid,
        exitCode: record.child.exitCode,
        signal: record.child.signalCode,
        generation: record.generation,
      });
    }
    const health = await probeHealth(this.#fetch, record.descriptor, this.healthTimeoutMs);
    if (!health.ok) {
      throw new SidecarError(
        'SIDECAR_HEALTH_ATTESTATION_FAILED',
        'attached runtime no longer matches its readiness descriptor',
        { reason: health.reason, pid: record.attachment.pid },
      );
    }
    return Object.freeze({
      schemaVersion: 'snapback.desktop-sidecar-health.v1',
      ok: true,
      pid: record.attachment.pid,
      url: record.attachment.url,
      startupNonce: record.descriptor.startupNonce,
      checkedAtMs: Date.now(),
    });
  }

  async #stopRecord(record) {
    record.expectedExit = true;
    const stop = native(record.runtime.binary, ['stop', '--ready-file', this.readyFile], {
      cwd: this.projectRoot,
      env: this.environment,
      timeout: this.stopTimeoutMs,
    });
    let exited = record.child ? await waitForChildExit(record.child, this.stopTimeoutMs) : false;
    let escalatedTo = null;
    if (record.child && !exited && childAlive(record.child)) {
      escalatedTo = 'SIGTERM';
      record.child.kill('SIGTERM');
      exited = await waitForChildExit(record.child, 1_000);
    }
    if (record.child && !exited && childAlive(record.child)) {
      escalatedTo = 'SIGKILL';
      record.child.kill('SIGKILL');
      exited = await waitForChildExit(record.child, 1_000);
    }
    if (!record.child) {
      exited = await waitUntil(async () => {
        const health = await probeHealth(this.#fetch, record.descriptor, this.healthTimeoutMs);
        return !health.ok;
      }, this.stopTimeoutMs);
    }
    const descriptorRemoved = await waitUntil(
      () => !existsSync(this.readyFile),
      Math.min(this.stopTimeoutMs, 2_000),
    );
    const health = await probeHealth(this.#fetch, record.descriptor, this.healthTimeoutMs);
    const receipt = Object.freeze({
      schemaVersion: 'snapback.desktop-sidecar-stop.v1',
      pid: record.attachment.pid,
      graceful: stop.status === 0 && exited && descriptorRemoved && !health.ok && escalatedTo === null,
      stopStatus: stop.status,
      stopSignal: stop.signal,
      childExited: exited,
      descriptorRemoved,
      healthUnavailable: !health.ok,
      escalatedTo,
    });
    if (!receipt.graceful) {
      throw new SidecarError(
        'SIDECAR_GRACEFUL_STOP_FAILED',
        'sidecar could not attest a clean nonce-verified runtime teardown',
        { receipt },
      );
    }
    return receipt;
  }

  async #removeStaleReadyArtifacts() {
    if (!existsSync(this.readyFile)) return;
    let descriptor = null;
    try {
      descriptor = readReadyDescriptor(this.readyFile);
    } catch {
      descriptor = null;
    }
    if (descriptor) {
      const health = await probeHealth(this.#fetch, descriptor, this.healthTimeoutMs);
      if (health.ok) {
        throw new SidecarError(
          'SIDECAR_ALREADY_RUNNING',
          'sidecar readiness path already belongs to a live Snapback process',
          { readyFile: this.readyFile, pid: descriptor.pid },
        );
      }
    }
    for (const path of [
      this.readyFile,
      `${this.readyFile}.secret-read-root`,
      `${this.readyFile}.impersonation`,
    ]) rmSync(path, { force: true });
  }

  #writeJournal(value) {
    writeJsonAtomic(this.#journalPath, value);
  }

  #removeJournal() {
    rmSync(this.#journalPath, { force: true });
  }

  async #recoverSwapJournal() {
    let journal;
    try {
      journal = JSON.parse(readFileSync(this.#journalPath, 'utf8'));
    } catch (cause) {
      throw new SidecarError(
        'SIDECAR_SWAP_JOURNAL_INVALID',
        'could not parse the retained sidecar swap journal',
        { path: this.#journalPath },
        { cause },
      );
    }
    if (
      journal?.schemaVersion !== SWAP_JOURNAL_SCHEMA_VERSION
      || canonicalPath(journal.database) !== canonicalPath(this.database)
      || canonicalPath(journal.readyFile) !== canonicalPath(this.readyFile)
    ) {
      throw new SidecarError(
        'SIDECAR_SWAP_JOURNAL_INVALID',
        'retained swap journal does not belong to this database and readiness path',
        { path: this.#journalPath },
      );
    }
    const oldRuntime = resolveRuntimeBinary({ runtimeBinary: journal.oldRuntime?.binary });
    const newRuntime = resolveRuntimeBinary({ runtimeBinary: journal.newRuntime?.binary });

    if (existsSync(this.readyFile)) {
      try {
        const descriptor = validateHostReadyDescriptor(readReadyDescriptor(this.readyFile), {
          readyFile: this.readyFile,
          database: this.database,
        });
        const health = await probeHealth(this.#fetch, descriptor, this.healthTimeoutMs);
        if (health.ok) {
          const runtime = journal.stage === 'prepared' ? oldRuntime : newRuntime;
          const record = await this.#recordFromDescriptor({
            runtime,
            child: null,
            descriptor,
            generation: ++this.#generation,
            purpose: 'swap-recovery-attach',
          });
          this.#removeJournal();
          this.#emit({ type: 'swap-recovered', attached: journal.stage === 'prepared' ? 'old' : 'new' });
          return record;
        }
      } catch {
        // The retained descriptor is stale or invalid; recover by booting one
        // journaled package after removing only ready-scoped artifacts.
      }
    }
    await this.#removeStaleReadyArtifacts();
    const order = journal.stage === 'prepared'
      ? [oldRuntime, newRuntime]
      : [newRuntime, oldRuntime];
    const record = await this.#recoverOneOf(order, 'swap-journal-recovery');
    this.#removeJournal();
    this.#emit({
      type: 'swap-recovered',
      attached: record.runtime.binary === oldRuntime.binary ? 'old' : 'new',
    });
    return record;
  }

  async #recoverOneOf(runtimes, purpose) {
    const failures = [];
    for (const runtime of runtimes) {
      try {
        return await this.#spawnRecord(runtime, purpose, { watch: false });
      } catch (error) {
        failures.push({ runtime: safeRuntime(runtime), code: errorCode(error) });
      }
    }
    throw new SidecarError(
      'SIDECAR_SWAP_RECOVERY_FAILED',
      'neither retained runtime package could be re-attached after the swap cut',
      { failures, journal: this.#journalPath },
    );
  }
}

export function createSidecarSupervisor(options) {
  return new SnapbackSidecarSupervisor(options);
}

export const SIDECAR_STATES = Object.freeze([
  'idle',
  'starting',
  'attached',
  'swapping',
  'stopping',
  'failed',
]);
