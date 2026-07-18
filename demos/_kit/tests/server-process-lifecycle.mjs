// ENG-24378: startup/shutdown is identified by the ready-file nonce and owns
// an isolated process tree. No real Snapback build is needed for this lifecycle
// suite; a tiny child speaks the same ready + /health identity handshake.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __startServerForTests, stopChild } from '../server-process.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'server-process-lifecycle-'));
const fixture = join(scratch, 'fixture-server.cjs');
const signalOwnerFixture = join(scratch, 'signal-owner-parent.mjs');
const EXPECTED = {
  crateVersion: '7.8.9-test',
  gitCommit: '0123456789abcdef0123456789abcdef01234567',
  gitDirty: false,
};

writeFileSync(fixture, String.raw`
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { writeFileSync, renameSync } = require('node:fs');
const { createServer } = require('node:http');
const readyFile = process.argv[2];
const bindPort = Number(process.argv[3] || 0);
const expected = JSON.parse(process.env.FIXTURE_EXPECTED);
const nonce = randomUUID();
let resistantDescendant = null;
const server = createServer((req, res) => {
  if (req.url !== '/health') { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    ok: true,
    target: 'local-dev-sqlite-ibex',
    binary: { ...expected, buildProfile: 'debug', startupNonce: nonce },
    pid: process.pid,
    resistantDescendantPid: resistantDescendant?.pid ?? null,
  }));
});
const listen = () => server.listen(bindPort, '127.0.0.1', () => {
  const port = server.address().port;
  const tmp = readyFile + '.tmp';
  const descriptor = {
    ready: true,
    serverUrl: 'http://127.0.0.1:' + port,
    port,
    pid: process.pid,
    startupNonce: nonce,
  };
  if (process.env.FIXTURE_IMPERSONATION === '1') {
    descriptor.impersonationCapabilityFile = readyFile + '.impersonation';
    writeFileSync(descriptor.impersonationCapabilityFile, 'sbic_fixture_capability.1234abcd');
  }
  writeFileSync(tmp, JSON.stringify(descriptor));
  renameSync(tmp, readyFile);
});
if (process.env.FIXTURE_EXIT_WITH_LATE_TAIL === '1') {
  writeFileSync(1, 'startup leader exited before readiness\n');
  spawn(process.execPath, ['-e', [
    'const { writeFileSync } = require("node:fs");',
    'setTimeout(() => writeFileSync(2, "late inherited-stdio diagnostic tail\\n"), 250);',
  ].join(' ')], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.exit(17);
} else if (process.env.FIXTURE_RESISTANT_DESCENDANT === '1') {
  resistantDescendant = spawn(process.execPath, ['-e', [
    'process.on("SIGTERM", () => {});',
    'process.send("ready");',
    'setInterval(() => {}, 1000);',
  ].join(' ')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  resistantDescendant.once('message', listen);
  resistantDescendant.once('error', (error) => { throw error; });
} else {
  listen();
}
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`);

writeFileSync(signalOwnerFixture, String.raw`
const { __startServerForTests } = await import(process.env.SERVER_PROCESS_MODULE_URL);
const expected = JSON.parse(process.env.FIXTURE_EXPECTED);
const fixture = process.env.FIXTURE_SERVER_PATH;
const server = await __startServerForTests({
  port: 0,
  cwd: process.env.FIXTURE_CWD,
  startupTimeoutMs: 2_000,
}, {
  expectedIdentity: expected,
  preflight: () => ({}),
  launchSpec: ({ readyFile, cwd, env }) => ({
    command: process.execPath,
    args: [fixture, readyFile],
    cwd,
    env: {
      ...env,
      FIXTURE_EXPECTED: JSON.stringify(expected),
      FIXTURE_RESISTANT_DESCENDANT: '1',
    },
  }),
  stopOptions: {
    graceMs: 25,
    processGroupTimeoutMs: 1_000,
    leaderCloseTimeoutMs: 1_000,
  },
});
const health = await fetch(server.baseUrl + '/health').then((response) => response.json());
process.send({
  serverPid: health.pid,
  descendantPid: health.resistantDescendantPid,
});
setInterval(() => {}, 1_000);
`);

