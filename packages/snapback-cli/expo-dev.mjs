import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer as createHttpServer,
  request as createHttpRequest,
} from 'node:http';
import { createConnection as createNetConnection, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  canonicalFileCarrierPath,
  diagnosticError,
  managedAdminToken,
  readApplicationReadyReceipt,
  readReadyDescriptor,
  runDev,
  scrubDynamicLoaderEnvironment,
} from './index.mjs';
import {
  CLEANUP_LEASE_DIRECTORY_ENV,
  activateCleanupPath,
  activateCleanupSocketPath,
  cleanupLeasedPath,
  inspectSecureDirectoryChain,
  inspectSecureExternalDirectoryChain,
  openCarrierCleanupLease,
  rebindCleanupPath,
  releaseCleanupResource,
  reserveCleanupPath,
  spawnLeasedProcess,
  stopProcessGroup,
  withCleanupPathLock,
} from './process-teardown.mjs';
import { createSupervisedBindingPublisher } from './expo-binding-refresh.mjs';
import {
  createSharedDevelopmentBroker,
  sharedDevelopmentAuthProjection,
  supervisedSharedAuthReturnTargets,
} from './shared-development-broker.mjs';
import {
  devPortPlanOwner,
  materializeDevPortPlan,
  resolveDevPortPlan,
} from './port-plan.mjs';
export { resolveDevPortPlan } from './port-plan.mjs';

export const EXPO_DEV_EVENT_FORMAT = 'snapback.expo-dev.v1';
export const EXPO_SUPERVISOR_DESCRIPTOR_FORMAT = 'snapback.expo-supervisor.v1';
export const SUPERVISED_EXCHANGE_FORMAT = 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH = '/_snapback/expo/v1/bootstrap';
const SUPERVISED_AUTHORITY_REQUEST = 'mint';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH = '/_snapback/expo/v1/dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER = 'x-snapback-dev-identity-checkout';
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV = 'SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE';
export const DEV_CONTROL_SOCKET_FORMAT = 'snapback.dev-control.v1';
export const DEV_CONTROL_COMMAND_FORMAT = 'snapback.dev-control-command.v1';
export const DEV_CONTROL_ACK_FORMAT = 'snapback.dev-control-ack.v1';
export const DEV_CONTROL_RESULT_FORMAT = 'snapback.dev-control-result.v1';
export const METRO_WATCH_BLIND_ROOTS = Object.freeze(['/private/tmp', '/tmp']);
export const SUPERVISOR_PARENT_PID_ENV = 'SNAPBACK_EXPO_SUPERVISOR_PARENT_PID';
export const SUPERVISOR_PARENT_START_TIME_ENV = 'SNAPBACK_EXPO_SUPERVISOR_PARENT_START_TIME';
const EXPO_GO_IOS_BUNDLE_IDENTIFIER = 'host.exp.Exponent';
const EXPO_GO_ANDROID_COMPONENT_PREFIX = 'host.exp.exponent/';
const EXPO_APP_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
const DEV_CONTROL_SOCKET_BASENAME = '.dc-sock';
const DEV_CONTROL_OWNER_STATE_BASENAME = 'dev-control.owner.json';
const DEV_CONTROL_OWNER_STATE_FORMAT = 'snapback.dev-control-owner.v1';
const DEV_CONTROL_COMMAND_LIMIT_BYTES = 16 * 1024;
const DEV_CONTROL_VERBS = Object.freeze(['reload-metro', 'stop-children']);
const SUPERVISED_HTTP_CONTROL_VERBS = Object.freeze(['dev-fresh', ...DEV_CONTROL_VERBS]);

function devControlDiagnostic(code, message, details = {}) {
  return Object.freeze({ code, severity: 'error', subsystem: 'cli', message, details });
}

function requiredDevControlChannelDiagnostic({
  unavailableDetails = {},
  stdinControl = { available: false, kind: 'unknown' },
  readyFile,
}) {
  const component = unavailableDetails.component
    ?? unavailableDetails.path
    ?? dirname(resolve(readyFile));
  const reason = unavailableDetails.reason
    ?? unavailableDetails.cause
    ?? 'socket-publication-failed';
  const cause = unavailableDetails.cause ?? reason;
  const stdinReason = stdinControl.reason ?? 'stdin is unavailable';
  let failure;
  let recovery;
  if (reason === 'advertised-path-probe-failed') {
    failure = `the advertised owner-bound dev control socket probe failed in ${component} (${cause})`;
    recovery = 'use --ready-file <path> inside a shorter 0700 owner-only directory tree';
  } else if (['socket-bind-failed', 'socket-publication-failed', 'socket-custody-failed']
    .includes(reason)) {
    failure = `the owner-bound dev control socket could not bind or publish in ${component} (${cause})`;
    recovery = 'use --ready-file <path> inside a shorter 0700 owner-only directory tree';
  } else {
    failure = `${component} failed secure directory-chain admission (${reason})`;
    recovery = `use --ready-file <path> inside a 0700 owner-only directory tree, or fix the directory mode at ${component}`;
  }
  return devControlDiagnostic(
    'SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE',
    `detached dev control cannot start because authenticated HTTP has no usable managed admin-token carrier, ${failure}, and ${stdinReason}, so stdin cannot carry snapback.dev-command.v1; ${recovery}`,
    {
      ...unavailableDetails,
      component,
      reason,
      stdin: stdinControl,
      recovery,
    },
  );
}

function devControlResult({ requestId = null, verb = null, ok, result, diagnostic }) {
  return Object.freeze({
    schemaVersion: DEV_CONTROL_RESULT_FORMAT,
    ok,
    state: 'result',
    ...(requestId === null ? {} : { requestId }),
    ...(verb === null ? {} : { verb }),
    ...(result === undefined ? {} : { result }),
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
  });
}

function controlLifecycleReceipt(input) {
  const digest = createHash('sha256').update(JSON.stringify({
    schemaVersion: DEV_CONTROL_SOCKET_FORMAT,
    readyFile: resolve(input.readyFile),
    ownerPid: input.ownerPid,
    ownerUid: input.ownerUid,
    ownerIncarnationId: input.ownerIncarnationId,
    ownerStartTime: input.ownerStartTime,
    startedAt: input.startedAt,
  })).digest('hex');
  return `sha256:${digest}`;
}

function writeOwnerOnlyJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  const metadata = lstatSync(path);
  return Object.freeze({
    device: String(metadata.dev),
    inode: String(metadata.ino),
  });
}

function publishSupervisorDescriptorAtomically(
  path,
  descriptor,
  temporaryFile = null,
  { cleanup = null, afterRename = null } = {},
) {
  // @ref LLP 0310.000#track-c--generate-must-not-kill-metro — the live Metro
  // policy carrier is read concurrently by bare generate, so every revision
  // is a private same-directory rename rather than truncate-and-rewrite.
  const destination = resolve(path);
  const temporary = temporaryFile === null
    ? `${destination}.${process.pid}.${randomUUID()}.tmp`
    : resolve(temporaryFile);
  if (dirname(temporary) !== dirname(destination)) {
    throw new TypeError('Expo supervisor descriptor temporary file must share its destination directory');
  }
  mkdirSync(dirname(destination), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    if (cleanup !== null) {
      if (cleanup.mode !== 'rebind') {
        throw new TypeError('Expo supervisor descriptor cleanup mode must rebind');
      }
      // Prepare the durable lease with the staged inode before publication.
      // A crash on either side of rename leaves the reaper authorized for the
      // old destination or the exact staged successor, never an arbitrary
      // same-generation replacement.
      rebindCleanupPath(cleanup.resource, {
        runIdField: cleanup.runIdField,
        runId: cleanup.runId,
        candidatePath: temporary,
      });
    }
    renameSync(temporary, destination);
    afterRename?.({ destination, temporary });
    if (cleanup !== null) {
      // Settle the two-inode prepared record after rename. If the owner dies
      // before this write, cleanup accepts either prepared identity.
      rebindCleanupPath(cleanup.resource, {
        runIdField: cleanup.runIdField,
        runId: cleanup.runId,
      });
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

function validateDevControlCommand(command, controlSocket, endpoint) {
  const requestId = typeof command?.requestId === 'string' && command.requestId.length > 0
    ? command.requestId
    : null;
  const verb = typeof command?.verb === 'string' ? command.verb : null;
  if (
    command?.schemaVersion !== DEV_CONTROL_COMMAND_FORMAT
    || requestId === null
    || verb === null
    || command?.owner === null
    || typeof command?.owner !== 'object'
    || Array.isArray(command.owner)
  ) {
    return devControlResult({
      requestId,
      verb,
      ok: false,
      diagnostic: devControlDiagnostic(
        'SNAPBACK_DEV_COMMAND_INVALID',
        'expected one owner-bound snapback.dev-control-command.v1 JSON object',
        { supported: DEV_CONTROL_VERBS },
      ),
    });
  }
  if (endpoint.uid !== controlSocket.ownerUid || command.owner.uid !== controlSocket.ownerUid) {
    return devControlResult({
      requestId,
      verb,
      ok: false,
      diagnostic: devControlDiagnostic(
        'SNAPBACK_DEV_CONTROL_OTHER_UID',
        'the dev control endpoint does not belong to this lifecycle owner uid',
        { expectedUid: controlSocket.ownerUid },
      ),
    });
  }
  if (
    endpoint.device !== controlSocket.endpoint.device
    || endpoint.inode !== controlSocket.endpoint.inode
    || command.owner.pid !== controlSocket.ownerPid
    || command.owner.incarnationId !== controlSocket.ownerIncarnationId
  ) {
    return devControlResult({
      requestId,
      verb,
      ok: false,
      diagnostic: devControlDiagnostic(
        'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
        'the dev control endpoint belongs to a different lifecycle owner',
        { ownerPid: controlSocket.ownerPid, ownerIncarnationId: controlSocket.ownerIncarnationId },
      ),
    });
  }
  if (command.lifecycleReceipt !== controlSocket.lifecycleReceipt) {
    return devControlResult({
      requestId,
      verb,
      ok: false,
      diagnostic: devControlDiagnostic(
        'SNAPBACK_DEV_CONTROL_STALE_INCARNATION',
        'the dev control request names a stale lifecycle receipt',
        { ownerIncarnationId: controlSocket.ownerIncarnationId },
      ),
    });
  }
  if (!DEV_CONTROL_VERBS.includes(verb)) {
    return devControlResult({
      requestId,
      verb,
      ok: false,
      diagnostic: devControlDiagnostic(
        'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB',
        `unknown owner control verb ${verb}`,
        { verb, supported: DEV_CONTROL_VERBS },
      ),
    });
  }
  return Object.freeze({ requestId, verb });
}

function observedControlEndpoint(path) {
  const observed = lstatSync(path);
  if (!observed.isSocket() || observed.isSymbolicLink()) {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      'the dev control path is not the socket created by this lifecycle owner',
      { path },
    );
  }
  return Object.freeze({
    uid: observed.uid,
    mode: observed.mode & 0o777,
    device: String(observed.dev),
    inode: String(observed.ino),
  });
}

function sameControlEndpoint(left, right) {
  return left.uid === right.uid
    && left.device === right.device
    && left.inode === right.inode;
}

function probeDevControlEndpoint(path, {
  timeoutMs = 500,
  connect = createNetConnection,
} = {}) {
  return new Promise((resolveProbe, rejectProbe) => {
    const socket = connect(path);
    let settled = false;
    const finish = (outcome, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error === null) resolveProbe(outcome);
      else rejectProbe(error);
    };
    socket.setTimeout(timeoutMs, () => finish(null, Object.assign(
      new Error(`timed out probing occupied dev control endpoint ${path}`),
      { code: 'ETIMEDOUT' },
    )));
    socket.once('connect', () => finish('live'));
    socket.once('error', (error) => {
      if (error?.code === 'ECONNREFUSED') finish('dead');
      else finish(null, error);
    });
  });
}

function validControlOwnerState(state, path) {
  return state?.schemaVersion === DEV_CONTROL_OWNER_STATE_FORMAT
    && ['binding', 'bound'].includes(state.phase)
    && state.path === path
    && Number.isSafeInteger(state.ownerPid)
    && Number.isSafeInteger(state.ownerUid)
    && typeof state.ownerIncarnationId === 'string'
    && state.ownerIncarnationId.length > 0
    && typeof state.ownerStartTime === 'string'
    && typeof state.lifecycleReceipt === 'string'
    && typeof state.startedAt === 'string'
    && (state.endpoint === null || (
      typeof state.endpoint === 'object'
      && typeof state.endpoint.device === 'string'
      && typeof state.endpoint.inode === 'string'
      && Number.isSafeInteger(state.endpoint.uid)
      && typeof state.endpoint.ownerIncarnationId === 'string'
      && state.endpoint.ownerIncarnationId.length > 0
    ));
}

function readControlOwnerState(path, endpointPath) {
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) return Object.freeze({ status: 'corrupt' });
    const state = JSON.parse(readFileSync(path, 'utf8'));
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino) {
      return Object.freeze({ status: 'corrupt' });
    }
    return validControlOwnerState(state, endpointPath)
      ? Object.freeze({ status: 'valid', state })
      : Object.freeze({ status: 'corrupt' });
  } catch (error) {
    return Object.freeze({ status: error?.code === 'ENOENT' ? 'absent' : 'corrupt' });
  }
}

function assertControlOwnerStateAllowsReclaim(ownerStatePath, path, endpoint) {
  const ownerState = readControlOwnerState(ownerStatePath, path);
  if (ownerState.status !== 'valid') {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      `the persisted dev control owner record is ${ownerState.status}; automatic reclamation is refused`,
      {
        path,
        ownerStatePath,
        ownerStateStatus: ownerState.status,
        recovery: `inspect the endpoint owner, then explicitly remove both ${path} and ${ownerStatePath}; or relaunch with --ready-file in a different owner-only state directory`,
      },
    );
  }
  const { state } = ownerState;
  if (state.phase === 'bound'
      && state.ownerUid === endpoint.uid
      && state.endpoint !== null
      && state.endpoint.ownerIncarnationId === state.ownerIncarnationId
      && sameControlEndpoint(state.endpoint, endpoint)) return;
  throw diagnosticError(
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
    'the persisted dev control owner record names a different endpoint or incarnation',
    {
      path,
      ownerStatePath,
      observedOwnerIncarnationId: state.ownerIncarnationId,
      observedEndpoint: state.endpoint,
    },
  );
}

async function reclaimDeadControlEndpoint({
  path,
  ownerStatePath,
  ownerUid,
  observeEndpoint,
  probeEndpoint,
  beforeUnlink,
}) {
  let endpoint;
  try {
    endpoint = observeEndpoint(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (endpoint.uid !== ownerUid) {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_OTHER_UID',
      'the dev control socket path belongs to another uid',
      { path, expectedUid: ownerUid, observedUid: endpoint.uid },
    );
  }
  let occupancy;
  try {
    occupancy = await probeEndpoint(path);
  } catch (error) {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      'the occupied dev control endpoint could not be proven dead',
      { path, cause: error?.code ?? error?.message ?? String(error) },
    );
  }
  if (occupancy !== 'dead') {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      occupancy === 'live'
        ? 'the dev control socket path is already occupied by another endpoint'
        : 'the occupied dev control endpoint could not be proven dead',
      {
        path,
        expectedUid: ownerUid,
        observedUid: endpoint.uid,
        ...(occupancy === 'live' ? {} : { probeOutcome: occupancy ?? null }),
      },
    );
  }
  assertControlOwnerStateAllowsReclaim(ownerStatePath, path, endpoint);
  let current;
  try {
    current = observeEndpoint(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!sameControlEndpoint(current, endpoint)) {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      'the dead dev control endpoint changed before owner reclamation',
      { path },
    );
  }
  await beforeUnlink?.({ endpoint });
  try {
    current = observeEndpoint(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return endpoint;
    throw error;
  }
  if (!sameControlEndpoint(current, endpoint)) {
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      'the dead dev control endpoint changed before owner reclamation',
      { path },
    );
  }
  assertControlOwnerStateAllowsReclaim(ownerStatePath, path, endpoint);
  // Recheck and unlink are adjacent while the shared pathname lock is held.
  rmSync(path);
  return endpoint;
}

