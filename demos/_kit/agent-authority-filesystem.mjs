// Secure Node/POSIX storage for AgentAuthorityFence durable custody.
//
// This module is intentionally not re-exported by client.mjs: importing the
// portable client arm must never pull node:fs, node:child_process, or a
// platform lock helper into a browser bundle.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — only the durable
// actor/credential-generation/grant tuple is persisted; scoped-token bearers
// and carrier ids remain process custody.
// @ref LLP 0059#cross-context-ownership — an OS advisory lock provides the
// cross-process owner and is never stolen on elapsed wall time.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  lstat,
  mkdir,
  realpath,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  sep,
} from 'node:path';

const DIRECTORY_MODE = 0o700;
const SAFE_COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const MAX_RECORD_BYTES = 64 * 1_024;
const PROCESS_OWNERSHIP = new Map();
const PROCESS_OWNERSHIP_CONTEXT = new AsyncLocalStorage();
const DIRECTORY_CAPABILITIES = new Map();
const MAX_RETAINED_DIRECTORY_CAPABILITIES = 32;
const CAPABILITY_HELPER = fileURLToPath(new URL('./agent-authority-filesystem-helper.mjs', import.meta.url));
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  'formatVersion',
  'custodyId',
  'authorityEpoch',
  'revision',
  'phase',
  'status',
  'authorityKey',
  'authority',
  'transition',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'kind',
  'authMode',
  'actorUserId',
  'credentialId',
  'credentialGeneration',
  'grantId',
]);
const TRANSITION_FIELDS = Object.freeze([
  'formatVersion',
  'transitionId',
  'expectedRevision',
  'expectedEpoch',
  'expectedAuthorityKey',
  'previousStatus',
  'previousAuthority',
  'nextEpoch',
  'nextAuthorityKey',
  'nextStatus',
  'nextAuthority',
  'reason',
  'disposition',
]);
const execFileAsync = promisify(execFile);

export const AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS = Object.freeze({
  unsupported: 'SNAPBACK_AUTH_CUSTODY_FILESYSTEM_UNSUPPORTED',
  directoryInsecure: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
  fileInsecure: 'SNAPBACK_AUTH_CUSTODY_FILE_INSECURE',
  lockUnavailable: 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
  lockLost: 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
  operationOverlap: 'SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP',
  ownershipReentrant: 'SNAPBACK_AUTH_CUSTODY_OWNERSHIP_REENTRANT',
  casStale: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
  corrupt: 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  ioFailed: 'SNAPBACK_AUTH_CUSTODY_IO_FAILED',
  capabilityLimit: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_CAPABILITY_LIMIT',
  orphanLimit: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_LIMIT',
  orphanCleanupFailed: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_CLEANUP_FAILED',
});

const diagnostic = (code, message, details = undefined, cause = undefined) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
};

const ioFailure = (operation, cause) => diagnostic(
  AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ioFailed,
  'filesystem agent custody operation failed',
  {
    operation,
    ...(typeof cause?.code === 'string' ? { errno: cause.code } : {}),
  },
  cause,
);

const corrupt = (message, details = undefined, cause = undefined) => diagnostic(
  AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.corrupt,
  message,
  details,
  cause,
);

const clone = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)));

const exactKeys = (value, expected, where) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${where} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw corrupt(`${where} has an invalid field set`, { fields: actual });
  }
};

const normalizeCustodyId = (value) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new TypeError('custodyId must be a stable non-empty string without control characters');
  }
  return value;
};

const normalizeDuration = (value, name, { minimum = 1, maximum = 60_000 } = {}) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
};

const assertSafeCounter = (value, name, { positive = false } = {}) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`${name} must be a safe ${positive ? 'positive' : 'non-negative'} integer`);
  }
};

const assertUuid = (value, name) => {
  if (!UUID_V7.test(value ?? '')) throw corrupt(`${name} must be a canonical UUIDv7`);
};

const assertAuthority = (value, where) => {
  exactKeys(value, AUTHORITY_FIELDS, where);
  if (value.kind !== 'servicePrincipal' || value.authMode !== 'sessions') {
    throw corrupt(`${where} must be a sessions service principal`);
  }
  assertUuid(value.actorUserId, `${where}.actorUserId`);
  assertUuid(value.credentialId, `${where}.credentialId`);
  assertSafeCounter(value.credentialGeneration, `${where}.credentialGeneration`);
  assertUuid(value.grantId, `${where}.grantId`);
};

