// @ref LLP 0015#acceptance-rules — a tree cleanup is complete only after the
// platform primitive itself has succeeded, including POSIX ESRCH attestation
// and the awaited Windows taskkill /T close status.

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export function cleanupError(error) {
  return error instanceof Error ? error.message : String(error);
}

function processGroupGone(pid, processKill) {
  try {
    processKill(-pid, 0);
    return { gone: false };
  } catch (error) {
    if (error?.code === 'ESRCH') return { gone: true };
    return { gone: false, error };
  }
}

export async function attestProcessGroupExit(pid, {
  processKill = process.kill,
  timeoutMs = 2_000,
  pollMs = 10,
} = {}) {
  const deadline = performance.now() + Math.max(0, timeoutMs);
  let polls = 0;
  let lastProbeError = null;
  for (;;) {
    polls += 1;
    const probe = processGroupGone(pid, processKill);
    if (probe.gone) return { ok: true, exitAttested: true, polls };
    // EPERM and other transient probe failures do not attest exit, but they
    // also need not make cleanup fail immediately while the bounded window can
    // still reach an authoritative ESRCH observation.
    lastProbeError = probe.error ? cleanupError(probe.error) : null;
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        exitAttested: false,
        polls,
        timedOut: true,
        error: lastProbeError
          ? `process-group exit was not attested after ${timeoutMs}ms; last probe failed: ${lastProbeError}`
          : `process group still existed after ${timeoutMs}ms cleanup attestation`,
      };
    }
    // Keep this timer referenced. Once the leader exits, no child handle may
    // remain to keep Node alive, but cleanup cannot settle until the bounded
    // group-exit proof has completed.
    await new Promise((resolvePoll) => {
      setTimeout(resolvePoll, Math.max(1, Math.min(pollMs, remainingMs)));
    });
  }
}

/**
 * Signal one subprocess tree and report whether the native tree primitive
 * completed. A successful POSIX SIGKILL is not success until a signal-0 probe
 * observes ESRCH. A Windows taskkill is not success until its close event
 * reports exit code zero.
 */
export function signalProcessTree(child, signal, {
  spawnImpl = spawn,
  platform = process.platform,
  taskkillTimeoutMs = 2_000,
  processGroupTimeoutMs = 2_000,
  processGroupPollMs = 10,
  processKill = process.kill,
} = {}) {
  const pid = child?.pid;
  if (!pid) {
    return Promise.resolve({ ok: true, mechanism: 'none', signal, pid: null });
  }
  if (platform === 'win32') {
    // Windows has no negative-pid process groups. taskkill /T is the native
    // tree primitive; /F is reserved for the hard-kill leg.
    const args = ['/pid', String(pid), '/t'];
    if (signal === 'SIGKILL') args.push('/f');
    return new Promise((resolveCleanup) => {
      let settled = false;
      let killer;
      let timeout = null;
      const fallbackLeader = () => {
        if (child.exitCode != null || typeof child.kill !== 'function') return false;
        try {
          return child.kill(signal) !== false;
        } catch {
          return false;
        }
      };
      const finishCleanup = (result) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolveCleanup({
          mechanism: 'taskkill',
          signal,
          pid,
          args,
          ...result,
        });
      };
      try {
        killer = spawnImpl('taskkill', args, { stdio: 'ignore', windowsHide: true });
      } catch (error) {
        finishCleanup({
          ok: false,
          error: `taskkill spawn failed: ${cleanupError(error)}`,
          leaderFallback: fallbackLeader(),
        });
        return;
      }
      // This timeout is intentionally referenced: neither a fake test child
      // nor a leader that has already closed can be relied on to keep Node
      // alive while taskkill itself is still outstanding.
      timeout = setTimeout(() => {
        try { killer.kill?.('SIGKILL'); } catch { /* best effort */ }
        finishCleanup({
          ok: false,
          timedOut: true,
          error: `taskkill did not complete within ${taskkillTimeoutMs}ms`,
          leaderFallback: fallbackLeader(),
        });
      }, taskkillTimeoutMs);
      killer.once('error', (error) => finishCleanup({
        ok: false,
        error: `taskkill spawn failed: ${cleanupError(error)}`,
        leaderFallback: fallbackLeader(),
      }));
      killer.once('close', (code, taskkillSignal) => finishCleanup({
        ok: code === 0,
        code,
        taskkillSignal,
        ...(code === 0
          ? {}
          : {
              error: `taskkill exited ${code ?? taskkillSignal}`,
              leaderFallback: fallbackLeader(),
            }),
      }));
    });
  }
  try {
    processKill(-pid, signal);
    if (signal !== 'SIGKILL') {
      return Promise.resolve({
        ok: true,
        mechanism: 'process-group',
        signal,
        pid,
        delivered: true,
        exitAttested: false,
      });
    }
    // Successful kill(2) delivery is not evidence that the group has exited.
    return attestProcessGroupExit(pid, {
      processKill,
      timeoutMs: processGroupTimeoutMs,
      pollMs: processGroupPollMs,
    }).then((attestation) => ({
      mechanism: 'process-group',
      signal,
      pid,
      delivered: true,
      ...attestation,
    }));
  } catch (error) {
    // ESRCH proves there is no process left in the detached process group.
    if (error?.code === 'ESRCH') {
      return Promise.resolve({
        ok: true,
        mechanism: 'process-group',
        signal,
        pid,
        alreadyExited: true,
        exitAttested: true,
      });
    }
    let leaderFallback = false;
    if (child.exitCode == null && typeof child.kill === 'function') {
      try { leaderFallback = child.kill(signal) !== false; } catch { /* best effort */ }
    }
    return Promise.resolve({
      ok: false,
      mechanism: 'process-group',
      signal,
      pid,
      error: cleanupError(error),
      leaderFallback,
    });
  }
}

