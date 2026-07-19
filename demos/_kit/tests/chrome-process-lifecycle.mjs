// Focused process-tree/profile proof for the shared Chrome acceptance launcher.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  launchChromeCdp,
  NO_PRIMARY_FAILURE,
  throwRunAndCleanupFailures,
} from '../chrome-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, '..', '..', '..');
const fixtureMode = process.argv[2];
let nextFakePid = 900_000_000;

if (fixtureMode === '--descendant') {
  process.on('SIGTERM', () => setTimeout(() => process.exit(0), 40));
  setInterval(() => {}, 1_000);
} else if (fixtureMode === '--chrome-fixture') {
  await runChromeFixture(process.argv[3], process.argv[4]);
} else {
  await runLifecycleProof();
}

async function runChromeFixture(mode, auditPath) {
  const profilePrefix = '--user-' + 'data-dir=';
  const profileArgument = process.argv.find((argument) => argument.startsWith(profilePrefix));
  if (!profileArgument) throw new Error('fixture did not receive a Chrome profile');
  const profilePath = profileArgument.slice(profilePrefix.length);
  const descendant = spawn(process.execPath, [fixturePath, '--descendant'], {
    stdio: 'ignore',
  });
  writeFileSync(auditPath, JSON.stringify({
    leaderPid: process.pid,
    descendantPid: descendant.pid,
    profilePath,
  }));

  let server = null;
  let stopping = false;
  process.on('SIGTERM', () => {
    if (stopping) return;
    stopping = true;
    server?.close();
    setTimeout(() => process.exit(0), 30);
  });

  if (mode === 'early-exit') {
    setTimeout(() => process.exit(17), 30);
  } else if (mode === 'ready') {
    server = http.createServer((request, response) => {
      if (request.url !== '/json/version') {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        Browser: 'FakeChrome/1',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: 'ws://127.0.0.1/fake-browser',
      }));
    });
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    writeFileSync(join(profilePath, 'DevToolsActivePort'), `${address.port}\n/fake-browser\n`);
  }

  await new Promise(() => {});
}

