import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLEANUP_LEASE_DIRECTORY_ENV = 'SNAPBACK_CARRIER_CLEANUP_LEASE_DIRECTORY';

const CLEANUP_LEASE_FORMAT = 'snapback.carrier-cleanup-lease.v1';
const CLEANUP_RESOURCE_FORMAT = 'snapback.carrier-cleanup-resource.v1';
const CLEANUP_LEASE_PREFIX = 'snapback-carrier-cleanup-';
const CLEANUP_RESOURCE_PREFIX = 'resource-';
const MODULE_PATH = fileURLToPath(import.meta.url);
const LEASED_PROCESS_STATE = new WeakMap();

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

function processGroupAlivePid(pid) {
  if (!Number.isSafeInteger(pid) || process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

function processGroupAlive(child) {
  return processGroupAlivePid(child?.pid);
}

async function waitForProcessGroupPid(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlivePid(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return !processGroupAlivePid(pid);
}

async function waitForProcessGroup(child, timeoutMs) {
  return waitForProcessGroupPid(child?.pid, timeoutMs);
}

function processTable() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('cleanup lease could not enumerate process identities');
  }
  return result.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (match === null) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      processGroup: Number(match[3]),
      startTime: match[4],
    }];
  });
}

function processIdentity(pid, table = processTable()) {
  return table.find((candidate) => candidate.pid === pid) ?? null;
}

function liveIdentity(identity, table = processTable()) {
  return Number.isSafeInteger(identity?.pid)
    && typeof identity?.startTime === 'string'
    && processIdentity(identity.pid, table)?.startTime === identity.startTime;
}

function writeOwnerOnlyJson(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertLeaseDirectory(directory) {
  if (!isAbsolute(directory)) throw new Error('cleanup lease directory must be absolute');
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('cleanup lease directory must be an owner-only real directory');
  }
  const root = readJson(join(directory, 'lease.json'));
  if (root?.schemaVersion !== CLEANUP_LEASE_FORMAT
      || root.state !== 'active'
      || !Number.isSafeInteger(root.rootOwner?.pid)
      || typeof root.rootOwner?.startTime !== 'string') {
    throw new Error('cleanup lease root is malformed');
  }
  return root;
}

function cleanupLeaseHandle(directory, root, { ownsReaper = false } = {}) {
  return Object.freeze({
    directory,
    rootOwner: Object.freeze({ ...root.rootOwner }),
    ownsReaper,
  });
}

