import { spawn } from 'node:child_process';

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

export function spawnOwned(label, command, args, { cwd, env = {}, stdin = 'pipe' } = {}) {
  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
    stdio: [stdin, 'pipe', 'pipe'],
  });
  let output = '';
  const append = (chunk) => { output = `${output}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', (error) => { output = `${output}\n${label}: ${error.message}`; });
  return Object.assign(child, { ownedLabel: label, capturedOutput: () => output });
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
