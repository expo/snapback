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

import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_128 = /^[A-Za-z0-9_-]{22}$/;
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

export const AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS = Object.freeze({
  unsupported: 'SNAPBACK_AUTH_CUSTODY_FILESYSTEM_UNSUPPORTED',
  directoryInsecure: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
  fileInsecure: 'SNAPBACK_AUTH_CUSTODY_FILE_INSECURE',
  lockUnavailable: 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
  lockLost: 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
  casStale: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
  corrupt: 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  ioFailed: 'SNAPBACK_AUTH_CUSTODY_IO_FAILED',
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
    || value.length > 512
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
  if (value.phase !== 'settled' && value.phase !== 'clearing') {
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
    throw corrupt('settled filesystem agent custody cannot retain a transition');
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
    if (
      next.authorityEpoch !== 0
      || next.revision !== 1
      || next.phase !== 'settled'
      || next.status !== 'active'
    ) {
      throw corrupt('fresh filesystem agent custody must settle active at epoch 0 and revision 1');
    }
    return;
  }
  if (current.revision === SAFE_COUNTER_MAX || next.revision !== current.revision + 1) {
    throw corrupt('filesystem agent custody replacement must advance revision exactly once');
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

const assertPrivateDirectory = async (directory) => {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw ioFailure('inspect-directory', error);
    try {
      await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
      info = await lstat(directory);
    } catch (createError) {
      throw ioFailure('create-directory', createError);
    }
  }
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== DIRECTORY_MODE) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody directory must be a real 0700 directory',
    );
  }
};

const assertPrivateFileInfo = (info) => {
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== FILE_MODE) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
      'filesystem agent custody files must be real 0600 files',
    );
  }
};

const ensurePrivateLockFile = async (path) => {
  try {
    const handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      FILE_MODE,
    );
    try {
      await handle.chmod(FILE_MODE);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw ioFailure('create-lock-file', error);
  }
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    throw ioFailure('inspect-lock-file', error);
  }
  assertPrivateFileInfo(info);
};

const syncDirectory = async (directory) => {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    await handle.sync();
  } catch (error) {
    throw ioFailure('sync-directory', error);
  } finally {
    await handle?.close().catch(() => {});
  }
};

const readRecordFile = async (path, custodyId) => {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'ELOOP') {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
        'filesystem agent custody record cannot be a symbolic link',
      );
    }
    throw ioFailure('open-record', error);
  }
  try {
    assertPrivateFileInfo(await handle.stat());
    const bytes = await handle.readFile({ encoding: 'utf8' });
    let parsed;
    try {
      parsed = JSON.parse(bytes);
    } catch (error) {
      throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
    }
    return clone(assertCustodyRecord(parsed, custodyId));
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('read-record', error);
  } finally {
    await handle.close().catch(() => {});
  }
};

const lockCommand = () => {
  if (process.platform === 'darwin' || process.platform.endsWith('bsd')) {
    return Object.freeze({
      executable: '/usr/bin/lockf',
      argumentsFor: (lockPath, timeoutMs, helper) => [
        '-knsw',
        '-t',
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        lockPath,
        process.execPath,
        '--input-type=module',
        '--eval',
        helper,
      ],
    });
  }
  if (process.platform === 'linux') {
    return Object.freeze({
      executable: '/usr/bin/flock',
      argumentsFor: (lockPath, timeoutMs, helper) => [
        '--exclusive',
        // Keep the lock holder and helper as one killable process. Without
        // --no-fork, an acquisition-timeout race could terminate flock while
        // leaving its just-spawned helper holding an orphaned lock.
        '--no-fork',
        '--timeout',
        String(timeoutMs / 1000),
        lockPath,
        process.execPath,
        '--input-type=module',
        '--eval',
        helper,
      ],
    });
  }
  throw diagnostic(
    AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.unsupported,
    'secure filesystem agent custody requires POSIX advisory file locking',
  );
};

const LOCK_HELPER = String.raw`
const nonce = process.argv[1];
process.stdout.write(JSON.stringify({ formatVersion: 1, nonce, pid: process.pid }) + '\n');
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.includes('\n')) process.exit(input === 'release\n' ? 0 : 64);
});
process.stdin.on('end', () => process.exit(0));
`;

