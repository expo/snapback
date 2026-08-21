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

const CLEANUP_LEASE_FORMAT = 'snapback.carrier-cleanup-lease.v2';
const CLEANUP_RESOURCE_FORMAT = 'snapback.carrier-cleanup-resource.v2';
const CLEANUP_LEASE_PREFIX = 'snapback-carrier-cleanup-';
const CLEANUP_RESOURCE_PREFIX = 'resource-';
const PROCESS_LEASE_MARKER_ENV = 'SNAPBACK_CARRIER_PROCESS_LEASE_MARKER';
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

function processTable() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,command='], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error('cleanup lease could not enumerate process identities');
  }
  return result.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/u.exec(line);
    if (match === null) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      processGroup: Number(match[3]),
      startTime: match[4],
      command: match[5],
    }];
  });
}

function processIdentity(pid, table = processTable()) {
  return table.find((candidate) => candidate.pid === pid) ?? null;
}

function processLeaseMarkerState(pid, marker) {
  if (!Number.isSafeInteger(pid) || typeof marker !== 'string' || marker.length === 0) {
    return 'mismatch';
  }
  try {
    if (process.platform === 'linux') {
      return readFileSync(`/proc/${pid}/environ`)
        .toString('utf8')
        .split('\0')
        .includes(`${PROCESS_LEASE_MARKER_ENV}=${marker}`) ? 'match' : 'mismatch';
    }
    const result = spawnSync('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) return 'unavailable';
    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (new RegExp(
      `(?:^|\\s)${PROCESS_LEASE_MARKER_ENV}=${escapedMarker}(?:\\s|$)`,
      'u',
    ).test(result.stdout)) return 'match';
    // macOS withholds the environment for some platform binaries. In that
    // case use the documented PID + start-time + exact-command fallback;
    // when an environment is visible but the marker is absent, refuse it.
    return /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/u.test(result.stdout)
      ? 'mismatch'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function liveIdentity(identity, table = processTable()) {
  if (!Number.isSafeInteger(identity?.pid)
      || typeof identity?.startTime !== 'string'
      || typeof identity?.command !== 'string') return false;
  const current = processIdentity(identity.pid, table);
  return current?.startTime === identity.startTime
    && current.command === identity.command
    && (identity.leaseMarker === undefined
      || processLeaseMarkerState(identity.pid, identity.leaseMarker) !== 'mismatch');
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
      || typeof root.rootOwner?.startTime !== 'string'
      || typeof root.rootOwner?.command !== 'string') {
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
    rootOwner: {
      pid: rootOwner.pid,
      startTime: rootOwner.startTime,
      command: rootOwner.command,
    },
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

function reserveProcessGroup(lease, label, leaseMarker, command) {
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
    reservationOwner: {
      pid: owner.pid,
      startTime: owner.startTime,
      command: owner.command,
    },
    leaseMarker,
    targetCommand: command,
    createdAt: new Date().toISOString(),
  });
  return Object.freeze({ lease, path });
}

function scheduleProcessGroupIdentityFinalization(child, resource, leaseMarker) {
  let attempts = 0;
  const inspect = () => {
    attempts += 1;
    try {
      const record = readJson(resource.path);
      const identity = processIdentity(child.pid);
      if (record?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
          || record.kind !== 'process-group'
          || record.state !== 'active'
          || identity === null
          || processLeaseMarkerState(child.pid, leaseMarker) === 'mismatch') {
        if (attempts < 100 && !exited(child)) schedule();
        return;
      }
      // Registration runs in a short-lived shell before exec. Record only the
      // post-exec OS command so a same-second PID reuse must also reproduce the
      // exact command and the unguessable inherited lease marker.
      if (identity.command.includes('--cleanup-lease-register')) {
        if (attempts < 100 && !exited(child)) schedule();
        return;
      }
      writeOwnerOnlyJson(resource.path, {
        ...record,
        leader: {
          pid: identity.pid,
          startTime: identity.startTime,
          command: identity.command,
          leaseMarker,
        },
        identityFinalizedAt: new Date().toISOString(),
      });
    } catch {
      if (attempts < 100 && !exited(child)) schedule();
    }
  };
  const schedule = () => {
    const timer = setTimeout(inspect, 10);
    timer.unref?.();
  };
  schedule();
}

export function reserveCleanupPath(lease, path, {
  type,
  label = 'cleanup path',
  leaseUnique = false,
} = {}) {
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
    state: type === 'file' && !leaseUnique ? 'reserved' : 'active',
    label,
    reservationOwner: {
      pid: owner.pid,
      startTime: owner.startTime,
      command: owner.command,
    },
    path,
    pathType: type,
    leaseUnique,
    createdAt: new Date().toISOString(),
  });
  return Object.freeze({ lease, path: resource });
}

