import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const MAX_OUTPUT = 64 * 1024;

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function run(label, command, args, { cwd, env = {}, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const append = (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error(`${label} could not start: ${error.message}`), { cause: error }));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${label} exited ${code ?? signal}: ${output.slice(-8_000)}`));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${timeoutMs}ms: ${output.slice(-8_000)}`));
    }, timeoutMs);
  });
}

export function spawnOwned(label, command, args, {
  cwd,
  env = {},
  stdin = 'pipe',
  logPath = null,
} = {}) {
  const logFd = logPath === null ? null : openSync(logPath, 'wx', 0o600);
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
    stdio: [stdin, 'pipe', 'pipe'],
  });
  let output = '';
  const append = (chunk) => { output = `${output}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT); };
  const capture = (chunk) => {
    append(chunk);
    if (logFd !== null) {
      try { writeFileSync(logFd, chunk); } catch { /* retain process output tail */ }
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('close', () => { if (logFd !== null) closeSync(logFd); });
  child.once('error', (error) => { output = `${output}\n${label}: ${error.message}`; });
  return Object.assign(child, { ownedLabel: label, capturedOutput: () => output });
}

export function runToFileExclusive(label, command, args, path, {
  cwd,
  env = {},
  timeoutMs = 20 * 60_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const fd = openSync(path, 'wx', 0o600);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', fd, 'pipe'],
    });
    let errors = '';
    let settled = false;
    child.stderr.on('data', (chunk) => {
      errors = `${errors}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT);
      try { writeFileSync(fd, chunk); } catch { /* retain the subprocess error */ }
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(fd);
      callback();
    };
    child.once('error', (error) => finish(() => reject(
      Object.assign(new Error(`${label} could not start: ${error.message}`), { cause: error }),
    )));
    child.once('close', (code, signal) => finish(() => {
      if (code === 0) resolve(path);
      else reject(new Error(`${label} exited ${code ?? signal}: ${errors.slice(-8_000)}`));
    }));
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      finish(() => reject(new Error(`${label} timed out after ${timeoutMs}ms: ${errors.slice(-8_000)}`)));
    }, timeoutMs);
  });
}

export function listenerPids(port) {
  try {
    const output = execFileSync('lsof', [
      '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t',
    ], { encoding: 'utf8' });
    return [...new Set(output.trim().split(/\s+/u)
      .filter((value) => /^\d+$/u.test(value))
      .map(Number))];
  } catch (error) {
    if (error?.status === 1) return [];
    throw new Error(`could not inspect TCP port ${port} with lsof: ${error.message}`);
  }
}

function processCommand(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '<process exited>';
  }
}

export async function prepareHarnessPort({ port, ownerFile, role }) {
  const listeners = listenerPids(port);
  if (listeners.length === 0) {
    rmSync(ownerFile, { force: true });
    return;
  }
  let owner = null;
  try { owner = JSON.parse(readFileSync(ownerFile, 'utf8')); } catch { /* foreign or stale */ }
  const owned = owner?.kind === 'native-custody-probe-harness-port'
    && owner.role === role
    && owner.port === port
    && Number.isSafeInteger(owner.pid)
    && listeners.includes(owner.pid)
    && processCommand(owner.pid).includes(owner.commandToken ?? '\0');
  if (!owned) {
    const occupants = listeners.map((pid) => `${pid} (${processCommand(pid)})`).join(', ');
    throw new Error(`P0/${role}-port: TCP ${port} has foreign occupant ${occupants}`);
  }
  try { process.kill(owner.pid, 'SIGTERM'); } catch { /* exited after lsof */ }
  const deadline = Date.now() + 5_000;
  while (listenerPids(port).length > 0 && Date.now() < deadline) await delay(50);
  if (listenerPids(port).length > 0) {
    try { process.kill(owner.pid, 'SIGKILL'); } catch { /* exited after SIGTERM */ }
  }
  const killDeadline = Date.now() + 5_000;
  while (listenerPids(port).length > 0 && Date.now() < killDeadline) await delay(50);
  if (listenerPids(port).length > 0) {
    throw new Error(`P0/${role}-port: harness-owned stale listener ${owner.pid} did not release TCP ${port}`);
  }
  rmSync(ownerFile, { force: true });
}

export function writeHarnessPortOwner({ port, ownerFile, role, pid, commandToken }) {
  mkdirSync(dirname(ownerFile), { recursive: true, mode: 0o700 });
  writeFileSync(ownerFile, `${JSON.stringify({
    kind: 'native-custody-probe-harness-port',
    role,
    port,
    pid,
    commandToken,
    startedAt: new Date().toISOString(),
  })}\n`, { flag: 'wx', mode: 0o600 });
}

export function removeHarnessPortOwner(ownerFile, pid) {
  if (!existsSync(ownerFile)) return;
  try {
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    if (owner?.kind === 'native-custody-probe-harness-port' && owner.pid === pid) {
      rmSync(ownerFile, { force: true });
    }
  } catch { /* preserve an unrecognized owner receipt */ }
}

export function verifyListenerPid(port, expectedPid, label) {
  const listeners = listenerPids(port);
  if (listeners.length !== 1 || listeners[0] !== expectedPid) {
    const occupants = listeners.map((pid) => `${pid} (${processCommand(pid)})`).join(', ') || 'none';
    throw new Error(`${label}: TCP ${port} listener must be spawned PID ${expectedPid}; observed ${occupants}`);
  }
  return Object.freeze({ port, pid: expectedPid });
}

export async function stopOwned(child, { timeoutMs = 10_000 } = {}) {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return;
  if (child.stdin?.writable) child.stdin.end();
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await delay(50);
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch { /* already gone */ }
  await delay(250);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { /* already gone */ }
  }
}

export async function eventually(read, label, timeoutMs = 60_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