function cleanupControlOwnerStateMarker(path, identity, ownerIncarnationId, endpoint) {
  if (identity === null) return false;
  try {
    const before = lstatSync(path);
    if (!before.isFile()
        || before.isSymbolicLink()
        || String(before.dev) !== identity.device
        || String(before.ino) !== identity.inode) return false;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino
        || state?.schemaVersion !== DEV_CONTROL_OWNER_STATE_FORMAT
        || state.ownerIncarnationId !== ownerIncarnationId) return false;
    if (endpoint === null ? state.endpoint !== null : (
      state.endpoint?.device !== endpoint.device
      || state.endpoint?.inode !== endpoint.inode
      || state.endpoint?.uid !== endpoint.uid
      || state.endpoint?.ownerIncarnationId !== ownerIncarnationId
    )) return false;
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

function flushControlResult(socket, encodedResult, timeoutMs = 1_000) {
  if (socket.destroyed) return Promise.resolve(false);
  return new Promise((resolveFlush) => {
    let settled = false;
    const finish = (flushed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('close', onClose);
      socket.off('error', onError);
      resolveFlush(flushed);
    };
    const onClose = () => finish(false);
    const onError = () => finish(false);
    const timeout = setTimeout(() => {
      socket.destroy();
      finish(false);
    }, timeoutMs);
    socket.once('close', onClose);
    socket.once('error', onError);
    socket.end(encodedResult, () => {
      finish(true);
      // end() flushes the result but only half-closes the connection. A client
      // that intentionally keeps its writable half open must not retain one
      // supervisor FD after the one-request protocol has settled.
      socket.destroy();
    });
  });
}

function createDevControlDispatcher(verbs) {
  let accepting = true;
  let stopPending = false;
  let controlChain = Promise.resolve();
  const enqueue = (verb, context) => {
    if (!accepting || stopPending) {
      throw diagnosticError(
        'SNAPBACK_DEV_CONTROL_STOPPING',
        'the dev control owner is stopping and will not acknowledge new work',
        { verb },
      );
    }
    const stopsChildren = verb === 'stop-children';
    if (stopsChildren) stopPending = true;
    const operation = controlChain.then(() => verbs[verb](context));
    const run = operation.then(
      (result) => {
        if (stopsChildren) stopPending = false;
        return result;
      },
      (error) => {
        if (stopsChildren) stopPending = false;
        throw error;
      },
    );
    controlChain = run.then(() => undefined, () => undefined);
    return run;
  };
  return Object.freeze({
    enqueue,
    get stopping() { return !accepting || stopPending; },
    stopAccepting() { accepting = false; },
    idle() { return controlChain; },
  });
}

async function startDevControlSocketWithDependencies(options, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const getuid = Object.hasOwn(dependencies, 'getuid')
    ? dependencies.getuid
    : process.getuid;
  const readyFile = resolve(options.readyFile);
  const unavailable = (details) => {
    const message = typeof details.path === 'string'
      ? `owner-bound dev control is unavailable for state directory ${details.path}; continuing with stdin control only; choose an owner-only directory with --ready-file`
      : 'owner-bound dev control is unavailable; continuing with stdin control only';
    const diagnostic = devControlDiagnostic(
      'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
      message,
      details,
    );
    options.onUnavailable?.(Object.freeze({ ...diagnostic, severity: 'warning' }));
    return null;
  };
  if (platform === 'win32' || typeof getuid !== 'function') {
    return unavailable({ platform, readyFile });
  }
  const requestedStateDirectoryPath = dirname(readyFile);
  const ownerUid = getuid();
  const ownerPid = process.pid;
  const lifecycleReceipt = controlLifecycleReceipt({
    readyFile: options.readyFile,
    ownerPid,
    ownerUid,
    ownerIncarnationId: options.ownerIncarnationId,
    ownerStartTime: options.ownerStartTime,
    startedAt: options.startedAt,
  });
  const observeEndpoint = dependencies.observeEndpoint ?? observedControlEndpoint;
  const probeEndpoint = dependencies.probeEndpoint
    ?? ((endpointPath) => probeDevControlEndpoint(
      endpointPath,
      { timeoutMs: options.endpointProbeTimeoutMs ?? 500 },
    ));
  const withPathLock = dependencies.withPathLock ?? withCleanupPathLock;
  const writeAcknowledgement = dependencies.writeAcknowledgement
    ?? ((socket, payload, callback) => socket.write(payload, callback));
  const dispatcher = dependencies.dispatcher ?? createDevControlDispatcher(options.verbs);
  const requestedPathChainRoot = resolve(options.pathChainRoot ?? requestedStateDirectoryPath);
  let pathChain = inspectSecureDirectoryChain(
    requestedPathChainRoot,
    requestedStateDirectoryPath,
    ownerUid,
  );
  if (!pathChain.ok && pathChain.reason === 'outside-root') {
    pathChain = inspectSecureExternalDirectoryChain(requestedStateDirectoryPath, ownerUid);
  }
  const pathChainRoot = pathChain.root ?? requestedPathChainRoot;
  const stateDirectoryPath = pathChain.ok && pathChain.external === true
    ? pathChain.canonicalTarget
    : requestedStateDirectoryPath;
  const path = join(stateDirectoryPath, DEV_CONTROL_SOCKET_BASENAME);
  // Bind through an unadvertised same-directory name, publish its inode with
  // link(2), then remove the bind name. Node remembers only the private name,
  // so net.Server.close cannot unlink a later replacement of the public path.
  const privateBindPath = join(stateDirectoryPath, `.d${randomBytes(3).toString('hex')}`);
  const ownerStatePath = join(stateDirectoryPath, DEV_CONTROL_OWNER_STATE_BASENAME);
  if (!pathChain.ok) {
    return unavailable({
      path: stateDirectoryPath,
      readyFile,
      pathChainRoot,
      reason: pathChain.reason,
      component: pathChain.component,
      ...(pathChain.cause === undefined ? {} : { cause: pathChain.cause }),
      ...(pathChain.expectedUid === undefined ? {} : { expectedUid: pathChain.expectedUid }),
      ...(pathChain.observedUid === undefined ? {} : { observedUid: pathChain.observedUid }),
      ...(pathChain.observedMode === undefined ? {} : { observedMode: pathChain.observedMode }),
      recovery: 'choose a same-uid path under --ready-file <path> whose canonical chain has no group/other-writable components; only root-owned symlinks to trusted or sticky system directories are admitted',
    });
  }
  let stateDirectory;
  try {
    stateDirectory = lstatSync(stateDirectoryPath);
  } catch (error) {
    return unavailable({
      path: stateDirectoryPath,
      readyFile,
      cause: error?.code ?? error?.message ?? String(error),
      recovery: 'choose a same-uid owner-only non-symlink state directory with --ready-file <path>',
    });
  }
  if (!stateDirectory.isDirectory()
      || stateDirectory.isSymbolicLink()
      || stateDirectory.uid !== ownerUid
      || (stateDirectory.mode & 0o077) !== 0) {
    return unavailable({
      path: stateDirectoryPath,
      readyFile,
      reason: 'state-directory-custody-failed',
      expectedUid: ownerUid,
      observedUid: stateDirectory.uid,
      observedMode: stateDirectory.mode & 0o777,
      recovery: 'choose a same-uid owner-only non-symlink state directory with --ready-file <path>',
    });
  }

  const sockets = new Set();
  const pendingReplies = new Set();
  let closed = false;
  let closePromise = null;
  let controlSocket = null;
  let cleanupResource = null;
  let privateCleanupResource = null;
  let privateEndpointListened = false;
  let endpoint = null;
  let boundEndpoint = null;
  let descriptor = null;
  let ownerStateIdentity = null;
  let ownerStateEndpoint = null;
  let startupUnavailable = null;
  let close = async () => {};
  const assertStateDirectoryIdentity = (stage) => {
    const inspected = pathChain.external === true
      ? inspectSecureExternalDirectoryChain(requestedStateDirectoryPath, ownerUid)
      : inspectSecureDirectoryChain(
          requestedPathChainRoot,
          requestedStateDirectoryPath,
          ownerUid,
        );
    const fail = (details) => {
      throw diagnosticError(
        'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
        'the admitted dev control directory chain changed before endpoint publication',
        {
          path: stateDirectoryPath,
          endpointPath: path,
          readyFile,
          stage,
          ...details,
        },
      );
    };
    if (!inspected.ok) {
      fail({
        reason: inspected.reason,
        component: inspected.component,
        ...(inspected.cause === undefined ? {} : { cause: inspected.cause }),
        ...(inspected.expectedUid === undefined ? {} : { expectedUid: inspected.expectedUid }),
        ...(inspected.observedUid === undefined ? {} : { observedUid: inspected.observedUid }),
        ...(inspected.observedMode === undefined ? {} : { observedMode: inspected.observedMode }),
      });
    }
    if (inspected.root !== pathChain.root
        || inspected.target !== pathChain.target
        || inspected.canonicalRoot !== pathChain.canonicalRoot
        || inspected.canonicalTarget !== pathChain.canonicalTarget) {
      fail({ reason: 'component-changed', component: requestedStateDirectoryPath });
    }
    for (const key of ['components', 'lexicalComponents']) {
      const expected = pathChain[key] ?? [];
      const observed = inspected[key] ?? [];
      if (expected.length !== observed.length) {
        fail({
          reason: 'component-changed',
          component: observed.at(-1)?.path ?? expected.at(-1)?.path ?? requestedStateDirectoryPath,
        });
      }
      for (let index = 0; index < expected.length; index += 1) {
        const expectedIdentity = expected[index];
        const observedIdentity = observed[index];
        if (expectedIdentity.path !== observedIdentity.path
            || expectedIdentity.device !== observedIdentity.device
            || expectedIdentity.inode !== observedIdentity.inode
            || expectedIdentity.symlink !== observedIdentity.symlink
            || expectedIdentity.canonicalPath !== observedIdentity.canonicalPath) {
          fail({ reason: 'component-changed', component: observedIdentity.path });
        }
      }
    }
  };
  const observeBoundEndpoint = () => {
    const observed = observeEndpoint(path);
    if (boundEndpoint !== null && !sameControlEndpoint(observed, boundEndpoint)) {
      throw diagnosticError(
        'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
        'the bound dev control endpoint was replaced by another pathname owner',
        { path },
      );
    }
    return observed;
  };
  const server = createNetServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(options.connectionIdleTimeoutMs ?? 5_000);
    let buffer = '';
    let handled = false;
    socket.on('close', () => sockets.delete(socket));
    // A caller may disconnect after the acknowledgement while a verb is
    // still settling. That abandons only its reply; it must not crash the
    // lifecycle owner or cancel an operation already acknowledged.
    socket.on('error', () => sockets.delete(socket));
    socket.on('timeout', () => socket.destroy());
    socket.on('end', () => {
      // EOF before a complete newline-delimited request closes the writable
      // half immediately. After a complete request, retain it until the
      // asynchronous settled result flushes; flushControlResult then destroys
      // the connection even when the client never closes its writable half.
      if (!handled) socket.end();
    });
    socket.on('data', (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > DEV_CONTROL_COMMAND_LIMIT_BYTES) {
        handled = true;
        void flushControlResult(socket, `${JSON.stringify(devControlResult({
          ok: false,
          diagnostic: devControlDiagnostic(
            'SNAPBACK_DEV_COMMAND_INVALID',
            'the dev control command exceeded the 16 KiB limit',
          ),
        }))}\n`);
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      handled = true;
      const line = buffer.slice(0, newline);
      const handleCommand = async () => {
        let command;
        try {
          command = JSON.parse(line);
        } catch {
          void flushControlResult(socket, `${JSON.stringify(devControlResult({
            ok: false,
            diagnostic: devControlDiagnostic(
              'SNAPBACK_DEV_COMMAND_INVALID',
              'dev control commands are newline-delimited JSON objects',
            ),
          }))}\n`);
          return;
        }
        let endpoint;
        try {
          endpoint = observeBoundEndpoint();
        } catch (error) {
          void flushControlResult(socket, `${JSON.stringify(devControlResult({
            requestId: typeof command?.requestId === 'string' ? command.requestId : null,
            verb: typeof command?.verb === 'string' ? command.verb : null,
            ok: false,
            diagnostic: error?.diagnostic ?? devControlDiagnostic(
              'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
              'the dev control endpoint identity could not be verified',
              { path },
            ),
          }))}\n`);
          return;
        }
        if (controlSocket === null) {
          void flushControlResult(socket, `${JSON.stringify(devControlResult({
            requestId: typeof command?.requestId === 'string' ? command.requestId : null,
            verb: typeof command?.verb === 'string' ? command.verb : null,
            ok: false,
            diagnostic: devControlDiagnostic(
              'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
              'the dev control owner has not finished binding its lifecycle receipt',
              { path },
            ),
          }))}\n`);
          return;
        }
        const validation = validateDevControlCommand(command, controlSocket, endpoint);
        if (validation?.schemaVersion === DEV_CONTROL_RESULT_FORMAT) {
          void flushControlResult(socket, `${JSON.stringify(validation)}\n`);
          return;
        }
        const { requestId, verb } = validation;
        let operation;
        let releaseResponse = null;
        const afterResponse = verb === 'stop-children'
          ? new Promise((resolveResponse) => { releaseResponse = resolveResponse; })
          : null;
        try {
          operation = dispatcher.enqueue(verb, {
            requestId,
            ...(afterResponse === null ? {} : { afterResponse }),
          });
        } catch (error) {
          void flushControlResult(socket, `${JSON.stringify(devControlResult({
            requestId,
            verb,
            ok: false,
            diagnostic: error?.diagnostic ?? devControlDiagnostic(
              error?.code ?? 'SNAPBACK_DEV_CONTROL_STOPPING',
              error?.message ?? 'the dev control owner is stopping and will not acknowledge new work',
              { verb },
            ),
          }))}\n`);
          return;
        }
        // Queue the accepted work before touching the reply socket. A peer may
        // FIN or reset immediately after its command; that abandons only the
        // acknowledgement/result, never the already-admitted owner verb.
        const reply = operation.then(
          (result) => {
            // @ref LLP 0192#d-1-the-durable-state-registry — the owner-only
            // InstanceLocal socket returns the correlated result without
            // transferring lifecycle authority into durable store state.
            return `${JSON.stringify(devControlResult({
              requestId,
              verb,
              ok: result?.ok !== false,
              result,
            }))}\n`;
          },
          (error) => `${JSON.stringify(devControlResult({
              requestId,
              verb,
              ok: false,
              diagnostic: error?.diagnostic ?? devControlDiagnostic(
                error?.code ?? 'SNAPBACK_DEV_COMMAND_FAILED',
                error?.message ?? `dev control verb ${verb} failed`,
                { verb },
              ),
            }))}\n`,
        ).then((encodedResult) => flushControlResult(socket, encodedResult));
        pendingReplies.add(reply);
        void reply.then(
          () => pendingReplies.delete(reply),
          () => pendingReplies.delete(reply),
        );
        socket.setTimeout(0);
        const releaseAcknowledgement = releaseResponse === null
          ? undefined
          : () => releaseResponse();
        if (releaseAcknowledgement !== undefined) {
          // A reset peer cannot receive the acknowledgement, but it also must
          // not strand already-admitted cleanup behind an unreachable gate.
          socket.once('close', releaseAcknowledgement);
        }
        try {
          writeAcknowledgement(socket, `${JSON.stringify({
            schemaVersion: DEV_CONTROL_ACK_FORMAT,
            ok: true,
            state: 'acknowledged',
            requestId,
            verb,
            ownerIncarnationId: controlSocket.ownerIncarnationId,
            lifecycleReceipt: controlSocket.lifecycleReceipt,
          })}\n`, releaseAcknowledgement);
        } catch {
          releaseAcknowledgement?.();
          socket.destroy();
        }
      };
      void handleCommand().catch(() => socket.destroy());
    });
  });

  close = () => {
    if (closePromise !== null) return closePromise;
    closed = true;
    dispatcher.stopAccepting();
    closePromise = (async () => {
      let resolveServerClose;
      const serverClose = new Promise((resolveClose) => { resolveServerClose = resolveClose; });
      if (server.listening) server.close(resolveServerClose);
      else resolveServerClose();
      await dispatcher.idle();
      await Promise.allSettled([...pendingReplies]);
      for (const socket of sockets) socket.destroy();
      await serverClose;
    })().finally(async () => {
      // @ref LLP 0192#d-1-the-durable-state-registry — this socket is
      // transient instance-local state, not a durable member. Remove only the
      // exact endpoint this owner bound; a replacement is never deleted.
      if (cleanupResource !== null) await cleanupLeasedPath(cleanupResource);
      else await withPathLock(path, async () => {
        try {
          const observed = observeEndpoint(path);
          if (sameControlEndpoint(observed, endpoint)) {
            const current = observeEndpoint(path);
            if (sameControlEndpoint(current, endpoint)) rmSync(path);
          }
        } catch { /* Missing or replaced endpoints are permanently discharged. */ }
      });
      cleanupControlOwnerStateMarker(
        ownerStatePath,
        ownerStateIdentity,
        options.ownerIncarnationId,
        endpoint,
      );
      cleanupResource = null;
    });
    return closePromise;
  };

  await withPathLock(path, async () => {
    try {
      await reclaimDeadControlEndpoint({
        path,
        ownerStatePath,
        ownerUid,
        observeEndpoint,
        probeEndpoint,
        beforeUnlink: dependencies.beforeReclaimUnlink,
      });
      cleanupResource = reserveCleanupPath(options.cleanupLease ?? null, path, {
        type: 'socket',
        label: 'Expo dev control socket',
        pendingOwnerState: {
          path: ownerStatePath,
          endpointPath: path,
          ownerIncarnationId: options.ownerIncarnationId,
          ownerUid,
        },
      });
      // Persist the incarnation before binding a private same-directory name.
      // The private inode is cleanup-leased before listen; link(2) later
      // publishes it without replacing an occupied well-known endpoint.
      ownerStateIdentity = writeOwnerOnlyJsonAtomic(ownerStatePath, {
        schemaVersion: DEV_CONTROL_OWNER_STATE_FORMAT,
        phase: 'binding',
        path,
        ownerPid,
        ownerUid,
        ownerIncarnationId: options.ownerIncarnationId,
        ownerStartTime: options.ownerStartTime,
        lifecycleReceipt,
        endpoint: null,
        startedAt: options.startedAt,
      });
      await dependencies.beforeEndpointPublish?.({ path, ownerStatePath });
      assertStateDirectoryIdentity('before-private-bind');
      privateCleanupResource = reserveCleanupPath(
        options.cleanupLease ?? null,
        privateBindPath,
        {
          type: 'socket',
          label: 'Expo dev control private bind socket',
          leaseUnique: true,
        },
      );
      await new Promise((resolveListen, rejectListen) => {
        const onError = (cause) => {
          server.off('listening', onListening);
          if (cause?.code === 'EADDRINUSE') {
            rejectListen(diagnosticError(
              'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
              'the dev control socket path became occupied before binding',
              { path, cause: cause.code },
            ));
            return;
          }
          rejectListen(diagnosticError(
            'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
            `the dev control socket could not bind at ${path}: ${cause.message}`,
            {
              path: stateDirectoryPath,
              endpointPath: path,
              readyFile,
              reason: 'socket-bind-failed',
              cause: cause.code ?? cause.message,
              recovery: 'choose a shorter owner-only state directory with --ready-file <path>',
            },
          ));
        };
        const onListening = () => {
          server.off('error', onError);
          privateEndpointListened = true;
          resolveListen();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        try {
          // @ref LLP 0192#d-1-the-durable-state-registry — bind an unadvertised
          // InstanceLocal inode first; link(2) below publishes it without
          // replacing an occupied owner endpoint.
          (dependencies.listenServer ?? ((boundServer, endpointPath) => (
            boundServer.listen(endpointPath)
          )))(server, privateBindPath);
        } catch (cause) {
          onError(cause);
        }
      });
      await dependencies.afterPrivateEndpointListen?.({
        path,
        privateBindPath,
        ownerStatePath,
      });
      boundEndpoint = observeEndpoint(privateBindPath);
      chmodSync(privateBindPath, 0o600);
      boundEndpoint = observeEndpoint(privateBindPath);
      if (boundEndpoint.uid !== ownerUid || boundEndpoint.mode !== 0o600) {
        throw diagnosticError(
          'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
          'the dev control socket did not acquire owner-only uid/mode custody',
          {
            path: stateDirectoryPath,
            endpointPath: path,
            readyFile,
            reason: 'socket-custody-failed',
            expectedUid: ownerUid,
            observedUid: boundEndpoint.uid,
            observedMode: boundEndpoint.mode,
            recovery: 'choose another owner-only state directory with --ready-file <path>',
          },
        );
      }
      try {
        assertStateDirectoryIdentity('before-link-publication');
        // link(2) publishes only into an absent destination. Removing the
        // private name detaches Node's automatic close-time pathname unlink
        // while the public hard link continues accepting connections.
        linkSync(privateBindPath, path);
        rmSync(privateBindPath);
        releaseCleanupResource(privateCleanupResource);
        privateCleanupResource = null;
      } catch (cause) {
        if (cause?.diagnostic?.code === 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE') {
          throw cause;
        }
        if (cause?.code === 'EEXIST') {
          throw diagnosticError(
            'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
            'the dev control socket path became occupied before binding',
            { path, cause: cause.code },
          );
        }
        throw diagnosticError(
          'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
          `the dev control socket could not publish at ${path}: ${cause.message}`,
          {
            path: stateDirectoryPath,
            endpointPath: path,
            readyFile,
            reason: 'socket-publication-failed',
            cause: cause?.code ?? cause?.message ?? String(cause),
            recovery: 'choose another owner-only state directory with --ready-file <path>',
          },
        );
      }
      endpoint = observeBoundEndpoint();
      dependencies.afterEndpointListen?.({ path, ownerStatePath, endpoint });
      endpoint = observeBoundEndpoint();
      descriptor = Object.freeze({
        schemaVersion: DEV_CONTROL_SOCKET_FORMAT,
        path,
        ownerPid,
        ownerUid,
        ownerIncarnationId: options.ownerIncarnationId,
        ownerStartTime: options.ownerStartTime,
        lifecycleReceipt,
        endpoint,
        verbs: DEV_CONTROL_VERBS,
      });
      ownerStateIdentity = writeOwnerOnlyJsonAtomic(ownerStatePath, {
        schemaVersion: DEV_CONTROL_OWNER_STATE_FORMAT,
        phase: 'bound',
        path,
        ownerPid,
        ownerUid,
        ownerIncarnationId: options.ownerIncarnationId,
        ownerStartTime: options.ownerStartTime,
        lifecycleReceipt,
        endpoint: { ...endpoint, ownerIncarnationId: options.ownerIncarnationId },
        startedAt: options.startedAt,
      });
      ownerStateEndpoint = endpoint;
      activateCleanupSocketPath(cleanupResource, {
        ownerIncarnationId: options.ownerIncarnationId,
        socketIdentity: endpoint,
        ownerStatePath,
      });
      await dependencies.afterEndpointLeaseActivation?.({
        path,
        ownerStatePath,
      });
      try {
        const advertisedOccupancy = await probeEndpoint(path);
        if (advertisedOccupancy !== 'live') {
          throw Object.assign(
            new Error(`advertised endpoint probe returned ${advertisedOccupancy ?? 'unknown'}`),
            { code: advertisedOccupancy ?? 'UNKNOWN_SOCKET_OUTCOME' },
          );
        }
      } catch (cause) {
        throw diagnosticError(
          'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
          'the advertised dev control socket path could not be reached before publication',
          {
            path: stateDirectoryPath,
            endpointPath: path,
            readyFile,
            reason: 'advertised-path-probe-failed',
            cause: cause?.code ?? cause?.message ?? String(cause),
            recovery: 'choose a shorter owner-only state directory with --ready-file <path>',
          },
        );
      }
      const published = observeBoundEndpoint();
      if (!sameControlEndpoint(published, endpoint)) throw diagnosticError(
        'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
        'the published dev control endpoint does not match its owner state',
        { path },
      );
      await dependencies.afterEndpointPublish?.({ path, descriptor });
    } catch (error) {
      await (dependencies.closeServer ?? ((boundServer) => new Promise((resolveClose) => {
        if (!boundServer.listening) {
          resolveClose();
          return;
        }
        boundServer.close(() => resolveClose());
      })))(server);
      if (privateCleanupResource !== null) {
        if (privateEndpointListened) await cleanupLeasedPath(privateCleanupResource);
        else releaseCleanupResource(privateCleanupResource);
        privateCleanupResource = null;
      }
      releaseCleanupResource(cleanupResource);
      cleanupResource = null;
      try {
        const current = observedControlEndpoint(path);
        if (boundEndpoint !== null && sameControlEndpoint(current, boundEndpoint)) rmSync(path);
      } catch { /* absent or replaced */ }
      cleanupControlOwnerStateMarker(
        ownerStatePath,
        ownerStateIdentity,
        options.ownerIncarnationId,
        ownerStateEndpoint,
      );
      if (error?.diagnostic?.code === 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE') {
        startupUnavailable = error.diagnostic;
        return;
      }
      throw error;
    }
  }).catch((error) => {
    if ((error?.diagnostic?.code ?? error?.code) !== 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE') {
      throw error;
    }
    throw diagnosticError(
      'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      'the owner-bound dev control path lock could not exclude a live or ambiguous owner',
      {
        path: stateDirectoryPath,
        endpointPath: path,
        readyFile,
        cause: error?.code ?? error?.message ?? String(error),
        recovery: 'wait for the current lifecycle owner to exit before starting another supervisor',
      },
    );
  });
  if (startupUnavailable !== null) return unavailable(startupUnavailable.details);
  // The pathname lock, direct-connect probe, and final endpoint identity check
  // all finish before commands can bind to this lifecycle descriptor. Clients
  // that connect while publication is in flight are refused by handleCommand.
  controlSocket = descriptor;
  return Object.freeze({
    descriptor,
    get closed() { return closed; },
    close,
  });
}

export async function startDevControlSocket(options) {
  return startDevControlSocketWithDependencies(options);
}

export function expoSupervisorChildEnvironment(env = process.env) {
  const childEnv = { ...(env ?? {}) };
  // The supervisor coordinates backend and Metro processes, but it is not an
  // RQS-store owner. Inheriting the caller's file-store namespace lets a
  // supervised JS child take the app's single-writer lock before the app does.
  delete childEnv.SNAPBACK_CLIENT_RQS_DIR;
  // A stale caller environment must never turn the process-only native
  // checkout nonce into Metro input. The supervisor issues its own nonce only
  // after selecting a native target.
  delete childEnv[SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV];
  // The lease belongs to this supervisor process. Backend and Metro children
  // must not mistake their own parentage for the carrier's lease.
  delete childEnv[SUPERVISOR_PARENT_PID_ENV];
  delete childEnv[SUPERVISOR_PARENT_START_TIME_ENV];
  delete childEnv[CLEANUP_LEASE_DIRECTORY_ENV];
  return childEnv;
}

