import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  activateCleanupPath,
  CLEANUP_LEASE_DIRECTORY_ENV,
  closeCarrierCleanupLease,
  createCarrierCleanupLease,
  rebindCleanupPath,
  reserveCleanupPath,
  withCleanupPathLock,
} from './process-teardown.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const scratchRoot = mkdtempSync(join(tmpdir(), 'sbctl-unit-'));
const holderScript = join(scratchRoot, 'holder.mjs');
const pathLockScript = join(scratchRoot, 'path-lock-holder.mjs');
const foreignSocketScript = join(scratchRoot, 'foreign-socket-holder.mjs');
const holders = new Set();

writeFileSync(holderScript, `
import { __test, startDevControlSocket } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'expo-dev.mjs')).href)};
import { writeSync } from 'node:fs';
import { openCarrierCleanupLease } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'process-teardown.mjs')).href)};

const readyFile = process.argv[2];
const ownerIncarnationId = process.argv[3];
const startedAt = new Date().toISOString();
const cleanupLease = process.env.SNAPBACK_CARRIER_CLEANUP_LEASE_DIRECTORY
  ? openCarrierCleanupLease(process.env)
  : null;
const options = {
  readyFile,
  ownerIncarnationId,
  ownerStartTime: 'unit-holder-start',
  startedAt,
  cleanupLease,
  verbs: {
    'reload-metro': async () => ({ ok: true }),
    'stop-children': async () => ({ ok: true }),
  },
};
const injectedDependencies = process.env.SNAPBACK_TEST_CRASH_PREACTIVATION_SOCKET === '1'
  ? {
      afterEndpointListen(details) {
        writeSync(1, JSON.stringify({ state: 'endpoint-listened-reserved', ...details }) + '\\n');
        process.kill(process.pid, 'SIGKILL');
      },
    }
  : process.env.SNAPBACK_TEST_STALL_BOUND_SOCKET === '1'
    ? {
      async afterEndpointLeaseActivation(details) {
        process.stdout.write(JSON.stringify({ state: 'endpoint-lease-activated', ...details }) + '\\n');
        await new Promise(() => {});
      },
    }
    : null;
const control = injectedDependencies === null
  ? await startDevControlSocket(options)
  : await __test.startDevControlSocketWithDependencies(options, injectedDependencies);
process.stdout.write(JSON.stringify({ startedAt, descriptor: control.descriptor }) + '\\n');
setInterval(() => {}, 60_000);
`);

writeFileSync(pathLockScript, `
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withCleanupPathLock } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'process-teardown.mjs')).href)};

const endpointPath = process.argv[2];
const mode = process.argv[3];
const contenderId = process.argv[4];
const releaseFile = process.argv[5];
const stall = () => new Promise(() => { setInterval(() => {}, 60_000); });
try {
  await withCleanupPathLock(endpointPath, async () => {
    const lockOwner = JSON.parse(readFileSync(join(dirname(endpointPath), '.dc-lock'), 'utf8'));
    process.stdout.write(JSON.stringify({ state: mode === 'stale-contender' || mode.startsWith('publication-') ? 'protected-action' : 'lock-acquired', contenderId, lockOwner }) + '\\n');
    await stall();
  }, {
    timeoutMs: mode.startsWith('publication-') ? 1_500 : mode === 'stale-contender' ? 5_000 : 10_000,
    ...(mode === 'publication-paused' ? {
      afterLockRecordOpened() {
        process.stdout.write(JSON.stringify({ state: 'lock-record-opened', contenderId }) + '\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      },
    } : {}),
    ...(mode === 'die-while-reclaiming' ? {
      async afterReclaimMarkerAcquired() {
        process.stdout.write(JSON.stringify({ state: 'reclaim-marker-acquired' }) + '\\n');
        await stall();
      },
    } : {}),
    ...(mode === 'die-after-stale-claim' ? {
      async afterStaleReclaimClaimAcquired({ claimFiles }) {
        process.stdout.write(JSON.stringify({ state: 'stale-claim-acquired', claimFiles }) + '\\n');
        await stall();
      },
    } : {}),
    ...(mode === 'stale-contender' ? {
      async afterStaleReclaimMarkerObserved({ marker }) {
        process.stdout.write(JSON.stringify({
          state: 'stale-reclaim-observed',
          contenderId,
          marker: {
            device: marker.device,
            inode: marker.inode,
            modifiedAtMs: marker.modifiedAtMs,
            bytes: marker.bytes,
          },
        }) + '\\n');
        while (!existsSync(releaseFile)) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        }
      },
    } : {}),
  });
} catch (error) {
  process.stdout.write(JSON.stringify({ state: 'refused', contenderId, code: error?.code }) + '\\n');
}
`);

