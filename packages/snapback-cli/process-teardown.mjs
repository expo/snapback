function exited(child) {
  return !child || child.exitCode != null || child.signalCode != null;
}

function signal(child, name, processGroup) {
  try {
    if (processGroup && process.platform !== 'win32') process.kill(-child.pid, name);
    else child.kill(name);
  } catch {
    try { child.kill(name); } catch { /* already gone */ }
  }
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const onExit = () => settle(true);
    const timer = setTimeout(() => settle(exited(child)), timeoutMs);
    const settle = (didExit) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(didExit);
    };
    child.once('exit', onExit);
  });
}

function processGroupAlive(child) {
  if (!child || !Number.isSafeInteger(child.pid) || process.platform === 'win32') return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function waitForProcessGroup(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(child) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return !processGroupAlive(child);
}

// @ref LLP 0030#server-process-ownership — stop only the child tree this
// managed session owns, escalating from graceful termination to kill.
// Detached shell/Metro trees opt into processGroup; ordinary native children
// are signalled directly so the caller's own process group is never targeted.
export async function stopProcessGroup(child, {
  graceMs = 5_000,
  killWaitMs = 2_000,
  processGroup = false,
} = {}) {
  if (!child) return true;
  if (processGroup && process.platform !== 'win32') {
    // The detached leader may already be reaped while a shell/Metro
    // grandchild continues to own the recorded group.
    if (!processGroupAlive(child)) return true;
    signal(child, 'SIGTERM', true);
    if (await waitForProcessGroup(child, graceMs)) {
      await waitForExit(child, 0);
      return true;
    }
    signal(child, 'SIGKILL', true);
    const stopped = await waitForProcessGroup(child, killWaitMs);
    await waitForExit(child, 0);
    return stopped;
  }
  if (exited(child)) return true;
  signal(child, 'SIGTERM', processGroup);
  if (await waitForExit(child, graceMs)) return true;
  signal(child, 'SIGKILL', processGroup);
  return waitForExit(child, killWaitMs);
}
