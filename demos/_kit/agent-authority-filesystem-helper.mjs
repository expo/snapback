// Dedicated POSIX directory-capability helper for AgentAuthorityFence custody.
//
// Node does not expose openat(2), renameat(2), or unlinkat(2). This helper
// validates the configured directory once, changes into that exact inode, and
// then accepts only single-component names. POSIX retains cwd as a kernel
// directory reference even when its original pathname is renamed or replaced;
// every relative operation below is therefore equivalent to an *at syscall
// using that retained directory and AT_FDCWD.
//
// The helper that owns SQLite's advisory lock is also the only process that
// reads, creates, renames, unlinks, or fsyncs custody files. If it dies, both
// the lock and every possible stale writer die together.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — filesystem custody keeps
// the lock and atomic record replacement beneath one retained directory
// capability.
// @ref LLP 0059#cross-context-ownership — the advisory lock is never stolen on
// elapsed time and all durable comparisons remain inside its ownership.

import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  open,
  opendir,
  stat,
  unlink,
  rename,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 64 * 1_024;
const MAX_DIRECTORY_SCAN_ENTRIES = 4_096;
const MAX_ORPHAN_FILES = 128;
const MAX_ORPHAN_BYTES = MAX_ORPHAN_FILES * MAX_RECORD_BYTES;
const LOCK_RETRY_MS = 10;
const COMPONENT = /^[a-f0-9]{64}\.(?:json|lock)$/u;
const SESSIONS = new Map();
const PENDING_HOOKS = new Map();
const execFileAsync = promisify(execFile);
let nextHookId = 1;
let initialized = false;
let closing = false;

const CODES = Object.freeze({
  directoryInsecure: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
  fileInsecure: 'SNAPBACK_AUTH_CUSTODY_FILE_INSECURE',
  lockUnavailable: 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
  lockLost: 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
  casStale: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
  ioFailed: 'SNAPBACK_AUTH_CUSTODY_IO_FAILED',
  orphanLimit: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_LIMIT',
  orphanCleanupFailed: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_CLEANUP_FAILED',
});

const coded = (code, message, details = undefined, cause = undefined) => {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
};

const ioFailure = (operation, cause) => coded(
  CODES.ioFailed,
  'filesystem agent custody capability operation failed',
  {
    operation,
    ...(typeof cause?.code === 'string' ? { errno: cause.code } : {}),
  },
  cause,
);

const serializeError = (error) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error?.message ?? String(error),
  diagnostic: error?.diagnostic ?? null,
});

const fromRemoteError = (value) => {
  const error = new Error(value?.message ?? 'filesystem custody hook failed');
  if (typeof value?.code === 'string') error.code = value.code;
  if (value?.diagnostic && typeof value.diagnostic === 'object') {
    error.diagnostic = value.diagnostic;
  }
  return error;
};

const send = (message) => {
  if (typeof process.send !== 'function' || !process.connected) return false;
  try {
    return process.send(message);
  } catch {
    return false;
  }
};

const assertComponent = (value, suffix) => {
  if (typeof value !== 'string' || !COMPONENT.test(value) || !value.endsWith(suffix)) {
    throw coded(
      CODES.fileInsecure,
      'filesystem agent custody helper accepts only derived single-component names',
    );
  }
  return value;
};

const sameIdentity = (left, right) => (
  left.dev === right.dev
  && left.ino === right.ino
  && left.uid === right.uid
);

const assertPrivateFileInfo = (info, { maximumBytes = null } = {}) => {
  const effectiveUid = process.geteuid();
  if (
    !info.isFile()
    || info.isSymbolicLink()
    || (info.mode & 0o7777) !== FILE_MODE
    || info.uid !== effectiveUid
    || info.nlink !== 1
    || (maximumBytes !== null && info.size > maximumBytes)
  ) {
    throw coded(
      CODES.fileInsecure,
      'filesystem agent custody files must be owned, single-link, bounded real 0600 files',
      maximumBytes === null ? undefined : { maximumBytes, size: info.size },
    );
  }
};