writeFileSync(foreignSocketScript, `
import { lstatSync } from 'node:fs';
import { createServer } from 'node:net';

const path = process.argv[2];
const server = createServer();
server.listen(path, () => {
  const metadata = lstatSync(path);
  process.stdout.write(JSON.stringify({
    state: 'listening',
    device: String(metadata.dev),
    inode: String(metadata.ino),
  }) + '\\n');
});
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

async function startBoundSocketHolder(root, ownerIncarnationId, cleanupLease) {
  const child = spawn(process.execPath, [holderScript, join(root, 'dev.ready.json'), ownerIncarnationId], {
    env: {
      ...process.env,
      [CLEANUP_LEASE_DIRECTORY_ENV]: cleanupLease.directory,
      SNAPBACK_TEST_STALL_BOUND_SOCKET: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  holders.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const barrier = await eventually(() => {
    const newline = stdout.indexOf('\n');
    if (newline !== -1) return JSON.parse(stdout.slice(0, newline));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`pending-socket holder exited before its barrier: ${stderr || stdout}`);
    }
    return false;
  }, { label: 'pending-socket bind barrier' });
  return { child, barrier };
}

async function startPreActivationCrash(root, ownerIncarnationId, cleanupLease) {
  const child = spawn(process.execPath, [holderScript, join(root, 'dev.ready.json'), ownerIncarnationId], {
    env: {
      ...process.env,
      [CLEANUP_LEASE_DIRECTORY_ENV]: cleanupLease.directory,
      SNAPBACK_TEST_CRASH_PREACTIVATION_SOCKET: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  holders.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const barrier = await eventually(() => {
    const newline = stdout.indexOf('\n');
    if (newline !== -1) return JSON.parse(stdout.slice(0, newline));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`pre-activation holder exited before its barrier: ${stderr || stdout}`);
    }
    return false;
  }, { label: 'pre-activation socket bind barrier' });
  await eventually(
    () => child.signalCode === 'SIGKILL',
    { label: 'pre-activation holder SIGKILL' },
  );
  holders.delete(child);
  return { child, barrier };
}

async function killHolder(holder) {
  if (holder.child.exitCode !== null || holder.child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => holder.child.once('exit', resolveExit));
  holder.child.kill('SIGKILL');
  await exited;
  holders.delete(holder.child);
}

async function startPathLockActor(endpointPath, mode) {
  const child = spawn(process.execPath, [pathLockScript, endpointPath, mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  holders.add(child);
  const messages = [];
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline === -1) break;
      messages.push(JSON.parse(stdout.slice(0, newline)));
      stdout = stdout.slice(newline + 1);
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = await eventually(() => {
    if (messages.length > 0) return messages[0];
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`path-lock actor exited before its barrier: ${stderr || stdout}`);
    }
    return false;
  }, { label: `${mode} path-lock barrier` });
  return { child, ready, messages };
}

async function startForeignSocketHolder(endpointPath) {
  const child = spawn(process.execPath, [foreignSocketScript, endpointPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  holders.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = await eventually(() => {
    const newline = stdout.indexOf('\n');
    if (newline !== -1) return JSON.parse(stdout.slice(0, newline));
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`foreign socket holder exited before readiness: ${stderr || stdout}`);
    }
    return false;
  }, { label: 'foreign socket collision readiness' });
  return { child, ...ready };
}

async function startStaleReclaimContender(endpointPath, contenderId, releaseFile) {
  const child = spawn(
    process.execPath,
    [pathLockScript, endpointPath, 'stale-contender', contenderId, releaseFile],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  holders.add(child);
  const messages = [];
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline === -1) break;
      messages.push(JSON.parse(stdout.slice(0, newline)));
      stdout = stdout.slice(newline + 1);
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await eventually(
    () => messages.find((message) => message.state === 'stale-reclaim-observed')
      ?? (child.exitCode !== null || child.signalCode !== null
        ? Promise.reject(new Error(`stale contender exited before observation: ${stderr || stdout}`))
        : false),
    { label: `${contenderId} stale-reclaim observation` },
  );
  return { child, messages };
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

async function assertRefusal(action, code, inspect = () => {}) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.diagnostic?.code ?? error?.code, code);
    inspect(error);
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
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
    return root;
  };
  const makeRootWithByteLength = (byteLength) => {
    const prefixBytes = Buffer.byteLength(`${scratchRoot}/`);
    const root = join(scratchRoot, 'w'.repeat(byteLength - prefixBytes));
    assert.equal(Buffer.byteLength(root), byteLength);
    mkdirSync(root, { mode: 0o700 });
    chmodSync(root, 0o700);
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

  const atomicDescriptorRoot = makeRoot('atomic-descriptor');
  const atomicDescriptorPath = join(atomicDescriptorRoot, 'expo-supervisor.json');
  writeFileSync(atomicDescriptorPath, '{"supervisorGeneration":"atomic-owner","revision":1}\n', {
    mode: 0o600,
  });
  const descriptorBefore = lstatSync(atomicDescriptorPath);
  assert.equal(
    typeof expoDevTest.publishSupervisorDescriptorAtomically,
    'function',
    'Expo supervisor descriptor publication must expose the Track C atomic helper',
  );
  expoDevTest.publishSupervisorDescriptorAtomically(atomicDescriptorPath, {
    supervisorGeneration: 'atomic-owner',
    revision: 2,
  });
  const descriptorAfter = lstatSync(atomicDescriptorPath);
  assert.notEqual(descriptorAfter.ino, descriptorBefore.ino);
  assert.equal(descriptorAfter.mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(atomicDescriptorPath, 'utf8')).revision, 2);
  assert.deepEqual(
    readdirSync(atomicDescriptorRoot).filter((name) => name.endsWith('.tmp')),
    [],
  );
  const descriptorLease = await createCarrierCleanupLease();
  const leasedDescriptorPath = join(atomicDescriptorRoot, 'leased-expo-supervisor.json');
  const leasedDescriptorResource = reserveCleanupPath(descriptorLease, leasedDescriptorPath, {
    type: 'file',
    label: 'atomic supervisor descriptor regression',
  });
  writeFileSync(
    leasedDescriptorPath,
    '{"supervisorGeneration":"leased-owner","revision":1}\n',
    { mode: 0o600 },
  );
  activateCleanupPath(leasedDescriptorResource, {
    runIdField: 'supervisorGeneration',
    runId: 'leased-owner',
  });
  expoDevTest.publishSupervisorDescriptorAtomically(leasedDescriptorPath, {
    supervisorGeneration: 'leased-owner',
    revision: 2,
  });
  rebindCleanupPath(leasedDescriptorResource, {
    runIdField: 'supervisorGeneration',
    runId: 'leased-owner',
  });
  await closeCarrierCleanupLease(descriptorLease);
  assert.equal(existsSync(leasedDescriptorPath), false);
  console.log('supervisor descriptor publication: owner-only same-directory atomic replacement');

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
  assert.equal(existsSync(join(uidlessRoot, '.dc-sock')), false);
  console.log('uid custody unavailable: stdin-only fallback remains live');

  const sockaddrPathBytes = process.platform === 'darwin' ? 104 : 107;
  const advertisedPathWindowRoot = makeRootWithByteLength(
    sockaddrPathBytes - Buffer.byteLength('/.dc-sock'),
  );
  const advertisedPathWindowControl = await startDevControlSocket(
    testOptions(advertisedPathWindowRoot, 'unit-advertised-path-window-owner'),
  );
  assert.equal(
    Buffer.byteLength(advertisedPathWindowControl.descriptor.path),
    sockaddrPathBytes,
  );
  try {
    await new Promise((resolveConnect, rejectConnect) => {
      const socket = createConnection(advertisedPathWindowControl.descriptor.path);
      socket.once('connect', () => {
        socket.destroy();
        resolveConnect();
      });
      socket.once('error', (error) => rejectConnect(new Error(
        `advertised dev control path must accept connect: ${error.code}: ${error.message}`,
      )));
    });
  } finally {
    await advertisedPathWindowControl.close();
  }
  console.log(`advertised path budget: descriptor endpoint accepts connect at exact ${sockaddrPathBytes}-byte boundary`);

  const advertisedProbeRoot = makeRoot('advertised-probe');
  const advertisedProbeNotices = [];
  const advertisedProbeControl = await expoDevTest.startDevControlSocketWithDependencies(
    testOptions(advertisedProbeRoot, 'unit-advertised-probe-owner', {
      onUnavailable: (diagnostic) => advertisedProbeNotices.push(diagnostic),
    }),
    {
      async probeEndpoint() {
        throw Object.assign(new Error('injected advertised-path EINVAL'), { code: 'EINVAL' });
      },
    },
  );
  assert.equal(advertisedProbeControl, null);
  assert.equal(advertisedProbeNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(advertisedProbeNotices[0].details.cause, 'EINVAL');
  assert.equal(existsSync(join(advertisedProbeRoot, '.dc-sock')), false);
  assert.equal(existsSync(join(advertisedProbeRoot, 'dev-control.owner.json')), false);
  console.log('advertised path probe failure: coded stdin-only fallback publishes no descriptor');

  const publishCollisionRoot = makeRoot('publish-collision');
  let foreignSocketHolder = null;
  let publishCollisionControl = null;
  let publishCollisionError = null;
  try {
    publishCollisionControl = await expoDevTest.startDevControlSocketWithDependencies(
      testOptions(publishCollisionRoot, 'unit-publish-collision-owner'),
      {
        async beforeEndpointPublish({ path }) {
          foreignSocketHolder = await startForeignSocketHolder(path);
        },
      },
    );
  } catch (error) {
    publishCollisionError = error;
  }
  if (publishCollisionControl !== null) await publishCollisionControl.close();
  assert.equal(
    publishCollisionError?.diagnostic?.code,
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
    'a real same-UID endpoint created after the initial probe must refuse publication',
  );
  const collisionPath = join(publishCollisionRoot, '.dc-sock');
  assert.equal(existsSync(collisionPath), true, 'the foreign socket path must remain published');
  const collisionMetadata = lstatSync(collisionPath);
  assert.equal(String(collisionMetadata.dev), foreignSocketHolder.device);
  assert.equal(String(collisionMetadata.ino), foreignSocketHolder.inode);
  await killHolder(foreignSocketHolder);
  rmSync(collisionPath, { force: true });
  console.log('real socket publication collision: owner refuses and preserves foreign inode');

  const lockTimeoutRoot = makeRoot('lock-timeout');
  const lockTimeoutNotices = [];
  const lockTimeoutControl = await expoDevTest.startDevControlSocketWithDependencies(
    testOptions(lockTimeoutRoot, 'unit-lock-timeout-owner', {
      onUnavailable: (diagnostic) => lockTimeoutNotices.push(diagnostic),
    }),
    {
      async withPathLock() {
        throw Object.assign(new Error('injected cleanup path lock timeout'), {
          code: 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
        });
      },
    },
  );
  assert.equal(lockTimeoutControl, null);
  assert.equal(lockTimeoutNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(lockTimeoutNotices[0].details.cause, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(existsSync(join(lockTimeoutRoot, '.dc-sock')), false);
  console.log('cleanup path lock timeout: coded stdin-only fallback remains live');

  const socketModeRoot = makeRoot('socket-mode');
  const socketModeNotices = [];
  const socketModeControl = await expoDevTest.startDevControlSocketWithDependencies(
    testOptions(socketModeRoot, 'unit-socket-mode-owner', {
      onUnavailable: (diagnostic) => socketModeNotices.push(diagnostic),
    }),
    {
      observeEndpoint(endpointPath) {
        const observed = lstatSync(endpointPath);
        return Object.freeze({
          uid: observed.uid,
          mode: 0o660,
          device: String(observed.dev),
          inode: String(observed.ino),
        });
      },
    },
  );
  assert.equal(socketModeControl, null);
  assert.equal(socketModeNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(socketModeNotices[0].details.observedMode, 0o660);
  assert.equal(existsSync(join(socketModeRoot, '.dc-sock')), false);
  console.log('post-bind socket mode mismatch: coded stdin-only fallback avoids other-uid claim');

  let configuredProbeTimeout = null;
  const stalledProbeSocket = new EventEmitter();
  stalledProbeSocket.destroy = () => {};
  stalledProbeSocket.setTimeout = (timeoutMs, onTimeout) => {
    configuredProbeTimeout = timeoutMs;
    setImmediate(onTimeout);
  };
  await assert.rejects(
    () => expoDevTest.probeDevControlEndpoint('/unit/stalled-control.sock', {
      timeoutMs: 37,
      connect: () => stalledProbeSocket,
    }),
    (error) => error?.code === 'ETIMEDOUT',
  );
  assert.equal(configuredProbeTimeout, 37);
  console.log('occupied endpoint probe: socket timeout fails closed as not proven dead');

  const unpublishedRoot = makeRoot('p');
  const unpublishedHolder = await startHolder(unpublishedRoot, 'unit-unpublished-owner');
  const unpublishedEndpoint = { ...unpublishedHolder.descriptor.endpoint };
  const unpublishedOwnerStatePath = join(unpublishedRoot, 'dev-control.owner.json');
  const unpublishedOwnerState = JSON.parse(readFileSync(unpublishedOwnerStatePath, 'utf8'));
  const unpublishedOwnerStateMetadata = lstatSync(unpublishedOwnerStatePath);
  assert.equal(unpublishedOwnerStateMetadata.mode & 0o777, 0o600);
  assert.equal(unpublishedOwnerState.phase, 'bound');
  assert.equal(unpublishedOwnerState.ownerIncarnationId, 'unit-unpublished-owner');
  assert.deepEqual(unpublishedOwnerState.endpoint, {
    ...unpublishedEndpoint,
    ownerIncarnationId: 'unit-unpublished-owner',
  });
  assert.equal(unpublishedOwnerState.path, unpublishedHolder.descriptor.path);
  await killHolder(unpublishedHolder);
  assert.deepEqual(
    JSON.parse(readFileSync(unpublishedOwnerStatePath, 'utf8')),
    unpublishedOwnerState,
    'pre-descriptor death must retain the pre-publication bound owner marker',
  );
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
  console.log('dead same-uid endpoint: matching owner record reclaimed and rebound');

  const missingRecordRoot = makeRoot('m');
  const missingRecordHolder = await startHolder(missingRecordRoot, 'unit-missing-record-owner');
  await killHolder(missingRecordHolder);
  rmSync(join(missingRecordRoot, 'dev-control.owner.json'));
  await assertRefusal(
    () => startDevControlSocket(
      testOptions(missingRecordRoot, 'unit-missing-record-successor'),
    ),
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
    (error) => assert.match(error.diagnostic.details.recovery, /--ready-file/u),
  );
  rmSync(missingRecordHolder.descriptor.path, { force: true });
  console.log('dead same-uid endpoint: absent owner record refuses automatic reclamation');

  const corruptRecordRoot = makeRoot('o');
  const corruptRecordHolder = await startHolder(corruptRecordRoot, 'unit-corrupt-record-owner');
  await killHolder(corruptRecordHolder);
  writeFileSync(join(corruptRecordRoot, 'dev-control.owner.json'), '{not-json\n', { mode: 0o600 });
  await assertRefusal(
    () => startDevControlSocket(
      testOptions(corruptRecordRoot, 'unit-corrupt-record-successor'),
    ),
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
    (error) => assert.match(error.diagnostic.details.recovery, /--ready-file/u),
  );
  rmSync(corruptRecordHolder.descriptor.path, { force: true });
  console.log('dead same-uid endpoint: corrupt owner record refuses automatic reclamation');

  const mismatchRecordRoot = makeRoot('d');
  const mismatchRecordHolder = await startHolder(mismatchRecordRoot, 'unit-mismatch-record-owner');
  await killHolder(mismatchRecordHolder);
  const mismatchRecordPath = join(mismatchRecordRoot, 'dev-control.owner.json');
  const mismatchedRecord = JSON.parse(readFileSync(mismatchRecordPath, 'utf8'));
  mismatchedRecord.endpoint.inode = `${mismatchedRecord.endpoint.inode}-different`;
  writeFileSync(mismatchRecordPath, `${JSON.stringify(mismatchedRecord, null, 2)}\n`, { mode: 0o600 });
  let mismatchedRecordError = null;
  let mismatchedRecordControl = null;
  try {
    mismatchedRecordControl = await startDevControlSocket(
      testOptions(mismatchRecordRoot, 'unit-mismatch-record-successor'),
    );
  } catch (error) {
    mismatchedRecordError = error;
  }
  if (mismatchedRecordControl !== null) await mismatchedRecordControl.close();
  assert.equal(
    mismatchedRecordError?.diagnostic?.code,
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
    'a valid owner record naming another inode/incarnation must refuse reclamation',
  );
  rmSync(mismatchRecordHolder.descriptor.path, { force: true });
  console.log('dead same-uid endpoint: mismatched valid owner record refuses reclamation');

  const mismatchIncarnationRoot = makeRoot('i');
  const mismatchIncarnationHolder = await startHolder(
    mismatchIncarnationRoot,
    'unit-mismatch-incarnation-owner',
  );
  await killHolder(mismatchIncarnationHolder);
  const mismatchIncarnationPath = join(mismatchIncarnationRoot, 'dev-control.owner.json');
  const mismatchedIncarnation = JSON.parse(readFileSync(mismatchIncarnationPath, 'utf8'));
  mismatchedIncarnation.endpoint.ownerIncarnationId = 'unit-different-incarnation';
  writeFileSync(
    mismatchIncarnationPath,
    `${JSON.stringify(mismatchedIncarnation, null, 2)}\n`,
    { mode: 0o600 },
  );
  await assertRefusal(
    () => startDevControlSocket(
      testOptions(mismatchIncarnationRoot, 'unit-mismatch-incarnation-successor'),
    ),
    'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
  );
  rmSync(mismatchIncarnationHolder.descriptor.path, { force: true });
  console.log('dead same-uid endpoint: mismatched valid owner incarnation refuses reclamation');

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

  const publicationRaceRoot = makeRoot('lock-publication-race');
  const publicationRaceEndpoint = join(publicationRaceRoot, '.dc-sock');
  const pausedPublisher = await startPathLockActor(
    publicationRaceEndpoint,
    'publication-paused',
  );
  assert.equal(pausedPublisher.ready.state, 'lock-record-opened');
  const observedWellKnownBytes = existsSync(join(publicationRaceRoot, '.dc-lock'))
    ? readFileSync(join(publicationRaceRoot, '.dc-lock'), 'utf8')
    : null;
  const publicationContender = await startPathLockActor(
    publicationRaceEndpoint,
    'publication-contender',
  );
  const publicationOutcomes = await eventually(() => {
    const outcomes = [pausedPublisher, publicationContender]
      .flatMap((actor) => actor.messages)
      .filter((message) => message.state === 'protected-action' || message.state === 'refused');
    return outcomes.length === 2 ? outcomes : false;
  }, { timeoutMs: 5_000, label: 'paused lock publication contender outcomes' });
  assert.equal(
    publicationOutcomes.filter((message) => message.state === 'protected-action').length,
    1,
    'a publisher paused before lock publication and its contender must run only one protected action',
  );
  assert.notEqual(
    observedWellKnownBytes,
    '',
    'the well-known lock pathname must never expose an empty owner marker',
  );
  await Promise.all([pausedPublisher, publicationContender].map(killHolder));
  console.log('lock publication pause: complete atomic marker admits only one protected action');

  const lockRecoveryRoot = makeRoot('locks');
  const lockRecoveryEndpoint = join(lockRecoveryRoot, '.dc-sock');
  const deadLockHolder = await startPathLockActor(lockRecoveryEndpoint, 'hold-lock');
  assert.equal(deadLockHolder.ready.state, 'lock-acquired');
  await killHolder(deadLockHolder);
  assert.equal(existsSync(join(lockRecoveryRoot, '.dc-lock')), true);
  const deadReclaimer = await startPathLockActor(lockRecoveryEndpoint, 'die-while-reclaiming');
  assert.equal(
    deadReclaimer.ready.state,
    'reclaim-marker-acquired',
    'fault injection must stop after .dc-reclaim publication and before stale-lock replacement',
  );
  await killHolder(deadReclaimer);
  assert.equal(existsSync(join(lockRecoveryRoot, '.dc-reclaim')), true);
  let successorAcquired = false;
  await withCleanupPathLock(lockRecoveryEndpoint, async () => {
    successorAcquired = true;
  }, { timeoutMs: 5_000 });
  assert.equal(successorAcquired, true);
  assert.equal(existsSync(join(lockRecoveryRoot, '.dc-lock')), false);
  assert.equal(existsSync(join(lockRecoveryRoot, '.dc-reclaim')), false);
  console.log('coordination markers: successor recovers after reclaimer SIGKILL');

  const takeoverRaceRoot = makeRoot('takeover-race');
  const takeoverRaceEndpoint = join(takeoverRaceRoot, '.dc-sock');
  const takeoverDeadLockHolder = await startPathLockActor(takeoverRaceEndpoint, 'hold-lock');
  await killHolder(takeoverDeadLockHolder);
  const takeoverDeadReclaimer = await startPathLockActor(
    takeoverRaceEndpoint,
    'die-while-reclaiming',
  );
  await killHolder(takeoverDeadReclaimer);
  const takeoverDeadClaimant = await startPathLockActor(
    takeoverRaceEndpoint,
    'die-after-stale-claim',
  );
  assert.equal(
    takeoverDeadClaimant.ready.state,
    'stale-claim-acquired',
    'fault injection must stop after the generation claim and before .dc-reclaim replacement',
  );
  await killHolder(takeoverDeadClaimant);
  const takeoverReleaseFile = join(takeoverRaceRoot, 'release-stale-contenders');
  const staleContenders = await Promise.all([
    startStaleReclaimContender(takeoverRaceEndpoint, 'first', takeoverReleaseFile),
    startStaleReclaimContender(takeoverRaceEndpoint, 'second', takeoverReleaseFile),
  ]);
  const observedGenerations = staleContenders.map(({ messages }) => (
    messages.find((message) => message.state === 'stale-reclaim-observed').marker
  ));
  assert.deepEqual(
    observedGenerations[0],
    observedGenerations[1],
    'both contenders must park after observing the same stale reclaim generation',
  );
  writeFileSync(takeoverReleaseFile, 'release\n', { mode: 0o600 });
  const takeoverOutcomes = await eventually(() => {
    const messages = staleContenders.flatMap((contender) => contender.messages)
      .filter((message) => message.state === 'protected-action' || message.state === 'refused');
    return messages.length === 2 ? messages : false;
  }, { label: 'stale reclaim contender outcomes' });
  const takeoverEntrants = takeoverOutcomes.filter((message) => message.state === 'protected-action');
  const takeoverRefusals = takeoverOutcomes.filter((message) => message.state === 'refused');
  assert.equal(
    takeoverEntrants.length,
    1,
    'exactly one stale-generation contender may enter the protected action',
  );
  assert.equal(takeoverRefusals.length, 1);
  assert.equal(takeoverRefusals[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.deepEqual(
    JSON.parse(readFileSync(join(takeoverRaceRoot, '.dc-lock'), 'utf8')),
    takeoverEntrants[0].lockOwner,
    'the losing contender must leave the winning lock owner marker intact',
  );
  assert.deepEqual(
    readdirSync(takeoverRaceRoot).filter((name) => name.startsWith('.dc-t-')),
    [],
    'the winning live .dc-lock publication must remove stale-generation claim markers',
  );
  await Promise.all(staleContenders.map(killHolder));
  console.log('stale reclaimer claim crash: later race yields one winner, preserves its lock, and removes tombstones');

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

  {
    const reservedReaperRaceRoot = makeRoot('reserved-reaper-race');
    const reservedSuccessorPublished = deferred();
    const releaseReservedSuccessor = deferred();
    const reservedSuccessorPromise = expoDevTest.startDevControlSocketWithDependencies(
      testOptions(reservedReaperRaceRoot, 'unit-reserved-reaper-successor'),
      {
        async afterEndpointPublish() {
          reservedSuccessorPublished.resolve();
          await releaseReservedSuccessor.promise;
        },
      },
    );
    await reservedSuccessorPublished.promise;
    const reservedReaperResource = {
      state: 'reserved',
      pathType: 'socket',
      path: join(reservedReaperRaceRoot, '.dc-sock'),
      pendingOwnerState: {
        path: join(reservedReaperRaceRoot, 'dev-control.owner.json'),
        endpointPath: join(reservedReaperRaceRoot, '.dc-sock'),
        ownerIncarnationId: 'unit-dead-reserved-owner',
        ownerUid: typeof process.getuid === 'function' ? process.getuid() : 0,
      },
    };
    let reservedReaperSettled = false;
    const reservedRacingReaper = teardownTest.cleanupExactPath(reservedReaperResource)
      .finally(() => { reservedReaperSettled = true; });
    await new Promise((resolveWait) => setTimeout(resolveWait, 75));
    assert.equal(
      reservedReaperSettled,
      false,
      'the reserved stale reaper must wait for successor publication',
    );
    releaseReservedSuccessor.resolve();
    const reservedSuccessor = await reservedSuccessorPromise;
    const reservedReaperResult = await reservedRacingReaper;
    const reservedSuccessorSurvived = existsSync(reservedSuccessor.descriptor.path)
      && String(lstatSync(reservedSuccessor.descriptor.path).ino)
        === reservedSuccessor.descriptor.endpoint.inode;
    await reservedSuccessor.close();
    assert.equal(
      reservedReaperResult,
      false,
      'a reserved lease has no endpoint identity and must discharge without unlinking',
    );
    assert.equal(
      reservedSuccessorSurvived,
      true,
      'the successor inode must survive a stale reserved cleanup record',
    );
    console.log('reserved reaper versus bind: stale reservation preserves the live successor inode');
  }

  {
    const preActivationRoot = makeRoot('preactivation-crash');
    const preActivationLease = await createCarrierCleanupLease();
    try {
      const crashed = await startPreActivationCrash(
        preActivationRoot,
        'unit-preactivation-owner',
        preActivationLease,
      );
      assert.equal(crashed.barrier.state, 'endpoint-listened-reserved');
      assert.equal(existsSync(crashed.barrier.path), true);
      assert.equal(existsSync(crashed.barrier.ownerStatePath), true);
      await eventually(
        () => !existsSync(crashed.barrier.ownerStatePath),
        { label: 'pre-activation binding marker cleanup' },
      );
      assert.equal(
        existsSync(crashed.barrier.path),
        true,
        'pre-activation socket residue is ambiguous and requires explicit recovery',
      );
      await assertRefusal(
        () => startDevControlSocket(testOptions(
          preActivationRoot,
          'unit-preactivation-racing-successor',
        )),
        'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER',
      );
      assert.equal(existsSync(crashed.barrier.path), true);
      rmSync(crashed.barrier.path);
      const recoveredSuccessor = await startDevControlSocket(testOptions(
        preActivationRoot,
        'unit-preactivation-recovered-successor',
      ));
      assert.equal(existsSync(recoveredSuccessor.descriptor.path), true);
      await recoveredSuccessor.close();
    } finally {
      await closeCarrierCleanupLease(preActivationLease);
    }
    console.log('pre-activation SIGKILL: reserved cleanup removes only binding marker and explicit recovery admits successor');
  }

  const liveRoot = makeRoot('l');
  const liveHolder = await startHolder(liveRoot, 'unit-live-owner');
  publishSupervisorDescriptor(liveRoot, liveHolder);
  const liveOwnerStatePath = join(liveRoot, 'dev-control.owner.json');
  const liveOwnerStateMetadata = lstatSync(liveOwnerStatePath);
  const liveReaperResource = {
    state: 'active',
    pathType: 'socket',
    path: liveHolder.descriptor.path,
    socketIdentity: {
      ...liveHolder.descriptor.endpoint,
      ownerIncarnationId: liveHolder.descriptor.ownerIncarnationId,
    },
    ownerStateIdentity: {
      path: liveOwnerStatePath,
      device: String(liveOwnerStateMetadata.dev),
      inode: String(liveOwnerStateMetadata.ino),
      ownerIncarnationId: liveHolder.descriptor.ownerIncarnationId,
    },
  };
  assert.equal(
    await teardownTest.cleanupExactPath(liveReaperResource),
    false,
    'an exact cleanup identity still requires a dead-endpoint probe',
  );
  assert.equal(existsSync(liveHolder.descriptor.path), true);
  assert.equal(existsSync(liveOwnerStatePath), true);
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

  const looseDirectoryRoot = makeRoot('modes');
  chmodSync(looseDirectoryRoot, 0o755);
  const looseDirectoryNotices = [];
  const looseDirectoryReadyFile = join(looseDirectoryRoot, 'dev.ready.json');
  const looseDirectoryControl = await startDevControlSocket(testOptions(
    looseDirectoryRoot,
    'unit-loose-directory-owner',
    { onUnavailable: (diagnostic) => looseDirectoryNotices.push(diagnostic) },
  ));
  assert.equal(looseDirectoryControl, null);
  assert.equal(looseDirectoryNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(looseDirectoryNotices[0].severity, 'warning');
  assert.equal(looseDirectoryNotices[0].details.path, looseDirectoryRoot);
  assert.equal(looseDirectoryNotices[0].details.readyFile, looseDirectoryReadyFile);
  assert.match(looseDirectoryNotices[0].details.recovery, /--ready-file/u);
  assert.equal(looseDirectoryNotices[0].message.includes(looseDirectoryRoot), true);
  assert.match(looseDirectoryNotices[0].message, /--ready-file/u);
  assert.equal(existsSync(join(looseDirectoryRoot, '.dc-sock')), false);
  chmodSync(looseDirectoryRoot, 0o700);
  console.log('non-owner-only state directory: stdin-only fallback remains live');

  const symlinkDirectoryTarget = makeRoot('symlink-target');
  const symlinkDirectoryRoot = join(scratchRoot, 'symlink-state');
  symlinkSync(symlinkDirectoryTarget, symlinkDirectoryRoot, 'dir');
  const symlinkDirectoryNotices = [];
  const symlinkDirectoryControl = await startDevControlSocket(testOptions(
    symlinkDirectoryRoot,
    'unit-symlink-directory-owner',
    { onUnavailable: (diagnostic) => symlinkDirectoryNotices.push(diagnostic) },
  ));
  assert.equal(symlinkDirectoryControl, null);
  assert.equal(symlinkDirectoryNotices[0].code, 'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE');
  assert.equal(symlinkDirectoryNotices[0].details.path, symlinkDirectoryRoot);
  assert.equal(
    symlinkDirectoryNotices[0].details.readyFile,
    join(symlinkDirectoryRoot, 'dev.ready.json'),
  );
  assert.match(symlinkDirectoryNotices[0].details.recovery, /--ready-file/u);
  assert.equal(symlinkDirectoryNotices[0].message.includes(symlinkDirectoryRoot), true);
  assert.match(symlinkDirectoryNotices[0].message, /--ready-file/u);
  assert.equal(existsSync(join(symlinkDirectoryRoot, '.dc-sock')), false);
  console.log('symlinked state directory: stdin-only fallback remains live');

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
    const leasedOwnerStatePath = join(leasedRoot, 'dev-control.owner.json');
    assert.equal(JSON.parse(readFileSync(leasedOwnerStatePath, 'utf8')).phase, 'bound');
    await killHolder(leasedHolder);
    await eventually(
      () => !existsSync(leasedHolder.descriptor.path) && !existsSync(leasedOwnerStatePath),
      { label: 'cleanup lease socket and bound owner marker reap after owner SIGKILL' },
    );
  } finally {
    await closeCarrierCleanupLease(cleanupLease);
  }
  console.log('cleanup lease: owner death reaps the exact socket inode');

  const boundLeaseRoot = makeRoot('bound-lease');
  const boundCleanupLease = await createCarrierCleanupLease();
  try {
    const boundHolder = await startBoundSocketHolder(
      boundLeaseRoot,
      'unit-bound-owner',
      boundCleanupLease,
    );
    assert.equal(
      boundHolder.barrier.state,
      'endpoint-lease-activated',
      'fault injection must stop after bound owner state and exact-inode lease activation',
    );
    assert.equal(existsSync(boundHolder.barrier.path), true);
    assert.equal(existsSync(boundHolder.barrier.ownerStatePath), true);
    assert.equal(
      JSON.parse(readFileSync(boundHolder.barrier.ownerStatePath, 'utf8')).phase,
      'bound',
    );
    await killHolder(boundHolder);
    await eventually(
      () => !existsSync(boundHolder.barrier.path)
        && !existsSync(boundHolder.barrier.ownerStatePath),
      { label: 'direct-bound socket and binding marker reap after owner SIGKILL' },
    );
  } finally {
    await closeCarrierCleanupLease(boundCleanupLease);
  }
  console.log('cleanup lease: direct-bind owner death reaps exact socket inode and bound marker');
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