function childCloseObserved(child) {
  if (child?.exitCode == null && child?.signalCode == null) return false;
  return [child.stdout, child.stderr].every(
    (stream) => !stream || stream.closed === true || stream.destroyed === true,
  );
}

async function waitForChildClose(child, timeoutMs) {
  if (childCloseObserved(child)) return true;
  return new Promise((resolveClose) => {
    let settled = false;
    let timeout;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.off?.('close', onClose);
      resolveClose(closed);
    };
    const onClose = () => finish(true);
    child.once?.('close', onClose);
    timeout = setTimeout(() => finish(childCloseObserved(child)), timeoutMs);
  });
}

/**
 * Request an owned child tree's normal stop, then hard-stop and attest any
 * descendant that outlives the leader. Captured stdio is retired only after
 * the native tree primitive completes, so a grandchild cannot keep the
 * caller alive indefinitely by retaining the leader's pipe descriptors.
 */
export async function stopOwnedProcessTree(child, {
  requestGracefulStop = () => child?.stdin?.end(),
  gracefulTimeoutMs = 15_000,
  leaderCloseTimeoutMs = 2_000,
  signalTree = signalProcessTree,
  platform = process.platform,
  taskkillTimeoutMs = 2_000,
  processGroupTimeoutMs = 2_000,
  processGroupPollMs = 10,
  processKill = process.kill,
} = {}) {
  const pid = child?.pid;
  if (!pid) {
    return {
      ok: true,
      pid: null,
      gracefulStopRequested: false,
      leaderClosed: true,
      cleanup: { ok: true, mechanism: 'none', signal: 'SIGKILL', pid: null },
    };
  }

  let gracefulStopError = null;
  try {
    await requestGracefulStop?.();
  } catch (error) {
    gracefulStopError = cleanupError(error);
  }
  let leaderClosed = await waitForChildClose(child, gracefulTimeoutMs);

  let cleanup;
  if (platform === 'win32' && leaderClosed) {
    // Once a normally stopping Windows leader has closed, taskkill can no
    // longer address its former tree by pid. The process owns descendant
    // shutdown on this successful path; live leaders still take /T /F below.
    cleanup = {
      ok: true,
      mechanism: 'graceful-leader-close',
      signal: 'SIGKILL',
      pid,
      exitAttested: true,
    };
  } else {
    try {
      cleanup = await signalTree(child, 'SIGKILL', {
        platform,
        taskkillTimeoutMs,
        processGroupTimeoutMs,
        processGroupPollMs,
        processKill,
      });
    } catch (error) {
      cleanup = {
        ok: false,
        mechanism: 'cleanup-seam',
        signal: 'SIGKILL',
        pid,
        error: cleanupError(error),
      };
    }
  }

  // After whole-tree exit is attested, no subprocess can legitimately own
  // these handles. Retiring them prevents a stale captured pipe from keeping
  // the proof runner's event loop alive while close delivery settles.
  try { child.stdin?.destroy?.(); } catch { /* tree result remains authority */ }
  try { child.stdout?.destroy?.(); } catch { /* tree result remains authority */ }
  try { child.stderr?.destroy?.(); } catch { /* tree result remains authority */ }
  if (!leaderClosed) {
    leaderClosed = await waitForChildClose(child, leaderCloseTimeoutMs);
  }

  return {
    ok: cleanup.ok === true && leaderClosed,
    pid,
    gracefulStopRequested: true,
    ...(gracefulStopError ? { gracefulStopError } : {}),
    leaderClosed,
    cleanup,
    ...(!cleanup.ok
      ? { error: cleanup.error ?? 'process-tree cleanup was not attested' }
      : !leaderClosed
        ? { error: `process tree exited but leader close was not observed within ${leaderCloseTimeoutMs}ms` }
        : {}),
  };
}
