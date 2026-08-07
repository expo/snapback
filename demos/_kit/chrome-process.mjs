// Shared Chrome/CDP process ownership for repository acceptance suites.
//
// @ref LLP 0015#acceptance-rules — a browser acceptance cleanup owns the whole
// detached process tree; profile deletion follows native tree/leader exit
// attestation and never substitutes for it.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownProcessTree, stopChild } from './server-process.mjs';

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 100;
const STDERR_LIMIT_BYTES = 16_000;
const LIFECYCLE_OWNED_FLAGS = [
  '--remote-debugging-port',
  '--user-data-dir',
];
const INDEXEDDB_BACKING_STORE_FAILURE = /internal error opening backing store/i;
const CHROME_LOADER_RESOURCE_EXHAUSTED = /\bnet::ERR_INSUFFICIENT_RESOURCES\b/;

// JavaScript permits `throw null` and `throw undefined`; neither may be
// confused with the absence of a primary run failure.
export const NO_PRIMARY_FAILURE = Symbol('snapback.no-primary-failure');

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function cleanupMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorChainMatches(error, predicate, seen = new Set()) {
  if (error === null || error === undefined || seen.has(error)) return false;
  if ((typeof error === 'object' || typeof error === 'function')) seen.add(error);
  if (predicate(cleanupMessage(error), error)) return true;
  if (error?.cause && errorChainMatches(error.cause, predicate, seen)) return true;
  if (Array.isArray(error?.errors)) {
    return error.errors.some((entry) => errorChainMatches(entry, predicate, seen));
  }
  return false;
}

/**
 * Retry only Chrome's exact loader-resource diagnostic. The operation must own
 * a fresh browser process and its cleanup on every attempt; product failures
 * and every other infrastructure failure retain their original identity.
 *
 * @ref LLP 0010#ci-and-review-gates — acceptance failures stay visible while
 * one bounded, diagnostic-specific infrastructure recovery is permitted.
 */
export async function retryChromeResourceExhaustion(operation, {
  maxAttempts = process.platform === 'linux' ? 3 : 1,
  delayMs = 250,
  sleepImpl = sleep,
} = {}) {
  if (typeof operation !== 'function') {
    throw new TypeError('retryChromeResourceExhaustion requires an operation function');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('retryChromeResourceExhaustion maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError('retryChromeResourceExhaustion delayMs must be a non-negative number');
  }
  if (typeof sleepImpl !== 'function') {
    throw new TypeError('retryChromeResourceExhaustion sleepImpl must be a function');
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      const resourceExhausted = errorChainMatches(
        error,
        (message) => CHROME_LOADER_RESOURCE_EXHAUSTED.test(message),
      );
      const cleanupFailed = errorChainMatches(
        error,
        (_message, candidate) => (
          typeof candidate?.code === 'string'
          && (candidate.code.includes('CLEANUP') || candidate.code.includes('PROCESS_TREE'))
        ),
      );
      if (!resourceExhausted || cleanupFailed || attempt >= maxAttempts) throw error;
      await sleepImpl(delayMs * attempt);
    }
  }
}

/**
 * Add profile identity and a concrete recovery to Chrome's otherwise opaque
 * IndexedDB backing-store error. Non-matching errors retain exact identity.
 */
export function diagnoseChromeRuntimeError(error, {
  profilePath,
  platform = process.platform,
} = {}) {
  if (!errorChainMatches(error, (message) => INDEXEDDB_BACKING_STORE_FAILURE.test(message))) {
    return error;
  }
  if (error?.code === 'SNAPBACK_BROWSER_INDEXEDDB_PROFILE_OPEN_FAILED') return error;
  if (typeof profilePath !== 'string' || profilePath.length === 0) {
    throw new TypeError('diagnoseChromeRuntimeError requires a Chrome profilePath for backing-store failures');
  }
  const tempRootRecovery = platform === 'darwin'
    ? "tempRoot: '/tmp'"
    : 'tempRoot: <short writable temporary directory>';
  const message = [
    cleanupMessage(error),
    `Chrome reported "UnknownError: Internal error opening backing store" and could not initialize IndexedDB in profile ${profilePath}.`,
    `This failure can depend on the profile path or host policy; retry launchChromeCdp with ${tempRootRecovery} for launcher-owned cleanup, or userDataDir: <explicit writable profile> when the caller must retain the profile.`,
  ].join(' ');
  const wrapped = new Error(message, { cause: error });
  wrapped.code = 'SNAPBACK_BROWSER_INDEXEDDB_PROFILE_OPEN_FAILED';
  wrapped.profilePath = profilePath;
  wrapped.diagnostic = {
    schemaVersion: 'snapback.browser-runtime-diagnostic.v1',
    code: wrapped.code,
    subsystem: 'browser-profile',
    platform,
    profilePath,
    recovery: {
      launcherOwned: tempRootRecovery,
      callerOwned: 'userDataDir: <explicit writable profile>',
    },
  };
  return wrapped;
}

