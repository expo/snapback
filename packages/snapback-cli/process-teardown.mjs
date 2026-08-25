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

const CLEANUP_LEASE_FORMAT = 'snapback.carrier-cleanup-lease.v3';
const CLEANUP_RESOURCE_FORMAT = 'snapback.carrier-cleanup-resource.v3';
const CLEANUP_LEASE_PREFIX = 'snapback-carrier-cleanup-';
const CLEANUP_RESOURCE_PREFIX = 'resource-';
const PROCESS_LEASE_MARKER_ENV = 'SNAPBACK_CARRIER_PROCESS_LEASE_MARKER';
const PROCESS_LEASE_RUN_ID_ENV = 'SNAPBACK_CARRIER_PROCESS_LEASE_RUN_ID';
const PENDING_PROCESS_CONFIRM_MS = 1_000;
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

function processEnvironmentEntryStates(pid, entries) {
  if (!Number.isSafeInteger(pid)
      || !entries.every(({ name, value }) => (
        typeof name === 'string'
        && name.length > 0
        && typeof value === 'string'
        && value.length > 0
      ))) return entries.map(() => 'mismatch');
  try {
    if (process.platform === 'linux') {
      const environment = readFileSync(`/proc/${pid}/environ`)
        .toString('utf8')
        .split('\0');
      return entries.map(({ name, value }) => (
        environment.includes(`${name}=${value}`) ? 'match' : 'mismatch'
      ));
    }
    const result = spawnSync('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) return entries.map(() => 'unavailable');
    // macOS withholds the environment for some platform binaries. In that
    // case use the documented PID + start-time + exact-command fallback;
    // when an environment is visible but the marker is absent, refuse it.
    const environmentVisible = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/u.test(result.stdout);
    return entries.map(({ name, value }) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(
        `(?:^|\\s)${escapedName}=${escapedValue}(?:\\s|$)`,
        'u',
      ).test(result.stdout) ? 'match' : (environmentVisible ? 'mismatch' : 'unavailable');
    });
  } catch {
    return entries.map(() => 'unavailable');
  }
}

function processLeaseEnvironmentStates(pid, marker, runId) {
  const entries = [];
  if (marker !== undefined) {
    entries.push({ key: 'marker', name: PROCESS_LEASE_MARKER_ENV, value: marker });
  }
  if (runId !== undefined) {
    entries.push({ key: 'runId', name: PROCESS_LEASE_RUN_ID_ENV, value: runId });
  }
  const observed = processEnvironmentEntryStates(pid, entries);
  const states = { marker: 'not-required', runId: 'not-required' };
  for (let index = 0; index < entries.length; index += 1) {
    states[entries[index].key] = observed[index];
  }
  return Object.freeze(states);
}