const sameAuthority = (left, right) => (
  left?.kind === right?.kind
  && left?.authMode === right?.authMode
  && left?.actorUserId === right?.actorUserId
  && left?.credentialId === right?.credentialId
  && left?.credentialGeneration === right?.credentialGeneration
  && left?.grantId === right?.grantId
);

const assertTransition = (value, where) => {
  exactKeys(value, TRANSITION_FIELDS, where);
  if (value.formatVersion !== 1) throw corrupt(`${where}.formatVersion must be 1`);
  if (typeof value.transitionId !== 'string' || !value.transitionId.startsWith('agent-transition-v1:')) {
    throw corrupt(`${where}.transitionId is invalid`);
  }
  if (value.expectedRevision === null) {
    for (const field of ['expectedEpoch', 'expectedAuthorityKey', 'previousStatus', 'previousAuthority']) {
      if (value[field] !== null) throw corrupt(`${where}.${field} must be null for fresh custody`);
    }
  } else {
    assertSafeCounter(value.expectedRevision, `${where}.expectedRevision`, { positive: true });
    assertSafeCounter(value.expectedEpoch, `${where}.expectedEpoch`);
    if (typeof value.expectedAuthorityKey !== 'string') {
      throw corrupt(`${where}.expectedAuthorityKey is invalid`);
    }
    if (value.previousStatus !== 'active' && value.previousStatus !== 'deleted') {
      throw corrupt(`${where}.previousStatus is invalid`);
    }
    assertAuthority(value.previousAuthority, `${where}.previousAuthority`);
  }
  assertSafeCounter(value.nextEpoch, `${where}.nextEpoch`);
  if (typeof value.nextAuthorityKey !== 'string') throw corrupt(`${where}.nextAuthorityKey is invalid`);
  if (value.nextStatus !== 'active' && value.nextStatus !== 'deleted') {
    throw corrupt(`${where}.nextStatus is invalid`);
  }
  assertAuthority(value.nextAuthority, `${where}.nextAuthority`);
  if (typeof value.reason !== 'string' || value.reason.length === 0) {
    throw corrupt(`${where}.reason is invalid`);
  }
  if (value.disposition !== 'retain' && value.disposition !== 'delete') {
    throw corrupt(`${where}.disposition is invalid`);
  }
};

const assertCustodyRecord = (value, expectedCustodyId) => {
  exactKeys(value, TOP_LEVEL_FIELDS, 'filesystem agent custody record');
  if (value.formatVersion !== 1) throw corrupt('filesystem agent custody formatVersion must be 1');
  if (value.custodyId !== expectedCustodyId) {
    throw corrupt('filesystem agent custody record belongs to another partition');
  }
  assertSafeCounter(value.authorityEpoch, 'filesystem agent custody authorityEpoch');
  assertSafeCounter(value.revision, 'filesystem agent custody revision', { positive: true });
  if (
    value.phase !== 'settled'
    && value.phase !== 'clearing'
    && value.phase !== 'exhausted'
  ) {
    throw corrupt('filesystem agent custody phase is invalid');
  }
  if (value.status !== 'active' && value.status !== 'deleted') {
    throw corrupt('filesystem agent custody status is invalid');
  }
  if (typeof value.authorityKey !== 'string' || !value.authorityKey.startsWith('sha256:')) {
    throw corrupt('filesystem agent custody authorityKey is invalid');
  }
  assertAuthority(value.authority, 'filesystem agent custody authority');
  if (value.phase === 'clearing') {
    assertTransition(value.transition, 'filesystem agent custody transition');
  } else if (value.transition !== null) {
    throw corrupt('non-clearing filesystem agent custody cannot retain a transition');
  }
  if (value.phase === 'exhausted' && value.status !== 'deleted') {
    throw corrupt('exhausted filesystem agent custody must be terminally deleted');
  }
  // The closed envelope above intentionally has no tokenId or bearer field.
  // Keep an independent recursive guard so a future schema extension cannot
  // accidentally turn this Node adapter into secret persistence.
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    for (const [field, child] of Object.entries(current)) {
      if (/bearer|secret|tokenid/i.test(field)) {
        throw corrupt('filesystem agent custody refuses bearer or carrier material', { field });
      }
      pending.push(child);
    }
  }
  return value;
};

