import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const LOCK_FORMAT = 'snapback.codegen-generation-lock.v1';
const LOCK_FILE = '.generated.regenerate.lock';
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 25;
const INVALID_LOCK_GRACE_MS = 1_000;
const MAX_HOLDER_AGE_MS = 5 * 60_000;

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

function lockFailure(code, message, details, cause = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.codegenGenerationLockFailure = true;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'codegen',
    message,
    details,
  };
  if (cause) error.cause = cause;
  return error;
}

function observeLock(lockPath) {
  let stat;
  try {
    stat = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw lockFailure(
      'CODEGEN_REGENERATION_LOCK_UNAVAILABLE',
      `could not inspect the regeneration lock ${lockPath}`,
      { lockPath, error: error?.message ?? String(error) },
      error,
    );
  }

  let owner = null;
  try {
    const candidate = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (
      candidate?.format === LOCK_FORMAT
      && Number.isSafeInteger(candidate.pid)
      && candidate.pid > 0
      && typeof candidate.token === 'string'
      && candidate.token.length > 0
    ) {
      owner = candidate;
    }
  } catch {
    // A process can be observed between exclusive creation and its completed
    // write. The grace interval below keeps that brief state from looking stale.
  }
  return {
    owner,
    ageMs: Math.max(0, Date.now() - stat.mtimeMs),
    identity: { dev: stat.dev, ino: stat.ino },
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM still proves that the process exists; only ESRCH proves it does not.
    return error?.code !== 'ESRCH';
  }
}

function isStale(observed) {
  if (!observed) return false;
  if (!observed.owner) return observed.ageMs >= INVALID_LOCK_GRACE_MS;
  return !processIsAlive(observed.owner.pid) || observed.ageMs >= MAX_HOLDER_AGE_MS;
}

function sameObservedLock(left, right) {
  if (!left || !right) return false;
  if (
    left.identity.dev !== right.identity.dev
    || left.identity.ino !== right.identity.ino
  ) {
    return false;
  }
  return left.owner?.token === right.owner?.token;
}

function moveOwnedLockAside(lockPath, observed, suffix) {
  const movedPath = `${lockPath}.${suffix}-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, movedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw lockFailure(
      'CODEGEN_REGENERATION_LOCK_UNAVAILABLE',
      `could not move the regeneration lock ${lockPath}`,
      { lockPath, error: error?.message ?? String(error) },
      error,
    );
  }
  const moved = observeLock(movedPath);
  if (sameObservedLock(observed, moved)) return movedPath;

  // Ownership changed between observation and rename. Restore that lock when
  // possible; never delete bytes that were not the observed holder's.
  try {
    renameSync(movedPath, lockPath);
  } catch {
    // A new owner may already occupy the canonical path. Leave the displaced
    // file for a later bounded stale cleanup rather than deleting unknown state.
  }
  return null;
}

function reclaimStaleLock(lockPath, observed) {
  const movedPath = moveOwnedLockAside(lockPath, observed, 'stale');
  if (!movedPath) return false;
  rmSync(movedPath, { force: true });
  return true;
}

function releaseLock(lockPath, owner) {
  let observed;
  try {
    observed = observeLock(lockPath);
  } catch {
    return;
  }
  if (observed?.owner?.token !== owner.token) return;
  const movedPath = moveOwnedLockAside(lockPath, observed, 'released');
  if (movedPath) rmSync(movedPath, { force: true });
}

async function acquireLock(backendRoot, hooks) {
  const lockPath = join(backendRoot, LOCK_FILE);
  const owner = {
    format: LOCK_FORMAT,
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  };
  const deadline = Date.now() + LOCK_WAIT_MS;
  let reportedBlocked = false;

  for (;;) {
    try {
      writeFileSync(lockPath, `${JSON.stringify(owner)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return { lockPath, owner };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw lockFailure(
          'CODEGEN_REGENERATION_LOCK_UNAVAILABLE',
          `could not acquire the regeneration lock ${lockPath}`,
          { lockPath, error: error?.message ?? String(error) },
          error,
        );
      }
    }

    const observed = observeLock(lockPath);
    if (isStale(observed) && reclaimStaleLock(lockPath, observed)) continue;
    if (!reportedBlocked) {
      reportedBlocked = true;
      hooks?.onBlocked?.({ lockPath, owner: observed?.owner ?? null });
    }
    if (Date.now() >= deadline) {
      throw lockFailure(
        'CODEGEN_REGENERATION_LOCK_TIMEOUT',
        `timed out waiting for another regeneration of ${backendRoot}`,
        {
          backendRoot,
          lockPath,
          waitMs: LOCK_WAIT_MS,
          holderPid: observed?.owner?.pid ?? null,
        },
      );
    }
    await wait(Math.min(LOCK_POLL_MS, Math.max(1, deadline - Date.now())));
  }
}

// @ref LLP 0041#watch-mode — every codegen entry point shares one backend-local
// regeneration critical section; the managed loop's debounce remains its own
// scheduling policy, while direct and cross-process writers cannot overlap it.
export async function withCodegenGenerationLock(backendRoot, action, hooks = undefined) {
  const held = await acquireLock(backendRoot, hooks);
  try {
    await hooks?.afterAcquire?.({ lockPath: held.lockPath });
    return await action();
  } finally {
    releaseLock(held.lockPath, held.owner);
  }
}