const assertNoExtendedAccess = async (path, expectedType) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      '/bin/ls',
      [process.platform === 'darwin' ? '-lde' : '-ld', path],
      { encoding: 'utf8', maxBuffer: 16 * 1_024 },
    ));
  } catch (error) {
    throw ioFailure('inspect-capability-access-control', error);
  }
  const permissions = stdout.trimStart().split(/\s+/u)[0] ?? '';
  const expected = expectedType === 'directory' ? 'drwx------' : '-rw-------';
  const hasAcl = permissions.includes('+')
    || stdout.split('\n').some((line) => /^\s*\d+:/u.test(line));
  if (permissions.slice(0, expected.length) !== expected || hasAcl) {
    throw coded(
      expectedType === 'directory' ? CODES.directoryInsecure : CODES.fileInsecure,
      `filesystem agent custody ${expectedType} cannot carry extended access controls`,
      { permissions },
    );
  }
};

const assertPrivateFile = async (path, info, options = {}) => {
  assertPrivateFileInfo(info, options);
  await assertNoExtendedAccess(path, 'file');
};

const assertPinnedDirectory = async (expectedIdentity) => {
  let info;
  try {
    info = await stat('.');
  } catch (error) {
    throw ioFailure('inspect-pinned-directory', error);
  }
  if (
    !info.isDirectory()
    || info.isSymbolicLink()
    || (info.mode & 0o7777) !== DIRECTORY_MODE
    || info.uid !== process.geteuid()
    || info.dev !== expectedIdentity.dev
    || info.ino !== expectedIdentity.ino
    || info.uid !== expectedIdentity.uid
  ) {
    throw coded(
      CODES.directoryInsecure,
      'filesystem agent custody helper did not retain the validated directory inode',
    );
  }
  await assertNoExtendedAccess('.', 'directory');
  return info;
};

