// Cleanup authority is the retained ChildProcess handle, never a numeric PID.
// @ref LLP 3000#publication-suite-under-contention — inspection commands must
// remain reapable even when the inspector itself is unavailable.
import { spawn } from 'node:child_process';

const owned = new WeakSet();
export function spawnOwned(...args) {
  const child = spawn(...args);
  owned.add(child);
  return child;
}
export function killOwned(child, signal) {
  if (!owned.has(child)) throw new Error('TEST_SIGNAL_REFUSED: no owned ChildProcess handle');
  // Node closes the native handle on exit. Do not convert it back into a PID
  // or infer ownership from null exit fields, parentage or a supplied object.
  return child.kill(signal);
}

export function signalSelf(signal, { group = false } = {}) {
  // Execution proves this birth. No supplied PID/PGID, metadata inspector or
  // compiler is needed on the keeper's EOF path or in CommonJS fixtures.
  if (!Number.isSafeInteger(process.pid) || process.pid <= 0 || process.pid > 0x7fffffff)
    throw new Error('TEST_SIGNAL_REFUSED: positive self PID required');
  process.kill(group ? 0 : process.pid, signal);
}

// Asynchronous timeout with a bounded TERM grace and then unconditional KILL.
// Used to bootstrap the Darwin identity inspector: it cannot inspect itself
// before compilation. Resolve only after close, including failure/timeout.
export function runOwnedCommand(command, args, { timeout, grace = 1000, env = process.env, maxBuffer = 16 * 1024 * 1024 }) {
  return new Promise(resolve => {
    let child;
    try { child = spawnOwned(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ error }); return; }
    let error, escalation, bytes = 0;
    const stdout = [], stderr = [];
    const kill = () => {
      killOwned(child, 'SIGKILL');
      child.stdout.destroy(); child.stderr.destroy();
    };
    const fail = failure => {
      if (error) return;
      error = failure;
      killOwned(child, 'SIGTERM');
      escalation = setTimeout(kill, grace);
    };
    const timer = setTimeout(() => fail(Object.assign(Error(`${command} ETIMEDOUT`), { code: 'ETIMEDOUT' })), timeout);
    const capture = target => chunk => {
      if (error) return;
      bytes += chunk.length;
      if (bytes > maxBuffer) fail(Object.assign(Error(`${command} exceeded maxBuffer`), { code: 'ENOBUFS' }));
      else target.push(chunk);
    };
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
    child.stdout.on('error', fail); child.stderr.on('error', fail);
    child.on('error', failure => { error ??= failure; });
    child.once('close', (status, signal) => {
      clearTimeout(timer); clearTimeout(escalation);
      resolve({ status, signal, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