async function waitForPath(path, child, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child && exited(child)) throw new Error(`${label} exited before becoming ready`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label} did not become ready`);
}

// The reaper is deliberately detached from the carrier. It observes the
// carrier's PID/start-time identity and cleans every durable resource record
// if the carrier is SIGKILLed, so cleanup does not depend on carrier finally.
export async function createCarrierCleanupLease() {
  if (process.platform === 'win32') return null;
  const rootOwner = processIdentity(process.pid);
  if (rootOwner === null) throw new Error('carrier cleanup lease could not identify its owner');
  const directory = mkdtempSync(join(tmpdir(), CLEANUP_LEASE_PREFIX));
  chmodSync(directory, 0o700);
  const root = {
    schemaVersion: CLEANUP_LEASE_FORMAT,
    state: 'active',
    rootOwner: { pid: rootOwner.pid, startTime: rootOwner.startTime },
    createdAt: new Date().toISOString(),
  };
  writeOwnerOnlyJson(join(directory, 'lease.json'), root);
  const reaper = spawn(process.execPath, [MODULE_PATH, '--cleanup-lease-reaper', directory], {
    detached: true,
    stdio: 'ignore',
  });
  reaper.unref();
  try {
    await waitForPath(join(directory, 'reaper.ready.json'), reaper, 5_000, 'cleanup lease reaper');
  } catch (error) {
    try { process.kill(-reaper.pid, 'SIGKILL'); } catch { /* already gone */ }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return cleanupLeaseHandle(directory, root, { ownsReaper: true });
}

export function openCarrierCleanupLease(env = process.env) {
  const directory = env?.[CLEANUP_LEASE_DIRECTORY_ENV];
  if (directory === undefined) return null;
  const root = assertLeaseDirectory(directory);
  if (!liveIdentity(root.rootOwner)) {
    throw new Error('cleanup lease carrier owner is no longer live');
  }
  return cleanupLeaseHandle(directory, root);
}

function resourceFile(lease) {
  return join(lease.directory, `${CLEANUP_RESOURCE_PREFIX}${randomUUID()}.json`);
}

function reserveProcessGroup(lease, label) {
  if (lease === null || process.platform === 'win32') return null;
  assertLeaseDirectory(lease.directory);
  const owner = processIdentity(process.pid);
  if (owner === null) throw new Error('cleanup lease could not identify the process-group owner');
  const path = resourceFile(lease);
  writeOwnerOnlyJson(path, {
    schemaVersion: CLEANUP_RESOURCE_FORMAT,
    kind: 'process-group',
    state: 'reserved',
    label,
    reservationOwner: { pid: owner.pid, startTime: owner.startTime },
    createdAt: new Date().toISOString(),
  });
  return Object.freeze({ lease, path });
}

export function reserveCleanupPath(lease, path, { type, label = 'cleanup path' } = {}) {
  if (lease === null || process.platform === 'win32') return null;
  if (!isAbsolute(path) || !['file', 'browser-profile'].includes(type)) {
    throw new Error('cleanup path lease requires an absolute file or browser-profile path');
  }
  if (type === 'browser-profile') {
    const resolved = resolve(path);
    if (dirname(resolved) !== resolve(tmpdir())
        || !basename(resolved).startsWith('snapback-carrier-browser-')) {
      throw new Error('recursive cleanup lease is restricted to exact carrier browser profiles');
    }
  }
  assertLeaseDirectory(lease.directory);
  const owner = processIdentity(process.pid);
  if (owner === null) throw new Error('cleanup lease could not identify the path owner');
  const resource = resourceFile(lease);
  writeOwnerOnlyJson(resource, {
    schemaVersion: CLEANUP_RESOURCE_FORMAT,
    kind: 'path',
    state: 'active',
    label,
    reservationOwner: { pid: owner.pid, startTime: owner.startTime },
    path,
    pathType: type,
    createdAt: new Date().toISOString(),
  });
  return Object.freeze({ lease, path: resource });
}

export function releaseCleanupResource(resource) {
  if (resource === null || resource === undefined) return;
  rmSync(resource.path, { force: true });
}

// A tiny shell stays the group leader only long enough to run the registration
// helper. The helper atomically records that future PGID and validates its
// still-live reservation owner; only then does the shell exec the real child.
// Thus the workload cannot begin in an unleased detached process group.
export function spawnLeasedProcess(command, {
  cleanupLease = null,
  label = 'owned child',
  cwd,
  env,
  stdio,
} = {}) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new TypeError('leased process command must be a non-empty array');
  }
  if (cleanupLease === null || process.platform === 'win32') {
    const [executable, ...args] = command;
    return spawn(executable, args, { cwd, env, stdio, detached: process.platform !== 'win32' });
  }
  const resource = reserveProcessGroup(cleanupLease, label);
  const registerThenExec = '"$1" "$2" --cleanup-lease-register "$3" && shift 3 && exec "$@"';
  const child = spawn('/bin/sh', [
    '-c', registerThenExec, 'snapback-leased-child',
    process.execPath, MODULE_PATH, resource.path,
    ...command,
  ], {
    cwd,
    env,
    stdio,
    detached: true,
  });
  LEASED_PROCESS_STATE.set(child, resource);
  child.once('error', () => releaseCleanupResource(resource));
  return child;
}

function releaseLeasedProcess(child) {
  const resource = LEASED_PROCESS_STATE.get(child);
  if (resource === undefined) return;
  releaseCleanupResource(resource);
  LEASED_PROCESS_STATE.delete(child);
}

export async function closeCarrierCleanupLease(lease) {
  if (lease === null || !lease.ownsReaper || process.platform === 'win32') return;
  const releasePath = join(lease.directory, 'release');
  writeFileSync(releasePath, 'release\n', { flag: 'wx', mode: 0o600 });
  const donePath = join(lease.directory, 'reaper.done');
  const deadline = Date.now() + 15_000;
  while (!existsSync(donePath) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (!existsSync(donePath)) {
    throw new Error('cleanup lease reaper did not join graceful release');
  }
  rmSync(lease.directory, { recursive: true, force: true });
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
    if (!processGroupAlive(child)) {
      releaseLeasedProcess(child);
      return true;
    }
    signal(child, 'SIGTERM', true);
    if (await waitForProcessGroup(child, graceMs)) {
      await waitForExit(child, 0);
      releaseLeasedProcess(child);
      return true;
    }
    signal(child, 'SIGKILL', true);
    const stopped = await waitForProcessGroup(child, killWaitMs);
    await waitForExit(child, 0);
    if (!stopped) {
      throw new Error(`owned process group ${child.pid} survived SIGKILL`);
    }
    releaseLeasedProcess(child);
    return true;
  }
  if (exited(child)) {
    releaseLeasedProcess(child);
    return true;
  }
  signal(child, 'SIGTERM', processGroup);
  if (await waitForExit(child, graceMs)) {
    releaseLeasedProcess(child);
    return true;
  }
  signal(child, 'SIGKILL', processGroup);
  const stopped = await waitForExit(child, killWaitMs);
  if (!stopped) throw new Error(`owned process ${child.pid} survived SIGKILL`);
  releaseLeasedProcess(child);
  return true;
}

async function cleanupProcessGroup(pgid, leader) {
  if (!processGroupAlivePid(pgid)) return;
  const currentLeader = processIdentity(pgid);
  if (currentLeader !== null && currentLeader.startTime !== leader?.startTime) {
    // A PGID can be reused only after the old group is empty. Never signal a
    // new group that inherited the numeric identifier after the leased group
    // disappeared between polls.
    return;
  }
  try { process.kill(-pgid, 'SIGTERM'); } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (await waitForProcessGroupPid(pgid, 1_000)) return;
  try { process.kill(-pgid, 'SIGKILL'); } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (!(await waitForProcessGroupPid(pgid, 2_000))) {
    throw new Error(`cleanup lease process group ${pgid} survived SIGKILL`);
  }
}

function cleanupExactPath(resource) {
  if (resource.pathType === 'file') {
    rmSync(resource.path, { force: true });
    return;
  }
  const resolved = resolve(resource.path);
  if (resource.pathType !== 'browser-profile'
      || dirname(resolved) !== resolve(tmpdir())
      || !basename(resolved).startsWith('snapback-carrier-browser-')) {
    throw new Error('cleanup lease refused an unsafe recursive path');
  }
  rmSync(resolved, { recursive: true, force: true });
}

async function cleanupResource(path, resource) {
  if (resource.kind === 'process-group' && resource.state === 'active') {
    await cleanupProcessGroup(resource.processGroup, resource.leader);
  } else if (resource.kind === 'path' && resource.state === 'active') {
    cleanupExactPath(resource);
  }
  rmSync(path, { force: true });
}

async function runCleanupLeaseReaper(directory) {
  const root = assertLeaseDirectory(directory);
  writeOwnerOnlyJson(join(directory, 'reaper.ready.json'), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  let forcedRelease = false;
  const release = () => { forcedRelease = true; };
  process.on('SIGINT', release);
  process.on('SIGTERM', release);
  process.on('SIGHUP', release);
  for (;;) {
    let table;
    try { table = processTable(); } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      continue;
    }
    const rootLost = !liveIdentity(root.rootOwner, table);
    const requestedRelease = forcedRelease || existsSync(join(directory, 'release'));
    const resources = readdirSync(directory)
      .filter((name) => name.startsWith(CLEANUP_RESOURCE_PREFIX) && name.endsWith('.json'))
      .map((name) => join(directory, name));
    for (const path of resources) {
      let resource;
      try { resource = readJson(path); } catch { continue; }
      if (resource?.schemaVersion !== CLEANUP_RESOURCE_FORMAT) continue;
      const reservationLost = !liveIdentity(resource.reservationOwner, table);
      const leaderLost = resource.kind === 'process-group'
        && resource.state === 'active'
        && !liveIdentity(resource.leader, table);
      if (!rootLost && !requestedRelease && !reservationLost && !leaderLost) continue;
      try { await cleanupResource(path, resource); } catch {
        // Keep the durable record and retry. A failed cleanup is never
        // converted into a successful lease disposition.
      }
    }
    if (rootLost || requestedRelease) {
      const remaining = readdirSync(directory)
        .some((name) => name.startsWith(CLEANUP_RESOURCE_PREFIX) && name.endsWith('.json'));
      if (!remaining) {
        if (requestedRelease && !rootLost) {
          writeFileSync(join(directory, 'reaper.done'), 'done\n', { mode: 0o600 });
        } else {
          rmSync(directory, { recursive: true, force: true });
        }
        return;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

function registerCleanupLeaseProcess(path) {
  const resource = readJson(path);
  if (resource?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
      || resource.kind !== 'process-group'
      || resource.state !== 'reserved') {
    throw new Error('cleanup process-group reservation is malformed');
  }
  const table = processTable();
  const owner = processIdentity(resource.reservationOwner?.pid, table);
  const launcher = processIdentity(process.ppid, table);
  if (owner?.startTime !== resource.reservationOwner?.startTime
      || launcher === null
      || launcher.ppid !== owner.pid
      || launcher.processGroup !== launcher.pid) {
    throw new Error('cleanup process-group reservation owner or launcher changed before exec');
  }
  writeOwnerOnlyJson(path, {
    ...resource,
    state: 'active',
    processGroup: launcher.processGroup,
    leader: { pid: launcher.pid, startTime: launcher.startTime },
    activatedAt: new Date().toISOString(),
  });
}

if (process.argv[2] === '--cleanup-lease-register') {
  try {
    registerCleanupLeaseProcess(process.argv[3]);
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
} else if (process.argv[2] === '--cleanup-lease-reaper') {
  try {
    await runCleanupLeaseReaper(process.argv[3]);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
