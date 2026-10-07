// Direct children retain native handles. Compiler commands use private groups
// whose live keepers dispatch group signals; group numbers are observations.
// @ref LLP 3000#publication-suite-under-contention — inspection commands must
// remain reapable even when the inspector itself is unavailable.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitForEmptyGroup } from './test-command-group.mjs';

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

// Only for the fixed system ps executable below, which does not fork. Compiler
// commands need the separate group lifetime in runOwnedCommand.
function runInspection(command, args, { timeout, env, maxBuffer }) {
  return new Promise(resolve => {
    let child;
    try { child = spawnOwned(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ error }); return; }
    let error, bytes = 0;
    const stdout = [], stderr = [];
    const kill = () => {
      killOwned(child, 'SIGKILL');
      child.stdout.destroy(); child.stderr.destroy();
    };
    const fail = failure => {
      if (error) return;
      error = failure;
      kill();
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
      clearTimeout(timer);
      resolve({ status, signal, error, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

// The keeper pins a private group and signals only its own group. The caller
// requests cleanup over its pipe; it never dispatches to a cached negative PID.
// Completed cleanup requires a reaped keeper and two observations with no live
// group members; failed inspection returns cleanupError instead of claiming a
// drained group. Ordinary descendants inherit custody; processes deliberately
// leaving the group are outside it.
export function runOwnedCommand(command, args, { timeout, grace = 1000, env = process.env, maxBuffer = 16 * 1024 * 1024 }) {
  return new Promise(resolve => {
    let keeper;
    try {
      keeper = spawnOwned(process.execPath, [new URL('./test-command-owner.mjs', import.meta.url).pathname, String(grace), command, ...args],
        { env, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    } catch (error) { resolve({ error }); return; }
    let error, cleanupError, released = false, commandExited = false, bytes = 0, status = null, signal = null;
    const stdout = [], stderr = [];
    const release = mode => {
      if (released) return;
      released = true;
      keeper.stdin.end(mode);
    };
    const fail = failure => { error ??= failure; release('TERM'); };
    const timer = setTimeout(() => fail(Object.assign(Error(`${command} ETIMEDOUT`), { code: 'ETIMEDOUT' })), timeout);
    const capture = target => chunk => {
      if (error) return;
      bytes += chunk.length;
      if (bytes > maxBuffer) fail(Object.assign(Error(`${command} exceeded maxBuffer`), { code: 'ENOBUFS' }));
      else target.push(chunk);
    };
    keeper.stdout.on('data', capture(stdout)); keeper.stderr.on('data', capture(stderr));
    keeper.stdout.on('error', fail); keeper.stderr.on('error', fail);
    keeper.stdin.on('error', failure => { error ??= failure; });
    keeper.on('message', message => {
      if (message.error) error ??= Object.assign(Error(message.error), { code: message.errorCode });
      if (message.exited || message.error) {
        commandExited = true;
        status = message.status ?? null; signal = message.signal ?? null;
        // A timeout is already under TERM/grace/KILL custody. A driver exit
        // cannot cancel its escalation while a frontend is still alive.
        release('KILL');
      }
    });
    keeper.once('error', failure => { error ??= failure; });
    const closed = new Promise(done => keeper.once('close', done));
    const complete = async (_status, keeperSignal) => {
      clearTimeout(timer);
      if (!released) error ??= Error('TEST_COMMAND_KEEPER_EXIT: owner exited before release');
      if (keeper.pid) {
        try { await waitForEmptyGroup(keeper.pid, runInspection); }
        catch (failure) { cleanupError = failure; error ??= failure; }
      }
      // A living descendant can hold the pipes open after keeper exit. Inspect
      // before awaiting close, so a failed drain has a bounded diagnostic too.
      const drained = cleanupError ? false : await Promise.race([closed.then(() => true), sleep(10000, false, { ref: false })]);
      if (!drained) {
        error ??= Error('TEST_COMMAND_OUTPUT_NOT_CLOSED: pipes survived group cleanup');
        keeper.stdout.destroy(); keeper.stderr.destroy();
      }
      await closed;
      resolve({ status, signal: commandExited ? signal : keeperSignal, error, cleanupError, group: keeper.pid,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    };
    keeper.once('exit', complete);
    // Failed spawn has no exit event or group to inspect.
    keeper.once('close', () => { if (!keeper.pid) void complete(null, null); });
  });
}