const deps = {
  expectedIdentity: EXPECTED,
  preflight: () => ({}),
  launchSpec: ({ args, readyFile, cwd, env }) => ({
    command: process.execPath,
    args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
    cwd,
    env: { ...env, FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
  }),
};

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function assertPidGone(pid, message) {
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') alive = false;
    else throw error;
  }
  assert.equal(alive, false, message);
}

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => false;
  return child;
}

function waitForChildMessage(child, timeoutMs = 5_000) {
  return new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => finish(
      rejectMessage,
      new Error(`child did not publish its lifecycle fixture message within ${timeoutMs}ms`),
    ), timeoutMs);
    const onMessage = (message) => finish(resolveMessage, message);
    const onError = (error) => finish(rejectMessage, error);
    const onClose = (code, signal) => finish(
      rejectMessage,
      new Error(`child closed before its lifecycle fixture message (${code ?? signal})`),
    );
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      settle(value);
    };
    child.once('message', onMessage);
    child.once('error', onError);
    child.once('close', onClose);
  });
}

function waitForChildClose(child, timeoutMs = 5_000) {
  return new Promise((resolveClose, rejectClose) => {
    const timer = setTimeout(() => finish(
      rejectClose,
      new Error(`child did not close within ${timeoutMs}ms`),
    ), timeoutMs);
    const onClose = (code, signal) => finish(resolveClose, { code, signal });
    const onError = (error) => finish(rejectClose, error);
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      settle(value);
    };
    child.once('close', onClose);
    child.once('error', onError);
  });
}

