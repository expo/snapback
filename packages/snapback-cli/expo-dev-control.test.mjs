import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  __test as expoDevTest,
  EXPO_SUPERVISOR_DESCRIPTOR_FORMAT,
  startDevControlSocket,
} from './expo-dev.mjs';
import {
  __test as teardownTest,
  CLEANUP_LEASE_DIRECTORY_ENV,
  closeCarrierCleanupLease,
  createCarrierCleanupLease,
} from './process-teardown.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const scratchRoot = mkdtempSync(join(tmpdir(), 'sbctl-unit-'));
const holderScript = join(scratchRoot, 'holder.mjs');
const holders = new Set();

writeFileSync(holderScript, `
import { startDevControlSocket } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'expo-dev.mjs')).href)};
import { openCarrierCleanupLease } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'process-teardown.mjs')).href)};

const readyFile = process.argv[2];
const ownerIncarnationId = process.argv[3];
const startedAt = new Date().toISOString();
const cleanupLease = process.env.SNAPBACK_CARRIER_CLEANUP_LEASE_DIRECTORY
  ? openCarrierCleanupLease(process.env)
  : null;
const control = await startDevControlSocket({
  readyFile,
  ownerIncarnationId,
  ownerStartTime: 'unit-holder-start',
  startedAt,
  cleanupLease,
  verbs: {
    'reload-metro': async () => ({ ok: true }),
    'stop-children': async () => ({ ok: true }),
  },
});
process.stdout.write(JSON.stringify({ startedAt, descriptor: control.descriptor }) + '\\n');
setInterval(() => {}, 60_000);
`);

async function eventually(check, { timeoutMs = 10_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function testOptions(root, ownerIncarnationId, extra = {}) {
  return {
    readyFile: join(root, 'dev.ready.json'),
    ownerIncarnationId,
    ownerStartTime: 'unit-owner-start',
    startedAt: new Date().toISOString(),
    verbs: {
      'reload-metro': async () => ({ ok: true }),
      'stop-children': async () => ({ ok: true }),
    },
    ...extra,
  };
}

async function startHolder(root, ownerIncarnationId, cleanupLease = null) {
  const child = spawn(process.execPath, [holderScript, join(root, 'dev.ready.json'), ownerIncarnationId], {
    env: {
      ...process.env,
      ...(cleanupLease === null ? {} : {
        [CLEANUP_LEASE_DIRECTORY_ENV]: cleanupLease.directory,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const published = await eventually(() => {
    const newline = stdout.indexOf('\n');
    if (newline !== -1) return JSON.parse(stdout.slice(0, newline));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`holder exited before readiness: ${stderr || stdout}`);
    }
    return false;
  }, { label: `${ownerIncarnationId} holder readiness` });
  holders.add(child);
  return { child, ...published };
}

async function killHolder(holder) {
  if (holder.child.exitCode !== null || holder.child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => holder.child.once('exit', resolveExit));
  holder.child.kill('SIGKILL');
  await exited;
  holders.delete(holder.child);
}

function publishSupervisorDescriptor(root, holder) {
  writeFileSync(join(root, 'expo-supervisor.json'), `${JSON.stringify({
    schemaVersion: EXPO_SUPERVISOR_DESCRIPTOR_FORMAT,
    supervisorGeneration: holder.descriptor.ownerIncarnationId,
    supervisor: {
      pid: holder.descriptor.ownerPid,
      startTime: holder.descriptor.ownerStartTime,
    },
    controlSocket: holder.descriptor,
    startedAt: holder.startedAt,
  }, null, 2)}\n`, { mode: 0o600 });
}

async function assertRefusal(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.diagnostic?.code ?? error?.code, code);
    return true;
  });
}

async function assertIncompleteClientCloses(path, { idle = false } = {}) {
  await new Promise((resolveClose, rejectClose) => {
    const socket = createConnection(path);
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectClose(new Error(`incomplete control client was retained after ${idle ? 'idle deadline' : 'EOF'}`));
    }, 2_000);
    socket.once('connect', () => {
      socket.write('{"schemaVersion":"snapback.dev-control-command.v1"');
      if (!idle) socket.end();
    });
    socket.once('error', rejectClose);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolveClose();
    });
  });
}