const syncPinnedDirectory = async (expectedIdentity) => {
  let handle;
  try {
    await assertPinnedDirectory(expectedIdentity);
    handle = await open('.', fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    await handle.sync();
    await assertPinnedDirectory(expectedIdentity);
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('sync-pinned-directory', error);
  } finally {
    await handle?.close().catch(() => {});
  }
};

const ensurePrivateLockFile = async (lockName) => {
  try {
    const handle = await open(
      lockName,
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
    if (error?.code !== 'EEXIST') throw ioFailure('create-lock-file-relative', error);
  }
  try {
    await assertPrivateFile(lockName, await lstat(lockName));
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('inspect-lock-file-relative', error);
  }
};

const readRecordBytes = async (recordName) => {
  let handle;
  try {
    handle = await open(
      recordName,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'ELOOP') {
      throw coded(CODES.fileInsecure, 'filesystem agent custody record cannot be a symbolic link');
    }
    throw ioFailure('open-record-relative', error);
  }
  try {
    const openedInfo = await handle.stat();
    await assertPrivateFile(recordName, openedInfo, { maximumBytes: MAX_RECORD_BYTES });
    const namedInfo = await lstat(recordName);
    if (!sameIdentity(openedInfo, namedInfo)) {
      throw coded(CODES.fileInsecure, 'filesystem agent custody record changed while opening');
    }
    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_RECORD_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(
        8 * 1_024,
        (MAX_RECORD_BYTES + 1) - totalBytes,
      ));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes > MAX_RECORD_BYTES) {
      throw coded(
        CODES.fileInsecure,
        'filesystem agent custody record exceeds its bounded envelope',
        { maximumBytes: MAX_RECORD_BYTES },
      );
    }
    const finalInfo = await handle.stat();
    const finalNamedInfo = await lstat(recordName);
    await assertPrivateFile(recordName, finalInfo, { maximumBytes: MAX_RECORD_BYTES });
    if (
      !sameIdentity(openedInfo, finalInfo)
      || !sameIdentity(finalInfo, finalNamedInfo)
      || finalInfo.size !== totalBytes
    ) {
      throw coded(CODES.fileInsecure, 'filesystem agent custody record changed while being read');
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('read-record-relative', error);
  } finally {
    await handle.close().catch(() => {});
  }
};

const recordRevision = (bytes) => {
  if (bytes === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    throw coded(CODES.fileInsecure, 'filesystem agent custody record is not valid JSON', undefined, error);
  }
  return Number.isSafeInteger(parsed?.revision) && parsed.revision > 0
    ? parsed.revision
    : Symbol.for('invalid-revision');
};

const temporaryPattern = (recordName) => {
  const escaped = recordName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped}\\.[1-9][0-9]*\\.[a-f0-9]{32}\\.tmp$`, 'u');
};

const callHook = async (sessionId, name, context) => {
  const hookId = nextHookId;
  nextHookId += 1;
  const outcome = new Promise((resolve, reject) => {
    PENDING_HOOKS.set(hookId, { resolve, reject });
  });
  if (!send({ kind: 'hook', hookId, sessionId, name, context })) {
    PENDING_HOOKS.delete(hookId);
    throw coded(CODES.lockLost, 'filesystem agent custody parent disconnected during a capability hook');
  }
  return outcome;
};

const cleanupOrphans = async (sessionId, recordName) => {
  const pattern = temporaryPattern(recordName);
  const candidates = [];
  let scannedEntries = 0;
  let totalBytes = 0;
  let directory;
  try {
    directory = await opendir('.');
    for await (const entry of directory) {
      scannedEntries += 1;
      if (scannedEntries > MAX_DIRECTORY_SCAN_ENTRIES) {
        throw coded(
          CODES.orphanLimit,
          'filesystem agent custody orphan scan exceeded its bounded directory budget',
          { maximumEntries: MAX_DIRECTORY_SCAN_ENTRIES },
        );
      }
      if (!pattern.test(entry.name)) continue;
      const info = await lstat(entry.name);
      await assertPrivateFile(entry.name, info, { maximumBytes: MAX_RECORD_BYTES });
      candidates.push(Object.freeze({
        name: entry.name,
        dev: info.dev,
        ino: info.ino,
        uid: info.uid,
        size: info.size,
      }));
      totalBytes += info.size;
      if (candidates.length > MAX_ORPHAN_FILES || totalBytes > MAX_ORPHAN_BYTES) {
        throw coded(
          CODES.orphanLimit,
          'filesystem agent custody orphan cleanup exceeded its bounded debris budget',
          {
            orphanCount: candidates.length,
            orphanBytes: totalBytes,
            maximumOrphans: MAX_ORPHAN_FILES,
            maximumBytes: MAX_ORPHAN_BYTES,
          },
        );
      }
    }
  } finally {
    await directory?.close().catch(() => {});
  }

  await callHook(sessionId, 'beforeOrphanCleanup', Object.freeze({
    recordName,
    orphanCount: candidates.length,
    orphanBytes: totalBytes,
    maximumOrphans: MAX_ORPHAN_FILES,
    maximumBytes: MAX_ORPHAN_BYTES,
  }));
  let removedCount = 0;
  for (const candidate of candidates) {
    try {
      const current = await lstat(candidate.name);
      await assertPrivateFile(candidate.name, current, { maximumBytes: MAX_RECORD_BYTES });
      if (!sameIdentity(current, candidate)) {
        throw coded(CODES.fileInsecure, 'filesystem agent custody orphan identity changed before cleanup');
      }
      await callHook(sessionId, 'beforeOrphanUnlink', Object.freeze({
        recordName,
        orphanName: candidate.name,
        orphanBytes: candidate.size,
        removedCount,
      }));
      const finalInfo = await lstat(candidate.name);
      if (!sameIdentity(finalInfo, candidate)) {
        throw coded(CODES.fileInsecure, 'filesystem agent custody orphan identity changed during cleanup');
      }
      await unlink(candidate.name);
      removedCount += 1;
    } catch (error) {
      throw coded(
        CODES.orphanCleanupFailed,
        'filesystem agent custody could not clean validated crash debris',
        {
          orphanCount: candidates.length,
          orphanBytes: totalBytes,
          removedCount,
          remainingCount: candidates.length - removedCount,
        },
        error,
      );
    }
  }
  if (removedCount > 0) await syncPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
  return Object.freeze({
    scannedEntries,
    orphanCount: candidates.length,
    orphanBytes: totalBytes,
    removedCount,
  });
};

let SESSION_DIRECTORY_IDENTITY = null;

const acquireLock = async (sessionId, lockName, recordName, timeoutMs) => {
  if (SESSIONS.has(sessionId)) {
    throw coded(CODES.lockLost, 'filesystem agent custody session identifier was reused');
  }
  await assertPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
  await ensurePrivateLockFile(lockName);
  await syncPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
  const before = await lstat(lockName);
  const startedAt = performance.now();
  let database = null;
  let lastBusy = null;
  for (;;) {
    try {
      database = new DatabaseSync(lockName);
      database.exec('PRAGMA busy_timeout = 0');
      database.exec('BEGIN IMMEDIATE');
      break;
    } catch (error) {
      try { database?.close(); } catch { /* preserve acquisition failure */ }
      database = null;
      if (error?.errcode !== 5 && error?.errcode !== 6) {
        throw ioFailure('acquire-relative-sqlite-lock', error);
      }
      lastBusy = error;
      const remainingMs = timeoutMs - (performance.now() - startedAt);
      if (remainingMs <= 0) {
        throw coded(
          CODES.lockUnavailable,
          'timed out waiting for filesystem agent custody ownership',
          { timeoutMs },
          lastBusy,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(LOCK_RETRY_MS, remainingMs)));
    }
  }
  try {
    const after = await lstat(lockName);
    await assertPrivateFile(lockName, after);
    if (!sameIdentity(before, after)) {
      throw coded(CODES.fileInsecure, 'filesystem agent custody SQLite lock inode changed during acquisition');
    }
    SESSIONS.set(sessionId, Object.freeze({ database, lockName, recordName }));
    const cleanup = await cleanupOrphans(sessionId, recordName);
    return cleanup;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* primary failure wins */ }
    try { database.close(); } catch { /* primary failure wins */ }
    SESSIONS.delete(sessionId);
    throw error;
  }
};

const assertSession = (sessionId, recordName = null) => {
  const session = SESSIONS.get(sessionId);
  if (session === undefined || (recordName !== null && session.recordName !== recordName)) {
    throw coded(CODES.lockLost, 'filesystem agent custody ownership was released');
  }
  return session;
};

const replaceRecord = async (sessionId, recordName, expectedRevision, encoded) => {
  assertSession(sessionId, recordName);
  const currentBytes = await readRecordBytes(recordName);
  const actualRevision = recordRevision(currentBytes);
  if (actualRevision !== expectedRevision) {
    throw coded(
      CODES.casStale,
      'durable filesystem agent custody changed before compare-and-swap',
      {
        expectedRevision,
        actualRevision: typeof actualRevision === 'symbol' ? null : actualRevision,
      },
    );
  }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
    throw coded(
      CODES.fileInsecure,
      'filesystem agent custody record exceeds its bounded envelope',
      { maximumBytes: MAX_RECORD_BYTES },
    );
  }
  const temporaryName = `${recordName}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  let handle;
  let renamed = false;
  try {
    await callHook(sessionId, 'beforeTemporaryCreate', Object.freeze({
      expectedRevision,
      nextRevision: JSON.parse(encoded).revision,
    }));
    handle = await open(
      temporaryName,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      FILE_MODE,
    );
    await handle.chmod(FILE_MODE);
    const createdInfo = await handle.stat();
    await callHook(sessionId, 'afterTemporaryCreate', Object.freeze({
      expectedRevision,
      nextRevision: JSON.parse(encoded).revision,
      temporaryName,
      helperPid: process.pid,
    }));
    await handle.writeFile(encoded, { encoding: 'utf8' });
    await handle.sync();
    const completeInfo = await handle.stat();
    await assertPrivateFile(temporaryName, completeInfo, { maximumBytes: MAX_RECORD_BYTES });
    if (!sameIdentity(createdInfo, completeInfo)) {
      throw coded(CODES.fileInsecure, 'filesystem agent custody temporary inode changed while writing');
    }
    await handle.close();
    handle = null;
    const context = Object.freeze({
      expectedRevision,
      nextRevision: JSON.parse(encoded).revision,
    });
    await callHook(sessionId, 'beforeRecordRename', context);
    assertSession(sessionId, recordName);
    await rename(temporaryName, recordName);
    renamed = true;
    const published = await lstat(recordName);
    await assertPrivateFile(recordName, published, { maximumBytes: MAX_RECORD_BYTES });
    if (!sameIdentity(createdInfo, published)) {
      throw coded(CODES.fileInsecure, 'published filesystem agent custody inode changed during rename');
    }
    await syncPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
    assertSession(sessionId, recordName);
    await callHook(sessionId, 'afterRecordRename', context);
    await assertPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
    return encoded;
  } catch (error) {
    if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
    throw ioFailure('replace-record-relative', error);
  } finally {
    await handle?.close().catch(() => {});
    if (!renamed) await unlink(temporaryName).catch(() => {});
  }
};