function forceKillProcessGroup(pid) {
  if (!Number.isInteger(pid) || process.platform === 'win32') return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

const previousToken = process.env.SNAPBACK_ADMIN_TOKEN;
delete process.env.SNAPBACK_ADMIN_TOKEN;
const running = [];

try {
  const first = await __startServerForTests({ port: 4399, cwd: scratch, startupTimeoutMs: 2_000 }, deps);
  running.push(first);
  assert.equal(first.reused, false);
  assert.match(first.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(Number(new URL(first.baseUrl).port), 4399, 'new child owns an OS-assigned port');
  assert.match(first.startupNonce, /^[0-9a-f-]+$/i);
  assert.equal(first.credentials.adminToken, first.adminToken);
  assert.equal(first.clientOptions.adminToken, first.adminToken);
  assert.equal(process.env.SNAPBACK_ADMIN_TOKEN, undefined, 'startup does not contaminate global credentials');

  const startupCarrier = join(scratch, 'startup-artifacts.json');
  writeFileSync(startupCarrier, '{}');
  let observedArgs = null;
  const capabilityServer = await __startServerForTests({
    port: 0,
    cwd: scratch,
    startupArtifacts: startupCarrier,
    captureImpersonationCapability: true,
    startupTimeoutMs: 2_000,
  }, {
    ...deps,
    launchSpec: ({ args, readyFile, cwd, env }) => {
      observedArgs = args;
      return {
        command: process.execPath,
        args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
        cwd,
        env: {
          ...env,
          FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
          FIXTURE_IMPERSONATION: '1',
        },
      };
    },
  });
  running.push(capabilityServer);
  assert.deepEqual(
    observedArgs.slice(observedArgs.indexOf('--startup-artifacts')),
    ['--startup-artifacts', startupCarrier],
  );
  assert.equal(capabilityServer.impersonationCapability, 'sbic_fixture_capability.1234abcd');

  const restartPort = Number(new URL(first.baseUrl).port);
  await first.stop();
  running.splice(running.indexOf(first), 1);
  const exactRestart = await __startServerForTests({
    port: restartPort,
    bindPortExactly: true,
    cwd: scratch,
    startupTimeoutMs: 2_000,
  }, deps);
  running.push(exactRestart);
  assert.equal(
    Number(new URL(exactRestart.baseUrl).port),
    restartPort,
    'explicit restart seam binds the released origin exactly',
  );

  const releasedPortServer = await listen((_req, res) => res.end('temporary'));
  const releasedPort = releasedPortServer.address().port;
  await new Promise((resolve) => releasedPortServer.close(resolve));
  await assert.rejects(
    __startServerForTests({
      port: releasedPort,
      bindPortExactly: true,
      cwd: scratch,
      startupTimeoutMs: 2_000,
    }, {
      ...deps,
      launchSpec: ({ readyFile, cwd, env }) => ({
        command: process.execPath,
        args: [fixture, readyFile, '0'],
        cwd,
        env: { ...env, FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
      }),
    }),
    /published port \d+, not requested exact port/,
    'exact restart rejects a nonce-valid child that silently binds a different port',
  );

  const squatter = await listen((_req, res) => {
    res.statusCode = 503;
    res.end('not snapback');
  });
  const squatterPort = squatter.address().port;
  const isolated = await __startServerForTests({
    port: squatterPort,
    cwd: scratch,
    startupTimeoutMs: 2_000,
  }, deps);
  running.push(isolated);
  assert.notEqual(Number(new URL(isolated.baseUrl).port), squatterPort, 'unhealthy occupant is never adopted');
  await assert.rejects(
    __startServerForTests({
      port: squatterPort,
      bindPortExactly: true,
      cwd: scratch,
      startupTimeoutMs: 2_000,
    }, deps),
    /exited before verified readiness|EADDRINUSE/,
    'exact restart bind neither adopts an occupant nor falls back to another origin',
  );
  await new Promise((resolve) => squatter.close(resolve));

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 1_000 }, {
      ...deps,
      launchSpec: () => ({ command: join(scratch, 'missing-executable'), args: [], cwd: scratch, env: {} }),
    }),
    /spawn failed/,
    'spawn errors reject instead of becoming unhandled child events',
  );

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 1_000 }, {
      ...deps,
      launchSpec: () => ({ command: process.execPath, args: ['-e', 'process.exit(17)'], cwd: scratch, env: process.env }),
    }),
    /exited before verified readiness \(17\)/,
    'immediate exit is reported before readiness',
  );

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 1_000 }, {
      ...deps,
      startupExitDrainTimeoutMs: 1_000,
      launchSpec: ({ readyFile, cwd, env }) => ({
        command: process.execPath,
        args: [fixture, readyFile],
        cwd,
        env: {
          ...env,
          FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
          FIXTURE_EXIT_WITH_LATE_TAIL: '1',
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /exited before verified readiness \(17\)/);
      assert.match(error.message, /startup leader exited before readiness/);
      assert.match(error.message, /late inherited-stdio diagnostic tail/);
      return true;
    },
    'pre-readiness exit waits boundedly for inherited stdio before snapshotting diagnostics',
  );

  // Same requested port, simultaneous helpers: every child asks the OS to
  // bind port zero and proves its own nonce, so probe-to-bind races disappear.
  const parallel = await Promise.all(Array.from({ length: 4 }, () =>
    __startServerForTests({ port: 4499, cwd: scratch, startupTimeoutMs: 2_000 }, deps)));
  running.push(...parallel);
  assert.equal(new Set(parallel.map((server) => server.baseUrl)).size, parallel.length);

  if (process.platform !== 'win32') {
    const resistant = await __startServerForTests(
      { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
      {
        ...deps,
        launchSpec: ({ readyFile, cwd, env }) => ({
          command: process.execPath,
          args: [fixture, readyFile],
          cwd,
          env: {
            ...env,
            FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
            FIXTURE_RESISTANT_DESCENDANT: '1',
          },
        }),
        stopOptions: {
          graceMs: 25,
          processGroupTimeoutMs: 1_000,
          leaderCloseTimeoutMs: 1_000,
        },
      },
    );
    running.push(resistant);
    const health = await fetch(`${resistant.baseUrl}/health`).then((response) => response.json());
    const descendantPid = health.resistantDescendantPid;
    assert(Number.isInteger(descendantPid), `fixture did not publish descendant pid: ${JSON.stringify(health)}`);
    process.kill(descendantPid, 0);

    await resistant.stop();
    running.splice(running.indexOf(resistant), 1);
    // No post-stop grace sleep: the awaited stop itself must include the
    // bounded ESRCH proof for the TERM-resistant descendant's process group.
    assertPidGone(descendantPid, 'awaited stop leaves no TERM-resistant descendant');

    // A test parent terminated by the runner must not strand the detached
    // server groups it owns. Run that path in a disposable parent so this
    // suite can observe both native signal termination and tree cleanup.
    for (const terminationSignal of ['SIGINT', 'SIGTERM']) {
      const signalOwner = spawn(process.execPath, [signalOwnerFixture], {
        cwd: scratch,
        env: {
          ...process.env,
          SERVER_PROCESS_MODULE_URL: new URL('../server-process.mjs', import.meta.url).href,
          FIXTURE_SERVER_PATH: fixture,
          FIXTURE_CWD: scratch,
          FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let signalOwnerLog = '';
      signalOwner.stdout.on('data', (chunk) => { signalOwnerLog += chunk; });
      signalOwner.stderr.on('data', (chunk) => { signalOwnerLog += chunk; });
      let signalOwnedPids = null;
      try {
        signalOwnedPids = await waitForChildMessage(signalOwner);
        assert(Number.isInteger(signalOwnedPids.serverPid), JSON.stringify(signalOwnedPids));
        assert(Number.isInteger(signalOwnedPids.descendantPid), JSON.stringify(signalOwnedPids));
        process.kill(signalOwnedPids.serverPid, 0);
        process.kill(signalOwnedPids.descendantPid, 0);

        const signalOwnerClose = waitForChildClose(signalOwner);
        assert.equal(
          signalOwner.kill(terminationSignal),
          true,
          `test parent accepted ${terminationSignal}`,
        );
        const closed = await signalOwnerClose;
        assert.equal(closed.code, null, `signal owner exited by code; log:\n${signalOwnerLog}`);
        assert.equal(
          closed.signal,
          terminationSignal,
          `signal owner lost ${terminationSignal} semantics; log:\n${signalOwnerLog}`,
        );
        assertPidGone(signalOwnedPids.serverPid, `${terminationSignal} owner leaves no server leader`);
        assertPidGone(
          signalOwnedPids.descendantPid,
          `${terminationSignal} owner leaves no TERM-resistant descendant`,
        );
        assert.doesNotMatch(signalOwnerLog, /signal cleanup failed|cleanup not attested/);
      } finally {
        if (signalOwner.exitCode === null && signalOwner.signalCode === null) {
          signalOwner.kill('SIGKILL');
        }
        forceKillProcessGroup(signalOwnedPids?.serverPid);
      }
    }
  }

  // Fake Windows completion: leader close alone must not resolve stop(). The
  // taskkill /T subprocess close with code zero is the tree-completion proof.
  const windowsChild = fakeChild(43101);
  let windowsKiller = null;
  const windowsCalls = [];
  const windowsStop = stopChild(windowsChild, {
    platform: 'win32',
    graceMs: 100,
    taskkillTimeoutMs: 1_000,
    leaderCloseTimeoutMs: 100,
    spawnImpl: (command, args) => {
      assert.equal(command, 'taskkill');
      windowsCalls.push(args);
      windowsKiller = new EventEmitter();
      windowsKiller.kill = () => true;
      return windowsKiller;
    },
  });
  let windowsSettled = false;
  void windowsStop.finally(() => { windowsSettled = true; });
  windowsChild.exitCode = 0;
  windowsChild.emit('close', 0, null);
  await Promise.resolve();
  assert.equal(windowsSettled, false, 'leader close cannot outrun pending taskkill /T');
  windowsKiller.emit('close', 0, null);
  await windowsStop;
  assert.equal(windowsSettled, true);
  assert.deepEqual(windowsCalls, [['/pid', '43101', '/t']]);

  // A nonzero TERM taskkill is awaited and triggers the bounded /F recovery;
  // a nonzero recovery is surfaced rather than being hidden by leader close.
  const failedWindowsChild = fakeChild(43102);
  const failedWindowsKillers = [];
  const failedWindowsCalls = [];
  let resolveHardSpawn;
  const hardSpawned = new Promise((resolveSpawn) => { resolveHardSpawn = resolveSpawn; });
  const failedWindowsStop = stopChild(failedWindowsChild, {
    platform: 'win32',
    graceMs: 100,
    taskkillTimeoutMs: 1_000,
    leaderCloseTimeoutMs: 100,
    spawnImpl: (_command, args) => {
      failedWindowsCalls.push(args);
      const killer = new EventEmitter();
      killer.kill = () => true;
      failedWindowsKillers.push(killer);
      if (args.includes('/f')) resolveHardSpawn(killer);
      return killer;
    },
  });
  let failedWindowsSettled = false;
  void failedWindowsStop.catch(() => {}).finally(() => { failedWindowsSettled = true; });
  failedWindowsChild.exitCode = 1;
  failedWindowsChild.emit('close', 1, null);
  await Promise.resolve();
  assert.equal(failedWindowsSettled, false, 'leader failure cannot outrun pending taskkill /T');
  failedWindowsKillers[0].emit('close', 5, null);
  const failedHardKiller = await hardSpawned;
  assert.equal(failedWindowsSettled, false, 'failed TERM taskkill waits for /T /F recovery');
  failedHardKiller.emit('close', 9, null);
  await assert.rejects(failedWindowsStop, /TERM cleanup: taskkill exited 5.*KILL cleanup: taskkill exited 9/);
  assert.equal(failedWindowsSettled, true);
  assert.deepEqual(failedWindowsCalls, [
    ['/pid', '43102', '/t'],
    ['/pid', '43102', '/t', '/f'],
  ]);

  const spawnErrorChild = fakeChild(43103);
  const spawnErrorKillers = [];
  let resolveSpawnErrorHard;
  const spawnErrorHard = new Promise((resolveSpawn) => { resolveSpawnErrorHard = resolveSpawn; });
  const spawnErrorStop = stopChild(spawnErrorChild, {
    platform: 'win32',
    graceMs: 100,
    taskkillTimeoutMs: 1_000,
    leaderCloseTimeoutMs: 100,
    spawnImpl: (_command, args) => {
      const killer = new EventEmitter();
      killer.kill = () => true;
      spawnErrorKillers.push(killer);
      if (args.includes('/f')) resolveSpawnErrorHard(killer);
      return killer;
    },
  });
  spawnErrorChild.exitCode = 1;
  spawnErrorChild.emit('close', 1, null);
  spawnErrorKillers[0].emit('error', new Error('taskkill unavailable'));
  const spawnErrorHardKiller = await spawnErrorHard;
  spawnErrorHardKiller.emit('error', new Error('taskkill unavailable'));
  await assert.rejects(
    spawnErrorStop,
    /TERM cleanup: taskkill spawn failed: taskkill unavailable.*KILL cleanup: taskkill spawn failed: taskkill unavailable/,
  );

  const stopping = running.splice(0).map((server) => server.stop());
  await Promise.all(stopping);
  console.log('server-process-lifecycle: PASS');
} finally {
  await Promise.allSettled(running.map((server) => server.stop()));
  if (previousToken === undefined) delete process.env.SNAPBACK_ADMIN_TOKEN;
  else process.env.SNAPBACK_ADMIN_TOKEN = previousToken;
  rmSync(scratch, { recursive: true, force: true });
}