const assertReplacement = (current, next) => {
  if (current === null) {
    const validDirectInitialization = next.phase === 'settled'
      && next.status === 'active';
    const validFreshTransition = next.phase === 'clearing'
      && next.transition.expectedRevision === null;
    if (
      next.authorityEpoch !== 0
      || next.revision !== 1
      || (!validDirectInitialization && !validFreshTransition)
    ) {
      throw corrupt('fresh filesystem agent custody must initialize or begin a transition at epoch 0 and revision 1');
    }
    return;
  }
  if (current.revision === SAFE_COUNTER_MAX || next.revision !== current.revision + 1) {
    throw corrupt('filesystem agent custody replacement must advance revision exactly once');
  }
  if (current.phase === 'exhausted') {
    throw corrupt('exhausted filesystem agent custody cannot be replaced');
  }
  if (next.phase === 'exhausted') {
    if (
      next.status !== 'deleted'
      || next.authorityEpoch !== current.authorityEpoch
      || next.authorityKey !== current.authorityKey
      || !sameAuthority(next.authority, current.authority)
    ) {
      throw corrupt('filesystem agent custody exhaustion marker must tombstone its exact predecessor');
    }
    return;
  }
  if (current.phase === 'settled') {
    if (
      current.authorityEpoch === SAFE_COUNTER_MAX
      || next.phase !== 'clearing'
      || next.authorityEpoch !== current.authorityEpoch + 1
    ) {
      throw corrupt('settled filesystem agent custody must advance into the next clearing epoch');
    }
    const transition = next.transition;
    if (
      transition.expectedRevision !== current.revision
      || transition.expectedEpoch !== current.authorityEpoch
      || transition.expectedAuthorityKey !== current.authorityKey
      || transition.previousStatus !== current.status
      || !sameAuthority(transition.previousAuthority, current.authority)
    ) {
      throw corrupt('filesystem agent custody transition does not bind its exact predecessor');
    }
    if (
      current.status === 'deleted'
      && next.status === 'active'
      && current.authorityKey === next.authorityKey
    ) {
      throw corrupt('deleted filesystem agent custody cannot revive the same durable authority tuple');
    }
    return;
  }
  if (
    next.phase !== 'settled'
    || next.authorityEpoch !== current.authorityEpoch
    || next.status !== current.status
    || next.authorityKey !== current.authorityKey
    || !sameAuthority(next.authority, current.authority)
  ) {
    throw corrupt('clearing filesystem agent custody may only settle its exact successor');
  }
};

const storageKey = (custodyId) => createHash('sha256')
  .update(`snapback.agent-authority-custody-file.v1\n${custodyId}`, 'utf8')
  .digest('hex');

const assertNoExtendedAccess = async (path, expectedType) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      '/bin/ls',
      [process.platform === 'darwin' ? '-lde' : '-ld', path],
      {
      encoding: 'utf8',
      maxBuffer: 16 * 1_024,
      },
    ));
  } catch (error) {
    throw ioFailure('inspect-access-control', error);
  }
  const permissions = stdout.trimStart().split(/\s+/u)[0] ?? '';
  const expected = expectedType === 'directory' ? 'drwx------' : '-rw-------';
  const hasAcl = permissions.includes('+')
    || stdout.split('\n').some((line) => /^\s*\d+:/u.test(line));
  if (permissions.slice(0, expected.length) !== expected || hasAcl) {
    throw diagnostic(
      expectedType === 'directory'
        ? AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure
        : AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
      `filesystem agent custody ${expectedType} cannot carry extended access controls`,
      { permissions },
    );
  }
};

const assertAncestorAclSafe = async (path) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      '/bin/ls',
      [process.platform === 'darwin' ? '-lde' : '-ld', path],
      { encoding: 'utf8', maxBuffer: 16 * 1_024 },
    ));
  } catch (error) {
    throw ioFailure('inspect-ancestor-access-control', error);
  }
  const permissions = stdout.trimStart().split(/\s+/u)[0] ?? '';
  const unsafeMacAllow = stdout.split('\n').some((line) => (
    /\ballow\b/u.test(line)
    && /\b(add_file|add_subdirectory|delete|delete_child|write|writeattr|writeextattr|writesecurity|chown)\b/u.test(line)
  ));
  if ((permissions.includes('+') && process.platform !== 'darwin') || unsafeMacAllow) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody ancestor grants unsafe extended write authority',
      { path },
    );
  }
};