function exactFileIdentity(path, runIdField, runId) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('cleanup path identity requires a regular non-link file');
  }
  const document = readJson(path);
  const after = lstatSync(path);
  if (before.dev !== after.dev || before.ino !== after.ino
      || document?.[runIdField] !== runId) {
    throw new Error('cleanup path identity changed while it was being bound');
  }
  return {
    device: String(after.dev),
    inode: String(after.ino),
    runIdField,
    runId,
  };
}

export function activateCleanupPath(resource, { runIdField, runId } = {}) {
  if (resource === null || resource === undefined) return null;
  if (typeof runIdField !== 'string' || runIdField.length === 0
      || typeof runId !== 'string' || runId.length === 0) {
    throw new Error('cleanup file activation requires a run-id field and value');
  }
  const record = readJson(resource.path);
  if (record?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
      || record.kind !== 'path'
      || record.pathType !== 'file'
      || record.state !== 'reserved'
      || record.leaseUnique === true) {
    throw new Error('cleanup file reservation is not bindable');
  }
  const fileIdentity = exactFileIdentity(record.path, runIdField, runId);
  writeOwnerOnlyJson(resource.path, {
    ...record,
    state: 'active',
    fileIdentity,
    activatedAt: new Date().toISOString(),
  });
  return Object.freeze({ ...fileIdentity });
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
  const leaseMarker = randomUUID();
  const childEnvironment = {
    ...(env ?? process.env),
    [PROCESS_LEASE_MARKER_ENV]: leaseMarker,
  };
  if (cleanupLease === null || process.platform === 'win32') {
    const [executable, ...args] = command;
    const child = spawn(executable, args, {
      cwd,
      env: childEnvironment,
      stdio,
      detached: process.platform !== 'win32',
    });
    let leader = null;
    if (process.platform !== 'win32') {
      try {
        const identity = processIdentity(child.pid);
        if (identity?.processGroup === child.pid) {
          leader = Object.freeze({ ...identity, leaseMarker });
        }
      } catch { /* identity ambiguity safely prevents later group signalling */ }
    }
    LEASED_PROCESS_STATE.set(child, Object.freeze({ resource: null, leaseMarker, leader }));
    return child;
  }
  const resource = reserveProcessGroup(cleanupLease, label, leaseMarker, command);
  const registerThenExec = '"$1" "$2" --cleanup-lease-register "$3" && shift 3 && exec "$@"';
  const child = spawn('/bin/sh', [
    '-c', registerThenExec, 'snapback-leased-child',
    process.execPath, MODULE_PATH, resource.path,
    ...command,
  ], {
    cwd,
    env: childEnvironment,
    stdio,
    detached: true,
  });
  LEASED_PROCESS_STATE.set(child, Object.freeze({ resource, leaseMarker }));
  child.once('error', () => releaseCleanupResource(resource));
  scheduleProcessGroupIdentityFinalization(child, resource, leaseMarker);
  return child;
}

function releaseLeasedProcess(child) {
  const state = LEASED_PROCESS_STATE.get(child);
  if (state === undefined) return;
  releaseCleanupResource(state.resource);
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
function inspectProcessGroupLease(pgid, leader) {
  try {
    const table = processTable();
    const members = table.filter((candidate) => candidate.processGroup === pgid);
    if (members.length === 0) return 'empty';
    const currentLeader = members.find((candidate) => candidate.pid === pgid);
    if (currentLeader === undefined) return 'changed';
    return liveIdentity(leader, table) ? 'owned' : 'changed';
  } catch {
    return 'ambiguous';
  }
}

function processGroupLeaseGuard(pgid, leader, {
  inspect = inspectProcessGroupLease,
  sendSignal = (group, name) => process.kill(-group, name),
  wait = (duration) => new Promise((resolveWait) => setTimeout(resolveWait, duration)),
} = {}) {
  let discharged = false;
  const observe = () => {
    if (discharged) return 'discharged';
    const observation = inspect(pgid, leader);
    if (observation !== 'owned') {
      // An empty group, changed leader, or failed/ambiguous inspection ends
      // this lease permanently. It can never reacquire a reused numeric PGID.
      discharged = true;
      return 'discharged';
    }
    return 'owned';
  };
  const signalGroup = (name) => {
    if (observe() !== 'owned') return false;
    try {
      // The ownership observation is deliberately adjacent to every signal.
      sendSignal(pgid, name);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') {
        discharged = true;
        return false;
      }
      throw error;
    }
  };
  const waitForDischarge = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (observe() !== 'owned') return true;
      await wait(Math.min(25, Math.max(0, deadline - Date.now())));
    }
    return observe() !== 'owned';
  };
  return Object.freeze({ observe, signalGroup, waitForDischarge });
}