export function expoBackendDevAuthEnvironment(env, metroPort) {
  const origins = new Set(
    String(env?.SNAPBACK_DEV_AUTH_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  for (const origin of expoBackendClientOrigins(metroPort)) origins.add(origin);
  return {
    ...(env ?? {}),
    SNAPBACK_DEV_AUTH_ORIGINS: [...origins].join(','),
  };
}

export function expoBackendClientOrigins(metroPort) {
  return Object.freeze([
    `http://127.0.0.1:${metroPort}`,
    `http://[::1]:${metroPort}`,
    `http://localhost:${metroPort}`,
  ]);
}

export function expoMetroChildEnvironment({ env, bootstrapOrigin, backendOrigin, port }) {
  const childEnv = {
    ...(env ?? {}),
    EXPO_NO_TELEMETRY: '1',
    // @ref LLP 0223#decision — auto-inject, do not auto-write: the
    // credential-free rendezvous origin is process-scoped supervisor
    // environment; a durable .env copy is a rejected stale-lifecycle
    // configuration surface.
    EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN: bootstrapOrigin,
    // @ref LLP 0300#p4--the-dev-session-becomes-explicit — supervised web
    // exposes the backend data/auth origin while retaining the supervisor
    // origin above as the binding rendezvous control plane.
    // @ref LLP 0310.000#track-b--the-mint-is-on-demand-and-gives-the-form-back — Track B makes
    // the web data/auth URL visible without turning it into binding authority.
    ...(typeof backendOrigin === 'string' && backendOrigin.length > 0
      ? { EXPO_PUBLIC_SNAPBACK_URL: backendOrigin }
      : {}),
    SNAPBACK_EXPO_METRO_PORT: String(port),
    RCT_METRO_PORT: String(port),
    // Expo's --localhost server asks Node to listen on the hostname
    // "localhost". On IPv6-first Macs that otherwise resolves to ::1,
    // while the supervised iOS route is deliberately 127.0.0.1. Keep the
    // public and bound endpoints identical without exposing Metro on LAN.
    NODE_OPTIONS: metroNodeOptions(env?.NODE_OPTIONS),
  };
  if (typeof backendOrigin !== 'string' || backendOrigin.length === 0) {
    delete childEnv.EXPO_PUBLIC_SNAPBACK_URL;
  }
  // @ref LLP 0262#d2-carriers-per-shipped-topology — the browser-visible
  // Metro environment carries only credential-free origins. The checkout
  // nonce is delivered by the native launcher, never by Metro or an
  // EXPO_PUBLIC_* variable.
  delete childEnv[SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV];
  // @ref LLP 0241#d6-development-commands-share-one-recovery-model — the
  // supervised Metro arm is always a generated-client watch custodian. Parent
  // CI still keeps the controller headless, but inheriting it here makes Expo
  // start Metro with `watch: false` and freezes the predecessor generated graph.
  delete childEnv.CI;
  return childEnv;
}

export function assessMetroWatchInertness({ env = process.env, directory = null } = {}) {
  const advisories = [];

  try {
    const effectiveCi = env?.CI;
    const normalizedCi = effectiveCi == null
      ? ''
      : String(effectiveCi).trim().toLowerCase();
    if (effectiveCi != null && !['', '0', 'false'].includes(normalizedCi)) {
      advisories.push(Object.freeze({
        code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
        condition: 'ci-environment',
        message: `Metro file watching is inert: CI=${effectiveCi} is set in the environment, and Expo/Metro disable file watching under CI.`,
        remediation: 'Edits will not rebuild the served bundle. Unset CI (or pass CI=0) in the supervisor environment to re-enable watching.',
        details: Object.freeze({ ci: String(effectiveCi), defaulted: false }),
      }));
    }
  } catch {
    // Assessment is advisory only and must never disturb the supervised loop.
  }

  try {
    if (typeof directory === 'string' && directory.length > 0) {
      const resolvedPath = resolve(directory);
      let resolvedDirectory = resolvedPath;
      try {
        resolvedDirectory = realpathSync(resolvedPath);
      } catch {
        // A nonexistent or inaccessible path still supports the lexical heuristic.
      }
      const root = METRO_WATCH_BLIND_ROOTS.find((candidate) => (
        resolvedDirectory === candidate || resolvedDirectory.startsWith(`${candidate}/`)
      ));
      if (root !== undefined) {
        advisories.push(Object.freeze({
          code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
          condition: 'watcher-blind-root',
          message: `Metro file watching is inert: the Expo project directory ${resolvedDirectory} is under the watcher-blind root ${root}, where file events do not reach Metro.`,
          remediation: `Edits will not rebuild the served bundle. Move the project off ${root}, or restart the supervised loop after each change.`,
          details: Object.freeze({ directory: resolvedDirectory, root }),
        }));
      }
    }
  } catch {
    // Assessment is advisory only and must never disturb the supervised loop.
  }

  // An active sentinel-touch probe is skipped because Metro's event stream has
  // no reliable rebuild-completion event to join and a probe would write into
  // the user's project; the static tiers cover the observed failure modes
  // (issues/20260808-supervisor-warn-metro-watch-blind.md).
  return Object.freeze(advisories);
}

// Unsupervised Metro (`CI=1 npx expo start`, or `snapback dev --client-command`
// inheriting that environment) never reaches the supervised readiness stream.
// Reuse the same CI normalization and emit the same diagnostic code as an
// advisory before spawn (issues/closed/20260812-guide-gap-unsupervised-metro-ci-advisory.md).
export function cliMetroWatchInertAdvisory({
  env = process.env,
  clientCommand = null,
} = {}) {
  const ciAdvisory = assessMetroWatchInertness({ env })
    .find((advisory) => advisory.condition === 'ci-environment');
  if (!ciAdvisory) return null;
  const inheritedClientCommand = typeof clientCommand === 'string' && clientCommand.length > 0
    ? clientCommand
    : null;
  const unsupervised = ' If you launch Metro/Expo yourself, do not inherit CI=1; unset CI or pass CI=0.';
  const clientArm = inheritedClientCommand === null
    ? ''
    : ` --client-command ${JSON.stringify(inheritedClientCommand)} inherits this environment.`;
  return Object.freeze({
    code: ciAdvisory.code,
    severity: 'warning',
    subsystem: 'cli',
    condition: ciAdvisory.condition,
    message: `${ciAdvisory.message}${clientArm}${unsupervised}`,
    remediation: 'Edits will not rebuild the served bundle. Prefer snapback dev --expo, or unset CI (or pass CI=0) before launching Metro/Expo yourself.',
    details: Object.freeze({
      ...ciAdvisory.details,
      unsupervised: true,
      clientCommand: inheritedClientCommand,
    }),
  });
}

export function emitCliMetroWatchInertAdvisory({
  env = process.env,
  clientCommand = null,
  json = false,
  write = (line) => console.error(line),
} = {}) {
  const advisory = cliMetroWatchInertAdvisory({ env, clientCommand });
  if (advisory === null) return null;
  if (json) {
    write(JSON.stringify({
      ok: true,
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: advisory.code,
      diagnostic: advisory,
    }));
  } else {
    write(`[warning] ${advisory.code} (${advisory.subsystem}) ${advisory.message} ${advisory.remediation}`);
  }
  return advisory;
}

export const SUPERVISED_CONTROL_PATH = '/_snapback/expo/v1/control';

const LOOPBACK_HOST = '127.0.0.1';
const BROWSER_EXCHANGE_ORIGIN_PREFIXES = Object.freeze([
  'http://127.0.0.1:',
  'https://127.0.0.1:',
  'http://localhost:',
  'https://localhost:',
  'http://[::1]:',
  'https://[::1]:',
]);
const DEFAULT_BINDING_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_EMAIL = 'snapback-dev@localhost.invalid';
const BOOTSTRAP_BODY_LIMIT_BYTES = 4 * 1_024;
const CONTROL_BODY_LIMIT_BYTES = 4 * 1_024;
const SUPERVISED_CONNECT_CARRIER = 'supervisor-rendezvous';

export function admittedBrowserExchangeOrigin(originHeader) {
  if (typeof originHeader !== 'string') return null;
  let parsed;
  try { parsed = new URL(originHeader); } catch { return null; }
  return parsed.origin === originHeader
    && parsed.port.length > 0
    && BROWSER_EXCHANGE_ORIGIN_PREFIXES.some((prefix) => originHeader.startsWith(prefix))
    ? originHeader
    : null;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function constantTimeTokenEqual(presented, expected) {
  const presentedHash = createHash('sha256').update(
    typeof presented === 'string' ? presented : '',
  ).digest();
  const expectedHash = createHash('sha256').update(
    typeof expected === 'string' ? expected : '',
  ).digest();
  const hashesEqual = timingSafeEqual(presentedHash, expectedHash);
  return typeof presented === 'string'
    && presented.length > 0
    && typeof expected === 'string'
    && expected.length > 0
    && hashesEqual;
}

function readAdvertisedDevIdentityCapability(descriptor, readCapabilityFile) {
  const path = descriptor?.devIdentityCapabilityFile;
  if (typeof path !== 'string' || path.length === 0) return null;
  if (typeof descriptor?.startupNonce !== 'string' || descriptor.startupNonce.length === 0) {
    return null;
  }
  const capability = String(readCapabilityFile(path, 'utf8')).trim();
  if (!capability.startsWith('sbdev_')) {
    throw diagnosticError(
      'SNAPBACK_DEV_IDENTITY_REFUSED',
      'the ready-descriptor-advertised dev-identity capability is invalid',
    );
  }
  return Object.freeze({
    capability,
    path,
    startupNonce: descriptor.startupNonce,
  });
}

// @ref LLP 0262#d2-carriers-per-shipped-topology — packaged native Expo gets
// a per-device, one-shot nonce bound to the backend boot. The registry retains
// no capability bytes: redemption re-reads the advertised sidecar after
// checking the current startup nonce.
export function createDevIdentityCheckoutRegistry({
  getReadyDescriptor,
  readCapabilityFile = readFileSync,
  mintNonce = () => randomBytes(32).toString('base64url'),
} = {}) {
  if (typeof getReadyDescriptor !== 'function') {
    throw new TypeError('getReadyDescriptor must be a function');
  }
  if (typeof readCapabilityFile !== 'function' || typeof mintNonce !== 'function') {
    throw new TypeError('checkout registry readers and nonce minter must be functions');
  }
  const issued = [];
  const issue = ({ platform, device } = {}) => {
    const descriptor = getReadyDescriptor();
    const advertised = readAdvertisedDevIdentityCapability(descriptor, readCapabilityFile);
    if (advertised === null) return null;
    const nonce = mintNonce();
    if (typeof nonce !== 'string' || nonce.length < 32) {
      throw new TypeError('checkout nonce minter must return at least 32 characters');
    }
    issued.push({
      nonce,
      startupNonce: advertised.startupNonce,
      platform: platform ?? null,
      device: device ?? null,
    });
    return nonce;
  };
  const redeem = (presented) => {
    let matchedIndex = -1;
    const dummy = '0'.repeat(43);
    for (let index = 0; index < Math.max(issued.length, 1); index += 1) {
      const expected = issued[index]?.nonce ?? dummy;
      if (constantTimeTokenEqual(presented, expected)) matchedIndex = index;
    }
    if (matchedIndex === -1) return null;
    const [checkout] = issued.splice(matchedIndex, 1);
    let descriptor;
    let advertised;
    try {
      descriptor = getReadyDescriptor();
      advertised = readAdvertisedDevIdentityCapability(descriptor, readCapabilityFile);
    } catch {
      return null;
    }
    if (advertised === null || advertised.startupNonce !== checkout.startupNonce) return null;
    return advertised.capability;
  };
  return Object.freeze({
    issue,
    redeem,
    invalidate() { issued.length = 0; },
    get pending() { return issued.length; },
  });
}

function isLoopbackHost(host) {
  const normalized = String(host).toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === '::1'
    || normalized === 'localhost'
    || normalized.startsWith('127.');
}

function portFromOrigin(origin, label) {
  let parsed;
  try { parsed = new URL(origin); } catch {
    throw diagnosticError(
      'SNAPBACK_EXPO_ROUTE_INVALID',
      `${label} did not provide an absolute HTTP origin`,
      { origin },
    );
  }
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw diagnosticError('SNAPBACK_EXPO_ROUTE_INVALID', `${label} provided an invalid port`);
  }
  return { host: parsed.hostname, port, origin: parsed.origin };
}

function clientDiagnostic(source, fallbackCode, fallbackMessage) {
  const code = source?.code ?? fallbackCode;
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: source?.severity ?? 'error',
    message: source?.message ?? fallbackMessage,
    details: Object.freeze({ ...(source?.details ?? {}) }),
  });
}