const assertLexicalPathSafe = async (directory) => {
  const { root } = parse(directory);
  const relative = directory.slice(root.length);
  let cursor = root;
  for (const component of relative.split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw ioFailure('inspect-lexical-directory', error);
    }
    if (info.isSymbolicLink() && info.uid !== 0) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse an untrusted symbolic link',
        { path: cursor, uid: info.uid },
      );
    }
  }
};

const assertCanonicalAncestors = async (directory, expectedAncestors = null) => {
  let cursor = directory;
  const ancestors = [];
  const effectiveUid = process.geteuid();
  for (;;) {
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      throw ioFailure('inspect-directory-ancestor', error);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse symbolic or non-directory ancestors',
        { path: cursor },
      );
    }
    if (info.uid !== 0 && info.uid !== effectiveUid) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path has an untrusted ancestor owner',
        { path: cursor, uid: info.uid },
      );
    }
    if (
      cursor !== directory
      && (info.mode & 0o022) !== 0
      && (info.mode & 0o1000) === 0
    ) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse a replaceable ancestor',
        { path: cursor },
      );
    }
    const identity = Object.freeze({
      path: cursor,
      dev: info.dev,
      ino: info.ino,
      uid: info.uid,
      mode: info.mode & 0o7777,
    });
    const expected = expectedAncestors?.[ancestors.length] ?? null;
    if (
      expected !== null
      && (
        identity.path !== expected.path
        || identity.dev !== expected.dev
        || identity.ino !== expected.ino
        || identity.uid !== expected.uid
        || identity.mode !== expected.mode
      )
    ) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody ancestor identity changed while owned',
        { path: cursor },
      );
    }
    if (expectedAncestors === null) await assertAncestorAclSafe(cursor);
    ancestors.push(identity);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (expectedAncestors !== null && ancestors.length !== expectedAncestors.length) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody ancestor chain changed while owned',
    );
  }
  return Object.freeze(ancestors);
};

const assertPrivateDirectory = async (directory, expectedIdentity = null) => {
  await assertLexicalPathSafe(directory);
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT' || expectedIdentity !== null) {
      if (error?.code === 'ENOENT' && expectedIdentity !== null) {
        throw diagnostic(
          AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
          'filesystem agent custody directory disappeared while owned',
        );
      }
      throw ioFailure('inspect-directory', error);
    }
    try {
      await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
      await assertLexicalPathSafe(directory);
      info = await lstat(directory);
    } catch (createError) {
      throw ioFailure('create-directory', createError);
    }
  }
  const effectiveUid = process.geteuid();
  if (
    !info.isDirectory()
    || info.isSymbolicLink()
    || (info.mode & 0o7777) !== DIRECTORY_MODE
    || info.uid !== effectiveUid
  ) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody directory must be an owned real 0700 directory',
    );
  }
  let resolved;
  try {
    resolved = await realpath(directory);
  } catch (error) {
    throw ioFailure('resolve-directory', error);
  }
  let resolvedInfo;
  try {
    resolvedInfo = await lstat(resolved);
  } catch (error) {
    throw ioFailure('inspect-resolved-directory', error);
  }
  if (resolvedInfo.dev !== info.dev || resolvedInfo.ino !== info.ino) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody path changed while resolving its canonical identity',
    );
  }
  const ancestors = await assertCanonicalAncestors(
    resolved,
    expectedIdentity?.ancestors ?? null,
  );
  if (expectedIdentity === null) await assertNoExtendedAccess(resolved, 'directory');
  const identity = Object.freeze({
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    resolved,
    ancestors,
  });
  if (
    expectedIdentity !== null
    && (
      identity.dev !== expectedIdentity.dev
      || identity.ino !== expectedIdentity.ino
      || identity.uid !== expectedIdentity.uid
      || identity.resolved !== expectedIdentity.resolved
    )
  ) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody directory identity changed while owned',
    );
  }
  return identity;
};