async function stopGuardedProcessGroup(pgid, leader, graceMs, killWaitMs, dependencies) {
  const guard = processGroupLeaseGuard(pgid, leader, dependencies);
  if (!guard.signalGroup('SIGTERM')) return true;
  if (await guard.waitForDischarge(graceMs)) return true;
  if (!guard.signalGroup('SIGKILL')) return true;
  if (await guard.waitForDischarge(killWaitMs)) return true;
  throw new Error(`owned process group ${pgid} survived SIGKILL`);
}

function recordedProcessGroupLeader(child, state) {
  let leader = null;
  if (state?.resource === null) leader = state.leader;
  else if (state?.resource !== undefined) {
    try {
      const record = readJson(state.resource.path);
      if (record?.schemaVersion === CLEANUP_RESOURCE_FORMAT
          && record.kind === 'process-group'
          && record.state === 'active'
          && record.processGroup === child.pid
          && record.leader?.pid === child.pid) leader = record.leader;
    } catch { /* malformed or vanished identity is a safe discharge */ }
  }
  if (leader === null) return null;
  try {
    const current = processIdentity(child.pid);
    // Executable shims may replace their command after registration while
    // preserving the original birth tuple. Refresh that mutable component
    // only when the unguessable inherited marker proves continuity.
    if (current?.startTime === leader.startTime
        && processLeaseMarkerState(child.pid, leader.leaseMarker) === 'match') {
      return { ...leader, command: current.command };
    }
  } catch { /* the guard will conservatively validate the recorded identity */ }
  return leader;
}

export async function stopProcessGroup(child, {
  graceMs = 5_000,
  killWaitMs = 2_000,
  processGroup = false,
} = {}) {
  if (!child) return true;
  if (processGroup && process.platform !== 'win32') {
    const state = LEASED_PROCESS_STATE.get(child);
    const leader = recordedProcessGroupLeader(child, state);
    if (leader === null) {
      releaseLeasedProcess(child);
      return true;
    }
    await stopGuardedProcessGroup(child.pid, leader, graceMs, killWaitMs);
    await waitForExit(child, 0);
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
  await stopGuardedProcessGroup(pgid, leader, 1_000, 2_000);
}

function cleanupExactPath(resource) {
  if (resource.pathType === 'file') {
    if (resource.state !== 'active') return false;
    if (resource.leaseUnique === true) {
      rmSync(resource.path, { force: true });
      return true;
    }
    const identity = resource.fileIdentity;
    if (typeof identity?.device !== 'string'
        || typeof identity?.inode !== 'string'
        || typeof identity?.runIdField !== 'string'
        || typeof identity?.runId !== 'string') return false;
    try {
      const observed = exactFileIdentity(
        resource.path,
        identity.runIdField,
        identity.runId,
      );
      if (observed.device !== identity.device || observed.inode !== identity.inode) return false;
      rmSync(resource.path, { force: true });
      return true;
    } catch {
      // Missing, replaced, malformed, or concurrently changing means the old
      // lease is discharged. Never delete through ambiguity.
      return false;
    }
  }
  const resolved = resolve(resource.path);
  if (resource.pathType !== 'browser-profile'
      || dirname(resolved) !== resolve(tmpdir())
      || !basename(resolved).startsWith('snapback-carrier-browser-')) {
    throw new Error('cleanup lease refused an unsafe recursive path');
  }
  rmSync(resolved, { recursive: true, force: true });
  return true;
}

export function cleanupLeasedPath(resource) {
  if (resource === null || resource === undefined) return false;
  let removed = false;
  try {
    const record = readJson(resource.path);
    if (record?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
        || record.kind !== 'path') return false;
    removed = cleanupExactPath(record);
    return removed;
  } finally {
    // Replacement/ambiguity is a permanent discharge, not a reason to retry
    // later and risk deleting a successor run's artifact.
    releaseCleanupResource(resource);
  }
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
      if (!rootLost && !requestedRelease && !reservationLost) continue;
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
  if (!liveIdentity(resource.reservationOwner, table)
      || launcher === null
      || launcher.ppid !== owner.pid
      || launcher.processGroup !== launcher.pid) {
    throw new Error('cleanup process-group reservation owner or launcher changed before exec');
  }
  writeOwnerOnlyJson(path, {
    ...resource,
    state: 'active',
    processGroup: launcher.processGroup,
    leader: {
      pid: launcher.pid,
      startTime: launcher.startTime,
      command: launcher.command,
      leaseMarker: resource.leaseMarker,
    },
    activatedAt: new Date().toISOString(),
  });
}

export const __test = Object.freeze({
  stopGuardedProcessGroup,
});

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