// @ref LLP 0181#provider — E1 uses the already-shipped native session mint
// primitive. The operator token stays supervisor-held and is passed only to
// the native wrapper; the app-facing result contains only the ordinary
// session envelope.
// @ref LLP 0300#p4--the-dev-session-becomes-explicit — no target boot-mints;
// the supervisor calls this primitive only after application adoption or
// later replacement demand.
export function mintSupervisedOrdinarySession({
  runtimeBinary,
  readyFile,
  email = DEFAULT_EMAIL,
  operatorToken,
  cwd,
  env = process.env,
} = {}) {
  const result = spawnSync(runtimeBinary, [
    'session', 'mint',
    '--email', email,
    '--ready-file', readyFile,
  ], {
    cwd,
    env: {
      ...scrubDynamicLoaderEnvironment(env),
      ...(typeof operatorToken === 'string' && operatorToken.length > 0
        ? { SNAPBACK_ADMIN_TOKEN: operatorToken }
        : {}),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    const error = diagnosticError(
      'SNAPBACK_EXPO_SESSION_MINT_FAILED',
      'the supervised ordinary-session mint could not run',
      { cause: result.error.code ?? result.error.message },
    );
    error.cause = result.error;
    throw error;
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_EXPO_SESSION_MINT_FAILED',
      'the native session mint did not return one hostOpsResult JSON document',
      { status: result.status, signal: result.signal },
    );
    error.cause = cause;
    throw error;
  }
  if (envelope?.ok === true
    && envelope?.operation === 'auth.mintSession'
    && envelope?.data?.tokenType === 'Bearer'
    && typeof envelope?.data?.token === 'string'
    && envelope.data.token.length > 0) {
    return Object.freeze({
      status: 'ready',
      tokenType: 'Bearer',
      token: envelope.data.token,
      expiresAt: Number.isSafeInteger(envelope.data.session?.expiresAt)
        ? envelope.data.session.expiresAt
        : null,
    });
  }
  const source = envelope?.diagnostics?.[0] ?? envelope?.diagnostic ?? null;
  const projected = clientDiagnostic(
    source,
    'SNAPBACK_EXPO_SESSION_MINT_FAILED',
    'The supervised ordinary-session mint was refused.',
  );
  if (
    projected.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
    || projected.code === 'SNAPBACK_AUTHORITY_REQUIRED'
  ) {
    return Object.freeze({
      status: 'authority-required',
      diagnostic: projected,
      remediations: Object.freeze([]),
    });
  }
  throw diagnosticError(projected.code, projected.message, projected.details);
}

function appOrigin(host, port) {
  const renderedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${renderedHost}:${port}`;
}

function commandResultDetails(result) {
  return Object.freeze({
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    ...(result?.error ? { cause: result.error.code ?? result.error.message } : {}),
  });
}

function adbSerialClass(serial, fields) {
  if (/^emulator-\d+$/u.test(serial)) return 'emulator';
  if (
    /:\d+$/u.test(serial)
    || /^adb-.+\._adb-tls-(?:connect|pairing)\._tcp\.?$/u.test(serial)
  ) return 'tcpip';
  if (fields.some((field) => field.startsWith('usb:'))) return 'usb';
  // ADB's USB serial is otherwise opaque. Unknown non-network, non-emulator
  // serials stay on the local USB class; selection still requires state=device.
  return 'usb';
}

// @ref LLP 0176#open-questions — OQ4 admits Android emulators and physical
// USB devices through the same per-serial adb reverse discipline, while TCP/IP
// adb is a network carrier and therefore remains outside this supervisor.
export function parseAdbDeviceInventory(stdout) {
  const devices = [];
  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line || /^List of devices attached\b/u.test(line) || line.startsWith('*')) continue;
    const fields = line.split(/\s+/u);
    if (fields.length < 2) continue;
    const [serial, state, ...details] = fields;
    const deviceClass = adbSerialClass(serial, details);
    devices.push(Object.freeze({
      serial,
      state,
      class: deviceClass,
      transport: deviceClass === 'tcpip' ? 'network' : 'local',
      details: Object.freeze([...details]),
    }));
  }
  return Object.freeze(devices);
}

export function enumerateAndroidAdbDevices({
  adbBinary = 'adb',
  run = spawnSync,
  env = process.env,
} = {}) {
  const result = run(adbBinary, ['devices', '-l'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  if (result?.error || result?.status !== 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ADB_INVENTORY_FAILED',
      'adb could not enumerate Android devices for supervised routing',
      commandResultDetails(result),
    );
  }
  return parseAdbDeviceInventory(result.stdout);
}

function publicDeviceInventory(devices) {
  return devices.map((device) => Object.freeze({
    serial: device.serial,
    class: device.class,
    state: device.state,
  }));
}

function refuseTcpAdbDevice(device) {
  throw diagnosticError(
    'SNAPBACK_EXPO_ADB_TCPIP_DEVICE_REFUSED',
    'TCP/IP-connected adb devices are not admitted by the USB/port-forward supervisor',
    {
      serial: device.serial,
      class: device.class,
      reason: 'network-reachability-requires-llp-0168-carrier-review',
      admittedClasses: ['emulator', 'usb'],
    },
  );
}

export function selectAndroidAdbDevice(devices, { serial = null } = {}) {
  const inventory = Array.isArray(devices) ? devices : [];
  let selected = null;
  if (serial !== null) {
    selected = inventory.find((device) => device.serial === serial) ?? null;
    if (selected === null) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_NOT_FOUND',
        `adb did not report the requested Android device ${serial}`,
        { serial, devices: publicDeviceInventory(inventory) },
      );
    }
  } else {
    const admitted = inventory.filter((device) => (
      device.state === 'device' && (device.class === 'emulator' || device.class === 'usb')
    ));
    if (admitted.length > 1) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_AMBIGUOUS',
        'more than one emulator/USB Android device is available; select one with --android-serial',
        { devices: publicDeviceInventory(admitted) },
      );
    }
    if (admitted.length === 1) selected = admitted[0];
    else {
      const tcpip = inventory.find((device) => device.state === 'device' && device.class === 'tcpip');
      if (tcpip) refuseTcpAdbDevice(tcpip);
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_NOT_FOUND',
        'no ready Android emulator or USB device is attached',
        { devices: publicDeviceInventory(inventory) },
      );
    }
  }
  if (selected.class === 'tcpip') refuseTcpAdbDevice(selected);
  if (selected.state !== 'device') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_UNAVAILABLE',
      `the requested Android device is ${selected.state}, not ready`,
      { serial: selected.serial, class: selected.class, state: selected.state },
    );
  }
  return Object.freeze({ serial: selected.serial, class: selected.class });
}

export function parseDevicectlDeviceInventory(document) {
  let parsed = document;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (cause) {
      throw diagnosticError(
        'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_INVALID',
        'devicectl did not produce valid JSON device inventory',
        { cause: cause.message },
      );
    }
  }
  if (!Array.isArray(parsed?.result?.devices)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_INVALID',
      'devicectl JSON did not contain result.devices',
    );
  }
  return Object.freeze(parsed.result.devices
    .filter((entry) => (
      entry?.hardwareProperties?.reality === 'physical'
      && String(entry?.hardwareProperties?.platform ?? '').toLowerCase() === 'ios'
    ))
    .map((entry) => {
      const transportType = String(entry?.connectionProperties?.transportType ?? 'unknown');
      const paired = entry?.connectionProperties?.pairingState === 'paired';
      const tunnelState = String(entry?.connectionProperties?.tunnelState ?? 'unknown');
      const deviceClass = /^(?:wired|usb)$/iu.test(transportType) ? 'usb' : 'network';
      const available = paired
        && deviceClass === 'usb'
        && !/^(?:disconnected|unavailable)$/iu.test(tunnelState);
      return Object.freeze({
        serial: entry?.hardwareProperties?.udid ?? entry?.identifier ?? null,
        hardwareSerial: entry?.hardwareProperties?.serialNumber ?? null,
        name: entry?.deviceProperties?.name ?? null,
        class: deviceClass,
        state: paired ? (available ? 'device' : 'unavailable') : 'unpaired',
        transportType,
        tunnelState,
      });
    })
    .filter((device) => typeof device.serial === 'string' && device.serial.length > 0));
}

export function enumerateIosDevices({
  xcrunBinary = 'xcrun',
  run = spawnSync,
  env = process.env,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-expo-devicectl-'));
  const output = join(scratch, 'devices.json');
  try {
    const result = run(xcrunBinary, [
      'devicectl', 'list', 'devices', '--json-output', output, '--quiet',
    ], { encoding: 'utf8', env, timeout: 30_000 });
    if (result?.error || result?.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_EXPO_IOS_DEVICE_INVENTORY_FAILED',
        'xcrun devicectl could not enumerate iOS devices',
        commandResultDetails(result),
      );
    }
    return parseDevicectlDeviceInventory(readFileSync(output, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function selectIosUsbDevice(devices, { udid } = {}) {
  const inventory = Array.isArray(devices) ? devices : [];
  const selected = inventory.find((device) => (
    device.serial === udid || device.hardwareSerial === udid
  ));
  if (!selected) {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_NOT_FOUND',
      `devicectl did not report the requested iOS device ${udid}`,
      { udid, devices: publicDeviceInventory(inventory) },
    );
  }
  if (selected.class !== 'usb') {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_NETWORK_DEVICE_REFUSED',
      'the selected iOS device is reachable through a network transport, not USB',
      {
        serial: selected.serial,
        class: selected.class,
        transportType: selected.transportType,
        reason: 'network-reachability-requires-llp-0168-carrier-review',
      },
    );
  }
  if (selected.state !== 'device') {
    throw diagnosticError(
      'SNAPBACK_EXPO_IOS_DEVICE_UNAVAILABLE',
      'the selected iOS USB device is not paired and connected',
      { serial: selected.serial, state: selected.state, tunnelState: selected.tunnelState },
    );
  }
  return Object.freeze({ serial: selected.serial, class: 'usb' });
}

export function inspectIosForwardingTools({
  xcrunBinary = 'xcrun',
  iproxyBinary = 'iproxy',
  run = spawnSync,
  env = process.env,
} = {}) {
  const version = run(xcrunBinary, ['devicectl', '--version'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  const help = run(xcrunBinary, ['devicectl', 'help', 'device'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  const iproxy = run(iproxyBinary, ['--help'], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  return Object.freeze({
    devicectl: Object.freeze({
      available: !version?.error && version?.status === 0,
      version: version?.status === 0 ? String(version.stdout ?? '').trim() : null,
      supportsTcpForward: help?.status === 0
        && /\b(?:forward|port-forward|reverse)\b/iu.test(String(help.stdout ?? '')),
    }),
    iproxy: Object.freeze({
      available: !iproxy?.error && iproxy?.status === 0,
      direction: 'host-loopback-to-ios-service',
      supportsRequiredReverseDirection: false,
    }),
    requiredDirection: 'ios-device-loopback-to-host-loopback',
  });
}

export function refuseUnsupportedIosUsbForwarding(device, options = {}) {
  const tools = options.tools ?? inspectIosForwardingTools(options);
  throw diagnosticError(
    'SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE',
    'neither devicectl nor iproxy can forward iOS device loopback to host loopback',
    {
      device,
      tools,
      reason: 'devicectl-has-no-tcp-forward-and-iproxy-is-host-to-device-only',
      recovery: 'use the iOS simulator; a physical iOS carrier needs a device-side bridge or a separately accepted posture',
    },
  );
}

// @ref LLP 0181#web-browser — same-host Expo carriers consume the supervisor's
// resolved loopback origins; application code never supplies one.
// @ref LLP 0181#android-emulator — adb reverse is the preferred Android route
// and maps all three supervised ports to loopback from the app's perspective.
export function createExpoRoutingPlan({
  platform = 'ios',
  backendPort,
  metroPort,
  bootstrapPort,
  androidTransport = 'adb-reverse',
  androidSerial = null,
  androidDeviceClass = null,
} = {}) {
  const ports = Object.freeze([
    Object.freeze({ owner: 'backend', devicePort: backendPort, hostPort: backendPort }),
    Object.freeze({ owner: 'metro', devicePort: metroPort, hostPort: metroPort }),
    Object.freeze({ owner: 'bootstrap', devicePort: bootstrapPort, hostPort: bootstrapPort }),
  ]);
  if (ports.some(({ hostPort }) => !Number.isSafeInteger(hostPort) || hostPort < 1)) {
    throw diagnosticError('SNAPBACK_EXPO_ROUTE_INVALID', 'every supervised route needs a valid port');
  }
  if (platform === 'ios' || platform === 'web') {
    return Object.freeze({
      platform,
      transport: 'same-host-loopback',
      bindingRouting: 'loopback',
      appHost: LOOPBACK_HOST,
      ports,
      forwards: Object.freeze([]),
      fallback: null,
      device: Object.freeze({
        serial: null,
        class: platform === 'web' ? 'browser' : 'simulator',
      }),
    });
  }
  if (platform !== 'android') {
    throw diagnosticError(
      'SNAPBACK_EXPO_DEVICE_UNSUPPORTED',
      'supervised Expo development supports only iOS, Android, and web',
      { platform },
    );
  }
  if (androidTransport === 'emulator-host-alias') {
    return Object.freeze({
      platform,
      transport: 'emulator-host-alias',
      bindingRouting: 'port-forward',
      appHost: '10.0.2.2',
      ports,
      forwards: Object.freeze([]),
      fallback: Object.freeze({ host: '10.0.2.2', requiresAdbReverse: false }),
      device: Object.freeze({
        serial: androidSerial,
        class: androidDeviceClass ?? 'emulator',
      }),
    });
  }
  if (androidTransport !== 'adb-reverse') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ROUTE_INVALID',
      'Android transport must be adb-reverse or emulator-host-alias.',
      { androidTransport },
    );
  }
  if (typeof androidSerial !== 'string' || androidSerial.length === 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_REQUIRED',
      'adb reverse requires one enumerated emulator or USB device serial',
    );
  }
  return Object.freeze({
    platform,
    transport: 'adb-reverse',
    bindingRouting: 'port-forward',
    appHost: LOOPBACK_HOST,
    ports,
    forwards: Object.freeze(ports.map(({ owner, devicePort, hostPort }) => Object.freeze({
      owner,
      device: `tcp:${devicePort}`,
      host: `tcp:${hostPort}`,
    }))),
    fallback: Object.freeze({ host: '10.0.2.2', requiresAdbReverse: false }),
    androidSerial,
    device: Object.freeze({
      serial: androidSerial,
      class: androidDeviceClass ?? (/^emulator-\d+$/u.test(androidSerial) ? 'emulator' : 'usb'),
    }),
  });
}

export function createExpoRoutingReadiness(route) {
  return Object.freeze({
    platform: route.platform,
    device: Object.freeze({
      serial: route.device?.serial ?? null,
      class: route.device?.class ?? null,
    }),
    route: Object.freeze({
      transport: route.transport,
      bindingRouting: route.bindingRouting,
      appHost: route.appHost,
      fallback: route.fallback,
    }),
  });
}

export function installAndroidPortForwarding(plan, {
  adbBinary = 'adb',
  run = spawnSync,
  env = process.env,
} = {}) {
  if (plan?.platform !== 'android' || plan.transport !== 'adb-reverse') {
    return Object.freeze({ installed: Object.freeze([]), remove() {} });
  }
  if (typeof plan.androidSerial !== 'string' || plan.androidSerial.length === 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_DEVICE_REQUIRED',
      'adb reverse ownership requires an exact selected device serial',
    );
  }
  const prefix = ['-s', plan.androidSerial];
  const installed = [];
  const invoke = (args) => run(adbBinary, [...prefix, ...args], {
    encoding: 'utf8', env, timeout: 15_000,
  });
  try {
    for (const forward of plan.forwards) {
      const result = invoke(['reverse', forward.device, forward.host]);
      if (result.error || result.status !== 0) {
        throw diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
          `adb reverse failed for ${forward.owner}`,
          { owner: forward.owner, status: result.status, signal: result.signal },
        );
      }
      installed.push(forward);
    }
    const listed = invoke(['reverse', '--list']);
    if (listed.error || listed.status !== 0) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
        'adb reverse rules could not be verified',
        { status: listed.status, signal: listed.signal },
      );
    }
    const reported = String(listed.stdout ?? '').split('\n').map((line) => {
      const fields = line.trim().split(/\s+/u).filter(Boolean);
      if (fields.length < 2) return null;
      // `adb -s <serial> reverse --list` is already selected-device scoped.
      // Current adb can label each three-column row with a transport token
      // such as `host-16` instead of echoing the user-facing device serial.
      // @ref LLP 0176#g4--external-distribution-proof — public-package Android
      // proof must verify real reverse rules without confusing transport ids
      // for the selected emulator/device identity.
      return fields.length >= 3
        ? {
            serial: plan.androidSerial,
            transport: fields[0],
            device: fields.at(-2),
            host: fields.at(-1),
          }
        : { serial: plan.androidSerial, device: fields[0], host: fields[1] };
    }).filter(Boolean);
    for (const forward of installed) {
      if (!reported.some((rule) => (
        rule.serial === plan.androidSerial
        && rule.device === forward.device
        && rule.host === forward.host
      ))) {
        throw diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_FAILED',
          `adb did not report the installed ${forward.owner} reverse rule`,
          {
            owner: forward.owner,
            serial: plan.androidSerial,
            device: forward.device,
            host: forward.host,
          },
        );
      }
    }
  } catch (error) {
    const removalFailures = [];
    for (const forward of installed.reverse()) {
      const result = invoke(['reverse', '--remove', forward.device]);
      if (result.error || result.status !== 0) {
        removalFailures.push(diagnosticError(
          'SNAPBACK_EXPO_ADB_REVERSE_REMOVE_FAILED',
          `adb reverse rollback failed for ${forward.owner}`,
          { owner: forward.owner, status: result.status, signal: result.signal },
        ));
      }
    }
    if (removalFailures.length > 0) {
      throw new AggregateError(
        [error, ...removalFailures],
        'Android port-forward setup and rollback failed',
      );
    }
    throw error;
  }
  let removed = false;
  return Object.freeze({
    installed: Object.freeze([...installed]),
    remove() {
      if (removed) return;
      removed = true;
      const failures = [];
      for (const forward of [...installed].reverse()) {
        const result = invoke(['reverse', '--remove', forward.device]);
        if (result.error || result.status !== 0) {
          failures.push(diagnosticError(
            'SNAPBACK_EXPO_ADB_REVERSE_REMOVE_FAILED',
            `adb reverse removal failed for ${forward.owner}`,
            { owner: forward.owner, status: result.status, signal: result.signal },
          ));
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Android port-forward cleanup failed');
    },
  });
}

// @ref LLP 0262#d2-carriers-per-shipped-topology — checkout nonces travel
// only in native process-launch custody: simctl child environment for iOS and
// one selected serial's Activity extras for Android. The non-secret Metro
// development-client URL rides the same iOS launch argument (avoiding the
// iOS 26 confirmation imposed on `simctl openurl`) or a subsequent Android
// intent. This helper has no web arm and never receives the dev-identity
// capability itself.
export function launchExpoNativeCheckout(plan, nonce, {
  xcrunBinary = 'xcrun',
  adbBinary = 'adb',
  iosSimulator = 'booted',
  iosBundleIdentifier = null,
  androidComponent = null,
  expoAppScheme = null,
  run = spawnSync,
  env = process.env,
} = {}) {
  if (plan?.platform === 'web' || typeof nonce !== 'string' || nonce.length === 0) return null;
  if (typeof expoAppScheme !== 'string' || !EXPO_APP_SCHEME_PATTERN.test(expoAppScheme)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
      'native checkout requires the application development client URL scheme',
      { platform: plan?.platform ?? null },
    );
  }
  const metroPort = plan?.ports?.find((port) => port.owner === 'metro')?.devicePort;
  if (!Number.isSafeInteger(metroPort) || metroPort < 1) {
    throw diagnosticError(
      'SNAPBACK_EXPO_ROUTE_INVALID',
      'native checkout requires a valid Metro route',
    );
  }
  const metroOrigin = appOrigin(plan.appHost, metroPort);
  const developmentClientUrl = `${expoAppScheme}://expo-development-client/?url=${encodeURIComponent(metroOrigin)}`;
  let result;
  let carrier;
  if (plan?.platform === 'ios' && plan.device?.class === 'simulator') {
    if (
      typeof iosBundleIdentifier !== 'string'
      || iosBundleIdentifier.length === 0
      || iosBundleIdentifier === EXPO_GO_IOS_BUNDLE_IDENTIFIER
    ) {
      throw diagnosticError(
        'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
        'native checkout requires the application development client iOS bundle identifier',
        { platform: 'ios' },
      );
    }
    carrier = 'ios-simctl-environment';
    result = run(xcrunBinary, [
      'simctl',
      'launch',
      '--terminate-running-process',
      iosSimulator,
      iosBundleIdentifier,
      '--initialUrl',
      developmentClientUrl,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...(env ?? {}),
        [`SIMCTL_CHILD_${SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV}`]: nonce,
      },
    });
  } else if (plan?.platform === 'android' && plan.transport === 'adb-reverse') {
    if (typeof plan.androidSerial !== 'string' || plan.androidSerial.length === 0) {
      throw diagnosticError(
        'SNAPBACK_EXPO_ANDROID_DEVICE_REQUIRED',
        'native checkout launch requires the exact adb-reversed serial',
      );
    }
    if (
      typeof androidComponent !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_.]*\/[A-Za-z0-9_.$]+$/u.test(androidComponent)
      || androidComponent.startsWith(EXPO_GO_ANDROID_COMPONENT_PREFIX)
    ) {
      throw diagnosticError(
        'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
        'native checkout requires the application development client Android component',
        { platform: 'android' },
      );
    }
    carrier = 'android-adb-activity-extra';
    result = run(adbBinary, [
      '-s',
      plan.androidSerial,
      'shell',
      'am',
      'start',
      '-S',
      // Wait for the forced restart to reach the Activity before delivering
      // the development-client URL. Without `-W`, Android can accept both
      // commands but discard the second intent while the process is starting.
      '-W',
      '-n',
      androidComponent,
      '--es',
      SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
      nonce,
    ], { encoding: 'utf8', timeout: 30_000, env });
  } else {
    return null;
  }
  if (result?.error || result?.status !== 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_NATIVE_LAUNCH_FAILED',
      'the selected native Expo target could not be launched with its one-shot checkout',
      {
        platform: plan.platform,
        device: plan.device ?? null,
        carrier,
        phase: 'own-bundle-checkout-launch',
        ...commandResultDetails(result),
      },
    );
  }
  const openResult = plan.platform === 'android'
    ? run(adbBinary, [
      '-s',
      plan.androidSerial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      developmentClientUrl,
    ], { encoding: 'utf8', timeout: 30_000, env })
    : null;
  if (openResult !== null && (openResult.error || openResult.status !== 0)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_NATIVE_LAUNCH_FAILED',
      'the selected native Expo target could not open the supervised Metro development-client URL',
      {
        platform: plan.platform,
        device: plan.device ?? null,
        carrier,
        phase: 'metro-development-client-url',
        ...commandResultDetails(openResult),
      },
    );
  }
  return Object.freeze({
    platform: plan.platform,
    device: plan.device,
    carrier,
    developmentClientUrl,
  });
}

// @ref LLP 0262#d2-carriers-per-shipped-topology — ordinary supervised
// sessions remain unconditional. Checkout issuance requires an explicit
// opt-in/test runner and an application-owned development-client target;
// Expo Go cannot host the first-party native reader and therefore refuses
// before a nonce is issued.
export function shouldLaunchExpoNativeCheckout(plan, {
  nativeCheckout = false,
  nativeLaunchRun,
  iosBundleIdentifier = null,
  androidComponent = null,
  expoAppScheme = null,
} = {}) {
  const nativeTarget = plan?.platform === 'ios'
    || (plan?.platform === 'android' && plan?.transport === 'adb-reverse');
  if (!nativeTarget || (nativeCheckout !== true && typeof nativeLaunchRun !== 'function')) {
    return false;
  }
  if (plan.platform === 'ios') {
    if (
      typeof iosBundleIdentifier !== 'string'
      || iosBundleIdentifier.length === 0
      || iosBundleIdentifier === EXPO_GO_IOS_BUNDLE_IDENTIFIER
    ) {
      throw diagnosticError(
        'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
        'native checkout requires the application development client iOS bundle identifier',
        { platform: 'ios' },
      );
    }
  } else if (
    typeof androidComponent !== 'string'
    || !/^[A-Za-z][A-Za-z0-9_.]*\/[A-Za-z0-9_.$]+$/u.test(androidComponent)
    || androidComponent.startsWith(EXPO_GO_ANDROID_COMPONENT_PREFIX)
  ) {
    throw diagnosticError(
      'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
      'native checkout requires the application development client Android component',
      { platform: 'android' },
    );
  }
  if (typeof expoAppScheme !== 'string' || !EXPO_APP_SCHEME_PATTERN.test(expoAppScheme)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
      'native checkout requires the application development client URL scheme',
      { platform: plan.platform },
    );
  }
  return true;
}

function processTable() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'the supervisor could not enumerate its process tree',
    );
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

export function startExpoSupervisorParentLease({
  env = process.env,
  onLost,
  intervalMs = 200,
} = {}) {
  const rawPid = env?.[SUPERVISOR_PARENT_PID_ENV];
  const startTime = env?.[SUPERVISOR_PARENT_START_TIME_ENV];
  if (rawPid === undefined && startTime === undefined) return null;
  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid < 1
      || typeof startTime !== 'string' || startTime.length === 0) {
    throw diagnosticError(
      'SNAPBACK_EXPO_SUPERVISOR_PARENT_LEASE_INVALID',
      'the Expo supervisor parent lease is incomplete or malformed',
    );
  }
  const initial = processTable();
  const parent = processIdentity(pid, initial);
  const self = processIdentity(process.pid, initial);
  if (parent?.startTime !== startTime || self?.ppid !== pid) {
    throw diagnosticError(
      'SNAPBACK_EXPO_SUPERVISOR_PARENT_LEASE_INVALID',
      'the Expo supervisor parent lease does not identify its live parent process',
      { pid },
    );
  }
  let closed = false;
  let reported = false;
  const timer = setInterval(() => {
    if (closed || reported) return;
    let live = null;
    let currentSelf = null;
    try {
      const inventory = processTable();
      live = processIdentity(pid, inventory);
      currentSelf = processIdentity(process.pid, inventory);
    } catch {
      // A transient inventory failure cannot prove parent death. The next
      // bounded poll retries without widening ownership.
      return;
    }
    if (live?.startTime === startTime && currentSelf?.ppid === pid) return;
    reported = true;
    onLost?.(diagnosticError(
      'SNAPBACK_EXPO_SUPERVISOR_PARENT_LOST',
      'the Expo supervisor carrier parent exited; reclaiming supervised resources',
      { pid },
    ));
  }, intervalMs);
  timer.unref?.();
  return Object.freeze({
    pid,
    startTime,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
    },
  });
}

function descendants(rootPid, table) {
  const found = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { pid, ppid } of table) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        changed = true;
      }
    }
  }
  return found;
}

function listenerAddress(name) {
  const trimmed = name.replace(/\s+\(LISTEN\)$/u, '');
  if (trimmed.startsWith('[')) {
    const closing = trimmed.lastIndexOf(']:');
    if (closing === -1) return null;
    return { host: trimmed.slice(1, closing), port: Number(trimmed.slice(closing + 2)) };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) return null;
  return { host: trimmed.slice(0, colon), port: Number(trimmed.slice(colon + 1)) };
}

function parseLsofListeners(stdout) {
  const listeners = [];
  let pid = null;
  let command = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c')) command = line.slice(1);
    else if (line.startsWith('n') && Number.isInteger(pid)) {
      const address = listenerAddress(line.slice(1));
      if (address && Number.isInteger(address.port)) listeners.push({ pid, command, ...address });
    }
  }
  return listeners;
}

function lsofBinary() {
  for (const path of ['/usr/sbin/lsof', '/usr/bin/lsof']) if (existsSync(path)) return path;
  return null;
}

export function describePortHolder(port) {
  const binary = lsofBinary();
  if (binary === null) return null;
  try {
    const result = spawnSync(binary, [
      '-nP', `-i4TCP:${port}`, '-sTCP:LISTEN', '-Fpcn',
    ], { encoding: 'utf8', timeout: 10_000 });
    if (result.error || ![0, 1].includes(result.status)) return null;
    const holder = parseLsofListeners(result.stdout)
      .find((listener) => (
        listener.port === port
        && (
          listener.host === '127.0.0.1'
          || listener.host === '0.0.0.0'
          || listener.host === '*'
        )
      ));
    return holder === undefined
      ? null
      : Object.freeze({ pid: holder.pid, command: holder.command ?? null });
  } catch {
    return null;
  }
}

function unavailablePortError(owner, port) {
  // @ref LLP 0299#3-pins-are-strict — a supervisor-owned pin is a strict,
  // non-adopting contract; lsof identifies the holder without authorizing a
  // signal or fallback allocation.
  const recoveryByOwner = {
    client: `stop or reconfigure the process holding ${LOOPBACK_HOST}:${port}, or choose a different --client-port`,
    bootstrap: `stop or reconfigure the process holding ${LOOPBACK_HOST}:${port}, or choose a different --bootstrap-port`,
    metro: `stop or reconfigure the process holding ${LOOPBACK_HOST}:${port}, or choose a different --port-range (metro has no pin flag)`,
  };
  return diagnosticError(
    'SNAPBACK_DEV_PORT_UNAVAILABLE',
    `the pinned ${owner} listener port ${port} is unavailable on ${LOOPBACK_HOST}`,
    {
      owner,
      host: LOOPBACK_HOST,
      port,
      holder: describePortHolder(port),
      recovery: recoveryByOwner[owner],
    },
  );
}

function exhaustedPortRangeError(owner, range, observedPorts) {
  const holders = [...observedPorts]
    .sort((left, right) => right - left)
    .map((port) => {
      const holder = describePortHolder(port);
      return holder === null ? Object.freeze({ port, pid: null, command: null }) : Object.freeze({
        port,
        pid: holder.pid,
        command: holder.command,
      });
    });
  return diagnosticError(
    'SNAPBACK_DEV_PORT_RANGE_EXHAUSTED',
    `the ${owner} listener could not find a free port in ${range.lo}-${range.hi}`,
    { owner, range: { lo: range.lo, hi: range.hi }, holders },
  );
}

async function holdLoopbackPort(port) {
  const server = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, LOOPBACK_HOST, resolveListen);
  });
  return Object.freeze({
    port,
    async close() {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  });
}

function idempotentReservation(reservation) {
  let closePromise = null;
  const descriptors = Object.getOwnPropertyDescriptors(reservation);
  delete descriptors.close;
  const wrapped = Object.defineProperties({}, descriptors);
  Object.defineProperty(wrapped, 'close', {
    enumerable: true,
    value() {
      if (closePromise === null) closePromise = Promise.resolve().then(() => reservation.close());
      return closePromise;
    },
  });
  return Object.freeze(wrapped);
}

async function allocateSupervisorPortCandidates(
  plan,
  excluded = new Set(),
  {
    platform = 'web',
    bindOwner = async (_owner, port) => holdLoopbackPort(port),
    onReservation = () => {},
    afterOwnerBound = null,
  } = {},
) {
  const assigned = {};
  const reservations = {};
  const pinnedPorts = new Set(
    plan.owners.filter(({ source }) => source === 'pinned').map(({ port }) => port),
  );
  const supervisorOwners = ['client', 'bootstrap', 'metro']
    .map((owner) => devPortPlanOwner(plan, owner))
    .filter((entry) => entry !== null);
  const used = new Set(pinnedPorts);
  const close = async () => {
    const failures = [];
    for (const owner of [...supervisorOwners].reverse().map(({ owner }) => owner)) {
      try { await reservations[owner]?.close?.(); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'planned supervisor listener cleanup failed');
    }
  };
  try {
    // @ref LLP 0299#2-default-posture-stable-deterministic-collision-tolerant —
    // the owner order and descending scan are deliberate: the backend keeps
    // ascending from 4287 while client/bootstrap/metro descend from the top.
    for (const entry of supervisorOwners) {
      const occupied = new Set(excluded);
      const candidates = entry.source === 'pinned'
        ? [entry.port]
        : Array.from(
            { length: plan.range.hi - plan.range.lo + 1 },
            (_unused, offset) => plan.range.hi - offset,
          );
      let selected = null;
      for (const port of candidates) {
        if (entry.source !== 'pinned' && (used.has(port) || excluded.has(port))) continue;
        try {
          const reservation = idempotentReservation(await bindOwner(entry.owner, port, { platform }));
          assigned[entry.owner] = port;
          reservations[entry.owner] = reservation;
          used.add(port);
          onReservation(entry.owner, reservation);
          await afterOwnerBound?.(entry.owner, port, reservation);
          selected = port;
          break;
        } catch (error) {
          if (error?.code !== 'EADDRINUSE') throw error;
          if (entry.source === 'pinned') throw unavailablePortError(entry.owner, port);
          occupied.add(port);
        }
      }
      if (selected === null) {
        throw exhaustedPortRangeError(entry.owner, plan.range, occupied);
      }
    }
    return Object.freeze({
      assigned: Object.freeze(assigned),
      reservations: Object.freeze(reservations),
      close,
    });
  } catch (error) {
    try { await close(); } catch { /* allocation error wins */ }
    throw error;
  }
}