function liveIdentity(identity, table = processTable()) {
  if (!Number.isSafeInteger(identity?.pid)
      || typeof identity?.startTime !== 'string'
      || typeof identity?.command !== 'string') return false;
  const current = processIdentity(identity.pid, table);
  const environment = identity.leaseMarker === undefined && identity.runId === undefined
    ? null
    : processLeaseEnvironmentStates(identity.pid, identity.leaseMarker, identity.runId);
  return current?.startTime === identity.startTime
    && current.command === identity.command
    && (identity.leaseMarker === undefined
      || environment.marker !== 'mismatch')
    && (identity.runId === undefined
      || environment.runId !== 'mismatch');
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
      || typeof root.runId !== 'string'
      || root.runId.length === 0
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
    runId: root.runId,
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
    runId: randomUUID(),
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

function reserveProcessGroup(lease, label, leaseMarker, command, profileDirectory) {
  if (lease === null || process.platform === 'win32') return null;
  assertLeaseDirectory(lease.directory);
  const owner = processIdentity(process.pid);
  if (owner === null) throw new Error('cleanup lease could not identify the process-group owner');
  const path = resourceFile(lease);
  writeOwnerOnlyJson(path, {
    schemaVersion: CLEANUP_RESOURCE_FORMAT,
    kind: 'process-group',
    state: 'pending',
    label,
    runId: lease.runId,
    reservationOwner: {
      pid: owner.pid,
      startTime: owner.startTime,
      command: owner.command,
    },
    leaseMarker,
    intendedCommand: command,
    profileDirectory,
    createdAt: new Date().toISOString(),
  });
  return Object.freeze({ lease, path });
}

function scheduleProcessGroupIdentityFinalization(
  child,
  resource,
  leaseMarker,
  finalizationReady,
) {
  let attempts = 0;
  const inspect = () => {
    if (typeof finalizationReady === 'function') {
      try {
        if (!finalizationReady()) {
          if (!exited(child)) schedule();
          return;
        }
      } catch {
        if (!exited(child)) schedule();
        return;
      }
    }
    attempts += 1;
    try {
      const record = readJson(resource.path);
      const identity = processIdentity(child.pid);
      const environment = identity === null
        ? null
        : processLeaseEnvironmentStates(child.pid, leaseMarker, resource.lease.runId);
      if (record?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
          || record.kind !== 'process-group'
          || record.state !== 'pending'
          || record.runId !== resource.lease.runId
          || identity === null
          || identity.processGroup !== child.pid
          || record.spawned?.pid !== identity.pid
          || record.spawned?.startTime !== identity.startTime
          || record.spawned?.processGroup !== identity.processGroup
          || environment.marker === 'mismatch'
          || environment.runId === 'mismatch') {
        if (attempts < 100 && !exited(child)) schedule();
        return;
      }
      // Registration runs in a short-lived shell before exec. Record only the
      // post-exec OS command so a same-second PID reuse must also reproduce the
      // exact command and the unguessable inherited lease marker.
      if (identity.command === record.spawned.command
          || identity.command.includes('--cleanup-lease-register')) {
        if (attempts < 100 && !exited(child)) schedule();
        return;
      }
      writeOwnerOnlyJson(resource.path, {
        ...record,
        state: 'active',
        processGroup: identity.processGroup,
        leader: {
          pid: identity.pid,
          startTime: identity.startTime,
          command: identity.command,
          leaseMarker,
          runId: resource.lease.runId,
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
  if (!isAbsolute(path) || !['file', 'socket', 'browser-profile'].includes(type)) {
    throw new Error('cleanup path lease requires an absolute file, socket, or browser-profile path');
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
    state: ['file', 'socket'].includes(type) && !leaseUnique ? 'reserved' : 'active',
    label,
    runId: lease.runId,
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
      || record.runId !== resource.lease.runId
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

export function activateCleanupSocketPath(resource, { ownerIncarnationId } = {}) {
  if (resource === null || resource === undefined) return null;
  if (typeof ownerIncarnationId !== 'string' || ownerIncarnationId.length === 0) {
    throw new Error('cleanup socket activation requires an owner incarnation id');
  }
  const record = readJson(resource.path);
  if (record?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
      || record.kind !== 'path'
      || record.runId !== resource.lease.runId
      || record.pathType !== 'socket'
      || record.state !== 'reserved'
      || record.leaseUnique === true) {
    throw new Error('cleanup socket reservation is not bindable');
  }
  const observed = lstatSync(record.path);
  if (!observed.isSocket() || observed.isSymbolicLink()) {
    throw new Error('cleanup socket identity requires a unix socket, not a link');
  }
  const socketIdentity = {
    device: String(observed.dev),
    inode: String(observed.ino),
    uid: observed.uid,
    ownerIncarnationId,
  };
  writeOwnerOnlyJson(resource.path, {
    ...record,
    state: 'active',
    socketIdentity,
    activatedAt: new Date().toISOString(),
  });
  return Object.freeze({ ...socketIdentity });
}

export function releaseCleanupResource(resource) {
  if (resource === null || resource === undefined) return;
  rmSync(resource.path, { force: true });
}

function validateProfileDirectory(profileDirectory, command) {
  if (profileDirectory === null || profileDirectory === undefined) return null;
  if (!isAbsolute(profileDirectory)
      || !command.includes(`--user-data-dir=${profileDirectory}`)) {
    throw new Error('leased process profile directory must be absolute and present in its command');
  }
  return profileDirectory;
}

// @ref LLP 0181#web-browser — persist the run-scoped pending identity before
// spawn. The short-lived shell records the new PID/start time without making
// the lease active, then execs; asynchronous finalization binds the stable
// post-exec command. A carrier death at either boundary leaves a reclaimable
// pending record instead of an unowned Chrome/Metro group.
export function spawnLeasedProcess(command, {
  cleanupLease = null,
  label = 'owned child',
  profileDirectory = null,
  finalizationReady = null,
  cwd,
  env,
  stdio,
} = {}) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new TypeError('leased process command must be a non-empty array');
  }
  if (finalizationReady !== null && typeof finalizationReady !== 'function') {
    throw new TypeError('leased process finalization barrier must be a function');
  }
  const validatedProfileDirectory = validateProfileDirectory(profileDirectory, command);
  const leaseMarker = randomUUID();
  const childEnvironment = {
    ...(env ?? process.env),
    [PROCESS_LEASE_MARKER_ENV]: leaseMarker,
    ...(cleanupLease === null ? {} : {
      [PROCESS_LEASE_RUN_ID_ENV]: cleanupLease.runId,
    }),
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
  const resource = reserveProcessGroup(
    cleanupLease,
    label,
    leaseMarker,
    command,
    validatedProfileDirectory,
  );
  const registerThenExec = '"$1" "$2" --cleanup-lease-register "$3" && shift 3 && exec "$@"';
  let child;
  try {
    child = spawn('/bin/sh', [
      '-c', registerThenExec, 'snapback-leased-child',
      process.execPath, MODULE_PATH, resource.path,
      ...command,
    ], {
      cwd,
      env: childEnvironment,
      stdio,
      detached: true,
    });
  } catch (error) {
    releaseCleanupResource(resource);
    throw error;
  }
  LEASED_PROCESS_STATE.set(child, Object.freeze({ resource, leaseMarker }));
  child.once('error', () => releaseCleanupResource(resource));
  scheduleProcessGroupIdentityFinalization(
    child,
    resource,
    leaseMarker,
    finalizationReady,
  );
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

function intendedCommandMatches(resource, candidate) {
  if (!Array.isArray(resource.intendedCommand)
      || resource.intendedCommand.length === 0
      || !resource.intendedCommand.every((part) => typeof part === 'string')) return false;
  if (candidate.command === resource.intendedCommand.join(' ')) return true;
  const [executable, ...args] = resource.intendedCommand;
  if (basename(executable) !== 'npx' || args[0] !== '--no-install') return false;
  return candidate.command === ['npm', 'exec', ...args.slice(1)].join(' ');
}

function validPendingProfileDirectory(resource, leasedProfiles) {
  if (typeof resource.profileDirectory !== 'string') return false;
  const profile = resolve(resource.profileDirectory);
  return dirname(profile) === resolve(tmpdir())
    && basename(profile).startsWith('snapback-carrier-browser-')
    && leasedProfiles.has(profile);
}

function pendingCommandMatches(resource, candidate, leasedProfiles) {
  if (!intendedCommandMatches(resource, candidate)) return false;
  if (resource.profileDirectory === null || resource.profileDirectory === undefined) {
    return resource.spawned?.pid === candidate.pid
      && resource.spawned?.startTime === candidate.startTime
      && resource.spawned?.processGroup === candidate.processGroup;
  }
  if (!validPendingProfileDirectory(resource, leasedProfiles)) return false;
  const profileArgument = `--user-data-dir=${resource.profileDirectory}`;
  return resource.intendedCommand.includes(profileArgument)
    && candidate.command.includes(profileArgument);
}

function pendingProcessGroupResolution(
  resource,
  resourcePath,
  rootRunId,
  table,
  leasedProfiles,
) {
  if (resource?.schemaVersion !== CLEANUP_RESOURCE_FORMAT
      || resource.kind !== 'process-group'
      || resource.state !== 'pending'
      || resource.runId !== rootRunId
      || typeof resource.leaseMarker !== 'string'
      || resource.leaseMarker.length === 0) return Object.freeze({ status: 'discharged' });

  const spawned = resource.spawned;
  let candidates;
  if (Number.isSafeInteger(spawned?.pid)
      && typeof spawned?.startTime === 'string'
      && spawned.processGroup === spawned.pid) {
    candidates = table.filter((candidate) => (
      candidate.pid === spawned.pid
      && candidate.processGroup === spawned.processGroup
      && candidate.startTime === spawned.startTime
    ));
  } else {
    const intended = Array.isArray(resource.intendedCommand)
      ? resource.intendedCommand.join(' ')
      : '';
    const profileArgument = typeof resource.profileDirectory === 'string'
      ? `--user-data-dir=${resource.profileDirectory}`
      : null;
    candidates = table.filter((candidate) => (
      candidate.pid === candidate.processGroup
      && (
        candidate.command === intended
        || (profileArgument !== null && candidate.command.includes(profileArgument))
        || (candidate.command.includes('--cleanup-lease-register')
          && candidate.command.includes(resourcePath))
      )
    ));
  }

  if (candidates.length === 0) return Object.freeze({ status: 'absent' });
  const owned = [];
  let sawAmbiguous = false;
  for (const candidate of candidates) {
    const environment = processLeaseEnvironmentStates(
      candidate.pid,
      resource.leaseMarker,
      rootRunId,
    );
    const { marker, runId: run } = environment;
    if (marker === 'mismatch' || run === 'mismatch') continue;
    const environmentMatches = marker === 'match' && run === 'match';
    const commandMatches = marker === 'unavailable'
      && run === 'unavailable'
      && pendingCommandMatches(resource, candidate, leasedProfiles);
    if (!environmentMatches && !commandMatches) {
      sawAmbiguous = true;
      continue;
    }
    // The registration shell is still before exec. Waiting avoids freezing
    // its transient command into an active exact-command lease.
    if (candidate.command === spawned?.command
        || candidate.command.includes('--cleanup-lease-register')) {
      return Object.freeze({ status: 'wait' });
    }
    owned.push(candidate);
  }
  if (owned.length !== 1) {
    return Object.freeze({ status: sawAmbiguous || owned.length > 1 ? 'ambiguous' : 'discharged' });
  }
  const [candidate] = owned;
  return Object.freeze({
    status: 'owned',
    leader: Object.freeze({
      pid: candidate.pid,
      startTime: candidate.startTime,
      command: candidate.command,
      leaseMarker: resource.leaseMarker,
      runId: rootRunId,
    }),
  });
}

function refreshedActiveProcessGroupLeader(resource, table = processTable()) {
  const leader = resource?.leader;
  const current = processIdentity(leader?.pid, table);
  if (current?.startTime !== leader?.startTime
      || current.processGroup !== resource.processGroup) return leader;
  if (current.command === leader.command) return leader;
  const environment = processLeaseEnvironmentStates(
    current.pid,
    leader.leaseMarker,
    leader.runId,
  );
  const inheritedIdentityMatches = environment.marker === 'match'
    && (leader.runId === undefined || environment.runId === 'match');
  const hiddenNpxRewriteMatches = environment.marker === 'unavailable'
    && environment.runId === 'unavailable'
    && resource.runId === leader.runId
    && intendedCommandMatches(resource, current);
  return inheritedIdentityMatches || hiddenNpxRewriteMatches
    ? { ...leader, command: current.command }
    : leader;
}

async function recordedProcessGroupLeader(child, state) {
  let leader = null;
  let activeRecord = null;
  if (state?.resource === null) leader = state.leader;
  else if (state?.resource !== undefined) {
    const deadline = Date.now() + PENDING_PROCESS_CONFIRM_MS;
    while (leader === null && Date.now() < deadline) {
      try {
        const record = readJson(state.resource.path);
        if (record?.schemaVersion === CLEANUP_RESOURCE_FORMAT
            && record.kind === 'process-group'
            && record.state === 'active'
            && record.runId === state.resource.lease.runId
            && record.processGroup === child.pid
            && record.leader?.pid === child.pid) {
          leader = record.leader;
          activeRecord = record;
          break;
        }
        if (record?.state !== 'pending') break;
        const resolution = pendingProcessGroupResolution(
          record,
          state.resource.path,
          state.resource.lease.runId,
          processTable(),
          new Set(typeof record.profileDirectory === 'string'
            ? [resolve(record.profileDirectory)]
            : []),
        );
        if (resolution.status === 'owned') {
          leader = resolution.leader;
          writeOwnerOnlyJson(state.resource.path, {
            ...record,
            state: 'active',
            processGroup: leader.pid,
            leader,
            identityFinalizedAt: new Date().toISOString(),
          });
          break;
        }
        if (['discharged', 'absent'].includes(resolution.status) && exited(child)) break;
      } catch { /* malformed or vanished identity is a safe discharge */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  if (leader === null) return null;
  if (activeRecord !== null) return refreshedActiveProcessGroupLeader(activeRecord);
  try {
    const current = processIdentity(child.pid);
    const environment = processLeaseEnvironmentStates(
      child.pid,
      leader.leaseMarker,
      leader.runId,
    );
    // Executable shims may replace their command after registration while
    // preserving the original birth tuple. Refresh that mutable component
    // only when the unguessable inherited marker proves continuity.
    if (current?.startTime === leader.startTime
        && environment.marker === 'match'
        && (leader.runId === undefined
          || environment.runId === 'match')) {
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
    const leader = await recordedProcessGroupLeader(child, state);
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
  if (resource.pathType === 'socket') {
    if (resource.state !== 'active') return false;
    const identity = resource.socketIdentity;
    if (typeof identity?.device !== 'string'
        || typeof identity?.inode !== 'string'
        || !Number.isSafeInteger(identity?.uid)
        || typeof identity?.ownerIncarnationId !== 'string'
        || identity.ownerIncarnationId.length === 0) return false;
    try {
      const observed = lstatSync(resource.path);
      if (!observed.isSocket()
          || observed.isSymbolicLink()
          || String(observed.dev) !== identity.device
          || String(observed.ino) !== identity.inode
          || observed.uid !== identity.uid) return false;
      rmSync(resource.path, { force: true });
      return true;
    } catch {
      // Missing, replaced, or concurrently changing discharges this lease.
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
        || record.kind !== 'path'
        || record.runId !== resource.lease.runId) return false;
    removed = cleanupExactPath(record);
    return removed;
  } finally {
    // Replacement/ambiguity is a permanent discharge, not a reason to retry
    // later and risk deleting a successor run's artifact.
    releaseCleanupResource(resource);
  }
}

async function cleanupResource(path, resource, {
  root,
  table,
  leasedProfiles,
  pendingAbsentSince,
}) {
  if (resource.runId !== root.runId) return false;
  if (resource.kind === 'process-group' && resource.state === 'active') {
    await cleanupProcessGroup(
      resource.processGroup,
      refreshedActiveProcessGroupLeader(resource, table),
    );
  } else if (resource.kind === 'process-group' && resource.state === 'pending') {
    const resolution = pendingProcessGroupResolution(
      resource,
      path,
      root.runId,
      table,
      leasedProfiles,
    );
    if (resolution.status === 'owned') {
      writeOwnerOnlyJson(path, {
        ...resource,
        state: 'active',
        processGroup: resolution.leader.pid,
        leader: resolution.leader,
        identityFinalizedAt: new Date().toISOString(),
        finalizedBy: 'cleanup-reaper',
      });
      await cleanupProcessGroup(resolution.leader.pid, resolution.leader);
    } else if (resolution.status === 'absent') {
      const firstAbsent = pendingAbsentSince.get(path) ?? Date.now();
      pendingAbsentSince.set(path, firstAbsent);
      if (Date.now() - firstAbsent < PENDING_PROCESS_CONFIRM_MS) return false;
    } else if (resolution.status === 'wait' || resolution.status === 'ambiguous') {
      pendingAbsentSince.delete(path);
      return false;
    }
  } else if (resource.kind === 'path' && resource.state === 'active') {
    cleanupExactPath(resource);
  }
  pendingAbsentSince.delete(path);
  rmSync(path, { force: true });
  return true;
}

async function runCleanupLeaseReaper(directory) {
  const root = assertLeaseDirectory(directory);
  writeOwnerOnlyJson(join(directory, 'reaper.ready.json'), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  let forcedRelease = false;
  const pendingAbsentSince = new Map();
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
    const resourcePaths = readdirSync(directory)
      .filter((name) => name.startsWith(CLEANUP_RESOURCE_PREFIX) && name.endsWith('.json'))
      .map((name) => join(directory, name));
    const resources = resourcePaths.flatMap((path) => {
      try { return [{ path, resource: readJson(path) }]; } catch { return []; }
    }).filter(({ resource }) => resource?.schemaVersion === CLEANUP_RESOURCE_FORMAT);
    const leasedProfiles = new Set(resources.flatMap(({ resource }) => (
      resource.kind === 'path'
      && resource.state === 'active'
      && resource.runId === root.runId
      && resource.pathType === 'browser-profile'
        ? [resolve(resource.path)]
        : []
    )));
    const processResources = resources.filter(({ resource }) => resource.kind === 'process-group');
    for (const { path, resource } of processResources) {
      const reservationLost = !liveIdentity(resource.reservationOwner, table);
      if (!rootLost && !requestedRelease && !reservationLost) continue;
      try {
        await cleanupResource(path, resource, {
          root,
          table,
          leasedProfiles,
          pendingAbsentSince,
        });
      } catch {
        // Keep the durable record and retry. A failed cleanup is never
        // converted into a successful lease disposition.
      }
    }
    const processRecordsRemain = readdirSync(directory)
      .filter((name) => name.startsWith(CLEANUP_RESOURCE_PREFIX) && name.endsWith('.json'))
      .some((name) => {
        try { return readJson(join(directory, name))?.kind === 'process-group'; } catch { return true; }
      });
    if (!processRecordsRemain) {
      for (const { path, resource } of resources.filter(({ resource }) => resource.kind === 'path')) {
        const reservationLost = !liveIdentity(resource.reservationOwner, table);
        if (!rootLost && !requestedRelease && !reservationLost) continue;
        try {
          await cleanupResource(path, resource, {
            root,
            table,
            leasedProfiles,
            pendingAbsentSince,
          });
        } catch {
          // Keep the durable record and retry. A failed cleanup is never
          // converted into a successful lease disposition.
        }
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
      || resource.state !== 'pending'
      || typeof resource.runId !== 'string'
      || resource.runId.length === 0) {
    throw new Error('cleanup process-group reservation is malformed');
  }
  const root = assertLeaseDirectory(dirname(path));
  const table = processTable();
  const owner = processIdentity(resource.reservationOwner?.pid, table);
  const launcher = processIdentity(process.ppid, table);
  if (resource.runId !== root.runId
      || !liveIdentity(resource.reservationOwner, table)
      || launcher === null
      || launcher.ppid !== owner.pid
      || launcher.processGroup !== launcher.pid
      || process.env[PROCESS_LEASE_MARKER_ENV] !== resource.leaseMarker
      || process.env[PROCESS_LEASE_RUN_ID_ENV] !== resource.runId) {
    throw new Error('cleanup process-group reservation owner or launcher changed before exec');
  }
  writeOwnerOnlyJson(path, {
    ...resource,
    spawned: {
      pid: launcher.pid,
      startTime: launcher.startTime,
      command: launcher.command,
      processGroup: launcher.processGroup,
    },
    spawnedAt: new Date().toISOString(),
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