async function runLifecycleProof() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-chrome-lifecycle-'));
  try {
    if (process.platform === 'win32') {
      console.log('SKIP real POSIX Chrome process-group fixtures on Windows; taskkill behavior is covered by server-process-lifecycle.mjs');
    } else {
      await provesSuccessfulOwnedStop(scratch);
      await provesStartupFailureCleanup(scratch, 'timeout');
      await provesStartupFailureCleanup(scratch, 'early-exit');
    }
    await provesInjectedStopBeforeRemoval(scratch);
    await provesInjectedStartupStopBeforeRemoval(scratch);
    await provesWindowsSpawnShapeAndOrdering(scratch);
    await provesLifecycleFlagOverridesAreRejected(scratch);
    await provesSynchronousSpawnErrorCleanup(scratch);
    await provesSpawnErrorCleanup(scratch);
    await provesFailedAttestationPreservesProfile(scratch);
    provesRunAndCleanupFailureComposition();
    provesRepositoryInventory();
    assert.deepEqual(
      readdirSync(scratch).filter((name) => name.includes('profile')),
      [],
      'every attested fixture profile was removed',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log('PASS shared Chrome process-tree lifecycle and launcher inventory');
}

function launchFixture(scratch, mode, overrides = {}) {
  const auditPath = join(scratch, `${mode}-${Date.now()}-${Math.random()}.json`);
  return {
    auditPath,
    launched: launchChromeCdp({
      chromeBin: process.execPath,
      launchPrefixArgs: [fixturePath, '--chrome-fixture', mode, auditPath],
      userDataPrefix: `${mode}-profile-`,
      tempRoot: scratch,
      startupTimeoutMs: mode === 'timeout' ? 1_000 : 2_000,
      pollMs: 10,
      stopOptions: {
        graceMs: 500,
        processGroupTimeoutMs: 1_000,
        leaderCloseTimeoutMs: 1_000,
      },
      ...overrides,
    }),
  };
}

async function provesSuccessfulOwnedStop(scratch) {
  const { launched, auditPath } = launchFixture(scratch, 'ready');
  const chrome = await launched;
  const audit = await readAudit(auditPath);
  const firstStop = chrome.stop();
  const secondStop = chrome.stop();
  assert.equal(firstStop, secondStop, 'stop() must return one memoized cleanup promise');
  await firstStop;
  assert.equal(existsSync(chrome.profilePath), false, 'profile removal follows successful stop');
  assertProcessGone(audit.leaderPid, 'Chrome leader');
  assertProcessGone(audit.descendantPid, 'Chrome descendant');
}

async function provesStartupFailureCleanup(scratch, mode) {
  const { launched, auditPath } = launchFixture(scratch, mode);
  await assert.rejects(
    launched,
    mode === 'timeout' ? /did not expose DevToolsActivePort/ : /exited before CDP startup/,
  );
  const audit = await readAudit(auditPath);
  assert.equal(existsSync(audit.profilePath), false, `${mode}: profile must be removed after attested cleanup`);
  assertProcessGone(audit.leaderPid, `${mode}: Chrome leader`);
  assertProcessGone(audit.descendantPid, `${mode}: Chrome descendant`);
}

function injectedLaunch(scratch, {
  ready,
  platform = 'linux',
  stopError = null,
  prefix,
}) {
  const child = new EventEmitter();
  child.pid = nextFakePid++;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const events = [];
  let profilePath = null;
  let spawnOptions = null;
  const launched = launchChromeCdp({
    chromeBin: 'injected-chrome',
    userDataPrefix: prefix,
    tempRoot: scratch,
    startupTimeoutMs: ready ? 500 : 40,
    pollMs: 5,
    dependencies: {
      platform,
      spawnImpl(_command, args, options) {
        spawnOptions = options;
        const profileFlag = '--user-' + 'data-dir=';
        profilePath = args.find((argument) => argument.startsWith(profileFlag)).slice(profileFlag.length);
        if (ready) writeFileSync(join(profilePath, 'DevToolsActivePort'), '9222\n');
        return child;
      },
      fetchImpl: async () => ({
        json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/injected' }),
      }),
      stopChildImpl: async () => {
        events.push('stop:start');
        await Promise.resolve();
        if (stopError) throw stopError;
        events.push('stop:complete');
      },
      rmImpl(path, options) {
        events.push('rm');
        rmSync(path, options);
      },
    },
  });
  return {
    events,
    launched,
    get profilePath() { return profilePath; },
    get spawnOptions() { return spawnOptions; },
  };
}

async function provesInjectedStopBeforeRemoval(scratch) {
  const fixture = injectedLaunch(scratch, {
    ready: true,
    prefix: 'injected-success-profile-',
  });
  const chrome = await fixture.launched;
  await chrome.stop();
  assert.deepEqual(
    fixture.events,
    ['stop:start', 'stop:complete', 'rm'],
    'normal cleanup must await stopChild completion before profile removal',
  );
}

async function provesInjectedStartupStopBeforeRemoval(scratch) {
  const fixture = injectedLaunch(scratch, {
    ready: false,
    prefix: 'injected-startup-profile-',
  });
  await assert.rejects(fixture.launched, /did not expose DevToolsActivePort/);
  assert.deepEqual(
    fixture.events,
    ['stop:start', 'stop:complete', 'rm'],
    'startup cleanup must await stopChild completion before profile removal',
  );
}

async function provesWindowsSpawnShapeAndOrdering(scratch) {
  const fixture = injectedLaunch(scratch, {
    ready: true,
    platform: 'win32',
    prefix: 'injected-windows-profile-',
  });
  const chrome = await fixture.launched;
  assert.equal(fixture.spawnOptions.detached, false, 'Windows Chrome must use taskkill-compatible non-detached spawn');
  assert.equal(fixture.spawnOptions.windowsHide, true);
  await chrome.stop();
  assert.deepEqual(
    fixture.events,
    ['stop:start', 'stop:complete', 'rm'],
    'the Windows-shaped wrapper must retain stop-before-remove ordering',
  );
}

async function provesLifecycleFlagOverridesAreRejected(scratch) {
  const userDataFlag = '--user-' + 'data-dir';
  const debuggingFlag = '--remote-debugging-' + 'port';
  const cases = [
    [`${userDataFlag}=${join(scratch, 'hostile-profile')}`],
    [userDataFlag, join(scratch, 'hostile-profile')],
    [`${debuggingFlag}=9222`],
    [debuggingFlag, '9222'],
  ];
  const before = readdirSync(scratch).sort();
  for (const extraArgs of cases) {
    await assert.rejects(
      launchChromeCdp({
        chromeBin: 'must-not-spawn',
        extraArgs,
        tempRoot: scratch,
        dependencies: {
          spawnImpl() {
            assert.fail(`lifecycle override reached spawn: ${JSON.stringify(extraArgs)}`);
          },
        },
      }),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_BROWSER_LIFECYCLE_FLAG_OVERRIDE');
        return true;
      },
    );
  }
  assert.deepEqual(
    readdirSync(scratch).sort(),
    before,
    'rejected lifecycle overrides must not create a profile',
  );
}