// Enumerate, rather than merely restate configuration: the backend process
// tree, Metro process tree, and supervisor exchange socket are joined to the
// OS listener table and every observed address must be loopback.
// @ref LLP 0181#physical-device-lan-relay-separately-gated — a wildcard/LAN
// Metro listener is the same forbidden front even when the backend is local.
export function enumerateExpoOwnedListeners({
  backendPid,
  metroPid,
  supervisorPid = process.pid,
  webFrontPort = null,
}) {
  const binary = lsofBinary();
  if (binary === null) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'lsof is required to verify every supervised listener before readiness',
    );
  }
  const table = processTable();
  const backend = descendants(backendPid, table);
  const metro = descendants(metroPid, table);
  const pids = new Set([supervisorPid, ...backend, ...metro]);
  const result = spawnSync(binary, [
    '-nP', '-a', '-p', [...pids].join(','), '-iTCP', '-sTCP:LISTEN', '-Fpcn',
  ], { encoding: 'utf8', timeout: 10_000 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw diagnosticError(
      'SNAPBACK_EXPO_LISTENER_ENUMERATION_UNAVAILABLE',
      'lsof could not inspect the supervised process listeners',
      { status: result.status, signal: result.signal },
    );
  }
  return Object.freeze(parseLsofListeners(result.stdout).map((listener) => {
    const owner = listener.pid === supervisorPid
      ? listener.port === webFrontPort ? 'metro-front' : 'bootstrap'
      : backend.has(listener.pid)
        ? 'backend'
        : 'metro';
    return Object.freeze({
      owner,
      pid: listener.pid,
      command: listener.command,
      host: listener.host,
      port: listener.port,
      loopback: isLoopbackHost(listener.host),
      startTime: processIdentity(listener.pid, table)?.startTime ?? null,
    });
  }));
}

async function waitForListenerInventory({
  backendPid,
  metroPid,
  expected,
  metroProcess,
  webFrontPort = null,
  timeoutMs = 30_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    if (metroProcess.exitCode !== null || metroProcess.signalCode !== null) {
      throw diagnosticError(
        'SNAPBACK_EXPO_METRO_EXITED',
        'Expo/Metro exited before its listeners were admitted',
        { status: metroProcess.exitCode, signal: metroProcess.signalCode },
      );
    }
    last = enumerateExpoOwnedListeners({ backendPid, metroPid, webFrontPort });
    const complete = expected.every(({ owner, port }) => (
      last.some((listener) => listener.owner === owner && listener.port === port)
    ));
    if (complete) {
      const exposed = last.filter((listener) => !listener.loopback);
      if (exposed.length > 0) {
        throw diagnosticError(
          'SNAPBACK_EXPO_LISTENER_EXPOSED',
          'a supervised listener is reachable beyond loopback',
          { listeners: exposed },
        );
      }
      return last;
    }
    await delay(75);
  }
  throw diagnosticError(
    'SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE',
    'the supervisor could not enumerate every expected backend, Metro, front, and bootstrap listener',
    { expected, observed: last },
  );
}

export async function startBootstrapExchange(
  getPayload,
  {
    admittedAuthorityOrigins = [],
    onControl,
    onDevIdentityCheckout,
    onSharedAuth,
    port = 0,
  } = {},
) {
  const sockets = new Set();
  const currentAuthorityOrigins = () => {
    const resolved = typeof admittedAuthorityOrigins === 'function'
      ? admittedAuthorityOrigins()
      : admittedAuthorityOrigins;
    return new Set(resolved ?? []);
  };
  const handleRequest = async (request, response) => {
    // @ref LLP 0151#shared-development-browser-adapter — the shared development
    // broker is mounted on the origin the client already discovers, so a new app
    // needs no second terminal and no broker origin to configure. These routes
    // are checked before the bootstrap CORS projection is applied, because the
    // JSON routes are app-facing and the HTML route is same-origin by
    // construction.
    if (typeof onSharedAuth === 'function' && (request.url ?? '/').startsWith('/v1/shared/')) {
      const url = new URL(request.url, 'http://supervisor.local');
      if (await onSharedAuth(request, response, url)) return;
    }
    const requestUrl = new URL(request.url ?? '/', 'http://supervisor.local');
    const authorityRequest = requestUrl.searchParams.get('authority');
    const validAuthorityRequest = requestUrl.search === ''
      || (authorityRequest === SUPERVISED_AUTHORITY_REQUEST
        && [...requestUrl.searchParams.keys()].length === 1);
    const admittedOrigin = admittedBrowserExchangeOrigin(request.headers.origin);
    const authorityOriginAdmitted = admittedOrigin !== null
      && currentAuthorityOrigins().has(admittedOrigin);
    const authorityOriginAbsent = request.headers.origin === undefined;
    response.setHeader('cache-control', 'no-store, max-age=0');
    response.setHeader('pragma', 'no-cache');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-type', 'application/json; charset=utf-8');

    // @ref LLP 0176#security-claims-follow-reachability — loopback-only origin
    // admission, matching src/server.rs local_dev_cors, remains the security
    // boundary; only the exchange's response headers widen.
    if (
      admittedOrigin !== null
      && (authorityRequest !== SUPERVISED_AUTHORITY_REQUEST || authorityOriginAdmitted)
    ) {
      response.setHeader('access-control-allow-origin', admittedOrigin);
      response.setHeader('vary', 'Origin');
      response.setHeader(
        'access-control-allow-methods',
        authorityRequest === SUPERVISED_AUTHORITY_REQUEST ? 'POST, OPTIONS' : 'GET, OPTIONS',
      );
      response.setHeader(
        'access-control-allow-headers',
        authorityRequest === SUPERVISED_AUTHORITY_REQUEST ? 'accept, content-type' : 'accept',
      );
    }
    if (
      request.method === 'OPTIONS'
      && requestUrl.pathname === SUPERVISED_EXCHANGE_PATH
      && validAuthorityRequest
    ) {
      if (authorityRequest === SUPERVISED_AUTHORITY_REQUEST && !authorityOriginAdmitted) {
        response.statusCode = 403;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        }));
        return;
      }
      response.setHeader('access-control-max-age', '600');
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'POST' && request.url === SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH) {
      // This route is native-app-facing, never browser-facing. Remove the
      // bootstrap GET's permissive loopback CORS projection and reject any
      // browser-originated attempt before considering its nonce.
      response.removeHeader('access-control-allow-origin');
      response.removeHeader('access-control-allow-methods');
      response.removeHeader('access-control-allow-headers');
      response.removeHeader('access-control-max-age');
      response.removeHeader('vary');
      let capability = null;
      if (request.headers.origin === undefined && typeof onDevIdentityCheckout === 'function') {
        try {
          capability = await onDevIdentityCheckout(
            request.headers[SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER],
          );
        } catch {
          capability = null;
        }
      }
      if (typeof capability !== 'string' || !capability.startsWith('sbdev_')) {
        response.statusCode = 403;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_DEV_IDENTITY_REFUSED' }));
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, devIdentityCapability: capability }));
      return;
    }
    if (
      request.method === 'POST'
      && requestUrl.pathname === SUPERVISED_EXCHANGE_PATH
      && authorityRequest === SUPERVISED_AUTHORITY_REQUEST
      && validAuthorityRequest
    ) {
      // @ref LLP 0310.000#track-b--the-mint-is-on-demand-and-gives-the-form-back — the native
      // exception requires a truly missing Origin plus application/json, which
      // makes browser fetch preflight; the existing OPTIONS arm refuses an
      // opaque or unadmitted browser origin. The unguessable, timing-safe
      // per-boot correlation capability remains required before minting.
      if (!authorityOriginAdmitted && !authorityOriginAbsent) {
        response.statusCode = 403;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        }));
        return;
      }
      if (request.headers['content-type'] !== 'application/json') {
        response.statusCode = 415;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        }));
        return;
      }
      let body;
      try {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > BOOTSTRAP_BODY_LIMIT_BYTES) {
            oversized = true;
            continue;
          }
          chunks.push(chunk);
        }
        if (oversized) throw new SyntaxError('authority adoption body exceeded the size limit');
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
          body === null
          || typeof body !== 'object'
          || Array.isArray(body)
          || Object.keys(body).length !== 1
          || typeof body.correlationId !== 'string'
          || body.correlationId.length === 0
        ) throw new SyntaxError('authority adoption body must carry only correlationId');
      } catch {
        response.statusCode = 403;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        }));
        return;
      }
      let bootstrapPayload;
      try {
        bootstrapPayload = await getPayload(Object.freeze({ requestAuthority: false }));
      } catch {
        bootstrapPayload = null;
      }
      if (
        bootstrapPayload === null
        || !constantTimeTokenEqual(body.correlationId, bootstrapPayload.correlationId)
      ) {
        response.statusCode = 403;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        }));
        return;
      }
      let payload;
      try {
        payload = await getPayload(Object.freeze({ requestAuthority: true }));
      } catch {
        payload = null;
      }
      if (payload === null) {
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify(payload));
      return;
    }
    if (request.method === 'POST' && request.url === SUPERVISED_CONTROL_PATH) {
      // This route is owner-process-facing, never browser-facing. Remove the
      // bootstrap GET's loopback CORS projection before every control
      // response, including authentication and route-availability refusals.
      response.removeHeader('access-control-allow-origin');
      response.removeHeader('access-control-allow-methods');
      response.removeHeader('access-control-allow-headers');
      response.removeHeader('access-control-max-age');
      response.removeHeader('vary');
      if (typeof onControl !== 'function') {
        response.statusCode = 404;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND' }));
        return;
      }
      let body;
      try {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > CONTROL_BODY_LIMIT_BYTES) {
            oversized = true;
            continue;
          }
          chunks.push(chunk);
        }
        if (oversized) throw new SyntaxError('control request body exceeded the size limit');
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new SyntaxError('control request body must be a JSON object');
        }
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({
          ok: false,
          code: 'SNAPBACK_EXPO_CONTROL_BODY_INVALID',
        }));
        return;
      }
      try {
        const result = await onControl({
          operatorToken: request.headers['x-snapback-operator-token'],
          body,
        });
        response.statusCode = result?.statusCode ?? 500;
        const encodedBody = JSON.stringify(result?.body ?? {
          ok: false,
          code: 'SNAPBACK_EXPO_CONTROL_FAILED',
        });
        if (typeof result?.afterResponse !== 'function') {
          response.end(encodedBody);
        } else {
          let afterResponseStarted = false;
          const startAfterResponse = () => {
            if (afterResponseStarted) return;
            afterResponseStarted = true;
            void Promise.resolve().then(() => result.afterResponse()).catch(() => {});
          };
          // A destructive control action starts only once the response has
          // flushed, or once a disconnected caller can no longer receive it.
          // This keeps the serving bootstrap listener alive through delivery
          // without letting a reset peer cancel already-admitted work.
          response.once('finish', startAfterResponse);
          response.once('close', startAfterResponse);
          response.end(encodedBody);
          if (response.destroyed || response.closed) startAfterResponse();
        }
      } catch {
        response.statusCode = 500;
        response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_CONTROL_FAILED' }));
      }
      return;
    }
    if (
      request.method !== 'GET'
      || requestUrl.pathname !== SUPERVISED_EXCHANGE_PATH
      || requestUrl.search !== ''
    ) {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_ROUTE_NOT_FOUND' }));
      return;
    }
    let payload;
    try {
      payload = await getPayload(Object.freeze({
        requestAuthority: false,
      }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
      return;
    }
    if (payload === null) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
      return;
    }
    response.statusCode = 200;
    response.end(JSON.stringify(payload));
  };
  const server = createHttpServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (response.writableEnded) return;
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' }));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, LOOPBACK_HOST, resolveListen);
  });
  const address = server.address();
  return Object.freeze({
    origin: `http://${LOOPBACK_HOST}:${address.port}`,
    port: address.port,
    async close() {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  });
}

export function resolveExpoMetroCommand(command, port, platform = 'ios') {
  if (Array.isArray(command) && command.length > 0) {
    return { executable: command[0], args: command.slice(1), shell: false, display: command.join(' ') };
  }
  if (command && typeof command === 'object' && typeof command.command === 'string') {
    return {
      executable: command.command,
      args: Array.isArray(command.args) ? command.args : [],
      shell: false,
      display: [command.command, ...(command.args ?? [])].join(' '),
    };
  }
  if (typeof command === 'string' && command.trim()) {
    return { executable: command, args: [], shell: true, display: command };
  }
  return {
    executable: 'npx',
    args: [
      '--no-install',
      'expo',
      'start',
      '--localhost',
      '--port',
      String(port),
      ...(platform === 'web' ? ['--web'] : []),
    ],
    shell: false,
    display: `npx --no-install expo start --localhost --port ${port}${platform === 'web' ? ' --web' : ''}`,
  };
}

function metroNodeOptions(nodeOptions) {
  return [String(nodeOptions ?? '').trim(), '--dns-result-order=ipv4first']
    .filter(Boolean)
    .join(' ');
}

function createMetroRunAttestation(platform) {
  if (platform !== 'web') return null;
  const nonce = randomBytes(32).toString('base64url');
  const path = `/_snapback/expo/v1/web-attestation/${randomUUID()}`;
  let consumed = false;
  return Object.freeze({
    path,
    nonce,
    serve(request, response) {
      if (request.method !== 'GET' || request.url !== path) return false;
      response.setHeader('cache-control', 'no-store, max-age=0');
      response.setHeader('pragma', 'no-cache');
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      if (consumed) {
        response.statusCode = 410;
        response.end('attestation already consumed\n');
        return true;
      }
      // Latch before writing any bytes: concurrent requests cannot both
      // consume the same run-bound capability.
      consumed = true;
      response.statusCode = 200;
      response.end(`${nonce}\n`);
      return true;
    },
  });
}

function proxyUpgrade(request, socket, head, upstream) {
  const proxy = createHttpRequest({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: upstream.host },
  });
  proxy.once('upgrade', (response, upstreamSocket, upstreamHead) => {
    const destroyUpstream = () => {
      if (!upstreamSocket.destroyed) upstreamSocket.destroy();
    };
    const destroyClient = () => {
      if (!socket.destroyed) socket.destroy();
    };
    // Once ClientRequest hands off the upgraded socket, it no longer owns
    // errors from that socket. Both halves must absorb reset/error and close
    // the peer so a Metro/HMR restart cannot crash or strand the supervisor.
    socket.once('error', destroyUpstream);
    upstreamSocket.once('error', destroyClient);
    socket.once('close', destroyUpstream);
    upstreamSocket.once('close', destroyClient);
    const headers = Object.entries(response.headers)
      .flatMap(([name, value]) => (Array.isArray(value)
        ? value.map((entry) => `${name}: ${entry}`)
        : value === undefined ? [] : [`${name}: ${value}`]));
    socket.write([
      `HTTP/1.1 ${response.statusCode} ${response.statusMessage ?? 'Switching Protocols'}`,
      ...headers,
      '',
      '',
    ].join('\r\n'));
    if (head.length > 0) upstreamSocket.write(head);
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  proxy.once('response', (response) => {
    socket.end(`HTTP/1.1 ${response.statusCode ?? 502} Bad Gateway\r\nConnection: close\r\n\r\n`);
  });
  proxy.once('error', () => socket.destroy());
  proxy.end();
}

async function startMetroWebFront({ port, upstreamOrigin, attestation }) {
  let currentUpstreamOrigin = upstreamOrigin;
  const sockets = new Set();
  const server = createHttpServer((request, response) => {
    if (attestation.serve(request, response)) return;
    if (currentUpstreamOrigin === null) {
      response.statusCode = 503;
      response.end('supervised Metro is still being allocated\n');
      return;
    }
    const upstream = new URL(currentUpstreamOrigin);
    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableFinished) abort();
    });
    const fail = () => {
      if (controller.signal.aborted || response.destroyed || response.writableEnded) return;
      if (response.headersSent) response.destroy();
      else {
        response.statusCode = 502;
        response.end('supervised Metro unavailable\n');
      }
    };
    const proxy = createHttpRequest({
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: upstream.host },
    }, (upstreamResponse) => {
      if (controller.signal.aborted) {
        upstreamResponse.destroy();
        return;
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      void pipeline(
        upstreamResponse,
        response,
        { signal: controller.signal },
      ).catch((error) => {
        if (error && !controller.signal.aborted && !response.destroyed) response.destroy(error);
      });
    });
    proxy.once('error', fail);
    void pipeline(request, proxy, { signal: controller.signal }).catch((error) => {
      if (error && !controller.signal.aborted) fail();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    if (currentUpstreamOrigin === null) socket.destroy();
    else proxyUpgrade(request, socket, head, new URL(currentUpstreamOrigin));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, LOOPBACK_HOST, resolveListen);
  });
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address !== null ? address.port : port;
  return Object.freeze({
    origin: `http://${LOOPBACK_HOST}:${resolvedPort}`,
    port: resolvedPort,
    get upstreamOrigin() { return currentUpstreamOrigin; },
    setUpstreamOrigin(origin) {
      currentUpstreamOrigin = new URL(origin).origin;
    },
    async close() {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  });
}

// @ref LLP 0151#resolved-provider-entry — the deployment posture the broker
// admits against is supervisor-held. It is read from the supervisor's own
// environment, never from the client bundle or public Expo configuration, and
// `snapback dev` is a development supervisor unless its operator says otherwise.
function expoSharedAuthDeploymentProfile(env) {
  const declared = env?.SNAPBACK_DEV_AUTH_DEPLOYMENT_PROFILE;
  if (typeof declared !== 'string' || declared.length === 0) return 'development';
  const admitted = ['test', 'development', 'preview', 'staging', 'production'];
  if (!admitted.includes(declared)) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      `SNAPBACK_DEV_AUTH_DEPLOYMENT_PROFILE must be one of ${admitted.join(', ')}`,
      { declared },
    );
  }
  return declared;
}

// The mechanical `<ready-file>.impersonation` sibling, and only that path. A
// descriptor naming anything else is a refusal rather than a file read.
//
// The server pins the ready file's real directory before publishing, so the
// advertised sibling comes back symlink-resolved while the caller's own
// ready-file argument may not be — every macOS temporary directory is reached
// through a symlink. Compare what the paths name, the way the admin-token
// carrier already does, rather than how they were spelled.
function readSupervisedImpersonationCapability(descriptor, readyFile) {
  const advertised = descriptor?.impersonationCapabilityFile;
  const expected = canonicalFileCarrierPath(`${resolve(readyFile)}.impersonation`);
  if (typeof advertised !== 'string' || canonicalFileCarrierPath(advertised) !== expected) {
    throw diagnosticError(
      'SNAPBACK_DEV_IMPERSONATION_CAPABILITY_UNAVAILABLE',
      'the readiness descriptor names no mechanical impersonation capability sibling',
      { advertised: advertised ?? null, expected },
    );
  }
  return readFileSync(advertised, 'utf8').trim();
}

async function bindPlannedSupervisorListeners({
  plan,
  platform,
  attestation,
  admittedAuthorityOrigins,
  getBootstrapPayload,
  onControl,
  onDevIdentityCheckout,
  onSharedAuth,
  onReservation,
  afterOwnerBound,
}) {
  // @ref LLP 0299#4-ranges — allocation binds each owner in sequence. The
  // web client front and bootstrap are their real servers; Metro's port (the
  // native client port) is placeholder-held until the child spawn seam.
  const allocation = await allocateSupervisorPortCandidates(plan, new Set(), {
    platform,
    onReservation,
    afterOwnerBound,
    async bindOwner(owner, port) {
      if (owner === 'client' && platform === 'web') {
        return startMetroWebFront({
          port,
          upstreamOrigin: null,
          attestation,
        });
      }
      if (owner === 'bootstrap') {
        return startBootstrapExchange(getBootstrapPayload, {
          admittedAuthorityOrigins,
          onControl,
          onDevIdentityCheckout,
          onSharedAuth,
          port,
        });
      }
      return holdLoopbackPort(port);
    },
  });
  const { assigned, reservations } = allocation;
  const clientPort = assigned.client;
  const metroProcessPort = platform === 'web' ? assigned.metro : clientPort;
  const metroFront = platform === 'web' ? reservations.client : null;
  const bootstrap = reservations.bootstrap;
  const metroPlaceholder = platform === 'web'
    ? reservations.metro
    : reservations.client;
  metroFront?.setUpstreamOrigin(appOrigin(LOOPBACK_HOST, metroProcessPort));
  return Object.freeze({
    assigned,
    clientPort,
    metroProcessPort,
    metroFront,
    bootstrap,
    metroPlaceholder,
    close: allocation.close,
  });
}

function startMetro({
  command,
  directory,
  port,
  platform,
  bootstrapOrigin,
  backendOrigin,
  env,
  emit,
  onExit,
  onStarted,
  cleanupLease = null,
}) {
  const resolved = resolveExpoMetroCommand(command, port, platform);
  const launch = resolved.shell
    ? ['/bin/sh', '-c', resolved.executable]
    : [resolved.executable, ...resolved.args];
  const child = spawnLeasedProcess(launch, {
    cleanupLease,
    label: 'Expo Metro',
    cwd: directory,
    env: expoMetroChildEnvironment({ env, bootstrapOrigin, backendOrigin, port }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  onStarted?.(Object.freeze({ child }));
  const logs = [];
  const forward = (stream, streamName) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        logs.push(Object.freeze({ stream: streamName, line }));
        if (logs.length > 512) logs.shift();
        emit({ ok: true, state: 'metro-output', stream: streamName, line });
      }
    });
  };
  forward(child.stdout, 'stdout');
  forward(child.stderr, 'stderr');
  let terminalReported = false;
  const reportTerminal = (code, signal, error) => {
    if (terminalReported) return;
    terminalReported = true;
    onExit?.(code, signal, error);
  };
  child.once('error', (error) => reportTerminal(null, null, error));
  child.once('exit', (code, signal) => reportTerminal(code, signal, null));
  return { child, logs, command: resolved.display };
}

function publicBinding(binding) {
  return structuredClone(binding);
}

function publicApplicationReceipt(path, receipt) {
  return Object.freeze({
    path,
    formatVersion: receipt.formatVersion,
    startupNonce: receipt.startupNonce,
    hostReadyDescriptorDigest: receipt.hostReadyDescriptorDigest,
    admissionPosture: receipt.admissionPosture,
    binding: publicBinding(receipt.binding),
    clientOrigins: Object.freeze([...receipt.clientOrigins]),
    runtimeIdentity: structuredClone(receipt.runtimeIdentity),
  });
}