const acquireLock = async (path, timeoutMs) => {
  const nonce = randomBytes(16).toString('base64url');
  if (!BASE64URL_128.test(nonce)) throw new Error('unreachable invalid lock nonce');
  const command = lockCommand();
  const helper = `${LOCK_HELPER}\n// nonce argument follows`;
  const child = spawn(
    command.executable,
    [...command.argumentsFor(path, timeoutMs, helper), nonce],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', () => {});
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });

  let timer;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(() => reject(diagnostic(
          AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockUnavailable,
          'timed out waiting for filesystem agent custody ownership',
          { timeoutMs },
        )));
      }, timeoutMs);
      const inspect = () => {
        const newline = stdout.indexOf('\n');
        if (newline === -1) return;
        let ready;
        try {
          ready = JSON.parse(stdout.slice(0, newline));
        } catch (error) {
          finish(() => reject(ioFailure('start-lock-helper', error)));
          return;
        }
        if (
          ready?.formatVersion !== 1
          || ready.nonce !== nonce
          || !Number.isSafeInteger(ready.pid)
          || ready.pid <= 0
        ) {
          finish(() => reject(ioFailure('start-lock-helper', new Error('invalid helper readiness'))));
          return;
        }
        finish(resolve);
      };
      child.stdout.on('data', inspect);
      child.once('error', (error) => finish(() => reject(ioFailure('spawn-lock-helper', error))));
      child.once('exit', (status, signal) => finish(() => reject(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockUnavailable,
        'filesystem agent custody lock helper exited before ownership',
        {
          status,
          ...(signal === null ? {} : { signal }),
          ...(stderr.length === 0 ? {} : { helperOutputPresent: true }),
        },
      ))));
      inspect();
    });
  } catch (error) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    throw error;
  }

  let released = false;
  return Object.freeze({
    assertActive() {
      if (released || child.exitCode !== null || child.killed) {
        throw diagnostic(
          AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
          'filesystem agent custody ownership was lost',
        );
      }
    },
    async release() {
      if (released) return;
      released = true;
      if (child.exitCode !== null || child.killed) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.stdin.end('release\n');
      const releaseTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      await exited;
      clearTimeout(releaseTimer);
    },
  });
};

const atomicReplace = async ({
  directory,
  recordPath,
  custodyId,
  expectedRevision,
  nextValue,
  lock,
}) => {
  lock.assertActive();
  const current = await readRecordFile(recordPath, custodyId);
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
  const temporaryPath = `${recordPath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  let handle;
  let renamed = false;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      FILE_MODE,
    );
    await handle.writeFile(encoded, { encoding: 'utf8' });
    await handle.chmod(FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = null;
    lock.assertActive();
    await rename(temporaryPath, recordPath);
    renamed = true;
    await syncDirectory(directory);
    lock.assertActive();
    return clone(next);
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('replace-record', error);
  } finally {
    await handle?.close().catch(() => {});
    if (!renamed) await unlink(temporaryPath).catch(() => {});
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
  normalizeDuration(lockTimeoutMs, 'lockTimeoutMs');

  const pathsFor = (rawCustodyId) => {
    const custodyId = normalizeCustodyId(rawCustodyId);
    const key = storageKey(custodyId);
    return Object.freeze({
      custodyId,
      recordPath: join(directory, `${key}.json`),
      lockPath: join(directory, `${key}.lock`),
    });
  };

  const withOwnership = async (rawCustodyId, operation) => {
    if (typeof operation !== 'function') {
      throw new TypeError('filesystem agent custody ownership requires an operation callback');
    }
    const { custodyId, recordPath, lockPath } = pathsFor(rawCustodyId);
    await assertPrivateDirectory(directory);
    await ensurePrivateLockFile(lockPath);
    await syncDirectory(directory);
    const lock = await acquireLock(lockPath, lockTimeoutMs);
    let active = true;
    const owner = Object.freeze({
      async read() {
        if (!active) {
          throw diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
            'filesystem agent custody ownership was released',
          );
        }
        lock.assertActive();
        const value = await readRecordFile(recordPath, custodyId);
        lock.assertActive();
        return value;
      },
      async replace(expectedRevision, nextValue) {
        if (!active) {
          throw diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
            'filesystem agent custody ownership was released',
          );
        }
        if (expectedRevision !== null) {
          assertSafeCounter(expectedRevision, 'filesystem agent custody expectedRevision', {
            positive: true,
          });
        }
        return atomicReplace({
          directory,
          recordPath,
          custodyId,
          expectedRevision,
          nextValue,
          lock,
        });
      },
    });
    try {
      const result = await operation(owner);
      lock.assertActive();
      return result;
    } finally {
      active = false;
      await lock.release();
    }
  };

  return Object.freeze({
    withOwnership,
    async snapshot(rawCustodyId) {
      return withOwnership(rawCustodyId, (owner) => owner.read());
    },
  });
}