async function provesSpawnErrorCleanup(scratch) {
  const prefix = 'spawn-error-profile-';
  await assert.rejects(
    launchChromeCdp({
      chromeBin: join(scratch, 'missing-chrome'),
      userDataPrefix: prefix,
      tempRoot: scratch,
      startupTimeoutMs: 500,
      pollMs: 10,
    }),
    /Chrome failed to launch/,
  );
  assert.deepEqual(
    readdirSync(scratch).filter((name) => name.startsWith(prefix)),
    [],
    'asynchronous spawn failure must remove its unused profile',
  );
}

async function provesSynchronousSpawnErrorCleanup(scratch) {
  const prefix = 'sync-spawn-error-profile-';
  await assert.rejects(
    launchChromeCdp({
      chromeBin: 'synthetic-chrome',
      userDataPrefix: prefix,
      tempRoot: scratch,
      dependencies: {
        spawnImpl() {
          throw new Error('synthetic synchronous spawn failure');
        },
      },
    }),
    /Chrome failed to launch.*synthetic synchronous spawn failure/,
  );
  assert.deepEqual(
    readdirSync(scratch).filter((name) => name.startsWith(prefix)),
    [],
    'synchronous spawn failure must remove its unused profile',
  );
}

async function provesFailedAttestationPreservesProfile(scratch) {
  const child = new EventEmitter();
  child.pid = 987_654_321;
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new EventEmitter();
  child.kill = () => true;
  let profilePath = null;
  let rmCalled = false;
  const chrome = await launchChromeCdp({
    chromeBin: 'fake-chrome',
    userDataPrefix: 'failed-attestation-profile-',
    tempRoot: scratch,
    startupTimeoutMs: 500,
    pollMs: 10,
    dependencies: {
      spawnImpl(_command, args) {
        const prefix = '--user-' + 'data-dir=';
        profilePath = args.find((argument) => argument.startsWith(prefix)).slice(prefix.length);
        writeFileSync(join(profilePath, 'DevToolsActivePort'), '9222\n');
        return child;
      },
      fetchImpl: async () => ({
        json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/fake' }),
      }),
      stopChildImpl: async () => {
        const error = new Error('synthetic process-tree attestation failure');
        error.code = 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED';
        throw error;
      },
      rmImpl(path, options) {
        rmCalled = true;
        rmSync(path, options);
      },
    },
  });
  const firstStop = chrome.stop();
  assert.equal(firstStop, chrome.stop(), 'a rejected cleanup is memoized too');
  await assert.rejects(firstStop, (error) => {
    assert.equal(error.code, 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED');
    assert.equal(error.profilePath, profilePath);
    assert.match(error.message, /profile preserved/);
    return true;
  });
  assert.equal(rmCalled, false, 'profile removal must not start when stopChild fails');
  assert.equal(existsSync(profilePath), true, 'unattested cleanup must preserve the profile');
  rmSync(profilePath, { recursive: true, force: true });
}

function provesRunAndCleanupFailureComposition() {
  const primary = new Error('primary failure');
  const cleanupA = new Error('cleanup A');
  const cleanupB = new Error('cleanup B');
  assert.throws(
    () => throwRunAndCleanupFailures({ label: 'primary only', primaryError: primary }),
    (error) => error === primary,
  );
  assert.throws(
    () => throwRunAndCleanupFailures({ label: 'cleanup only', cleanupErrors: [cleanupA] }),
    (error) => error === cleanupA,
  );
  assert.throws(
    () => throwRunAndCleanupFailures({
      label: 'primary and cleanup',
      primaryError: primary,
      cleanupErrors: [cleanupA, cleanupB],
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, cleanupA, cleanupB]);
      assert.equal(error.cause, primary);
      return true;
    },
  );
  throwRunAndCleanupFailures({
    label: 'no failures',
    primaryError: NO_PRIMARY_FAILURE,
  });
  let threwNull = false;
  try {
    throwRunAndCleanupFailures({ label: 'null primary', primaryError: null });
  } catch (error) {
    threwNull = true;
    assert.equal(error, null, 'a thrown null primary must be preserved exactly');
  }
  assert.equal(threwNull, true, 'a null primary must not be mistaken for success');
  assert.throws(
    () => throwRunAndCleanupFailures({
      label: 'null primary and cleanup',
      primaryError: null,
      cleanupErrors: [cleanupA],
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [null, cleanupA]);
      assert.equal(error.cause, null);
      return true;
    },
  );
}

