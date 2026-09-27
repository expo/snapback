// ENG-24378: startup/shutdown is identified by the ready-file nonce and owns
// an isolated process tree. No real Snapback build is needed for this lifecycle
// suite; a tiny child speaks the same ready + /health identity handshake.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  __startServerForTests,
  formatRuntimeRecoveryFailure,
  RUNTIME_RECOVERY_JSON_ENV,
  stopChild,
} from '../server-process.mjs';

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
const { chmodSync, realpathSync, writeFileSync, renameSync } = require('node:fs');
const { createServer } = require('node:http');
const { resolve } = require('node:path');
// Positional (legacy launchSpec style: <readyFile> [port]) or flag style
// (real server-arg style: start --ready-file F --port N), so the same fixture
// can stand in for a prebuilt/configured binary on the LLP 0030 ladder rungs.
let readyFile = process.argv[2];
let bindPort = Number(process.argv[3] || 0);
if (process.argv.includes('--ready-file')) {
  const flag = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : process.argv[at + 1];
  };
  readyFile = flag('--ready-file');
  bindPort = Number(flag('--port') || 0);
}
const database = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : null;
const expected = JSON.parse(process.env.FIXTURE_EXPECTED);
// Readiness-seam fixture support (LLP 0115 CV-3): a stand-in binary on the
// configured/prebuilt rungs must answer "runtime-qualify" with the same
// verdict document the real binary prints, or the kit's live re-qualification
// self-heal would hang against a fixture that only speaks ready+/health.
if (process.argv[2] === 'runtime-qualify') {
  const refuse = process.env.FIXTURE_QUALIFY_REFUSE === '1';
  console.log(JSON.stringify({
    schemaVersion: 'snapback.runtime-qualify.v1',
    probe: 'restricted-no-eval-handler-vm',
    ok: !refuse,
    binary: { ...expected, buildProfile: 'debug' },
    ...(refuse
      ? {
          diagnostic: {
            code: 'SNAPBACK_RUNTIME_CREATE_FAILED',
            severity: 'error',
            subsystem: 'runtime',
            message: 'Ibex runtime could not be created',
          },
        }
      : {}),
  }));
  process.exit(refuse ? 1 : 0);
}
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
  if (process.env.FIXTURE_DEV_IDENTITY === '1') {
    const devIdentityCapabilityFile = database === null
      ? readyFile + '.dev-identity'
      : resolve(database) + '.dev-identity';
    writeFileSync(
      devIdentityCapabilityFile,
      'sbdev_fixture_capability',
      { mode: 0o600 },
    );
    chmodSync(
      devIdentityCapabilityFile,
      Number.parseInt(process.env.FIXTURE_DEV_IDENTITY_MODE || '0600', 8),
    );
    descriptor.devIdentityCapabilityFile = realpathSync(devIdentityCapabilityFile);
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
const coexistenceSignal = process.env.FIXTURE_COEXISTENCE_SIGNAL || null;
let observedSignals = 0;
let generation = 0;

// Register before startServer installs its owner. This listener deliberately
// keeps the fixture alive after the helper re-delivers the signal, modeling a
// larger test runner that owns its own shutdown policy.
if (coexistenceSignal) {
  process.on(coexistenceSignal, () => {
    observedSignals += 1;
    if (observedSignals % 2 === 0) {
      process.send({
        phase: 'signal-redispatched',
        signal: coexistenceSignal,
        observedSignals,
        generation,
      });
    }
  });
}

async function startAndPublish() {
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
  generation += 1;
  process.send({
    phase: 'server-ready',
    generation,
    serverPid: health.pid,
    descendantPid: health.resistantDescendantPid,
  });
}

await startAndPublish();
const crashMode = process.env.FIXTURE_CRASH_AFTER_READY || null;
if (crashMode) {
  // Model a test that dies before its cleanup runs: no signal, no stop().
  process.once('message', () => {
    if (crashMode === 'exit') process.exit(3);
    throw new Error('fixture parent crashed while owning a server');
  });
} else if (coexistenceSignal) {
  process.on('message', (message) => {
    if (message?.command === 'start-next') {
      void startAndPublish().catch((error) => {
        console.error(error);
        process.exit(2);
      });
    } else if (message?.command === 'exit') {
      process.exit(0);
    }
  });
} else {
  setInterval(() => {}, 1_000);
}
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

async function waitPidGone(pid, message, timeoutMs = 3_000) {
  // A SIGKILLed orphan stays a zombie until init reaps it; poll, then assert.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() > deadline) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assertPidGone(pid, message);
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
// The injection-tautology assertions below inspect the child environment; an
// inherited deterministic stamp (e.g. exported by scripts/verify-local-proof)
// must not masquerade as kit injection or flip verdicts to env-stamped.
const previousBuildEnv = {
  SNAPBACK_BUILD_GIT_COMMIT: process.env.SNAPBACK_BUILD_GIT_COMMIT,
  SNAPBACK_BUILD_GIT_DIRTY: process.env.SNAPBACK_BUILD_GIT_DIRTY,
  SNAPBACK_SERVER_BINARY: process.env.SNAPBACK_SERVER_BINARY,
};
for (const key of Object.keys(previousBuildEnv)) delete process.env[key];
const running = [];

function captureConsoleError() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(' '));
    original(...args);
  };
  return { lines, restore: () => { console.error = original; } };
}