function resolveExpoDeviceSelection(options) {
  const platform = options.platform ?? 'ios';
  if (platform === 'web') {
    return Object.freeze({ serial: null, class: 'browser' });
  }
  if (platform === 'ios') {
    if (options.iosUdid === undefined || options.iosUdid === null) {
      return Object.freeze({ serial: null, class: 'simulator' });
    }
    const inventory = options.iosDeviceInventory
      ?? enumerateIosDevices({
        xcrunBinary: options.xcrunBinary,
        run: options.devicectlRun,
        env: options.env,
      });
    const device = selectIosUsbDevice(inventory, { udid: options.iosUdid });
    refuseUnsupportedIosUsbForwarding(device, {
      ...(options.iosForwardingTools ? { tools: options.iosForwardingTools } : {}),
      xcrunBinary: options.xcrunBinary,
      iproxyBinary: options.iproxyBinary,
      run: options.iosToolRun,
      env: options.env,
    });
  }
  if (platform !== 'android') {
    throw diagnosticError(
      'SNAPBACK_EXPO_DEVICE_UNSUPPORTED',
      'supervised Expo development supports only iOS, Android, and web',
      { platform },
    );
  }
  const inventory = options.androidDeviceInventory
    ?? enumerateAndroidAdbDevices({
      adbBinary: options.adbBinary,
      run: options.adbRun,
      env: options.env,
    });
  const device = selectAndroidAdbDevice(inventory, {
    serial: options.androidSerial ?? null,
  });
  if (options.androidTransport === 'emulator-host-alias' && device.class !== 'emulator') {
    throw diagnosticError(
      'SNAPBACK_EXPO_ANDROID_HOST_ALIAS_DEVICE_INVALID',
      '10.0.2.2 is admitted only for an Android emulator, never a USB device',
      { serial: device.serial, class: device.class },
    );
  }
  return device;
}