const remoteError = (value) => {
  const error = new Error(value?.message ?? 'filesystem custody capability helper failed');
  if (typeof value?.code === 'string') error.code = value.code;
  if (value?.diagnostic && typeof value.diagnostic === 'object') {
    error.diagnostic = value.diagnostic;
  }
  return error;
};

const serializeHookError = (error) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error?.message ?? String(error),
  diagnostic: error?.diagnostic ?? null,
});

class RetainedDirectoryCapability {
  #child;
  #closed = false;
  #hooks = new Map();
  #nextRequestId = 1;
  #nextSessionId = 1;
  #pending = new Map();
  #stderr = '';

  constructor(directory) {
    this.directory = directory;
    this.#child = fork(CAPABILITY_HELPER, [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-16 * 1_024);
    });
    this.#child.stderr.unref?.();
    this.#child.on('message', (message) => this.#onMessage(message));
    this.#child.once('error', (error) => this.#fail(diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
      'filesystem agent custody directory capability helper failed',
      typeof error?.code === 'string' ? { errno: error.code } : undefined,
      error,
    )));
    this.#child.once('exit', (code, signal) => {
      this.#fail(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability helper exited',
        {
          code,
          signal,
          ...(this.#stderr.length === 0 ? {} : { helperStderr: this.#stderr }),
        },
      ));
    });
    this.#unref();
  }

  async initialize(identity) {
    return this.#request('initialize', {
      directory: this.directory,
      expectedIdentity: {
        dev: identity.dev,
        ino: identity.ino,
        uid: identity.uid,
      },
    });
  }

  nextSessionId() {
    const id = `${process.pid}:${this.#nextSessionId}`;
    this.#nextSessionId += 1;
    return id;
  }

  async begin(sessionId, lockName, recordName, timeoutMs, hooks) {
    this.#hooks.set(sessionId, hooks ?? null);
    try {
      return await this.#request('begin', { sessionId, lockName, recordName, timeoutMs });
    } catch (error) {
      this.#hooks.delete(sessionId);
      throw error;
    }
  }

  read(sessionId, recordName) {
    return this.#request('read', { sessionId, recordName });
  }

  replace(sessionId, recordName, expectedRevision, encoded) {
    return this.#request('replace', {
      sessionId,
      recordName,
      expectedRevision,
      encoded,
    });
  }

  async release(sessionId) {
    try {
      await this.#request('release', { sessionId });
    } finally {
      this.#hooks.delete(sessionId);
    }
  }

  retireAfterInitializationFailure() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability initialization failed',
      ));
    }
    this.#pending.clear();
    this.#hooks.clear();
    this.#child.kill('SIGTERM');
  }

  #request(command, fields) {
    if (this.#closed || !this.#child.connected) {
      return Promise.reject(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability is unavailable',
      ));
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    this.#ref();
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      try {
        this.#child.send({ kind: 'request', requestId, command, ...fields }, (error) => {
          if (error == null) return;
          const pending = this.#pending.get(requestId);
          if (pending === undefined) return;
          this.#pending.delete(requestId);
          pending.reject(ioFailure('send-capability-command', error));
          this.#unrefIfIdle();
        });
      } catch (error) {
        this.#pending.delete(requestId);
        reject(ioFailure('send-capability-command', error));
        this.#unrefIfIdle();
      }
    });
  }

  #onMessage(message) {
    if (message?.kind === 'response') {
      const pending = this.#pending.get(message.requestId);
      if (pending === undefined) return;
      this.#pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(remoteError(message.error));
      this.#unrefIfIdle();
      return;
    }
    if (message?.kind !== 'hook') return;
    const hook = this.#hooks.get(message.sessionId)?.[message.name];
    Promise.resolve()
      .then(() => (typeof hook === 'function' ? hook(message.context) : undefined))
      .then(
        () => this.#sendHookResult(message.hookId, true),
        (error) => this.#sendHookResult(message.hookId, false, serializeHookError(error)),
      );
  }

  #sendHookResult(hookId, ok, error = undefined) {
    if (this.#closed || !this.#child.connected) return;
    try {
      this.#child.send({ kind: 'hookResult', hookId, ok, error });
    } catch {
      // Child exit rejects the owning request and is the authoritative error.
    }
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#hooks.clear();
  }

  #ref() {
    this.#child.ref();
    this.#child.channel?.ref?.();
  }

  #unref() {
    this.#child.unref();
    this.#child.channel?.unref?.();
  }

  #unrefIfIdle() {
    if (this.#pending.size === 0) this.#unref();
  }
}