function removeProfile(profilePath, rmImpl) {
  try {
    rmImpl(profilePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch (error) {
    const wrapped = new Error(
      `Chrome profile cleanup failed at ${profilePath}: ${cleanupMessage(error)}`,
      { cause: error },
    );
    wrapped.code = 'SNAPBACK_BROWSER_PROFILE_CLEANUP_FAILED';
    wrapped.profilePath = profilePath;
    throw wrapped;
  }
}

function profilePreservedError(error, profilePath) {
  const wrapped = new Error(
    `${cleanupMessage(error)}; Chrome profile preserved at ${profilePath} because process-tree exit was not attested`,
    { cause: error },
  );
  wrapped.code = error?.code ?? 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED';
  wrapped.cleanup = error?.cleanup;
  wrapped.profilePath = profilePath;
  return wrapped;
}

function startupFailure(error, cleanupError) {
  const aggregate = new AggregateError(
    [error, cleanupError],
    `${cleanupMessage(error)}; Chrome startup cleanup failed: ${cleanupMessage(cleanupError)}`,
    { cause: error },
  );
  aggregate.code = cleanupError?.code ?? 'SNAPBACK_BROWSER_STARTUP_CLEANUP_FAILED';
  aggregate.cleanup = cleanupError?.cleanup;
  aggregate.profilePath = cleanupError?.profilePath;
  return aggregate;
}

function assertNoLifecycleFlagOverrides(extraArgs) {
  for (const argument of extraArgs) {
    if (typeof argument !== 'string') {
      throw new TypeError('Chrome extra arguments must be strings');
    }
    for (const ownedFlag of LIFECYCLE_OWNED_FLAGS) {
      if (argument === ownedFlag || argument.startsWith(`${ownedFlag}=`)) {
        const error = new TypeError(
          `${ownedFlag} is owned by the shared Chrome lifecycle and cannot be supplied through extraArgs`,
        );
        error.code = 'SNAPBACK_BROWSER_LIFECYCLE_FLAG_OVERRIDE';
        throw error;
      }
    }
  }
}

export function throwRunAndCleanupFailures({
  label,
  primaryError = NO_PRIMARY_FAILURE,
  cleanupErrors = [],
}) {
  if (!Array.isArray(cleanupErrors)) {
    throw new TypeError('cleanupErrors must be an array');
  }
  const hasPrimaryFailure = primaryError !== NO_PRIMARY_FAILURE;
  if (!hasPrimaryFailure && cleanupErrors.length === 0) return;
  if (hasPrimaryFailure && cleanupErrors.length === 0) throw primaryError;
  if (!hasPrimaryFailure && cleanupErrors.length === 1) throw cleanupErrors[0];
  const failures = !hasPrimaryFailure
    ? [...cleanupErrors]
    : [primaryError, ...cleanupErrors];
  throw new AggregateError(
    failures,
    `${label} failed with ${hasPrimaryFailure ? 1 : 0} primary and ${cleanupErrors.length} cleanup error(s)`,
    hasPrimaryFailure ? { cause: primaryError } : undefined,
  );
}

/**
 * Launch one isolated headless Chrome instance and return its CDP endpoint.
 * Test-only dependency overrides keep the lifecycle proof independent of a
 * locally installed browser; production callers should use the public fields.
 */
export async function launchChromeCdp({
  chromeBin,
  userDataDir = null,
  userDataPrefix = 'snapback-chrome-',
  tempRoot = tmpdir(),
  env = process.env,
  extraArgs = [],
  launchPrefixArgs = [],
  initialUrl = 'about:blank',
  headless = true,
  stopSignal = 'SIGTERM',
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  stopOptions = undefined,
  dependencies = {},
} = {}) {
  if (typeof chromeBin !== 'string' || chromeBin.length === 0) {
    throw new TypeError('launchChromeCdp requires a Chrome executable path');
  }
  if (!Array.isArray(extraArgs) || !Array.isArray(launchPrefixArgs)) {
    throw new TypeError('Chrome launch arguments must be arrays');
  }
  if (userDataDir !== null && (typeof userDataDir !== 'string' || userDataDir.length === 0)) {
    throw new TypeError('Chrome userDataDir must be a non-empty path');
  }
  if (typeof initialUrl !== 'string' || initialUrl.length === 0) {
    throw new TypeError('Chrome initialUrl must be a non-empty URL');
  }
  if (typeof headless !== 'boolean') throw new TypeError('Chrome headless must be boolean');
  if (stopSignal !== 'SIGTERM' && stopSignal !== 'SIGKILL') {
    throw new TypeError('Chrome stopSignal must be SIGTERM or SIGKILL');
  }
  assertNoLifecycleFlagOverrides(extraArgs);

  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const mkdtempImpl = dependencies.mkdtempImpl ?? mkdtempSync;
  const readFileImpl = dependencies.readFileImpl ?? readFileSync;
  const rmImpl = dependencies.rmImpl ?? rmSync;
  const stopChildImpl = dependencies.stopChildImpl ?? stopChild;
  const platform = dependencies.platform ?? process.platform;
  // @ref LLP 0155#stage-0--authority-reconciliation-and-baseline-freeze —
  // crash/relaunch evidence retains one exact profile while this launcher
  // still owns both browser process trees and their signal/exit attestation.
  const ownsProfile = userDataDir === null;
  const profilePath = userDataDir ?? mkdtempImpl(join(tempRoot, userDataPrefix));
  const chromeArgs = [
    ...launchPrefixArgs,
    ...(headless ? ['--headless=new', '--disable-gpu'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    ...extraArgs,
    initialUrl,
  ];

  let child;
  try {
    child = spawnImpl(chromeBin, chromeArgs, {
      env,
      detached: platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    const launchError = new Error(`Chrome failed to launch (${chromeBin}): ${cleanupMessage(error)}`, {
      cause: error,
    });
    if (ownsProfile) {
      try {
        removeProfile(profilePath, rmImpl);
      } catch (cleanupError) {
        throw startupFailure(launchError, cleanupError);
      }
    }
    throw launchError;
  }

  let stderr = '';
  let spawnError = null;
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT_BYTES);
  });
  child.once('error', (error) => { spawnError = error; });

  const ownership = ownProcessTree(child, async () => {
    try {
      await stopChildImpl(child, { ...stopOptions, initialSignal: stopSignal });
    } catch (error) {
      throw profilePreservedError(error, profilePath);
    }
    if (ownsProfile) removeProfile(profilePath, rmImpl);
  });
  const stop = () => ownership.stop();
  const portFile = join(profilePath, 'DevToolsActivePort');
  const deadline = Date.now() + Math.max(1, startupTimeoutMs);

  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Chrome failed to launch (${chromeBin}): ${cleanupMessage(spawnError)}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Chrome exited before CDP startup (${child.exitCode ?? child.signalCode})${stderr ? `:\n${stderr}` : ''}`,
        );
      }
      try {
        const [debugPort] = readFileImpl(portFile, 'utf8').trim().split('\n');
        if (!/^\d+$/.test(debugPort)) throw new Error('DevToolsActivePort did not contain a port');
        const remainingMs = Math.max(1, deadline - Date.now());
        const response = await fetchImpl(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(Math.min(1_000, remainingMs)),
        });
        const version = await response.json();
        if (typeof version?.webSocketDebuggerUrl !== 'string') {
          throw new Error('Chrome version response omitted webSocketDebuggerUrl');
        }
        return {
          ws: version.webSocketDebuggerUrl,
          version,
          debugPort: Number(debugPort),
          pid: child.pid,
          profilePath,
          diagnoseRuntimeError: (error) => diagnoseChromeRuntimeError(error, {
            profilePath,
            platform,
          }),
          stop,
        };
      } catch {
        await sleep(Math.max(1, Math.min(pollMs, deadline - Date.now())));
      }
    }
    throw new Error(
      `Chrome did not expose DevToolsActivePort within ${startupTimeoutMs}ms${stderr ? `:\n${stderr}` : ''}`,
    );
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw startupFailure(error, cleanupError);
    }
    throw error;
  }
}