// @ref LLP 0181#supervised-development-baseline — one owner coordinates the
// backend, Metro, expiring binding, credential-free rendezvous, optional
// on-demand session exchange, correlated readiness stream, signal-ready close
// operation, and complete cleanup.
export async function runExpoDev(options = {}) {
  const correlationId = options.correlationId ?? `snapback-expo-${randomUUID()}`;
  const generation = options.supervisorGeneration ?? `supervisor-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const childEnv = expoSupervisorChildEnvironment(options.env ?? process.env);
  const stopOwnedProcessGroup = options.stopProcessGroup ?? stopProcessGroup;
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const database = resolve(options.database ?? join(projectRoot, '.snapback', 'dev.sqlite3'));
  const expoDirectory = resolve(options.expoDirectory ?? projectRoot);
  const events = [];
  const emit = (event) => {
    const projected = Object.freeze({
      ...event,
      schemaVersion: EXPO_DEV_EVENT_FORMAT,
      correlationId,
    });
    events.push(projected);
    if (events.length > 1_024) events.shift();
    options.onEvent?.(projected);
    return projected;
  };
  emit({ ok: true, state: 'starting', platform: options.platform ?? 'ios' });

  let dev = null;
  let bootstrap = null;
  let metro = null;
  let metroLaunching = null;
  let metroLaunchPromise = null;
  let metroFront = null;
  let metroPlaceholder = null;
  let forwarding = null;
  let authority = Object.freeze({ status: 'unavailable' }), pendingAuthority = null;
  let authorityRequested = false;
  let authorityMintCount = 0;
  let authorityEmail = options.email ?? DEFAULT_EMAIL;
  let requestSupervisedAuthority = () => authority;
  let checkoutRegistry = null;
  let checkoutNonce = null;
  let nativeCheckoutLaunch = null;
  let listeners = Object.freeze([]);
  let closed = false;
  let backendControlClosed = false;
  let backendControlClosing = false;
  let backendControlStopAttempted = false;
  let validatedOperatorToken = null;
  let httpControlUnavailableDiagnostic = null;
  let childClosePromise = null;
  let closePromise = null;
  let closeSupervisor = null;
  let parentLease = null;
  let cleanupLease = null;
  let bindingPublisher = null;
  let metroAttestation = null;
  let startupCriticalExit = null;
  let startupPublished = false;
  let supervisorDescriptorFile = null;
  let supervisorDescriptorTemporaryFile = null;
  let supervisorDescriptorCleanupResource = null;
  let supervisorDescriptorTemporaryCleanupResource = null;
  let controlSocketHandle = null;
  let controlSocketUnavailable = null;
  let controlDispatcher = null;
  // @ref LLP 0310.000#track-a--let-the-client-retry-and-bound-the-window — a
  // successor that rotates before the control dispatcher exists parks here.
  let pendingSuccessorReloadDescriptorIdentity = null;
  const intentionallyStoppedMetroChildren = new WeakSet();
  const stoppingMetroChildren = new WeakSet();
  const metroExitErrors = new WeakMap();
  const metroCriticalExitAfterResponse = new WeakMap();
  const abortSignal = options.signal ?? null;
  let abortListener = null;
  const appDescriptorPath = join(backendRoot, 'generated', 'app.descriptor.json');
  const capabilityManifestPath = join(backendRoot, 'generated', 'capability.manifest.json');
  const currentCapabilityManifest = () => JSON.parse(
    readFileSync(capabilityManifestPath, 'utf8'),
  );
  let rotateBindingAfterLoad = () => null;
  let publishBindingProjection = () => null;
  let bindingProjection = null;
  let admittedAuthorityOrigins = Object.freeze([]);
  let applicationReceiptProjection = null;
  let portPlan = null;
  let handleBootstrapControl = async () => ({
    statusCode: 503,
    body: { ok: false, code: 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE' },
  });
  // The supervised shared development auth broker, built once the backend
  // origin and its admin/impersonation carriers are known.
  let sharedAuthBroker = null;
  let sharedAuthProjection = sharedDevelopmentAuthProjection(null, null);
  const closeChildren = () => {
    if (childClosePromise !== null) return childClosePromise;
    // Latch closure before any cleanup yield. A launch that resumes after a
    // placeholder/port wait observes this bit before it can spawn a child.
    closed = true;
    controlDispatcher?.stopAccepting();
    childClosePromise = (async () => {
      const failures = [];
      try { parentLease?.close?.(); } catch (error) { failures.push(error); }
      parentLease = null;
      try { bindingPublisher?.close?.(); } catch (error) { failures.push(error); }
      for (const [path, resource] of [
        [supervisorDescriptorFile, supervisorDescriptorCleanupResource],
        [supervisorDescriptorTemporaryFile, supervisorDescriptorTemporaryCleanupResource],
      ]) {
        if (path === null) continue;
        try {
          if (resource === null) rmSync(path, { force: true });
          else await cleanupLeasedPath(resource);
        } catch (error) { failures.push(error); }
      }
      supervisorDescriptorCleanupResource = null;
      supervisorDescriptorTemporaryCleanupResource = null;
      try { forwarding?.remove?.(); } catch (error) { failures.push(error); }
      try { await metroFront?.close?.(); } catch (error) { failures.push(error); }
      metroFront = null;
      try { await metroPlaceholder?.close?.(); } catch (error) { failures.push(error); }
      metroPlaceholder = null;
      const metroHandles = [...new Set([metroLaunching, metro].filter(Boolean))];
      for (const handle of metroHandles) {
        try {
          await stopOwnedProcessGroup(handle.child, { processGroup: true });
        } catch (error) { failures.push(error); }
      }
      metro = null;
      metroLaunching = null;
      metroAttestation = null;
      try { await bootstrap?.close?.(); } catch (error) { failures.push(error); }
      try { await dev?.close?.(); } catch (error) { failures.push(error); }
      checkoutRegistry?.invalidate();
      checkoutRegistry = null;
      checkoutNonce = null;
      authority = pendingAuthority = null;
      if (abortListener !== null) abortSignal?.removeEventListener('abort', abortListener);
      abortListener = null;
      const closedEvent = emit({ ok: failures.length === 0, state: 'closed', reclaimed: {
        backend: dev?.managed === true,
        metro: metroHandles.length > 0,
        bootstrap: bootstrap !== null,
        portForwards: forwarding?.installed?.length ?? 0,
      } });
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Expo supervisor cleanup failed');
      }
      return closedEvent;
    })();
    return childClosePromise;
  };
  const close = () => {
    if (closePromise !== null) return closePromise;
    const children = closeChildren();
    closePromise = (async () => {
      let closedEvent = null;
      const failures = [];
      try { closedEvent = await children; } catch (error) { failures.push(error); }
      try { await controlSocketHandle?.close?.(); } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Expo supervisor cleanup failed');
      }
      return closedEvent;
    })();
    return closePromise;
  };
  closeSupervisor = close;
  const reportCriticalExit = (error) => {
    if (closed) return;
    if (!startupPublished && startupCriticalExit === null) startupCriticalExit = error;
    try { options.onCriticalExit?.(error); } finally {
      void closeSupervisor().catch(() => {});
    }
  };
  const assertStartupActive = () => {
    if (startupCriticalExit !== null) throw startupCriticalExit;
    if (closed) {
      throw diagnosticError(
        'SNAPBACK_EXPO_DEV_STARTUP_CANCELLED',
        'the Expo supervisor began stopping before publishing readiness',
      );
    }
  };
  try {
    // Install the carrier lease before starting any owned process. If the
    // carrier is SIGKILLed during backend startup, the supervisor must still
    // reclaim that partially constructed process tree.
    parentLease = startExpoSupervisorParentLease({
      env: options.env ?? process.env,
      onLost: reportCriticalExit,
    });
    assertStartupActive();
    bindingPublisher = createSupervisedBindingPublisher({
      generation,
      now: options.now ?? Date.now,
      ttlMs: options.bindingTtlMs ?? DEFAULT_BINDING_TTL_MS,
      refreshWindowMs: options.bindingRefreshWindowMs,
      onEvent: emit,
    });
    cleanupLease = openCarrierCleanupLease(options.env ?? process.env);
    if (abortSignal !== null) {
      abortListener = () => reportCriticalExit(
        abortSignal.reason instanceof Error
          ? abortSignal.reason
          : diagnosticError(
            'SNAPBACK_EXPO_DEV_INTERRUPTED',
            'the Expo supervisor was interrupted during startup',
          ),
      );
      if (abortSignal.aborted) abortListener();
      else abortSignal.addEventListener('abort', abortListener, { once: true });
    }
    assertStartupActive();
    const selectedDevice = resolveExpoDeviceSelection({ ...options, env: childEnv });
    const platform = options.platform ?? 'ios';
    let requestedPortPlan = options.portPlan ?? resolveDevPortPlan({
      profile: 'expo',
      platform,
      flags: {
        port: options.devOptions?.port ?? options.port,
        clientPort: options.clientPort ?? options.metroPort,
        bootstrapPort: options.bootstrapPort,
        portRange: options.portRange ?? options.devOptions?.portRange,
      },
      env: options.env ?? process.env,
    });
    if (platform === 'web' && options.metroProcessPort !== undefined) {
      const metroProcessPort = Number(options.metroProcessPort);
      if (!Number.isSafeInteger(metroProcessPort)
          || metroProcessPort < 1
          || metroProcessPort > 65_535) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'the Metro process port test seam must be an integer from 1 through 65535',
          { port: options.metroProcessPort },
        );
      }
      if (requestedPortPlan.owners.some(({ owner, port }) => (
        owner !== 'metro' && port === metroProcessPort
      ))) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          `the Metro process port test seam duplicates another owner pin at ${metroProcessPort}`,
          { port: metroProcessPort },
        );
      }
      requestedPortPlan = Object.freeze({
        range: requestedPortPlan.range,
        owners: Object.freeze(requestedPortPlan.owners.map((entry) => (
          entry.owner === 'metro'
            ? Object.freeze({
                owner: 'metro',
                port: metroProcessPort,
                source: 'pinned',
                declaredBy: 'flag',
              })
            : entry
        ))),
      });
    }
    metroAttestation = createMetroRunAttestation(platform);
    const reservedListeners = await bindPlannedSupervisorListeners({
      plan: requestedPortPlan,
      platform,
      attestation: metroAttestation,
      admittedAuthorityOrigins: () => admittedAuthorityOrigins,
      onReservation(owner, reservation) {
        if (owner === 'bootstrap') bootstrap = reservation;
        else if (owner === 'client' && platform === 'web') metroFront = reservation;
        else metroPlaceholder = reservation;
      },
      async afterOwnerBound(owner, port, reservation) {
        await options.afterSupervisorOwnerBound?.(owner, port, reservation);
        assertStartupActive();
      },
      getBootstrapPayload: async ({ requestAuthority = false } = {}) => {
        const exchangeBinding = await bindingPublisher.bindingForExchange();
        if (exchangeBinding !== null) publishBindingProjection(exchangeBinding);
        const responseAuthority = requestAuthority
          ? await requestSupervisedAuthority()
          : Object.freeze({ status: 'unavailable' });
        // Test-only scheduling barrier for proving that each concurrent
        // adoption response retains the authority minted for that request.
        if (requestAuthority) await options.afterSupervisedAuthorityRequested?.();
        return exchangeBinding === null
          ? null
          : Object.freeze({
              format: SUPERVISED_EXCHANGE_FORMAT,
              correlationId,
              binding: exchangeBinding,
              authority: responseAuthority,
              // @ref LLP 0151#shared-development-browser-adapter — the broker
              // origin and its one exact return target are credential-free, so
              // they ride the ordinary exchange instead of an EXPO_PUBLIC_*
              // variable the author would have to set and keep fresh.
              sharedAuth: sharedAuthProjection,
            });
      },
      onDevIdentityCheckout: (presented) => checkoutRegistry?.redeem(presented) ?? null,
      onControl: (request) => handleBootstrapControl(request),
      onSharedAuth: (request, response, url) => (
        sharedAuthBroker === null
          ? Promise.resolve(false)
          : sharedAuthBroker.handle(request, response, url)
      ),
    });
    if (closed) {
      try { await reservedListeners.close(); } catch { /* latched critical exit wins */ }
      throw startupCriticalExit ?? diagnosticError(
        'SNAPBACK_EXPO_DEV_STARTUP_CANCELLED',
        'the Expo supervisor closed during listener allocation',
      );
    }
    bootstrap = reservedListeners.bootstrap;
    metroFront = reservedListeners.metroFront;
    metroPlaceholder = reservedListeners.metroPlaceholder;
    const metroPort = reservedListeners.clientPort;
    const metroProcessPort = reservedListeners.metroProcessPort;
    // The shared-auth page is served from the supervisor origin, so that
    // control-plane origin must never be allowed to mint an application
    // session. Metro client origins and originless correlation-bound native
    // requests are the complete product caller set.
    admittedAuthorityOrigins = Object.freeze(expoBackendClientOrigins(metroPort));
    portPlan = materializeDevPortPlan(requestedPortPlan, reservedListeners.assigned);
    const backendEnv = expoBackendDevAuthEnvironment(childEnv, metroPort);
    emit({
      ok: true,
      state: 'device-selected',
      platform: options.platform ?? 'ios',
      device: selectedDevice,
    });
    const launchMetro = async (
      backendOrigin,
      { criticalExitAfterResponse = null } = {},
    ) => {
      if (metro !== null) return metro;
      if (metroLaunchPromise !== null) return metroLaunchPromise;
      const launch = (async () => {
        assertStartupActive();
        const placeholder = metroPlaceholder;
        metroPlaceholder = null;
        await placeholder?.close?.();
        assertStartupActive();
        const startedMetro = startMetro({
          command: options.metroCommand,
          directory: expoDirectory,
          port: metroProcessPort,
          platform,
          bootstrapOrigin: bootstrap.origin,
          backendOrigin: platform === 'web' ? backendOrigin : undefined,
          env: childEnv,
          emit,
          cleanupLease,
          onStarted(handle) {
            metroLaunching = handle;
            if (criticalExitAfterResponse !== null) {
              metroCriticalExitAfterResponse.set(handle.child, criticalExitAfterResponse);
            }
          },
          onExit(code, signal, cause) {
            if (intentionallyStoppedMetroChildren.has(startedMetro.child)) return;
            const error = diagnosticError(
              'SNAPBACK_EXPO_METRO_EXITED',
              cause
                ? 'Expo/Metro could not be started'
                : 'Expo/Metro exited while supervised development was active',
              { code, signal, ...(cause ? { cause: cause.code ?? cause.message } : {}) },
            );
            metroExitErrors.set(startedMetro.child, error);
            // A stop attempt must settle before this exit is classified. A
            // confirmed stop suppresses it; a failed stop replays it below or
            // lets this callback close the supervisor after the failure.
            if (stoppingMetroChildren.has(startedMetro.child)) return;
            if (!closed && (
              metro?.child === startedMetro.child
              || metroLaunching?.child === startedMetro.child
            )) {
              const afterResponse = metroCriticalExitAfterResponse.get(startedMetro.child) ?? null;
              if (afterResponse === null) reportCriticalExit(error);
              else void afterResponse.then(() => {
                if (!closed) reportCriticalExit(error);
              });
            }
          },
        });
        metroLaunching = startedMetro;
        if (closed) {
          await stopOwnedProcessGroup(startedMetro.child, { processGroup: true });
          throw diagnosticError(
            'SNAPBACK_EXPO_SUPERVISOR_CLOSED',
            'the Expo supervisor closed while Metro was launching',
          );
        }
        metro = startedMetro;
        metroLaunching = null;
        return metro;
      })();
      metroLaunchPromise = launch;
      try {
        return await launch;
      } finally {
        if (metroLaunchPromise === launch) metroLaunchPromise = null;
      }
    };
    assertStartupActive();
    dev = await runDev({
      ...options.devOptions,
      backendDirectory: backendRoot,
      projectRoot,
      readyFile: options.readyFile,
      applicationReadyFile: options.applicationReadyFile,
      controlSocket: options.controlSocket === true,
      database,
      ...(options.writeEnvFile === undefined ? {} : { writeEnvFile: options.writeEnvFile }),
      runtimeBinary: options.runtimeBinary,
      env: backendEnv,
      portPlan,
      attach: options.attach === true,
      // The Metro aliases are declared before the backend process starts, so
      // Rust's live admission set and the authoritative receipt are identical.
      // Expo's device-route binding remains a projection outside that file.
      supervisedClientOrigins: expoBackendClientOrigins(metroPort),
      watch: true,
      serverStdio: options.serverStdio ?? ['ignore', 'ignore', 'ignore'],
      onEvent(event) {
        const bindingRotation = rotateBindingAfterLoad(event);
        emit({
          ok: event.ok !== false,
          state: 'backend-event',
          backend: event,
          ...(typeof event.snapbackUrl === 'string' ? {
            snapbackUrl: event.snapbackUrl,
            androidEmulatorUrl: event.androidEmulatorUrl,
          } : {}),
          ...(event.environmentFile === undefined ? {} : {
            environmentFile: event.environmentFile,
          }),
        });
        if (bindingRotation !== null) emit(bindingRotation);
      },
      onServerExit(code, signal) {
        if (closed) return;
        const error = diagnosticError(
          'SNAPBACK_DEV_SERVER_EXITED',
          'the supervised Snapback backend exited',
          { code, signal },
        );
        reportCriticalExit(error);
      },
    });
    if (dev.ok === false) {
      await closeSupervisor();
      return dev;
    }
    if (closed) {
      try { await dev.close?.(); } catch { /* latched critical exit wins */ }
    }
    assertStartupActive();
    let backendRoute = portFromOrigin(dev.serverUrl, 'Snapback backend');
    await launchMetro(backendRoute.origin);
    const backendProvenance = devPortPlanOwner(dev.portPlan, 'backend');
    portPlan = materializeDevPortPlan(
      portPlan,
      { backend: backendRoute.port },
      backendProvenance === null ? {} : {
        backend: {
          source: backendProvenance.source,
          declaredBy: backendProvenance.declaredBy,
        },
      },
    );
    if (!isLoopbackHost(backendRoute.host)) {
      throw diagnosticError(
        'SNAPBACK_EXPO_LISTENER_EXPOSED',
        'the supervised Snapback backend is not loopback-bound',
        { host: backendRoute.host, port: backendRoute.port },
      );
    }
    let descriptor = JSON.parse(readFileSync(appDescriptorPath, 'utf8'));
    const readyDescriptor = readReadyDescriptor(dev.readyFile);
    const readManagedOperatorToken = (currentReadyDescriptor) => {
      try {
        const token = managedAdminToken(currentReadyDescriptor, database);
        httpControlUnavailableDiagnostic = null;
        return token;
      } catch (error) {
        if ((error?.diagnostic?.code ?? error?.code) !== 'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID') {
          throw error;
        }
        const diagnostic = error.diagnostic ?? clientDiagnostic(
          error,
          'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
          'the managed admin-token carrier is unavailable',
        );
        if (httpControlUnavailableDiagnostic === null) {
          emit({
            ok: true,
            state: 'http-control-unavailable',
            notice: diagnostic.message,
            diagnostics: [diagnostic],
          });
        }
        httpControlUnavailableDiagnostic = diagnostic;
        return null;
      }
    };
    validatedOperatorToken = readManagedOperatorToken(readyDescriptor);
    // @ref LLP 0151#shared-development-browser-adapter — the broker exists only
    // when this app declares a provider, and only when server-held deployment
    // state admits the shared profile. Its origin is the one the client already
    // discovers, so no second terminal and no broker origin configuration.
    if ((descriptor.authBootstrap?.providers ?? []).length > 0
        && validatedOperatorToken !== null) {
      sharedAuthBroker = createSharedDevelopmentBroker({
        appId: descriptor.identity.app,
        serverOrigin: dev.serverUrl.replace(/\/$/u, ''),
        adminToken: validatedOperatorToken,
        impersonationCapability: readSupervisedImpersonationCapability(readyDescriptor, dev.readyFile),
        returnTargets: supervisedSharedAuthReturnTargets(metroPort),
        deploymentProfile: expoSharedAuthDeploymentProfile(childEnv),
      });
      sharedAuthProjection = sharedDevelopmentAuthProjection(sharedAuthBroker, bootstrap.origin);
      if (!sharedAuthBroker.available) {
        emit({
          ok: true,
          state: 'shared-auth-unavailable',
          sharedAuth: sharedAuthProjection,
        });
      }
    } else if ((descriptor.authBootstrap?.providers ?? []).length > 0) {
      emit({
        ok: true,
        state: 'shared-auth-unavailable',
        sharedAuth: sharedAuthProjection,
      });
    }
    checkoutRegistry = createDevIdentityCheckoutRegistry({
      getReadyDescriptor: () => readReadyDescriptor(dev.readyFile),
    });
    const mintAndSwapAuthority = (email, { emitReplacement = true, pending = false } = {}) => {
      authorityEmail = email;
      authorityRequested = true;
      let operatorToken = readManagedOperatorToken(readReadyDescriptor(dev.readyFile));
      try {
        authorityMintCount += 1;
        authority = operatorToken === null
          ? Object.freeze({
            status: 'authority-required',
            diagnostic: httpControlUnavailableDiagnostic ?? clientDiagnostic(
              null,
              'SNAPBACK_AUTHORITY_REQUIRED',
              'The supervised ordinary-session mint has no usable managed admin-token carrier.',
            ),
            remediations: Object.freeze([]),
          })
          : mintSupervisedOrdinarySession({
            runtimeBinary: dev.runtime.binary,
            readyFile: dev.readyFile,
            email,
            operatorToken,
            cwd: projectRoot,
            env: childEnv,
          });
      } finally {
        operatorToken = null;
      }
      if (emitReplacement) {
        emit({
          ok: authority.status === 'ready',
          state: authority.status === 'ready' ? 'authority-replaced' : 'authority-required',
          authority: authority.status === 'ready'
            ? { status: 'ready', kind: 'session', authMode: 'sessions' }
            : authority,
        });
      }
      if (pending) pendingAuthority = authority;
      return authority.status;
    };
    // @ref LLP 0300#p4--the-dev-session-becomes-explicit — binding admission
    // never invokes the mint on web or native; application adoption requests
    // the first ordinary session on demand.
    // @ref LLP 0310.000#track-b--the-mint-is-on-demand-and-gives-the-form-back — an operator
    // replacement is a one-shot response; other explicit adoptions mint fresh.
    requestSupervisedAuthority = () => {
      if (pendingAuthority !== null) [authority, pendingAuthority] = [pendingAuthority, null];
      else mintAndSwapAuthority(authorityEmail, { emitReplacement: authorityRequested });
      return authority;
    };
    // @ref LLP 0262#d2-carriers-per-shipped-topology — native remains
    // sessions-first at the provider boundary, but the provider's default
    // adoption request is now the first mint; there is no discarded S1.
    let route = null;
    // Backend lifecycle verbs keep revalidating the ready descriptor and its
    // declared carrier while that backend is live. Native stop removes the
    // descriptor, but not the surviving supervisor's bootstrap route, so the
    // post-stop control plane resolves the already-validated sibling directly
    // and falls back to the last validated token if the sidecar is also gone.
    const supervisorOperatorToken = () => {
      if (!backendControlClosed && !backendControlClosing) {
        const current = readManagedOperatorToken(readReadyDescriptor(dev.readyFile));
        validatedOperatorToken = current;
        return current;
      }
      try {
        const current = readManagedOperatorToken({
          adminTokenFile: `${database}.admin-token`,
        });
        if (current === null
            && typeof validatedOperatorToken === 'string'
            && validatedOperatorToken.length > 0) {
          return validatedOperatorToken;
        }
        validatedOperatorToken = current;
        return current;
      } catch (error) {
        if (typeof validatedOperatorToken === 'string' && validatedOperatorToken.length > 0) {
          return validatedOperatorToken;
        }
        throw error;
      }
    };
    // @ref LLP 0310.000#track-e--add-the-missing-verb-to-the-control-route-that-already-exists — the
    // token-gated HTTP plane and owner-bound socket enqueue their shared verb
    // implementations on one serialized dispatcher.
    handleBootstrapControl = async ({ operatorToken, body }) => {
        let expectedOperatorToken = null;
        try {
          expectedOperatorToken = supervisorOperatorToken();
          // @ref LLP 0181#provider — the operator capability remains
          // supervisor-held; the control route authenticates it without ever
          // projecting either it or the ordinary replacement bearer.
          if (!constantTimeTokenEqual(operatorToken, expectedOperatorToken)) {
            return {
              statusCode: 401,
              body: { ok: false, code: 'SNAPBACK_EXPO_CONTROL_UNAUTHORIZED' },
            };
          }
        } finally {
          expectedOperatorToken = null;
        }
        const verb = typeof body?.verb === 'string' ? body.verb : null;
        if (!SUPERVISED_HTTP_CONTROL_VERBS.includes(verb)) {
          return {
            statusCode: 400,
            body: {
              ok: false,
              code: 'SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN',
              supported: SUPERVISED_HTTP_CONTROL_VERBS,
            },
          };
        }
        const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
        try {
          if (controlDispatcher === null) {
            throw diagnosticError(
              'SNAPBACK_EXPO_CONTROL_FAILED',
              'the supervised control dispatcher is not ready',
            );
          }
          if (verb === 'stop-children' || verb === 'reload-metro') {
            let releaseResponse;
            const afterResponse = new Promise((resolveFlushed) => {
              releaseResponse = resolveFlushed;
            });
            const operation = controlDispatcher.enqueue(verb, { requestId, afterResponse });
            if (verb === 'reload-metro') {
              const result = await operation;
              return {
                statusCode: 200,
                body: result,
                afterResponse: async () => { releaseResponse(); },
              };
            }
            return {
              statusCode: 200,
              body: {
                schemaVersion: DEV_CONTROL_ACK_FORMAT,
                ok: true,
                state: 'acknowledged',
                verb,
                ...(requestId === undefined ? {} : { requestId }),
              },
              afterResponse: async () => {
                releaseResponse();
                await operation;
              },
            };
          }
          const result = await controlDispatcher.enqueue(verb, { requestId });
          return {
            statusCode: 200,
            body: result,
          };
        } catch (error) {
          return {
            statusCode: 200,
            body: verb === 'dev-fresh' ? {
              schemaVersion: 'snapback.reset-dev-fresh.v1',
              ok: false,
              mode: 'supervised',
              diagnostics: [error?.diagnostic ?? clientDiagnostic(
                error,
                'SNAPBACK_EXPO_CONTROL_FAILED',
                'the supervised dev-fresh control request did not complete',
              )],
              ...(requestId === undefined ? {} : { requestId }),
            } : {
              schemaVersion: EXPO_DEV_EVENT_FORMAT,
              ok: false,
              state: `${verb}-failed`,
              verb,
              diagnostics: [error?.diagnostic ?? clientDiagnostic(
                error,
                'SNAPBACK_EXPO_CONTROL_FAILED',
                `the supervised ${verb} control request did not complete`,
              )],
              ...(requestId === undefined ? {} : { requestId }),
            },
          };
        }
    };
    if (closed) {
      try { await bootstrap.close?.(); } catch { /* latched critical exit wins */ }
    }
    assertStartupActive();
    route = createExpoRoutingPlan({
      platform: options.platform ?? 'ios',
      backendPort: backendRoute.port,
      metroPort,
      bootstrapPort: bootstrap.port,
      androidTransport: options.androidTransport ?? 'adb-reverse',
      androidSerial: selectedDevice.serial,
      androidDeviceClass: selectedDevice.class,
    });
    publishBindingProjection = (binding) => {
      bindingProjection = publicBinding(binding);
      if (supervisorDescriptorFile !== null && existsSync(supervisorDescriptorFile)) {
        const current = JSON.parse(readFileSync(supervisorDescriptorFile, 'utf8'));
        // A CLI-owned reload can rotate both the authoritative receipt and
        // its binding before this callback runs. Refresh the inspection copy
        // from that file while preserving the ownership boundary: Expo writes
        // only expo-supervisor.json, never application-ready.json itself.
        try {
          applicationReceiptProjection = publicApplicationReceipt(
            dev.applicationReadyFile,
            readApplicationReadyReceipt(dev.applicationReadyFile),
          );
        } catch (error) {
          // The CLI deliberately removes the receipt during its short reload
          // transition. A coincident TTL-only refresh keeps the last settled
          // inspection copy; malformed present bytes still fail closed.
          if (existsSync(dev.applicationReadyFile)) throw error;
        }
        // This transient descriptor is an inspection projection, not attach
        // authority. The application-ready file remains untouched.
        publishSupervisorDescriptorAtomically(supervisorDescriptorFile, {
          ...current,
          portPlan,
          binding: bindingProjection,
          applicationReady: applicationReceiptProjection,
        }, null, {
          cleanup: {
            resource: supervisorDescriptorCleanupResource,
            mode: 'rebind',
            runIdField: 'supervisorGeneration',
            runId: generation,
          },
        });
      }
      return bindingProjection;
    };
    const initialBinding = bindingPublisher.issue({
      descriptor,
      capabilityManifest: currentCapabilityManifest(),
      origin: appOrigin(route.appHost, backendRoute.port),
      routing: route.bindingRouting,
    });
    publishBindingProjection(initialBinding);
    const shouldLaunchNativeCheckout = shouldLaunchExpoNativeCheckout(route, options);
    if (shouldLaunchNativeCheckout) {
      checkoutNonce = checkoutRegistry.issue({
        platform: route.platform,
        device: route.device,
      });
    }
    // @ref LLP 0310.000#track-a--let-the-client-retry-and-bound-the-window —
    // A1's reload is supervisor-initiated background work, not a caller's verb:
    // it must never turn a successful rotation into a rejected promise, and a
    // stopping owner refusing new control work is an expected outcome, not a
    // fault. A genuine reload failure is already reported as a critical exit by
    // reloadMetroVerb itself, so this path only has to keep the rejection
    // handled.
    const queueSuccessorMetroReload = (successorDescriptorIdentity) => {
      if (closed) return;
      // `controlDispatcher` is assigned later in startup than this closure is
      // defined. A browser arm held open across a supervisor restart can already
      // be talking to the new owner's bootstrap listener before that point, so a
      // successor rotating in this window would leave a *successfully admitted*
      // arm on the predecessor identity with nothing left to trigger a
      // re-exchange — the exact failure Track A exists to remove. Retain the
      // latest one and flush it when the dispatcher exists. Latest wins: an
      // older successor's reload is subsumed by the newer one.
      if (controlDispatcher === null) {
        pendingSuccessorReloadDescriptorIdentity = successorDescriptorIdentity;
        return;
      }
      let operation;
      try {
        operation = controlDispatcher.enqueue('reload-metro', {
          reason: 'successor-binding',
          descriptorIdentity: successorDescriptorIdentity,
        });
      } catch (error) {
        // A stopping owner refusing new control work is expected. Anything else
        // is unexpected, but must not take down the rotation that already
        // published a correct binding — report it out of band instead.
        if (error?.diagnostic?.code !== 'SNAPBACK_DEV_CONTROL_STOPPING' && !closed) {
          setImmediate(() => reportCriticalExit(error));
        }
        return;
      }
      void operation.catch(() => undefined);
    };
    // @ref LLP 0241#d6-development-commands-share-one-recovery-model —
    // generated-and-loaded is the compatible-cut boundary: only then may the
    // supervisor expose a binding for the successor descriptor identity.
    // @ref LLP 0181#appbinding-v1 — the binding remint keeps the supervised
    // route/provenance but must carry the exact newly imported descriptor.
    rotateBindingAfterLoad = (event) => {
      if (closed || event?.ok !== true || event.state !== 'generated-and-loaded') return null;
      const successor = JSON.parse(readFileSync(appDescriptorPath, 'utf8'));
      if (successor.identity.descriptor === descriptor.identity.descriptor) return null;
      const previousDescriptorIdentity = descriptor.identity.descriptor;
      descriptor = successor;
      const rotatedBinding = bindingPublisher.issue({
        descriptor,
        capabilityManifest: currentCapabilityManifest(),
        origin: appOrigin(route.appHost, backendRoute.port),
        routing: route.bindingRouting,
      });
      publishBindingProjection(rotatedBinding);
      // @ref LLP 0310.000#track-a--let-the-client-retry-and-bound-the-window —
      // A1. Exposure precedes publication: the successor graph is already in
      // Metro's view and the backend is already serving it by the time this
      // binding exists, so an arm that re-booted in between refused against the
      // predecessor and has no reason to exchange again. Replacing Metro now
      // makes the live arm re-import the successor `app` and re-exchange
      // promptly. This *narrows* the window (W2); it does not close it — the
      // client-side retry (A2) is what makes the remaining window survivable.
      // The reload goes through the shared control lane so it serializes with
      // operator verbs rather than racing them.
      queueSuccessorMetroReload(descriptor.identity.descriptor);
      return {
        ok: true,
        state: 'binding-rotated',
        changed: event.changed ?? null,
        previousDescriptorIdentity,
        descriptorIdentity: descriptor.identity.descriptor,
        binding: publicBinding(rotatedBinding),
      };
    };
    let backendPid = dev.child?.pid ?? readyDescriptor.pid;
    listeners = await waitForListenerInventory({
      backendPid,
      metroPid: metro.child.pid,
      metroProcess: metro.child,
      webFrontPort: metroFront?.port ?? null,
      expected: [
        { owner: 'backend', port: backendRoute.port },
        { owner: 'metro', port: metroProcessPort },
        ...(metroFront === null ? [] : [{ owner: 'metro-front', port: metroPort }]),
        { owner: 'bootstrap', port: bootstrap.port },
      ],
      timeoutMs: options.metroReadyTimeoutMs ?? 30_000,
    });
    assertStartupActive();
    emit({ ok: true, state: 'listeners-verified', listeners });
    // Advisory only — never fails the loop. The supervisor strips CI from its
    // owned Metro child, but watcher-blind roots such as /private/tmp can still
    // make stale bundles look like application bugs
    // (issues/20260808-supervisor-warn-metro-watch-blind.md).
    const watchAdvisories = assessMetroWatchInertness({
      env: expoMetroChildEnvironment({
        env: childEnv,
        bootstrapOrigin: bootstrap.origin,
        port: metroProcessPort,
      }),
      directory: expoDirectory,
    });
    if (watchAdvisories.length > 0) {
      emit({
        ok: true,
        state: 'metro-watch-advisory',
        code: 'SNAPBACK_EXPO_METRO_WATCH_INERT',
        advisories: watchAdvisories,
      });
    }
    forwarding = installAndroidPortForwarding(route, {
      adbBinary: options.adbBinary,
      run: options.adbRun,
      env: childEnv,
    });
    if (checkoutNonce !== null) {
      nativeCheckoutLaunch = launchExpoNativeCheckout(route, checkoutNonce, {
        xcrunBinary: options.xcrunBinary,
        adbBinary: options.adbBinary,
        iosSimulator: options.iosSimulator,
        iosBundleIdentifier: options.iosBundleIdentifier,
        androidComponent: options.androidComponent,
        expoAppScheme: options.expoAppScheme,
        run: options.nativeLaunchRun ?? spawnSync,
        env: childEnv,
      });
      checkoutNonce = null;
      emit({
        ok: true,
        state: 'native-checkout-launched',
        nativeCheckout: nativeCheckoutLaunch,
      });
    }
    const finalState = 'ready';
    assertStartupActive();
    if ((dev.child && (dev.child.exitCode !== null || dev.child.signalCode !== null))
        || metro.child.exitCode !== null || metro.child.signalCode !== null) {
      throw startupCriticalExit ?? diagnosticError(
        'SNAPBACK_EXPO_CHILD_EXITED_DURING_STARTUP',
        'a supervised child exited before Expo readiness could be published',
      );
    }
    const finalProcessInventory = processTable();
    const supervisorProcessIdentity = processIdentity(process.pid, finalProcessInventory);
    const metroProcessIdentity = processIdentity(metro.child.pid, finalProcessInventory);
    const backendProcessIdentity = processIdentity(backendPid, finalProcessInventory);
    if (supervisorProcessIdentity === null
        || metroProcessIdentity === null
        || backendProcessIdentity === null) {
      throw diagnosticError(
        'SNAPBACK_EXPO_CHILD_EXITED_DURING_STARTUP',
        'a supervised process identity disappeared before Expo readiness could be published',
      );
    }
    const finalSupervisorTree = descendants(process.pid, finalProcessInventory);
    if (!finalSupervisorTree.has(metro.child.pid)
        || (dev.managed === true && !finalSupervisorTree.has(backendPid))) {
      throw diagnosticError(
        'SNAPBACK_EXPO_CHILD_OWNERSHIP_CHANGED',
        'a supervised child left the supervisor process tree before readiness',
      );
    }
    listeners = enumerateExpoOwnedListeners({
      backendPid,
      metroPid: metro.child.pid,
      webFrontPort: metroFront?.port ?? null,
    });
    let expectedListeners = [
      { owner: 'backend', port: backendRoute.port },
      { owner: 'metro', port: metroProcessPort },
      ...(metroFront === null ? [] : [{ owner: 'metro-front', port: metroPort }]),
      { owner: 'bootstrap', port: bootstrap.port },
    ];
    const refreshLiveBackendListenerTarget = () => {
      const liveReady = readReadyDescriptor(dev.readyFile);
      const liveRoute = portFromOrigin(liveReady.serverUrl, 'Snapback backend');
      if (!isLoopbackHost(liveRoute.host)) {
        throw diagnosticError(
          'SNAPBACK_EXPO_LISTENER_EXPOSED',
          'the current supervised backend is not loopback-bound',
          { host: liveRoute.host, port: liveRoute.port },
        );
      }
      backendPid = liveReady.pid;
      backendRoute = liveRoute;
      expectedListeners = [
        { owner: 'backend', port: liveRoute.port },
        { owner: 'metro', port: metroProcessPort },
        ...(metroFront === null ? [] : [{ owner: 'metro-front', port: metroPort }]),
        { owner: 'bootstrap', port: bootstrap.port },
      ];
      return Object.freeze({
        backendPid,
        expectedListeners: Object.freeze([...expectedListeners]),
      });
    };
    if (!expectedListeners.every(({ owner, port }) => (
      listeners.some((listener) => (
        listener.owner === owner
          && listener.port === port
          && listener.loopback === true
          && typeof listener.startTime === 'string'
          && listener.startTime.length > 0
      ))
    ))) {
      throw diagnosticError(
        'SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE',
        'a supervised listener changed ownership before readiness publication',
        { expected: expectedListeners, observed: listeners },
      );
    }
    const metroListener = listeners.find((listener) => (
      listener.owner === 'metro' && listener.port === metroProcessPort
    ));
    const metroTree = descendants(metro.child.pid, finalProcessInventory);
    if (!metroListener || !metroTree.has(metroListener.pid)) {
      throw diagnosticError(
        'SNAPBACK_EXPO_CHILD_OWNERSHIP_CHANGED',
        'the admitted Metro listener no longer belongs to the Metro child tree',
      );
    }
    await options.beforeReadinessPublish?.({
      listeners,
      metroPid: metro.child.pid,
      metroProcessPort,
      metroOrigin: appOrigin(route.appHost, metroPort),
      signal: options.signal ?? null,
    });
    assertStartupActive();
    let metroReadiness = Object.freeze({
      pid: metro.child.pid,
      startTime: metroProcessIdentity.startTime,
      origin: appOrigin(route.appHost, metroPort),
      upstreamOrigin: appOrigin(LOOPBACK_HOST, metroProcessPort),
    });
    const bootstrapReadiness = Object.freeze({
      origin: appOrigin(route.appHost, bootstrap.port),
    });
    const applicationReceipt = readApplicationReadyReceipt(dev.applicationReadyFile);
    applicationReceiptProjection = publicApplicationReceipt(
      dev.applicationReadyFile,
      applicationReceipt,
    );
    supervisorDescriptorFile = join(dirname(dev.readyFile), 'expo-supervisor.json');
    const updateSupervisorDescriptor = (fields) => {
      if (!existsSync(supervisorDescriptorFile)) return;
      const current = JSON.parse(readFileSync(supervisorDescriptorFile, 'utf8'));
      if (current.supervisorGeneration !== generation) {
        throw diagnosticError(
          'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
          'the Expo supervisor descriptor was replaced by another lifecycle owner',
          { path: supervisorDescriptorFile, expected: generation, observed: current.supervisorGeneration },
        );
      }
      publishSupervisorDescriptorAtomically(supervisorDescriptorFile, {
        ...current,
        ...fields,
      }, null, {
        cleanup: {
          resource: supervisorDescriptorCleanupResource,
          mode: 'rebind',
          runIdField: 'supervisorGeneration',
          runId: generation,
        },
      });
    };
    // @ref LLP 0310.000#track-a--let-the-client-retry-and-bound-the-window —
    // the same replacement operation serves an operator verb and the
    // supervisor's own post-remint reload. `reason` records which one asked;
    // `descriptorIdentity` names the successor the reload is publishing.
    const reloadMetroVerb = async ({
      requestId,
      afterResponse = null,
      reason = 'operator-control',
      descriptorIdentity = null,
    } = {}) => {
      if (closed) {
        return Object.freeze({
          schemaVersion: EXPO_DEV_EVENT_FORMAT,
          ok: false,
          state: 'metro-reload-failed',
          verb: 'reload-metro',
          ...(requestId === undefined ? {} : { requestId }),
          diagnostics: [devControlDiagnostic(
            'SNAPBACK_EXPO_SUPERVISOR_CLOSED',
            'the Expo supervisor is closed and cannot reload Metro',
          )],
        });
      }
      const previousMetro = metro;
      const previousPid = previousMetro?.child.pid ?? null;
      try {
        if (previousMetro !== null) {
          stoppingMetroChildren.add(previousMetro.child);
          try {
            await stopOwnedProcessGroup(previousMetro.child, { processGroup: true });
            intentionallyStoppedMetroChildren.add(previousMetro.child);
          } catch (error) {
            const racedExit = metroExitErrors.get(previousMetro.child);
            if (racedExit !== undefined && !closed && (
              metro?.child === previousMetro.child
              || metroLaunching?.child === previousMetro.child
            )) {
              reportCriticalExit(racedExit);
            }
            throw error;
          } finally {
            stoppingMetroChildren.delete(previousMetro.child);
          }
          if (metro === previousMetro) metro = null;
          await options.afterMetroReloadPreviousStopped?.({ metro: previousMetro });
        }
        const restartedMetro = await launchMetro(
          backendRoute.origin,
          { criticalExitAfterResponse: afterResponse },
        );
        const liveBackend = backendControlClosed
          ? Object.freeze({
              backendPid,
              expectedListeners: Object.freeze([
                { owner: 'metro', port: metroProcessPort },
                ...(metroFront === null ? [] : [{ owner: 'metro-front', port: metroPort }]),
                { owner: 'bootstrap', port: bootstrap.port },
              ]),
             })
          : refreshLiveBackendListenerTarget();
        listeners = await waitForListenerInventory({
          backendPid: liveBackend.backendPid,
          metroPid: restartedMetro.child.pid,
          metroProcess: restartedMetro.child,
          webFrontPort: metroFront?.port ?? null,
          expected: liveBackend.expectedListeners,
          timeoutMs: options.metroReadyTimeoutMs ?? 30_000,
        });
        await options.afterMetroReloadListenersVerified?.({
          metro: restartedMetro,
          listeners,
        });
        // A listener can be observed just before its owning process exit event
        // is delivered. Give that terminal notification one turn to latch
        // before replacing the descriptor, then repeat the turn/check at the
        // immediate success-publication boundary.
        const assertReplacementMetroActive = () => {
          const replacementExit = metroExitErrors.get(restartedMetro.child) ?? null;
          if (replacementExit === null
              && !closed
              && metro === restartedMetro
              && restartedMetro.child.exitCode === null
              && restartedMetro.child.signalCode === null) return;
          throw diagnosticError(
            'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
            'the replacement Metro process exited before reload success could be published',
            {
              pid: restartedMetro.child.pid,
              cause: replacementExit?.diagnostic?.code
                ?? restartedMetro.child.signalCode
                ?? restartedMetro.child.exitCode
                ?? 'supervisor-closed',
            },
          );
        };
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        assertReplacementMetroActive();
        const identity = processIdentity(restartedMetro.child.pid, processTable());
        if (identity === null) {
          throw diagnosticError(
            'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
            'the replacement Metro process disappeared before its identity was recorded',
          );
        }
        metroReadiness = Object.freeze({
          pid: restartedMetro.child.pid,
          startTime: identity.startTime,
          origin: appOrigin(route.appHost, metroPort),
          upstreamOrigin: appOrigin(LOOPBACK_HOST, metroProcessPort),
        });
        updateSupervisorDescriptor({
          ...(backendControlClosed ? { state: 'metro-only' } : {}),
          metro: metroReadiness,
          listeners,
        });
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        assertReplacementMetroActive();
        return emit({
          ok: true,
          state: 'metro-reloaded',
          verb: 'reload-metro',
          reason,
          ...(descriptorIdentity === null ? {} : { descriptorIdentity }),
          ...(requestId === undefined ? {} : { requestId }),
          previousPid,
          pid: restartedMetro.child.pid,
          backendPid: liveBackend.backendPid,
          metro: metroReadiness,
          listeners,
        });
      } catch (error) {
        const reloadError = error?.diagnostic?.code === 'SNAPBACK_EXPO_METRO_RELOAD_FAILED'
          ? error
          : diagnosticError(
            'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
            error?.message ?? 'the replacement Metro process did not become ready',
            { cause: error?.diagnostic?.code ?? error?.code ?? error?.message ?? String(error) },
          );
        let currentBackendPid = null;
        try {
          currentBackendPid = dev.child?.pid ?? readReadyDescriptor(dev.readyFile).pid;
        } catch { /* the typed reload failure owns the outcome */ }
        const failure = emit({
          ok: false,
          state: 'metro-reload-failed',
          verb: 'reload-metro',
          reason,
          ...(descriptorIdentity === null ? {} : { descriptorIdentity }),
          ...(requestId === undefined ? {} : { requestId }),
          previousPid,
          backendPid: currentBackendPid,
          diagnostics: [reloadError.diagnostic],
        });
        if (!closed) {
          if (afterResponse === null) reportCriticalExit(reloadError);
          else void afterResponse.then(() => {
            if (!closed) reportCriticalExit(reloadError);
          });
        }
        return failure;
      }
    };
    const stopChildrenVerb = async ({ requestId, afterResponse = null } = {}) => {
      // HTTP admits this operation into the shared lane before replying, then
      // releases the gate from response.end's flush/close callback. The socket
      // plane releases the same gate from its acknowledgement write callback.
      if (afterResponse !== null) await afterResponse;
      await options.beforeStopChildren?.({ requestId });
      const failures = [];
      const recordFailure = (error, resource) => {
        failures.push(devControlDiagnostic(
          'SNAPBACK_EXPO_CHILD_STOP_FAILED',
          `the supervised ${resource} did not stop cleanly`,
          { resource, cause: error?.diagnostic?.code ?? error?.code ?? error?.message ?? String(error) },
        ));
      };
      const stoppedMetro = metro;
      const stoppedForwarding = forwarding;
      const installedForwards = stoppedForwarding?.installed?.length ?? 0;
      if (stoppedForwarding !== null) {
        try {
          stoppedForwarding.remove?.();
          if (forwarding === stoppedForwarding) forwarding = null;
        } catch (error) { recordFailure(error, 'port forwarding'); }
      }
      if (stoppedMetro !== null) {
        stoppingMetroChildren.add(stoppedMetro.child);
        try {
          await stopOwnedProcessGroup(stoppedMetro.child, { processGroup: true });
          intentionallyStoppedMetroChildren.add(stoppedMetro.child);
          if (metro === stoppedMetro) metro = null;
          if (metroLaunching === stoppedMetro) metroLaunching = null;
          metroAttestation = null;
          metroReadiness = null;
        } catch (error) {
          recordFailure(error, 'Metro child');
          const racedExit = metroExitErrors.get(stoppedMetro.child);
          if (racedExit !== undefined && !closed && (
            metro?.child === stoppedMetro.child
            || metroLaunching?.child === stoppedMetro.child
          )) {
            reportCriticalExit(racedExit);
          }
        } finally {
          stoppingMetroChildren.delete(stoppedMetro.child);
        }
      }
      if (!backendControlClosed) {
        backendControlStopAttempted = true;
        backendControlClosing = true;
        try {
          await (dev?.closeForExpoStopChildren?.() ?? dev?.close?.());
          backendControlClosed = true;
        } catch (error) { recordFailure(error, 'backend child'); } finally {
          backendControlClosing = false;
        }
      }
      if (backendControlClosed) {
        try { bindingPublisher?.close?.(); } catch (error) { recordFailure(error, 'binding publisher'); }
        checkoutRegistry?.invalidate();
        checkoutRegistry = null;
        checkoutNonce = null;
        authority = null;
      }
      listeners = Object.freeze(listeners.filter(({ owner }) => (
        (owner !== 'metro' || metro !== null)
          && (owner !== 'backend' || !backendControlClosed)
      )));
      const childrenStopped = failures.length === 0
        && forwarding === null
        && metro === null
        && backendControlClosed;
      const state = childrenStopped ? 'children-stopped' : 'children-stop-failed';
      try {
        updateSupervisorDescriptor({
          state,
          metro: metro === null ? null : metroReadiness,
          listeners,
        });
      } catch (error) { recordFailure(error, 'supervisor descriptor'); }
      const stoppedEvent = emit({
        ok: childrenStopped && failures.length === 0,
        state: childrenStopped && failures.length === 0 ? 'children-stopped' : 'children-stop-failed',
        verb: 'stop-children',
        ...(requestId === undefined ? {} : { requestId }),
        reclaimed: {
          backend: backendControlClosed && dev?.managed === true,
          metro: stoppedMetro !== null && metro !== stoppedMetro,
          bootstrap: false,
          portForwards: stoppedForwarding !== null && forwarding !== stoppedForwarding
            ? installedForwards
            : 0,
        },
        ...(failures.length === 0 ? {} : {
          diagnostics: failures,
        }),
      });
      return stoppedEvent;
    };
    const runBackendLifecycleVerb = async (verb, context) => {
      const event = await dev.verbs[verb](context);
      if (!closed && event?.ok === true) refreshLiveBackendListenerTarget();
      return event;
    };
    const supervisedDevFreshVerb = async ({ requestId } = {}) => {
      const event = await runBackendLifecycleVerb('dev-fresh', { requestId });
      if (event?.ok !== true) {
        return Object.freeze({
          schemaVersion: 'snapback.reset-dev-fresh.v1',
          ok: false,
          mode: 'supervised',
          diagnostics: event?.diagnostics ?? [{
            code: 'SNAPBACK_DEV_FRESH_FAILED',
            severity: 'error',
            subsystem: 'cli',
            message: 'the managed dev-fresh operation did not complete',
          }],
          ...(requestId === undefined ? {} : { requestId }),
        });
      }

      try {
        // The Expo refresh is part of the dispatched operation. No queued
        // Metro reload or child stop may observe the backend-success boundary
        // before listener verification, binding replacement, forwarding, and
        // authority remint all settle.
        await options.beforeDevFreshExpoRefresh?.();
        const refreshedReady = readReadyDescriptor(dev.readyFile);
        backendRoute = portFromOrigin(refreshedReady.serverUrl, 'Snapback backend');
        const refreshedBackendProvenance = devPortPlanOwner(dev.portPlan, 'backend');
        portPlan = materializeDevPortPlan(
          portPlan,
          { backend: backendRoute.port },
          refreshedBackendProvenance === null ? {} : {
            backend: {
              source: refreshedBackendProvenance.source,
              declaredBy: refreshedBackendProvenance.declaredBy,
            },
          },
        );
        if (!isLoopbackHost(backendRoute.host)) {
          throw diagnosticError(
            'SNAPBACK_EXPO_LISTENER_EXPOSED',
            'the refreshed supervised backend is not loopback-bound',
          );
        }
        descriptor = JSON.parse(readFileSync(appDescriptorPath, 'utf8'));
        // A backend restart rotates startupNonce and the dev-identity
        // sidecar, so both the pending delivery and every issued nonce are
        // invalid. The opt-in own-bundle path below issues a replacement
        // only after the refreshed listeners and sidecar are current.
        checkoutRegistry?.invalidate();
        checkoutNonce = null;
        nativeCheckoutLaunch = null;
        route = createExpoRoutingPlan({
          platform: options.platform ?? 'ios',
          backendPort: backendRoute.port,
          metroPort,
          bootstrapPort: bootstrap.port,
          androidTransport: options.androidTransport ?? 'adb-reverse',
          androidSerial: selectedDevice.serial,
          androidDeviceClass: selectedDevice.class,
        });
        const refreshedBinding = bindingPublisher.issue({
          descriptor,
          capabilityManifest: currentCapabilityManifest(),
          origin: appOrigin(route.appHost, backendRoute.port),
          routing: route.bindingRouting,
        });
        publishBindingProjection(refreshedBinding);
        forwarding?.remove?.();
        forwarding = installAndroidPortForwarding(route, {
          adbBinary: options.adbBinary,
          run: options.adbRun,
          env: childEnv,
        });
        listeners = await waitForListenerInventory({
          backendPid: refreshedReady.pid,
          metroPid: metro.child.pid,
          metroProcess: metro.child,
          webFrontPort: metroFront?.port ?? null,
          expected: [
            { owner: 'backend', port: backendRoute.port },
            { owner: 'metro', port: metroProcessPort },
            ...(metroFront === null ? [] : [{ owner: 'metro-front', port: metroPort }]),
            { owner: 'bootstrap', port: bootstrap.port },
          ],
          timeoutMs: options.metroReadyTimeoutMs ?? 30_000,
        });
        emit({ ok: true, state: 'listeners-verified', listeners });
        if (authorityRequested) mintAndSwapAuthority(authorityEmail, { pending: true });
        else authority = Object.freeze({ status: 'unavailable' });
        if (shouldLaunchExpoNativeCheckout(route, options)) {
          checkoutNonce = checkoutRegistry.issue({
            platform: route.platform,
            device: route.device,
          });
          if (checkoutNonce !== null) {
            nativeCheckoutLaunch = launchExpoNativeCheckout(route, checkoutNonce, {
              xcrunBinary: options.xcrunBinary,
              adbBinary: options.adbBinary,
              iosSimulator: options.iosSimulator,
              iosBundleIdentifier: options.iosBundleIdentifier,
              androidComponent: options.androidComponent,
              expoAppScheme: options.expoAppScheme,
              run: options.nativeLaunchRun ?? spawnSync,
              env: childEnv,
            });
            checkoutNonce = null;
            emit({
              ok: true,
              state: 'native-checkout-launched',
              reason: 'backend-rotation',
              nativeCheckout: nativeCheckoutLaunch,
            });
          }
        }
        return Object.freeze({
          schemaVersion: 'snapback.reset-dev-fresh.v1',
          ok: true,
          mode: 'supervised',
          correlationId,
          database: 'fresh',
          seed: 'applied',
          authority: {
            status: authority.status,
            authMode: 'sessions',
          },
          backend: { origin: backendRoute.origin },
          ...(requestId === undefined ? {} : { requestId }),
        });
      } catch (error) {
        return Object.freeze({
          schemaVersion: 'snapback.reset-dev-fresh.v1',
          ok: false,
          mode: 'supervised',
          diagnostics: [error?.diagnostic ?? clientDiagnostic(
            error,
            'SNAPBACK_EXPO_CONTROL_FAILED',
            'the supervised dev-fresh refresh did not complete',
          )],
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
    };
    controlDispatcher = createDevControlDispatcher({
      reload: (context) => runBackendLifecycleVerb('reload', context),
      restart: (context) => runBackendLifecycleVerb('restart', context),
      'dev-fresh': supervisedDevFreshVerb,
      'reload-metro': reloadMetroVerb,
      'stop-children': stopChildrenVerb,
    });
    // Flush a successor reload that rotated before the dispatcher existed. Only
    // the latest matters — an earlier successor's reload is subsumed by it — and
    // it must be cleared before the enqueue so a failure cannot resurrect it.
    if (pendingSuccessorReloadDescriptorIdentity !== null) {
      const pendingDescriptorIdentity = pendingSuccessorReloadDescriptorIdentity;
      pendingSuccessorReloadDescriptorIdentity = null;
      queueSuccessorMetroReload(pendingDescriptorIdentity);
    }
    const serializedLifecycleVerbs = Object.freeze(Object.fromEntries(
      ['reload', 'restart', 'dev-fresh', 'reload-metro', 'stop-children'].map((verb) => [
        verb,
        (context = {}) => controlDispatcher.enqueue(verb, context),
      ]),
    ));
    const inspectHttpControl = () => {
      let httpOperatorToken = supervisorOperatorToken();
      const projection = Object.freeze({
        available: typeof httpOperatorToken === 'string' && httpOperatorToken.length > 0,
        controlPath: SUPERVISED_CONTROL_PATH,
      });
      httpOperatorToken = null;
      return projection;
    };
    let httpControl = inspectHttpControl();
    if (options.controlSocket === true) {
      controlSocketHandle = await startDevControlSocketWithDependencies({
        readyFile: dev.readyFile,
        pathChainRoot: projectRoot,
        ownerIncarnationId: generation,
        ownerStartTime: supervisorProcessIdentity.startTime,
        startedAt,
        cleanupLease,
        verbs: {
          'reload-metro': reloadMetroVerb,
          'stop-children': stopChildrenVerb,
        },
        onUnavailable(diagnostic) {
          controlSocketUnavailable = Object.freeze({
            ...diagnostic,
            details: Object.freeze({
              ...diagnostic.details,
              httpControl,
            }),
          });
          emit({
            ok: true,
            state: 'control-socket-unavailable',
            notice: controlSocketUnavailable.message,
            diagnostics: [controlSocketUnavailable],
          });
        },
      }, {
        dispatcher: controlDispatcher,
        afterEndpointLeaseActivation: options.afterControlEndpointLeaseActivation,
      });
    }
    httpControl = inspectHttpControl();
    if (
      controlSocketHandle === null
      && options.requireControlCarrier === true
      && !httpControl.available
    ) {
      const unavailableDetails = {
        ...(controlSocketUnavailable?.details ?? {}),
        httpControl,
      };
      const unavailableDiagnostic = requiredDevControlChannelDiagnostic({
        unavailableDetails,
        stdinControl: options.stdinControl,
        readyFile: dev.readyFile,
      });
      throw diagnosticError(
        unavailableDiagnostic.code,
        unavailableDiagnostic.message,
        unavailableDiagnostic.details,
      );
    }
    assertStartupActive();
    const finalReadiness = {
      ok: true,
      state: finalState,
      connectCarrier: SUPERVISED_CONNECT_CARRIER,
      ...createExpoRoutingReadiness(route),
      binding: publicBinding(bindingProjection),
      applicationReady: applicationReceiptProjection,
      authority: authority.status === 'ready'
        ? { status: 'ready', kind: 'session', authMode: 'sessions' }
        : authority,
      backend: { pid: dev.child?.pid ?? null, origin: backendRoute.origin },
      snapbackUrl: dev.snapbackUrl,
      androidEmulatorUrl: dev.androidEmulatorUrl,
      ...(dev.environmentFile === null ? {} : { environmentFile: dev.environmentFile }),
      metro: metroReadiness,
      bootstrap: bootstrapReadiness,
      controlPath: SUPERVISED_CONTROL_PATH,
      controlSocket: controlSocketHandle?.descriptor ?? null,
      portPlan,
      adminConsoleCommand: `snapback admin --ready-file ${JSON.stringify(dev.readyFile)}`,
    };
    supervisorDescriptorTemporaryFile = `${supervisorDescriptorFile}.${process.pid}.${correlationId}.tmp`;
    supervisorDescriptorCleanupResource = reserveCleanupPath(
      cleanupLease,
      supervisorDescriptorFile,
      { type: 'file', label: 'Expo supervisor readiness' },
    );
    supervisorDescriptorTemporaryCleanupResource = reserveCleanupPath(
      cleanupLease,
      supervisorDescriptorTemporaryFile,
      {
        type: 'file',
        label: 'Expo supervisor readiness temporary',
        leaseUnique: true,
      },
    );
    publishSupervisorDescriptorAtomically(supervisorDescriptorFile, {
      schemaVersion: EXPO_SUPERVISOR_DESCRIPTOR_FORMAT,
      formatVersion: 1,
      state: finalState,
      correlationId,
      supervisorGeneration: generation,
      pid: process.pid,
      supervisor: {
        pid: process.pid,
        startTime: supervisorProcessIdentity.startTime,
      },
      platform: route.platform,
      connectCarrier: SUPERVISED_CONNECT_CARRIER,
      portPlan,
      binding: publicBinding(bindingProjection),
      applicationReady: applicationReceiptProjection,
      exchangeOrigin: bootstrap.origin,
      controlPath: SUPERVISED_CONTROL_PATH,
      controlSocket: controlSocketHandle?.descriptor ?? null,
      // @ref LLP 0151#shared-development-browser-adapter — the supervisor is
      // the only process that knows whether the shared broker exists and
      // whether deployment state admits it. Recording the projection here lets
      // a separate process read that fact instead of guessing from the
      // presence of a dev readiness file, which plain `snapback dev` writes
      // without ever serving the broker.
      sharedAuth: sharedAuthProjection,
      metro: metroReadiness,
      ...(metroAttestation === null ? {} : {
        attestation: {
          path: metroAttestation.path,
          nonce: metroAttestation.nonce,
        },
      }),
      listeners,
      startedAt,
    }, supervisorDescriptorTemporaryFile);
    releaseCleanupResource(supervisorDescriptorTemporaryCleanupResource);
    supervisorDescriptorTemporaryCleanupResource = null;
    supervisorDescriptorTemporaryFile = null;
    activateCleanupPath(supervisorDescriptorCleanupResource, {
      runIdField: 'supervisorGeneration',
      runId: generation,
    });
    emit(finalReadiness);
    // Give already-queued child exit/error notifications one turn to latch.
    // A child that died before the descriptor publish/return boundary must
    // turn startup into a refusal and remove that descriptor.
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assertStartupActive();
    startupPublished = true;

    const currentApplicationReceiptProjection = () => {
      try {
        return publicApplicationReceipt(
          dev.applicationReadyFile,
          readApplicationReadyReceipt(dev.applicationReadyFile),
        );
      } catch (error) {
        if ((closed || backendControlClosed || backendControlStopAttempted)
            && applicationReceiptProjection !== null) return applicationReceiptProjection;
        throw error;
      }
    };

    return Object.freeze({
      schemaVersion: EXPO_DEV_EVENT_FORMAT,
      ok: true,
      get state() {
        return 'ready';
      },
      correlationId,
      supervisorGeneration: generation,
      connectCarrier: SUPERVISED_CONNECT_CARRIER,
      device: route.device,
      get binding() {
        return publicBinding(bindingProjection);
      },
      get applicationReady() {
        return currentApplicationReceiptProjection();
      },
      exchangeOrigin: bootstrap.origin,
      metroOrigin: `http://${LOOPBACK_HOST}:${metroPort}`,
      get snapbackUrl() { return dev.snapbackUrl; },
      get androidEmulatorUrl() { return dev.androidEmulatorUrl; },
      get environmentFile() { return dev.environmentFile; },
      get portPlan() { return portPlan; },
      get listeners() { return listeners; },
      get controlSocket() { return controlSocketHandle?.descriptor ?? null; },
      verbs: Object.freeze({ ...dev.verbs, ...serializedLifecycleVerbs }),
      async replaceAuthority(email) {
        if (closed) {
          throw diagnosticError('SNAPBACK_EXPO_SUPERVISOR_CLOSED', 'the Expo supervisor is closed');
        }
        return mintAndSwapAuthority(email, { pending: true });
      },
      inspection() {
        return Object.freeze({
          correlationId,
          authorityMintCount,
          listeners,
          binding: publicBinding(bindingProjection),
          applicationReady: currentApplicationReceiptProjection(),
          portPlan,
          metro: metro === null ? null : Object.freeze({
            pid: metro.child.pid,
            origin: `http://${LOOPBACK_HOST}:${metroPort}`,
            logs: Object.freeze([...metro.logs]),
          }),
          readiness: Object.freeze([...events]),
        });
      },
      reportControlEvent(event) {
        return emit({
          ok: event?.ok !== false,
          state: 'control-event',
          control: event,
        });
      },
      close,
    });
  } catch (error) {
    try { await closeSupervisor(); } catch { /* original startup refusal wins */ }
    emit({
      ok: false,
      state: 'startup-failed',
      diagnostics: [error?.diagnostic ?? clientDiagnostic(
        error,
        'SNAPBACK_EXPO_DEV_FAILED',
        error?.message ?? String(error),
      )],
    });
    throw error;
  }
}

export const __test = Object.freeze({
  allocateSupervisorPortCandidates,
  bindPlannedSupervisorListeners,
  probeDevControlEndpoint,
  publishSupervisorDescriptorAtomically,
  readSupervisedImpersonationCapability,
  requiredDevControlChannelDiagnostic,
  startDevControlSocketWithDependencies,
  startMetroWebFront,
});