const releaseSession = (sessionId) => {
  const session = SESSIONS.get(sessionId);
  if (session === undefined) return;
  SESSIONS.delete(sessionId);
  // The SQLite file is an advisory-lock carrier only; no SQL state is ever
  // mutated. Closing the exact connection releases its inode lock. ROLLBACK is
  // best-effort because SQLite may have cached the directory's former name,
  // which can disappear while the retained CWD capability remains valid.
  try {
    session.database.exec('ROLLBACK');
  } catch { /* close below is the crash-released lock boundary */ }
  try {
    session.database.close();
  } catch (error) {
    throw ioFailure('close-relative-sqlite-lock', error);
  }
};

const closeAll = () => {
  if (closing) return;
  closing = true;
  for (const [sessionId, session] of SESSIONS) {
    SESSIONS.delete(sessionId);
    try { session.database.exec('ROLLBACK'); } catch { /* process exit releases the lock */ }
    try { session.database.close(); } catch { /* process exit releases the lock */ }
  }
  for (const { reject } of PENDING_HOOKS.values()) {
    reject(coded(CODES.lockLost, 'filesystem agent custody parent disconnected'));
  }
  PENDING_HOOKS.clear();
};

const initialize = async ({ directory, expectedIdentity }) => {
  if (initialized) throw coded(CODES.directoryInsecure, 'filesystem custody helper was initialized twice');
  if (process.platform === 'win32' || typeof process.geteuid !== 'function') {
    throw coded(CODES.directoryInsecure, 'filesystem custody directory capabilities require POSIX');
  }
  let before;
  try {
    before = await lstat(directory);
    process.chdir(directory);
  } catch (error) {
    throw ioFailure('acquire-directory-cwd-capability', error);
  }
  const after = await stat('.');
  if (
    !before.isDirectory()
    || before.isSymbolicLink()
    || !sameIdentity(before, after)
    || before.dev !== expectedIdentity.dev
    || before.ino !== expectedIdentity.ino
    || before.uid !== expectedIdentity.uid
  ) {
    throw coded(
      CODES.directoryInsecure,
      'filesystem custody directory changed before its retained capability was acquired',
    );
  }
  SESSION_DIRECTORY_IDENTITY = Object.freeze({
    dev: after.dev,
    ino: after.ino,
    uid: after.uid,
  });
  await assertPinnedDirectory(SESSION_DIRECTORY_IDENTITY);
  initialized = true;
  return SESSION_DIRECTORY_IDENTITY;
};