function stopChildrenCommand(control, requestId) {
  return {
    schemaVersion: 'snapback.dev-control-command.v1',
    requestId,
    verb: 'stop-children',
    owner: {
      pid: control.descriptor.ownerPid,
      uid: control.descriptor.ownerUid,
      incarnationId: control.descriptor.ownerIncarnationId,
    },
    lifecycleReceipt: control.descriptor.lifecycleReceipt,
  };
}

async function sendControlFin(control, command) {
  await new Promise((resolveSent, rejectSent) => {
    const socket = createConnection(control.descriptor.path);
    socket.once('connect', () => {
      socket.end(`${JSON.stringify(command)}\n`, resolveSent);
    });
    socket.once('error', rejectSent);
  });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

try {
  const makeRoot = (name) => {
    const root = join(scratchRoot, name);
    mkdirSync(root);
    return root;
  };
  const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.match(
    packageManifest.scripts.test,
    /node expo-dev-loop\.test\.mjs/u,
    'the package suite must run the Expo lifecycle witness',
  );
  assert.match(
    readFileSync(join(packageRoot, 'expo-dev-loop.test.mjs'), 'utf8'),
    /else \{\s*\/\/ The package-default suite owns the E1 no-TTY witness too;[\s\S]*?await runControlSocketSuite\(\);/u,
    'the default Expo lifecycle suite must retain the no-TTY E1 control-socket witness',
  );

  const uidlessRoot = makeRoot('n');
  const unavailableNotices = [];
  const uidlessControl = await expoDevTest.startDevControlSocketWithDependencies(
    testOptions(uidlessRoot, 'unit-uidless-owner', {
      onUnavailable: (diagnostic) => unavailableNotices.push(diagnostic),
    }),
    { getuid: undefined },
  );
  assert.equal(uidlessControl, null);
  assert.equal(unavailableNotices.length, 1);
  assert.equal(unavailableNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(unavailableNotices[0].severity, 'warning');
  assert.equal(existsSync(join(uidlessRoot, 'dev-control.sock')), false);
  console.log('uid custody unavailable: stdin-only fallback remains live');

  const unpublishedRoot = makeRoot('p');
  const unpublishedHolder = await startHolder(unpublishedRoot, 'unit-unpublished-owner');
  const unpublishedEndpoint = { ...unpublishedHolder.descriptor.endpoint };
  const unpublishedOwnerStatePath = join(unpublishedRoot, 'dev-control.owner.json');
  const unpublishedOwnerState = JSON.parse(readFileSync(unpublishedOwnerStatePath, 'utf8'));
  const unpublishedOwnerStateMetadata = lstatSync(unpublishedOwnerStatePath);
  assert.equal(unpublishedOwnerStateMetadata.mode & 0o777, 0o600);
  assert.equal(unpublishedOwnerState.phase, 'bound');
  assert.equal(unpublishedOwnerState.ownerIncarnationId, 'unit-unpublished-owner');
  assert.deepEqual(unpublishedOwnerState.endpoint, unpublishedEndpoint);
  assert.equal(unpublishedOwnerState.path, unpublishedHolder.descriptor.path);
  await killHolder(unpublishedHolder);
  assert.equal(
    existsSync(unpublishedHolder.descriptor.path),
    true,
    'SIGKILL before expo-supervisor.json publication must leave the kernel socket inode',
  );
  const unpublishedSuccessor = await startDevControlSocket(
    testOptions(unpublishedRoot, 'unit-unpublished-successor'),
  );
  assert.notEqual(unpublishedSuccessor.descriptor.endpoint.inode, unpublishedEndpoint.inode);
  await unpublishedSuccessor.close();
  console.log('pre-descriptor owner death: prepublished inode/incarnation reclaimed and rebound');

  const staleRoot = makeRoot('s');
  const staleHolder = await startHolder(staleRoot, 'unit-stale-owner');
  publishSupervisorDescriptor(staleRoot, staleHolder);
  const staleEndpoint = { ...staleHolder.descriptor.endpoint };
  await killHolder(staleHolder);
  assert.equal(existsSync(staleHolder.descriptor.path), true, 'SIGKILL must leave the kernel socket inode');
  const relaunched = await startDevControlSocket(testOptions(staleRoot, 'unit-successor-owner'));
  assert.notEqual(relaunched.descriptor.endpoint.inode, staleEndpoint.inode);
  await relaunched.close();
  console.log('dead same-uid endpoint: exact stale inode/incarnation reclaimed and rebound');

  const contenderRoot = makeRoot('q');
  const contenderHolder = await startHolder(contenderRoot, 'unit-contender-stale');
  await killHolder(contenderHolder);
  const firstAtUnlink = deferred();
  const releaseFirst = deferred();
  let secondReachedUnlink = false;
  const firstContender = expoDevTest.startDevControlSocketWithDependencies(
    testOptions(contenderRoot, 'unit-contender-first'),
    {
      async beforeReclaimUnlink() {
        firstAtUnlink.resolve();
        await releaseFirst.promise;
      },
    },
  );
  await firstAtUnlink.promise;
  const secondContender = expoDevTest.startDevControlSocketWithDependencies(
    testOptions(contenderRoot, 'unit-contender-second'),
    {
      beforeReclaimUnlink() { secondReachedUnlink = true; },
    },
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  assert.equal(
    secondReachedUnlink,
    false,
    'a second reclaimer must wait outside the first recheck/unlink/bind lock',
  );
  releaseFirst.resolve();
  const contenderResults = await Promise.allSettled([firstContender, secondContender]);
  const contenderWinner = contenderResults.find((result) => result.status === 'fulfilled');
  const contenderLoser = contenderResults.find((result) => result.status === 'rejected');
  assert(contenderWinner, 'one serialized contender must bind the successor endpoint');
  assert.equal(
    contenderLoser?.reason?.diagnostic?.code,
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
  );
  assert.equal(existsSync(contenderWinner.value.descriptor.path), true);
  await contenderWinner.value.close();
  console.log('two reclaimers: shared lock serializes recheck, unlink, and successor bind');

  const reaperRaceRoot = makeRoot('x');
  const reaperRaceHolder = await startHolder(reaperRaceRoot, 'unit-reaper-stale');
  const reaperRaceStatePath = join(reaperRaceRoot, 'dev-control.owner.json');
  const reaperRaceStateMetadata = lstatSync(reaperRaceStatePath);
  const staleReaperResource = {
    state: 'active',
    pathType: 'socket',
    path: reaperRaceHolder.descriptor.path,
    socketIdentity: {
      ...reaperRaceHolder.descriptor.endpoint,
      ownerIncarnationId: reaperRaceHolder.descriptor.ownerIncarnationId,
    },
    ownerStateIdentity: {
      path: reaperRaceStatePath,
      device: String(reaperRaceStateMetadata.dev),
      inode: String(reaperRaceStateMetadata.ino),
      ownerIncarnationId: reaperRaceHolder.descriptor.ownerIncarnationId,
    },
  };
  await killHolder(reaperRaceHolder);
  const successorPublished = deferred();
  const releaseSuccessor = deferred();
  const racingSuccessorPromise = expoDevTest.startDevControlSocketWithDependencies(
    testOptions(reaperRaceRoot, 'unit-reaper-successor'),
    {
      async afterEndpointPublish() {
        successorPublished.resolve();
        await releaseSuccessor.promise;
      },
    },
  );
  await successorPublished.promise;
  let reaperSettled = false;
  const racingReaper = teardownTest.cleanupExactPath(staleReaperResource)
    .finally(() => { reaperSettled = true; });
  await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  assert.equal(reaperSettled, false, 'the stale reaper must wait for successor publication');
  releaseSuccessor.resolve();
  const racingSuccessor = await racingSuccessorPromise;
  assert.equal(await racingReaper, false, 'the stale lease must discharge on the successor inode');
  assert.equal(existsSync(racingSuccessor.descriptor.path), true);
  assert.equal(
    String(lstatSync(racingSuccessor.descriptor.path).ino),
    racingSuccessor.descriptor.endpoint.inode,
  );
  await racingSuccessor.close();
  console.log('reaper versus bind: stale deletion waits and preserves the successor inode');

  const liveRoot = makeRoot('l');
  const liveHolder = await startHolder(liveRoot, 'unit-live-owner');
  publishSupervisorDescriptor(liveRoot, liveHolder);
  await assertRefusal(
    () => startDevControlSocket(testOptions(liveRoot, 'unit-live-contender')),
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
  );
  await killHolder(liveHolder);
  rmSync(liveHolder.descriptor.path, { force: true });
  console.log('live same-uid endpoint: foreign owner refused');

  const uidRoot = makeRoot('u');
  const uidHolder = await startHolder(uidRoot, 'unit-uid-owner');
  publishSupervisorDescriptor(uidRoot, uidHolder);
  await assertRefusal(
    () => expoDevTest.startDevControlSocketWithDependencies(
      testOptions(uidRoot, 'unit-uid-contender'),
      {
        observeEndpoint(path) {
          const observed = lstatSync(path);
          return Object.freeze({
            uid: (typeof process.getuid === 'function' ? process.getuid() : observed.uid) + 1,
            mode: observed.mode & 0o777,
            device: String(observed.dev),
            inode: String(observed.ino),
          });
        },
      },
    ),
    'SNAPBACK_DEV_CONTROL_OTHER_UID',
  );
  await killHolder(uidHolder);
  rmSync(uidHolder.descriptor.path, { force: true });
  console.log('simulated other-uid endpoint: custody refusal precedes adoption');

  const connectionRoot = makeRoot('c');
  const connectionControl = await startDevControlSocket(testOptions(
    connectionRoot,
    'unit-connection-owner',
    { connectionIdleTimeoutMs: 100 },
  ));
  await assertIncompleteClientCloses(connectionControl.descriptor.path);
  await assertIncompleteClientCloses(connectionControl.descriptor.path, { idle: true });
  await connectionControl.close();
  console.log('incomplete clients: EOF and idle deadline both release the connection');

  const finRoot = makeRoot('f');
  const stopQueued = deferred();
  const finControl = await expoDevTest.startDevControlSocketWithDependencies(
    testOptions(
      finRoot,
      'unit-fin-owner',
      {
        verbs: {
          'reload-metro': async () => ({ ok: true }),
          'stop-children': async () => {
            stopQueued.resolve();
            return { ok: true };
          },
        },
      },
    ),
    {
      writeAcknowledgement(socket) {
        socket.destroy();
        throw new Error('simulated peer reset before acknowledgement');
      },
    },
  );
  await sendControlFin(finControl, stopChildrenCommand(finControl, 'fin-stop'));
  await eventually(() => stopQueued.promise.then(() => true), {
    label: 'FIN-disconnected stop-children dispatch',
  });
  await eventually(() => finControl.closed, { label: 'FIN-disconnected control close' });
  console.log('stop-children FIN: work is queued before acknowledgement and completes');

  const leasedRoot = makeRoot('r');
  const cleanupLease = await createCarrierCleanupLease();
  try {
    const leasedHolder = await startHolder(leasedRoot, 'unit-leased-owner', cleanupLease);
    await killHolder(leasedHolder);
    await eventually(
      () => !existsSync(leasedHolder.descriptor.path),
      { label: 'cleanup lease socket reap after owner SIGKILL' },
    );
  } finally {
    await closeCarrierCleanupLease(cleanupLease);
  }
  console.log('cleanup lease: owner death reaps the exact socket inode');
} finally {
  await Promise.all([...holders].map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    child.kill('SIGKILL');
    await exited;
  }));
  rmSync(scratchRoot, { recursive: true, force: true });
}

console.log('expo-dev-control.test.mjs: all assertions passed');