function provesRepositoryInventory() {
  const launchers = [
    'admin-ui/tests/acceptance/csp-browser.mjs',
    'demos/all-aboard/tests/acceptance/browser.mjs',
    'demos/all-aboard/tests/acceptance/browser-react.mjs',
    'demos/all-aboard/tests/acceptance/update-economy.mjs',
    'demos/cursors-web/tests/acceptance/contract-browser.mjs',
    'demos/cursors-web/tests/acceptance/react-browser.mjs',
  ];
  for (const launcher of launchers) {
    const source = readFileSync(join(repoRoot, launcher), 'utf8');
    assert.match(source, /launchChromeCdp/, `${launcher} must use the shared launcher`);
    assert.doesNotMatch(source, /function\s+launchChrome/, `${launcher} must not retain a private launcher`);
  }
  for (const launcher of [launchers[0], launchers[3]]) {
    const source = readFileSync(join(repoRoot, launcher), 'utf8');
    assert.match(source, /primaryError/, `${launcher} must retain its primary failure`);
    assert.match(source, /cleanupErrors/, `${launcher} must retain cleanup failures`);
    assert.match(
      source,
      /throwRunAndCleanupFailures/,
      `${launcher} must compose primary and cleanup failures`,
    );
  }
  const updateEconomy = readFileSync(join(repoRoot, launchers[3]), 'utf8');
  assert.ok(
    updateEconomy.lastIndexOf('throwRunAndCleanupFailures') < updateEconomy.lastIndexOf('process.exit(0)'),
    'update-economy may force exit 0 only after the failure combiner returns cleanly',
  );

  const remoteDebuggingFlag = '--remote-debugging-' + 'port=0';
  const userDataFlag = '--user-' + 'data-dir=';
  const sources = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.mjs'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
  for (const needle of [remoteDebuggingFlag, userDataFlag]) {
    const owners = sources
      .filter((path) => readFileSync(join(repoRoot, path), 'utf8').includes(needle))
      .map((path) => relative(repoRoot, join(repoRoot, path)))
      .sort();
    assert.deepEqual(
      owners,
      ['demos/_kit/chrome-process.mjs'],
      `${needle} must remain single-sourced in the shared launcher`,
    );
  }
}

async function readAudit(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw new Error(`fixture audit did not appear at ${path}`);
}

function assertProcessGone(pid, label) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    throw error;
  }
  assert.fail(`${label} ${pid} survived attested cleanup`);
}