const retainedDirectoryCapability = async (directory) => {
  let capability = DIRECTORY_CAPABILITIES.get(directory);
  if (capability !== undefined) return capability;
  // Retained capabilities deliberately survive for the process lifetime: an
  // idle eviction followed by pathname re-resolution would reopen the ABA this
  // adapter exists to close. Bound distinct configured directories instead.
  // A helper that dies remains a closed capability until process restart; it
  // is never silently recreated from a potentially replaced pathname.
  if (DIRECTORY_CAPABILITIES.size >= MAX_RETAINED_DIRECTORY_CAPABILITIES) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.capabilityLimit,
      'filesystem agent custody retained-directory capacity is exhausted',
      { maximumDirectories: MAX_RETAINED_DIRECTORY_CAPABILITIES },
    );
  }
  capability = (async () => {
    const identity = await assertPrivateDirectory(directory);
    const retained = new RetainedDirectoryCapability(directory);
    try {
      await retained.initialize(identity);
      return retained;
    } catch (error) {
      retained.retireAfterInitializationFailure();
      throw error;
    }
  })();
  DIRECTORY_CAPABILITIES.set(directory, capability);
  try {
    return await capability;
  } catch (error) {
    if (DIRECTORY_CAPABILITIES.get(directory) === capability) {
      DIRECTORY_CAPABILITIES.delete(directory);
    }
    throw error;
  }
};

const withProcessOwnership = async (key, operation) => {
  const held = PROCESS_OWNERSHIP_CONTEXT.getStore();
  if (held?.has(key)) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ownershipReentrant,
      'filesystem agent custody ownership callbacks are non-reentrant',
      { key },
    );
  }
  const previous = PROCESS_OWNERSHIP.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  PROCESS_OWNERSHIP.set(key, current);
  await previous.catch(() => {});
  try {
    return await PROCESS_OWNERSHIP_CONTEXT.run(
      new Set([...(held ?? []), key]),
      operation,
    );
  } finally {
    release();
    if (PROCESS_OWNERSHIP.get(key) === current) PROCESS_OWNERSHIP.delete(key);
  }
};

/**
 * Create Node/POSIX durable custody for AgentAuthorityFence.
 *
 * `directory` is required and absolute. It is created as 0700 when absent;
 * an existing directory or record with broader permissions is refused rather
 * than silently trusted. Record names are domain-separated custody-id hashes.
 */