const dispatch = async (message) => {
  const { command } = message;
  if (command === 'initialize') return initialize(message);
  if (!initialized) throw coded(CODES.lockLost, 'filesystem custody helper is not initialized');
  if (command === 'begin') {
    const lockName = assertComponent(message.lockName, '.lock');
    const recordName = assertComponent(message.recordName, '.json');
    await callHook(message.sessionId, 'beforeLock', Object.freeze({ lockName, recordName }));
    return acquireLock(message.sessionId, lockName, recordName, message.timeoutMs);
  }
  if (command === 'read') {
    const recordName = assertComponent(message.recordName, '.json');
    assertSession(message.sessionId, recordName);
    return readRecordBytes(recordName);
  }
  if (command === 'replace') {
    const recordName = assertComponent(message.recordName, '.json');
    return replaceRecord(
      message.sessionId,
      recordName,
      message.expectedRevision,
      message.encoded,
    );
  }
  if (command === 'release') {
    releaseSession(message.sessionId);
    return null;
  }
  throw coded(CODES.ioFailed, 'filesystem custody helper received an unknown command');
};

process.on('message', (message) => {
  if (message?.kind === 'hookResult') {
    const pending = PENDING_HOOKS.get(message.hookId);
    if (pending === undefined) return;
    PENDING_HOOKS.delete(message.hookId);
    if (message.ok) pending.resolve();
    else pending.reject(fromRemoteError(message.error));
    return;
  }
  if (message?.kind !== 'request' || !Number.isSafeInteger(message.requestId)) return;
  Promise.resolve()
    .then(() => dispatch(message))
    .then(
      (value) => send({ kind: 'response', requestId: message.requestId, ok: true, value }),
      (error) => send({
        kind: 'response',
        requestId: message.requestId,
        ok: false,
        error: serializeError(error),
      }),
    );
});

process.once('disconnect', () => {
  closeAll();
  process.exit(0);
});
process.once('SIGTERM', () => {
  closeAll();
  process.exit(0);
});