try {
  {
    let launchAttempted = false;
    const typedDiagnostic = {
      code: 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED',
      severity: 'error',
      subsystem: 'runtime-link',
      message: 'fixture exact link failed',
      details: { missingSymbols: ['ex_fixture_symbol'] },
    };
    const typedRecovery = {
      schemaVersion: 'snapback.runtime-recovery.v1',
      selectedBinary: null,
      selectionRung: 'none',
      expected: EXPECTED,
      actualStamp: null,
      currentCheckout: { buildable: false, runnable: false },
      reuse: { allowed: false, reason: 'fixture link failure' },
      diagnostic: { code: typedDiagnostic.code, missingSymbols: ['ex_fixture_symbol'] },
      producerInputs: { root: scratch, target: 'snapback' },
      recovery: { repairCommand: 'scripts/assemble-runtime-package', overrideCommand: null },
    };
    await assert.rejects(
      __startServerForTests(
        { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
        {
          ...deps,
          runtimeLinkProbe: async () => ({
            ok: false,
            diagnostic: typedDiagnostic,
            recovery: typedRecovery,
          }),
          launchSpec() {
            launchAttempted = true;
            throw new Error('must not launch after exact-link failure');
          },
        },
      ),
      (error) => {
        assert.equal(error.code, typedDiagnostic.code);
        assert.deepEqual(error.diagnostic, typedDiagnostic);
        assert.equal(error.runtimeRecovery, typedRecovery);
        return true;
      },
    );
    assert.equal(launchAttempted, false, 'Cargo fallback must be gated by the exact-link probe');

    const failure = new Error(`${typedDiagnostic.code}: ${typedDiagnostic.message}`);
    failure.runtimeRecovery = typedRecovery;
    assert.equal(
      formatRuntimeRecoveryFailure(failure, {}),
      [
        'RUNTIME RECOVERY',
        `reason: ${typedDiagnostic.code}: ${typedDiagnostic.message}`,
        'repairCommand: scripts/assemble-runtime-package',
        'overrideCommand: unavailable',
      ].join('\n'),
    );
    const verbose = formatRuntimeRecoveryFailure(
      failure,
      { [RUNTIME_RECOVERY_JSON_ENV]: '1' },
    );
    assert.match(verbose, /overrideCommand: unavailable\nrecoveryJson: \{"schemaVersion"/u);
    assert.equal(verbose.match(/RUNTIME RECOVERY/gu)?.length, 1);
  }

  // Pin the deliberate port default: a requested port stays a verified-reuse
  // probe, the spawn lands on an OS-assigned isolated port, and that
  // reassignment is loud — never silent (kit port-binding ticket, 2026-07-24).
  const firstCapture = captureConsoleError();
  let first;
  try {
    first = await __startServerForTests({ port: 4399, cwd: scratch, startupTimeoutMs: 2_000 }, deps);
  } finally {
    firstCapture.restore();
  }
  running.push(first);
  assert.equal(first.reused, false);
  assert.match(first.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(Number(new URL(first.baseUrl).port), 4399, 'new child owns an OS-assigned port');
  assert(
    firstCapture.lines.some((line) =>
      line.includes('PORT REASSIGNED: requested :4399')
      && line.includes(`:${new URL(first.baseUrl).port}`)),
    `landing on a different port is announced loudly, got:\n${firstCapture.lines.join('\n')}`,
  );
  assert.equal(first.exit, null, 'live handle reports no child exit');
  assert.match(first.startupNonce, /^[0-9a-f-]+$/i);
  assert.equal(first.launch.rung, 'cargo', 'no prebuilt binary means the ladder lands on the cargo rung');
  assert.equal(first.identity.verdict, 'verified');
  assert.equal(first.identity.binary.buildProfile, 'debug');
  assert.equal(first.identity.binary.startupNonce, first.startupNonce);
  assert.equal(first.credentials.adminToken, first.adminToken);
  assert.equal(first.clientOptions.adminToken, first.adminToken);
  assert.equal(first.devIdentityCapability, null, 'older descriptors remain supported');
  assert.equal(first.clientOptions.devIdentityCapability, null);
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
          FIXTURE_DEV_IDENTITY: '1',
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
  assert.equal(capabilityServer.devIdentityCapability, 'sbdev_fixture_capability');
  assert.equal(
    capabilityServer.clientOptions.devIdentityCapability,
    'sbdev_fixture_capability',
    'harvested custody is passed through the client option, never argv',
  );

  const fileBackedDatabase = join(scratch, 'file-backed-dev-identity.sqlite3');
  const fileBackedCapabilityServer = await __startServerForTests({
    port: 0,
    cwd: scratch,
    db: fileBackedDatabase,
    startupTimeoutMs: 2_000,
  }, {
    ...deps,
    launchSpec: ({ args, cwd, env }) => ({
      command: process.execPath,
      args: [fixture, ...args],
      cwd,
      env: {
        ...env,
        FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
        FIXTURE_DEV_IDENTITY: '1',
      },
    }),
  });
  running.push(fileBackedCapabilityServer);
  assert.equal(
    fileBackedCapabilityServer.devIdentityCapability,
    'sbdev_fixture_capability',
    'a FILE-backed database harvests the descriptor-advertised database sibling',
  );

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 2_000 }, {
      ...deps,
      launchSpec: ({ args, readyFile, cwd, env }) => ({
        command: process.execPath,
        args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
        cwd,
        env: {
          ...env,
          FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
          FIXTURE_DEV_IDENTITY: '1',
          FIXTURE_DEV_IDENTITY_MODE: '0644',
        },
      }),
    }),
    /regular owner-only \(0600\) file/u,
    'a permissive dev-identity carrier is rejected before its bearer is read',
  );

  const restartPort = Number(new URL(first.baseUrl).port);
  let firstUnexpectedExit = null;
  first.onUnexpectedExit((exit) => { firstUnexpectedExit = exit; });
  await first.stop();
  running.splice(running.indexOf(first), 1);
  assert.equal(first.exit?.expected, true, 'owned stop records an expected child exit');
  assert.equal(firstUnexpectedExit, null, 'owned stop never fires the unexpected-death callback');
  assert.throws(
    () => first.assertAlive(),
    (error) => error.code === 'SNAPBACK_SERVER_CHILD_DIED',
    'a cleanly stopped handle still refuses further use with the typed diagnostic',
  );
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
  const squatterCapture = captureConsoleError();
  let isolated;
  try {
    isolated = await __startServerForTests({
      port: squatterPort,
      cwd: scratch,
      startupTimeoutMs: 2_000,
    }, deps);
  } finally {
    squatterCapture.restore();
  }
  running.push(isolated);
  assert.notEqual(Number(new URL(isolated.baseUrl).port), squatterPort, 'unhealthy occupant is never adopted');
  assert(
    squatterCapture.lines.some((line) => line.includes('PORT OCCUPIED')),
    'refusing an occupied requested port is announced loudly',
  );
  assert(
    squatterCapture.lines.some((line) => line.includes(`PORT REASSIGNED: requested :${squatterPort}`)),
    'the OS-assigned replacement port is announced loudly',
  );
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

  // ── Identity honesty (issues/20260724-kit-identity-stamp-env-injection-tautology) ──

  // The kit must not inject checkout-derived stamp values into children: the
  // child's build stamp has to stay an independent build.rs probe for the
  // comparisons below to carry information.
  {
    let observedEnv = null;
    const injectionProbe = await __startServerForTests(
      { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
      {
        ...deps,
        launchSpec: ({ args, readyFile, cwd, env }) => {
          observedEnv = env;
          return {
            command: process.execPath,
            args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
            cwd,
            env: { ...env, FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
          };
        },
      },
    );
    running.push(injectionProbe);
    assert.equal('SNAPBACK_BUILD_GIT_COMMIT' in observedEnv, false, 'no checkout commit is injected into the child env');
    assert.equal('SNAPBACK_BUILD_GIT_DIRTY' in observedEnv, false, 'no checkout dirty marker is injected into the child env');
    assert.equal(injectionProbe.identity.verdict, 'verified');
    await injectionProbe.stop();
    running.splice(running.indexOf(injectionProbe), 1);
  }

  // Drift detection: a child stamped at commit A while the checkout reads
  // commit B is a hard verification failure on the cargo rung — the case the
  // env injection used to make silently invisible.
  const DRIFTED = { ...EXPECTED, gitCommit: 'feedfacefeedfacefeedfacefeedfacefeedface' };
  await assert.rejects(
    __startServerForTests(
      { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
      { ...deps, expectedIdentity: DRIFTED },
    ),
    /spawned server identity verification failed: health commit 0123[0-9a-f]* does not match checkout feedface/,
    'stamp/checkout commit drift is detected instead of self-confirming',
  );

  // Dirty divergence is honest, not fatal: dirt outside the binary's tracked
  // build inputs legitimately does not re-stamp it. The binary's own stamp is
  // a clean exact build of the agreed commit, so the verdict is
  // `pinned-binary-dirty-checkout` (LLP 0115 CV-15 split the old `unpinned`
  // label so exact binary evidence is not misread as weak) instead of failing
  // or silently passing as verified.
  {
    const dirtyCheckout = await __startServerForTests(
      { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
      { ...deps, expectedIdentity: { ...EXPECTED, gitDirty: true } },
    );
    running.push(dirtyCheckout);
    assert.equal(dirtyCheckout.identity.verdict, 'pinned-binary-dirty-checkout');
    await dirtyCheckout.stop();
    running.splice(running.indexOf(dirtyCheckout), 1);
  }

  // Deterministic CI stamps ride the reserved env seam and classify as
  // `env-stamped` — attested by the caller, never presented as verified
  // against the checkout (and never a spurious hard failure).
  {
    const envStamped = await __startServerForTests(
      {
        port: 0,
        cwd: scratch,
        startupTimeoutMs: 2_000,
        env: { SNAPBACK_BUILD_GIT_COMMIT: EXPECTED.gitCommit },
      },
      { ...deps, expectedIdentity: DRIFTED },
    );
    running.push(envStamped);
    assert.equal(envStamped.identity.verdict, 'env-stamped');
    await envStamped.stop();
    running.splice(running.indexOf(envStamped), 1);
  }

  // Same requested port, simultaneous helpers: every child asks the OS to
  // bind port zero and proves its own nonce, so probe-to-bind races disappear.
  const parallel = await Promise.all(Array.from({ length: 4 }, () =>
    __startServerForTests({ port: 4499, cwd: scratch, startupTimeoutMs: 2_000 }, deps)));
  running.push(...parallel);
  assert.equal(new Set(parallel.map((server) => server.baseUrl)).size, parallel.length);

  if (process.platform !== 'win32') {
    // Post-readiness watchdog: a child killed after readiness is detected, the
    // handle fails fast with a typed diagnostic, and stop() reports the death
    // honestly instead of attesting a clean teardown (kit watchdog ticket,
    // 2026-07-24; All Aboard external review issues/0007).
    const optionExits = [];
    const victimCapture = captureConsoleError();
    let victim;
    let victimExit;
    try {
      victim = await __startServerForTests({
        port: 0,
        cwd: scratch,
        startupTimeoutMs: 2_000,
        onUnexpectedExit: (exit) => optionExits.push(exit),
      }, deps);
      assert.equal(victim.exit, null);
      victim.assertAlive();
      const victimHealth = await fetch(`${victim.baseUrl}/health`).then((response) => response.json());
      const seen = new Promise((resolveExit) => victim.onUnexpectedExit(resolveExit));
      process.kill(victimHealth.pid, 'SIGKILL');
      victimExit = await seen;
    } finally {
      victimCapture.restore();
    }
    assert.equal(victimExit.signal, 'SIGKILL');
    assert.equal(victimExit.expected, false);
    assert.deepEqual(victim.exit, victimExit, 'death is exposed as handle state');
    assert.deepEqual(optionExits, [victimExit], 'the startServer onUnexpectedExit option fired once');
    assert(
      victimCapture.lines.some((line) => line.includes('SNAPBACK SERVER DIED')
        && line.includes(victim.baseUrl)),
      `post-readiness death is announced loudly, got:\n${victimCapture.lines.join('\n')}`,
    );
    assert.throws(
      () => victim.assertAlive(),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_SERVER_CHILD_DIED');
        assert.equal(error.exit.signal, 'SIGKILL');
        return true;
      },
      'further use fails fast with the typed diagnostic',
    );
    const lateExit = await new Promise((resolveExit) => victim.onUnexpectedExit(resolveExit));
    assert.deepEqual(lateExit, victimExit, 'late subscribers still observe the recorded death');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        victim.stop(),
        (error) => {
          assert.equal(error.code, 'SNAPBACK_SERVER_CHILD_DIED');
          assert.match(error.message, /before stop\(\) was requested/);
          assert.match(error.message, /cannot attest a clean shutdown/);
          return true;
        },
        'stop() on an already-dead child reports the death instead of attesting a clean teardown',
      );
    }

    // ── LLP 0030 resolver ladder (issues/20260724-kit-prebuilt-binary-boot-path) ──
    // A fake repo whose `target/debug/snapback` is a wrapper around the same
    // ready+/health fixture, so the prebuilt/configured rungs are exercised
    // against real spawns without any cargo involvement.
    const fakeRepo = mkdtempSync(join(tmpdir(), 'server-process-ladder-'));
    const prebuilt = join(fakeRepo, 'target', 'debug', 'snapback');
    mkdirSync(join(fakeRepo, 'target', 'debug'), { recursive: true });
    writeFileSync(prebuilt, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    chmodSync(prebuilt, 0o755);
    const DRIFTED_LADDER = { ...EXPECTED, gitCommit: 'feedfacefeedfacefeedfacefeedfacefeedface' };
    const ladderDeps = (onCargoRung) => ({
      expectedIdentity: EXPECTED,
      preflight: () => ({}),
      launchSpec: ({ args, readyFile, cwd, env }) => {
        onCargoRung?.();
        return {
          command: process.execPath,
          args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
          cwd,
          env: { ...env, FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
        };
      },
    });

    // Rung 2: a pinned checkout with a stamp-verified prebuilt binary boots
    // it directly — the cargo rung is never touched.
    {
      let cargoRungUsed = false;
      const viaPrebuilt = await __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          startupTimeoutMs: 10_000,
          env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
        },
        ladderDeps(() => { cargoRungUsed = true; }),
      );
      running.push(viaPrebuilt);
      assert.equal(viaPrebuilt.launch.rung, 'prebuilt');
      assert.equal(viaPrebuilt.launch.command, prebuilt);
      assert.equal(viaPrebuilt.identity.verdict, 'verified');
      assert.equal(cargoRungUsed, false, 'a verified prebuilt binary boots without the cargo rung');
      await viaPrebuilt.stop();
      running.splice(running.indexOf(viaPrebuilt), 1);
    }

    // A drifted prebuilt binary (stamped at another commit) is torn down and
    // the ladder falls back to the cargo rung.
    {
      let fellBack = false;
      const fallback = await __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          startupTimeoutMs: 10_000,
          // The prebuilt child stamps the drifted commit; the cargo-rung
          // fixture (launchSpec override below) stamps the checkout's.
          env: { FIXTURE_EXPECTED: JSON.stringify(DRIFTED_LADDER) },
        },
        ladderDeps(() => { fellBack = true; }),
      );
      running.push(fallback);
      assert.equal(fallback.launch.rung, 'cargo');
      assert.equal(fellBack, true, 'a drifted prebuilt binary falls back to the cargo rung');
      assert.equal(fallback.identity.verdict, 'verified');
      await fallback.stop();
      running.splice(running.indexOf(fallback), 1);
    }

    // A dirty checkout skips the prebuilt rung entirely: only a rebuild can
    // contain the local edits.
    {
      const dirtySkip = await __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          startupTimeoutMs: 10_000,
          env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
        },
        { ...ladderDeps(null), expectedIdentity: { ...EXPECTED, gitDirty: true } },
      );
      running.push(dirtySkip);
      assert.equal(dirtySkip.launch.rung, 'cargo', 'a dirty checkout goes straight to the cargo rung');
      assert.equal(dirtySkip.identity.verdict, 'pinned-binary-dirty-checkout');
      await dirtySkip.stop();
      running.splice(running.indexOf(dirtySkip), 1);
    }

    // Rung 1: an explicitly configured binary boots even when its stamp does
    // not match the checkout — the paved escape for a broken/drifted HEAD —
    // and the drift is reported honestly on the handle.
    {
      const configured = await __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          serverBinary: prebuilt,
          startupTimeoutMs: 10_000,
          env: { FIXTURE_EXPECTED: JSON.stringify(DRIFTED_LADDER) },
        },
        { expectedIdentity: EXPECTED, preflight: () => ({}) },
      );
      running.push(configured);
      assert.equal(configured.launch.rung, 'configured');
      assert.equal(configured.identity.verdict, 'stamp-mismatch');
      assert.match(configured.identity.mismatches[0], /health commit feedface/);
      assert.equal(configured.runtimeRecovery.schemaVersion, 'snapback.runtime-recovery.v1');
      assert.equal(configured.runtimeRecovery.selectionRung, 'configured');
      assert.equal(configured.runtimeRecovery.actualStamp.gitCommit, DRIFTED_LADDER.gitCommit);
      assert.match(configured.runtimeRecovery.recovery.overrideCommand, /SNAPBACK_SERVER_BINARY=/);
      await configured.stop();
      running.splice(running.indexOf(configured), 1);
    }

    // A configured binary that does not exist is a hard, named error — never
    // a silent fall-through to another rung.
    await assert.rejects(
      __startServerForTests(
        { port: 0, cwd: fakeRepo, serverBinary: join(fakeRepo, 'no-such-binary'), startupTimeoutMs: 10_000 },
        { expectedIdentity: EXPECTED, preflight: () => ({}) },
      ),
      /configured snapback server binary does not exist/,
    );

    // ── Persisted readiness receipt rung coverage (LLP 0115 CV-3) ──
    // The configured/prebuilt rungs refuse a runtime whose receipt is absent,
    // stale, or incoherent unless live re-qualification self-heals it
    // (issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md).
    const absentReceipt = (binaryPath) => ({
      ok: false,
      reason: 'absent',
      receipt: null,
      receiptPath: `${binaryPath}.runtime-readiness.json`,
      diagnostic: {
        code: 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
        severity: 'error',
        subsystem: 'runtime-readiness',
        message: 'fixture: no persisted runtime readiness receipt',
        details: { reason: 'absent' },
      },
    });
    const coherentReceipt = (binaryPath) => ({
      ok: true,
      reason: 'coherent',
      receipt: {
        schemaVersion: 'snapback.runtime-readiness.v1',
        buildIdentity: { gitCommit: EXPECTED.gitCommit, crateVersion: EXPECTED.crateVersion },
        qualification: { probe: 'restricted-no-eval-handler-vm', ok: true },
      },
      receiptPath: `${binaryPath}.runtime-readiness.json`,
      diagnostic: null,
    });

    // An unreceipted prebuilt binary that cannot qualify falls back to the
    // cargo rung with the shared CV-2 code recorded — never boots.
    {
      let fellBack = false;
      let issuedForFailure = false;
      const fallbackCapture = captureConsoleError();
      let unqualified;
      try {
        unqualified = await __startServerForTests(
          {
            port: 0,
            cwd: fakeRepo,
            startupTimeoutMs: 10_000,
            env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
          },
          {
            ...ladderDeps(() => { fellBack = true; }),
            verifyReadiness: ({ binaryPath }) => absentReceipt(binaryPath),
            qualifyRuntime: () => ({
              ok: false,
              report: null,
              reason: 'Armed startup refused: fixture checkpoint tracking is unavailable',
            }),
            issueReadiness: () => { issuedForFailure = true; },
          },
        );
      } finally {
        fallbackCapture.restore();
      }
      running.push(unqualified);
      assert.equal(unqualified.launch.rung, 'cargo');
      assert.equal(fellBack, true, 'an unqualifiable prebuilt binary must fall back to the cargo rung');
      assert.equal(issuedForFailure, false, 'no receipt is ever issued for a failed qualification');
      assert.match(
        unqualified.runtimeRecovery.reuse.reason,
        /SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED/,
        'the fallback reason carries the shared CV-2 code',
      );
      assert(
        fallbackCapture.lines.some((line) => line.includes('PREBUILT SNAPBACK REJECTED')
          && line.includes('SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED')),
        `prebuilt readiness refusal is loud, got:\n${fallbackCapture.lines.join('\n')}`,
      );
      await unqualified.stop();
      running.splice(running.indexOf(unqualified), 1);
    }

    // An unreceipted prebuilt binary that DOES qualify self-heals: the kit
    // re-qualifies, issues a fresh receipt, and boots the prebuilt rung.
    {
      let issued = false;
      const healed = await __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          startupTimeoutMs: 10_000,
          env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
        },
        {
          ...ladderDeps(() => {
            throw new Error('a self-healed prebuilt binary must not fall back to cargo');
          }),
          verifyReadiness: ({ binaryPath }) => (issued
            ? coherentReceipt(binaryPath)
            : absentReceipt(binaryPath)),
          qualifyRuntime: () => ({
            ok: true,
            report: { binary: { ...EXPECTED, buildProfile: 'debug' } },
            reason: null,
          }),
          issueReadiness: ({ qualification }) => {
            assert.equal(qualification.ok, true);
            issued = true;
            return { receiptPath: `${prebuilt}.runtime-readiness.json` };
          },
        },
      );
      running.push(healed);
      assert.equal(healed.launch.rung, 'prebuilt');
      assert.equal(issued, true, 'self-heal must persist a fresh receipt');
      assert.equal(healed.runtimeRecovery.qualification.probe, 'persisted-receipt');
      assert.equal(healed.runtimeRecovery.qualification.ok, true);
      await healed.stop();
      running.splice(running.indexOf(healed), 1);
    }

    // A configured binary that cannot qualify is a HARD coded error carrying
    // the qualification verdict in its runtime-recovery record — the caller
    // chose the binary, but readiness evidence is never silently skipped.
    {
      const configuredCapture = captureConsoleError();
      try {
        await assert.rejects(
          __startServerForTests(
            {
              port: 0,
              cwd: fakeRepo,
              serverBinary: prebuilt,
              startupTimeoutMs: 10_000,
              env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
            },
            {
              expectedIdentity: EXPECTED,
              preflight: () => ({}),
              verifyReadiness: ({ binaryPath }) => absentReceipt(binaryPath),
              qualifyRuntime: () => ({
                ok: false,
                report: null,
                reason: 'Armed startup refused: fixture checkpoint tracking is unavailable',
              }),
              issueReadiness: () => {
                throw new Error('must not issue for a failed qualification');
              },
            },
          ),
          (error) => {
            assert.equal(error.code, 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED');
            assert.equal(error.runtimeRecovery.selectionRung, 'configured');
            assert.equal(error.runtimeRecovery.qualification.ok, false);
            assert.match(error.runtimeRecovery.qualification.reason, /Armed startup refused/);
            assert.equal(error.runtimeRecovery.reuse.allowed, false);
            return true;
          },
        );
      } finally {
        configuredCapture.restore();
      }
      assert.equal(
        configuredCapture.lines.some((line) => line.includes('RUNTIME RECOVERY')),
        false,
        'the programmatic test seam returns the record without printing it',
      );
    }

    // A qualification that passes but cannot be persisted is still a refusal
    // with the shared receipt code: acceptance never runs against a runtime
    // whose receipt is absent.
    await assert.rejects(
      __startServerForTests(
        {
          port: 0,
          cwd: fakeRepo,
          serverBinary: prebuilt,
          startupTimeoutMs: 10_000,
          env: { FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
        },
        {
          expectedIdentity: EXPECTED,
          preflight: () => ({}),
          verifyReadiness: ({ binaryPath }) => absentReceipt(binaryPath),
          qualifyRuntime: () => ({ ok: true, report: null, reason: null }),
          issueReadiness: () => {
            throw new Error('fixture: receipt directory is read-only');
          },
        },
      ),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID');
        assert.equal(error.runtimeRecovery.selectionRung, 'configured');
        return true;
      },
    );

    rmSync(fakeRepo, { recursive: true, force: true });

    // ── Reused-rung readiness binding (LLP 0115 CV-3) ──
    // A running server cannot be re-qualified in place, so reuse binds the
    // live /health identity to a locally receipted, digest-coherent runtime.
    {
      const donor = await __startServerForTests(
        { port: 0, cwd: scratch, startupTimeoutMs: 2_000 },
        {
          ...deps,
          launchSpec: ({ args, readyFile, cwd, env }) => ({
            command: process.execPath,
            args: [fixture, readyFile, args[args.indexOf('--port') + 1]],
            cwd,
            env: {
              ...env,
              FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
              FIXTURE_DEV_IDENTITY: '1',
            },
          }),
        },
      );
      running.push(donor);
      const donorPort = Number(new URL(donor.baseUrl).port);

      // Without a coherent local receipt, reuse is refused loudly and a
      // fresh (fixture-launched) server starts on an isolated port.
      const refusalCapture = captureConsoleError();
      let fresh;
      try {
        fresh = await __startServerForTests(
          { port: donorPort, cwd: scratch, startupTimeoutMs: 2_000, binaryProvenance: { identity: EXPECTED } },
          {
            ...deps,
            verifyReadiness: ({ binaryPath }) => absentReceipt(binaryPath),
            qualifyRuntime: () => ({ ok: true, report: null, reason: null }),
            issueReadiness: () => ({}),
          },
        );
      } finally {
        refusalCapture.restore();
      }
      running.push(fresh);
      assert.equal(fresh.reused, false, 'an unreceipted runtime must not be reused');
      assert(
        refusalCapture.lines.some((line) => line.includes('PROVENANCE MISMATCH')
          && line.includes('SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID')),
        `reuse refusal names the receipt code, got:\n${refusalCapture.lines.join('\n')}`,
      );
      await fresh.stop();
      running.splice(running.indexOf(fresh), 1);

      // With a coherent receipt whose build identity matches the live
      // /health stamp, reuse proceeds and the handle records the bind.
      const reused = await __startServerForTests(
        { port: donorPort, cwd: scratch, startupTimeoutMs: 2_000, binaryProvenance: { identity: EXPECTED } },
        {
          ...deps,
          verifyReadiness: ({ binaryPath }) => coherentReceipt(binaryPath),
          qualifyRuntime: () => {
            throw new Error('a running server must never be re-qualified in place');
          },
          issueReadiness: () => {
            throw new Error('reuse must not reissue a coherent receipt');
          },
        },
      );
      assert.equal(reused.reused, true, 'a receipted, identity-matched server is reused');
      assert.equal(
        reused.devIdentityCapability,
        'sbdev_fixture_capability',
        'verified reuse re-reads the nonce-bound descriptor-advertised carrier',
      );
      assert.equal(reused.runtimeRecovery.qualification.probe, 'persisted-receipt');
      assert.match(
        reused.runtimeRecovery.qualification.reason,
        /cannot be re-qualified in place/,
      );
      await reused.stop();

      // A receipt whose identity does NOT match the live server refuses the
      // bind: the receipt cannot vouch for a foreign process.
      const mismatchCapture = captureConsoleError();
      let foreign;
      try {
        foreign = await __startServerForTests(
          { port: donorPort, cwd: scratch, startupTimeoutMs: 2_000, binaryProvenance: { identity: EXPECTED } },
          {
            ...deps,
            verifyReadiness: ({ binaryPath }) => ({
              ...coherentReceipt(binaryPath),
              receipt: {
                schemaVersion: 'snapback.runtime-readiness.v1',
                buildIdentity: {
                  gitCommit: 'feedfacefeedfacefeedfacefeedfacefeedface',
                  crateVersion: EXPECTED.crateVersion,
                },
                qualification: { probe: 'restricted-no-eval-handler-vm', ok: true },
              },
            }),
            qualifyRuntime: () => ({ ok: true, report: null, reason: null }),
            issueReadiness: () => ({}),
          },
        );
      } finally {
        mismatchCapture.restore();
      }
      running.push(foreign);
      assert.equal(foreign.reused, false, 'a receipt for a different build cannot vouch for the live server');
      assert(
        mismatchCapture.lines.some((line) => line.includes('does not match the receipted local runtime')),
        `identity-mismatch refusal is named, got:\n${mismatchCapture.lines.join('\n')}`,
      );
      await foreign.stop();
      running.splice(running.indexOf(foreign), 1);

      await donor.stop();
      running.splice(running.indexOf(donor), 1);
    }

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

    // A test parent that dies without a signal (an uncaught throw before its
    // cleanup is registered, or a bare process.exit) must not strand its
    // detached server group either (issues/closed/20260926-demo-kit-servers-
    // orphaned-on-parent-exit.md: 71 orphans on one backstop host).
    if (process.platform !== 'win32') {
      for (const [crashMode, expectedCode] of [['throw', 1], ['exit', 3]]) {
        const crashOwner = spawn(process.execPath, [signalOwnerFixture], {
          cwd: scratch,
          env: {
            ...process.env,
            SERVER_PROCESS_MODULE_URL: new URL('../server-process.mjs', import.meta.url).href,
            FIXTURE_SERVER_PATH: fixture,
            FIXTURE_CWD: scratch,
            FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
            FIXTURE_CRASH_AFTER_READY: crashMode,
          },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let crashLog = '';
        crashOwner.stdout.on('data', (chunk) => { crashLog += chunk; });
        crashOwner.stderr.on('data', (chunk) => { crashLog += chunk; });
        let crashOwnedPids = null;
        try {
          crashOwnedPids = await waitForChildMessage(crashOwner);
          process.kill(crashOwnedPids.serverPid, 0);
          process.kill(crashOwnedPids.descendantPid, 0);
          const crashClose = waitForChildClose(crashOwner);
          crashOwner.send({ command: 'crash' });
          const closed = await crashClose;
          assert.equal(closed.code, expectedCode, `${crashMode} owner exit code; log:\n${crashLog}`);
          await waitPidGone(crashOwnedPids.serverPid, `${crashMode} owner leaves no server leader`);
          await waitPidGone(
            crashOwnedPids.descendantPid,
            `${crashMode} owner leaves no TERM-resistant descendant`,
          );
        } finally {
          if (crashOwner.exitCode === null && crashOwner.signalCode === null) {
            crashOwner.kill('SIGKILL');
          }
          forceKillProcessGroup(crashOwnedPids?.serverPid);
        }
      }
    }

    // A pre-existing runner listener may intentionally absorb the helper's
    // re-delivered signal. The signal owner must then be reusable: a later
    // start gets a fresh ownership generation, and its signal still performs
    // strict tree cleanup rather than taking the stale "second signal" path.
    const coexistenceOwner = spawn(process.execPath, [signalOwnerFixture], {
      cwd: scratch,
      env: {
        ...process.env,
        SERVER_PROCESS_MODULE_URL: new URL('../server-process.mjs', import.meta.url).href,
        FIXTURE_SERVER_PATH: fixture,
        FIXTURE_CWD: scratch,
        FIXTURE_EXPECTED: JSON.stringify(EXPECTED),
        FIXTURE_COEXISTENCE_SIGNAL: 'SIGTERM',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let coexistenceLog = '';
    coexistenceOwner.stdout.on('data', (chunk) => { coexistenceLog += chunk; });
    coexistenceOwner.stderr.on('data', (chunk) => { coexistenceLog += chunk; });
    const coexistenceGroups = [];
    try {
      const first = await waitForChildMessage(coexistenceOwner);
      assert.equal(first.phase, 'server-ready', JSON.stringify(first));
      assert.equal(first.generation, 1, JSON.stringify(first));
      coexistenceGroups.push(first.serverPid);
      process.kill(first.serverPid, 0);
      process.kill(first.descendantPid, 0);

      const firstRedispatch = waitForChildMessage(coexistenceOwner);
      assert.equal(coexistenceOwner.kill('SIGTERM'), true, 'coexistence fixture accepted first SIGTERM');
      const firstSignal = await firstRedispatch;
      assert.deepEqual(
        {
          phase: firstSignal.phase,
          signal: firstSignal.signal,
          observedSignals: firstSignal.observedSignals,
          generation: firstSignal.generation,
        },
        {
          phase: 'signal-redispatched',
          signal: 'SIGTERM',
          observedSignals: 2,
          generation: 1,
        },
      );
      assertPidGone(first.serverPid, 'absorbed first signal still cleans the first server leader');
      assertPidGone(first.descendantPid, 'absorbed first signal still cleans the first descendant');
      process.kill(coexistenceOwner.pid, 0);

      const secondReady = waitForChildMessage(coexistenceOwner);
      assert.equal(
        coexistenceOwner.send({ command: 'start-next' }),
        true,
        'coexistence fixture accepted the second start request',
      );
      const second = await secondReady;
      assert.equal(second.phase, 'server-ready', JSON.stringify(second));
      assert.equal(second.generation, 2, JSON.stringify(second));
      coexistenceGroups.push(second.serverPid);
      process.kill(second.serverPid, 0);
      process.kill(second.descendantPid, 0);

      const secondRedispatch = waitForChildMessage(coexistenceOwner);
      assert.equal(coexistenceOwner.kill('SIGTERM'), true, 'coexistence fixture accepted second SIGTERM');
      const secondSignal = await secondRedispatch;
      assert.deepEqual(
        {
          phase: secondSignal.phase,
          signal: secondSignal.signal,
          observedSignals: secondSignal.observedSignals,
          generation: secondSignal.generation,
        },
        {
          phase: 'signal-redispatched',
          signal: 'SIGTERM',
          observedSignals: 4,
          generation: 2,
        },
      );
      assertPidGone(second.serverPid, 'later signal cleans the re-armed server leader');
      assertPidGone(second.descendantPid, 'later signal cleans the re-armed descendant');
      assert.doesNotMatch(coexistenceLog, /signal cleanup failed|cleanup not attested/);

      const coexistenceClose = waitForChildClose(coexistenceOwner);
      assert.equal(
        coexistenceOwner.send({ command: 'exit' }),
        true,
        'coexistence fixture accepted explicit completion',
      );
      assert.deepEqual(await coexistenceClose, { code: 0, signal: null });
    } finally {
      if (coexistenceOwner.exitCode === null && coexistenceOwner.signalCode === null) {
        coexistenceOwner.kill('SIGKILL');
      }
      for (const pid of coexistenceGroups) forceKillProcessGroup(pid);
    }
  }

  // Native process-group exit is the ownership proof. A helper outside that
  // group may still retain an inherited pipe and delay Node's `close` event;
  // after group exit, stopChild releases the parent's pipe handle so this
  // descriptor lifetime cannot turn successful cleanup into a false failure.
  const inheritedPipeChild = fakeChild(43_100);
  inheritedPipeChild.stderr = {
    destroyed: false,
    destroy() {
      this.destroyed = true;
      inheritedPipeChild.emit('close', 0, null);
    },
  };
  await stopChild(inheritedPipeChild, {
    platform: 'darwin',
    graceMs: 100,
    leaderCloseTimeoutMs: 100,
    signalTree: async () => ({
      ok: true,
      mechanism: 'process-group',
      signal: 'SIGTERM',
      pid: inheritedPipeChild.pid,
      delivered: true,
      exitAttested: true,
    }),
  });
  assert.equal(inheritedPipeChild.stderr.destroyed, true);

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
  for (const [key, value] of Object.entries(previousBuildEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
}