export function createFilesystemAgentAuthorityCustodyStorage({
  directory,
  lockTimeoutMs = 5_000,
  testHooks = null,
} = {}) {
  if (process.platform === 'win32') {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.unsupported,
      'filesystem agent custody cannot prove POSIX mode or lock semantics on this platform',
    );
  }
  if (typeof directory !== 'string' || directory.length === 0 || !isAbsolute(directory)) {
    throw new TypeError('filesystem agent custody directory must be an absolute path');
  }
  const root = parse(directory).root;
  if (
    normalize(directory) !== directory
    || (directory.length > root.length && directory.endsWith(sep))
  ) {
    throw new TypeError('filesystem agent custody directory must be a normalized path without a trailing separator');
  }
  normalizeDuration(lockTimeoutMs, 'lockTimeoutMs');
  const testHookNames = [
    'beforeLock',
    'beforeOrphanCleanup',
    'beforeOrphanUnlink',
    'beforeTemporaryCreate',
    'afterTemporaryCreate',
    'beforeRecordRename',
    'afterRecordRename',
  ];
  if (
    testHooks !== null
    && (
      typeof testHooks !== 'object'
      || Array.isArray(testHooks)
      || Object.keys(testHooks).some((name) => !testHookNames.includes(name))
      || testHookNames.some(
        (name) => testHooks[name] !== undefined && typeof testHooks[name] !== 'function',
      )
    )
  ) {
    throw new TypeError('filesystem agent custody testHooks are invalid');
  }

  const pathsFor = (rawCustodyId) => {
    const custodyId = normalizeCustodyId(rawCustodyId);
    const key = storageKey(custodyId);
    return Object.freeze({
      custodyId,
      recordName: `${key}.json`,
      lockName: `${key}.lock`,
    });
  };

  let lastMaintenance = Object.freeze({
    scannedEntries: 0,
    orphanCount: 0,
    orphanBytes: 0,
    removedCount: 0,
  });

  const withOwnership = async (rawCustodyId, operation) => {
    if (typeof operation !== 'function') {
      throw new TypeError('filesystem agent custody ownership requires an operation callback');
    }
    const { custodyId, recordName, lockName } = pathsFor(rawCustodyId);
    return withProcessOwnership(`${directory}\u0000${lockName}`, async () => {
      const capability = await retainedDirectoryCapability(directory);
      const sessionId = capability.nextSessionId();
      const boundHooks = testHooks === null ? null : Object.fromEntries(
        testHookNames
          .filter((name) => typeof testHooks[name] === 'function')
          .map((name) => [name, (context) => testHooks[name](Object.freeze({
            custodyId,
            ...context,
          }))]),
      );
      lastMaintenance = Object.freeze(await capability.begin(
        sessionId,
        lockName,
        recordName,
        lockTimeoutMs,
        boundHooks,
      ));
      let active = true;
      let ownerOperationActive = false;
      const runOwnerOperation = async (operationName, operationBody) => {
        if (!active) {
          throw diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
            'filesystem agent custody ownership was released',
          );
        }
        if (ownerOperationActive) {
          throw diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.operationOverlap,
            'filesystem agent custody owner operations must not overlap',
            { operation: operationName },
          );
        }
        ownerOperationActive = true;
        try {
          return await operationBody();
        } finally {
          ownerOperationActive = false;
        }
      };
      const owner = Object.freeze({
        async withPartition(rawPartitionId, partitionOperation) {
          if (!active) {
            throw diagnostic(
              AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
              'filesystem agent custody ownership was released',
            );
          }
          const partitionId = normalizeCustodyId(rawPartitionId);
          if (partitionId === custodyId) {
            throw diagnostic(
              AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ownershipReentrant,
              'filesystem agent custody ownership cannot reacquire its current partition',
              { custodyId },
            );
          }
          return withOwnership(partitionId, partitionOperation);
        },
        async read() {
          return runOwnerOperation('read', async () => {
            const bytes = await capability.read(sessionId, recordName);
            if (bytes === null) return null;
            let parsed;
            try {
              parsed = JSON.parse(bytes);
            } catch (error) {
              throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
            }
            return clone(assertCustodyRecord(parsed, custodyId));
          });
        },
        async replace(expectedRevision, nextValue) {
          return runOwnerOperation('replace', async () => {
            if (expectedRevision !== null) {
              assertSafeCounter(expectedRevision, 'filesystem agent custody expectedRevision', {
                positive: true,
              });
            }
            const currentBytes = await capability.read(sessionId, recordName);
            let current = null;
            if (currentBytes !== null) {
              try {
                current = clone(assertCustodyRecord(JSON.parse(currentBytes), custodyId));
              } catch (error) {
                if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
                throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
              }
            }
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw diagnostic(
                AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.casStale,
                'durable filesystem agent custody changed before compare-and-swap',
                { expectedRevision, actualRevision },
              );
            }
            const next = clone(assertCustodyRecord(clone(nextValue), custodyId));
            assertReplacement(current, next);
            const encoded = `${JSON.stringify(next)}\n`;
            if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
              throw diagnostic(
                AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
                'filesystem agent custody record exceeds its bounded envelope',
                { maximumBytes: MAX_RECORD_BYTES },
              );
            }
            await capability.replace(sessionId, recordName, expectedRevision, encoded);
            return clone(next);
          });
        },
      });
      let operationError = null;
      try {
        const result = await operation(owner);
        return result;
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        active = false;
        try {
          await capability.release(sessionId);
        } catch (releaseError) {
          if (operationError === null) throw releaseError;
        }
      }
    });
  };

  return Object.freeze({
    partitionOwnership: 'partitioned-v1',
    withOwnership,
    maintenanceSnapshot() {
      return clone(lastMaintenance);
    },
    async snapshot(rawCustodyId) {
      return withOwnership(rawCustodyId, (owner) => owner.read());
    },
  });
}
