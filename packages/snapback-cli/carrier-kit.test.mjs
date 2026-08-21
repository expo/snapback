import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from './carrier-kit.mjs';
import {
  __test as teardownTest,
  activateCleanupPath,
  closeCarrierCleanupLease,
  createCarrierCleanupLease,
  reserveCleanupPath,
} from './process-teardown.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-carrier-kit-'));
const carrierKitUrl = pathToFileURL(join(import.meta.dirname, 'carrier-kit.mjs')).href;
const expoDevUrl = pathToFileURL(join(import.meta.dirname, 'expo-dev.mjs')).href;
const teardownUrl = pathToFileURL(join(import.meta.dirname, 'process-teardown.mjs')).href;
const verifier = join(root, 'verify.mjs');
const server = join(root, 'server.mjs');
const supervisor = join(root, 'supervisor.mjs');
const browser = join(root, 'browser.mjs');
const signalRunner = join(root, 'signal-runner.mjs');
const carrierDeathRunner = join(root, 'carrier-death-runner.mjs');

for (const template of ['react', 'crud-dashboard']) {
  const source = readFileSync(join(import.meta.dirname, 'templates', template, 'carrier.mjs'), 'utf8');
  assert.match(source, /origin:\s*'http:\/\/127\.0\.0\.1:5173'/u);
  assert.doesNotMatch(source, /structuredReadiness|--expo-platform/u);
}

function executable(path, source) {
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o755);
}

async function eventually(check, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function config(scenario, startupTimeoutMs = 10_000) {
  return defineTemplateCarrierConfig({
    schemaVersion: 'snapback.template-carriers.v1',
    verifyCommand: [process.execPath, verifier],
    verifyReceipt: '.snapback/verify-receipt.json',
    carriers: {
      'web-browser': {
        command: [
          process.execPath,
          supervisor,
          scenario,
          '{artifacts}/expo-supervisor.json',
          '{artifacts}/supervisor-cleaned',
          '{artifacts}/supervisor-started',
          '{artifacts}/descendant-pids.json',
          '{artifacts}/takeover-trigger',
          '{artifacts}/takeover-ready',
        ],
        structuredReadiness: {
          kind: 'expo-supervisor',
          file: '{artifacts}/expo-supervisor.json',
        },
        browserJourney: {
          readyExpression: 'true',
          runExpression: '({ marker: globalThis.__snapbackCarrierJourneyId, readObserved: true, writeObserved: true })',
          requiredDomText: ['Application ready'],
          forbiddenDomText: [
            'SNAPBACK_APP_BINDING_UNAVAILABLE',
            'SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED',
          ],
        },
        startupTimeoutMs,
      },
    },
  });
}

executable(verifier, `
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.snapback', { recursive: true });
writeFileSync('.snapback/verify-receipt.json', JSON.stringify({
  schemaVersion: 'snapback.verify-receipt.v1',
  ok: true,
  status: 'passed',
}));
`);

// Every lifecycle case below uses a real TCP listener and real descendant
// process. The stubborn mode deliberately survives SIGTERM.
executable(server, `
import { renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [mode, requestedPort, requestedHost, statePath] = process.argv.slice(2);
const http = createServer((request, response) => {
  response.statusCode = 200;
  response.end('<html><body><h1>Application ready</h1></body></html>');
});
http.listen(Number(requestedPort), requestedHost, () => {
  const temporaryState = statePath + '.' + process.pid + '.tmp';
  writeFileSync(temporaryState, JSON.stringify({
    pid: process.pid,
    host: requestedHost,
    port: http.address().port,
  }));
  renameSync(temporaryState, statePath);
});
const close = () => {
  if (mode === 'stubborn') return;
  http.closeAllConnections?.();
  http.close(() => process.exit(0));
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.on('SIGHUP', close);
`);

executable(supervisor, `
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as createHttpRequest } from 'node:http';
import { startExpoSupervisorParentLease } from ${JSON.stringify(expoDevUrl)};
import {
  openCarrierCleanupLease,
  spawnLeasedProcess,
  stopProcessGroup,
} from ${JSON.stringify(teardownUrl)};

const [
  scenario,
  readiness,
  cleaned,
  started,
  pidFile,
  takeoverTrigger,
  takeoverReady,
] = process.argv.slice(2);
const children = [];
const cleanupLease = openCarrierCleanupLease(process.env);
const waitFor = async (path) => {
  const deadline = Date.now() + 5000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  if (!existsSync(path)) throw new Error('child did not publish ' + path);
  return JSON.parse(readFileSync(path, 'utf8'));
};
const identity = (pid) => {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8' });
  for (const line of result.stdout.split('\\n')) {
    const match = /^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(.+?)\\s*$/.exec(line);
    if (match && Number(match[1]) === pid) return { pid, startTime: match[4] };
  }
  throw new Error('missing process identity ' + pid);
};
let sequence = 0;
const startServer = async ({ mode = 'normal', port = 0, host = '127.0.0.1' } = {}) => {
  const state = readiness + '.server-' + (++sequence) + '.json';
  const child = spawnLeasedProcess([
    process.execPath,
    ${JSON.stringify(server)},
    mode,
    String(port),
    host,
    state,
  ], {
    cleanupLease,
    label: 'fixture detached Metro',
    stdio: 'ignore',
  });
  children.push({ child, processGroup: true });
  return { child, state: await waitFor(state) };
};
let closing = false;
let front = null;
let parentLease = null;
const close = async () => {
  if (closing) return;
  closing = true;
  parentLease?.close();
  rmSync(readiness, { force: true });
  if (front !== null) {
    front.closeAllConnections?.();
    await new Promise((resolveClose) => front.close(() => resolveClose()));
  }
  for (const owned of [...children].reverse()) {
    try {
      await stopProcessGroup(owned.child, { processGroup: owned.processGroup, graceMs: 250, killWaitMs: 1000 });
    } catch {}
  }
  writeFileSync(cleaned, 'cleaned');
};
const stop = () => { void close().finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGHUP', stop);
parentLease = startExpoSupervisorParentLease({
  env: process.env,
  intervalMs: 25,
  onLost: stop,
});

if (scenario === 'timeout') {
  const metro = await startServer();
  writeFileSync(pidFile, JSON.stringify([metro.child.pid]));
  writeFileSync(started, 'started');
  setInterval(() => {}, 1000);
} else if (scenario === 'stubborn-grandchild') {
  const stubborn = await startServer({ mode: 'stubborn' });
  writeFileSync(pidFile, JSON.stringify([stubborn.child.pid]));
  writeFileSync(started, 'started');
  setInterval(() => {}, 1000);
} else if (scenario === 'leader-sigkill') {
  const descendant = await startServer();
  writeFileSync(pidFile, JSON.stringify([descendant.child.pid]));
  writeFileSync(started, 'started');
  process.kill(process.pid, 'SIGKILL');
} else if (scenario === 'parent-death') {
  const metro = await startServer();
  writeFileSync(pidFile, JSON.stringify([process.pid, metro.child.pid]));
  writeFileSync(started, 'started');
  setInterval(() => {}, 1000);
} else {
  const nonce = 'carrier-test-attestation-' + 'x'.repeat(32);
  const attestationPath = '/_snapback/expo/v1/web-attestation/carrier-test';
  let attestationConsumed = false;
  let metro = await startServer();
  const metroIdentity = identity(metro.child.pid);
  if (scenario === 'unrelated') {
    const foreign = await startServer({ port: metro.state.port, host: '::1' });
    writeFileSync(pidFile, JSON.stringify([foreign.child.pid]));
  }
  front = createServer((request, response) => {
    if (request.method === 'GET' && request.url === attestationPath) {
      response.setHeader('cache-control', 'no-store');
      if (attestationConsumed) {
        response.statusCode = 410;
        response.end('attestation already consumed\\n');
      } else {
        attestationConsumed = true;
        response.end(nonce + '\\n');
      }
      return;
    }
    const proxy = createHttpRequest({
      hostname: '127.0.0.1',
      port: metro.state.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    }, (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    });
    proxy.on('error', () => {
      response.statusCode = 502;
      response.end('unavailable');
    });
    request.pipe(proxy);
  });
  await new Promise((resolveListen) => front.listen(0, '127.0.0.1', resolveListen));
  const supervisorIdentity = identity(process.pid);
  const descriptor = {
    schemaVersion: 'snapback.expo-supervisor.v1',
    formatVersion: 1,
    state: 'ready',
    correlationId: 'carrier-test-correlation',
    supervisorGeneration: 'carrier-test-generation',
    pid: scenario === 'stale' ? process.pid + 100000 : process.pid,
    supervisor: { pid: process.pid, startTime: supervisorIdentity.startTime },
    platform: 'web',
    connectCarrier: 'supervisor-rendezvous',
    exchangeOrigin: 'http://127.0.0.1:1',
    controlPath: '/_snapback/expo/v1/control',
    metro: {
      pid: metro.child.pid,
      startTime: metroIdentity.startTime,
      origin: 'http://127.0.0.1:' + front.address().port,
      upstreamOrigin: 'http://127.0.0.1:' + metro.state.port,
    },
    attestation: { path: attestationPath, nonce },
    listeners: [
      {
        owner: 'metro',
        pid: metro.child.pid,
        startTime: metroIdentity.startTime,
        command: 'real-test-metro',
        host: '127.0.0.1',
        port: metro.state.port,
        loopback: true,
      },
      {
        owner: 'metro-front',
        pid: process.pid,
        startTime: supervisorIdentity.startTime,
        command: 'real-test-front',
        host: '127.0.0.1',
        port: front.address().port,
        loopback: true,
      },
    ],
    startedAt: new Date().toISOString(),
  };
  const temporary = readiness + '.tmp';
  writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, readiness);
  writeFileSync(started, 'started');
  if (!existsSync(pidFile)) {
    writeFileSync(pidFile, JSON.stringify([process.pid, metro.child.pid]));
  }
  if (scenario === 'takeover') {
    let replacing = false;
    const takeoverPoll = setInterval(async () => {
      if (replacing || !existsSync(takeoverTrigger)) return;
      replacing = true;
      clearInterval(takeoverPoll);
      await stopProcessGroup(metro.child, {
        processGroup: true,
        graceMs: 100,
        killWaitMs: 1000,
      });
      metro = await startServer({ port: metro.state.port });
      writeFileSync(pidFile, JSON.stringify([metro.child.pid]));
      writeFileSync(takeoverReady, 'ready');
    }, 10);
  }
  setInterval(() => {}, 1000);
}
`);

executable(browser, `
import { createReadStream, createWriteStream, existsSync, writeFileSync } from 'node:fs';
const screenshot = process.argv.find((value) => value.startsWith('--screenshot='))?.slice('--screenshot='.length);
const profile = process.argv.find((value) => value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const cdp = process.argv.includes('--remote-debugging-pipe');
const hanging = process.env.SNAPBACK_CARRIER_TEST_HANG_BROWSER === '1';
if (hanging) {
  writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_PROFILE, profile ?? '');
  if (process.env.SNAPBACK_CARRIER_TEST_BROWSER_PID) {
    writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_PID, String(process.pid));
  }
}
if (cdp) {
  const input = createReadStream('/dev/null', { fd: 3, autoClose: false });
  const output = createWriteStream('/dev/null', { fd: 4, autoClose: false });
  const origin = process.argv.at(-1);
  let marker = null;
  let buffer = Buffer.alloc(0);
  const respond = (request, result) => {
    output.write(JSON.stringify({ id: request.id, result, ...(request.sessionId ? { sessionId: request.sessionId } : {}) }) + '\\0');
  };
  const handle = async (request) => {
    if (request.method === 'Target.getTargets') {
      respond(request, { targetInfos: [{ targetId: 'page-1', type: 'page', url: origin }] });
    } else if (request.method === 'Target.attachToTarget') {
      respond(request, { sessionId: 'session-1' });
    } else if (request.method === 'Runtime.evaluate') {
      const expression = request.params.expression;
      if (expression.includes("cache: 'no-store'")) {
        // Chrome can expose the destination origin while the document's href
        // is still the transient about:blank URL. The attestation request must
        // be absolute and must bind the independently observed page origin.
        globalThis.location = { origin: new URL(origin).origin, href: 'about:blank' };
        const value = await eval(expression);
        respond(request, { result: { type: 'object', value } });
      } else if (expression.startsWith('globalThis.__snapbackCarrierJourneyId = ')) {
        marker = JSON.parse(expression.slice(expression.indexOf(' = ') + 3));
        respond(request, { result: { type: 'boolean', value: true } });
      } else if (expression.includes('readObserved: true')) {
        if (!hanging) respond(request, { result: { type: 'object', value: { marker, readObserved: true, writeObserved: true } } });
      } else if (expression === 'document.documentElement.outerHTML') {
        respond(request, { result: { type: 'string', value: '<html><body><h1>Application ready</h1><p>' + marker + '</p></body></html>' } });
      } else {
        respond(request, { result: { type: 'boolean', value: true } });
      }
    } else if (request.method === 'Page.captureScreenshot') {
      respond(request, { data: Buffer.from('fake-png').toString('base64') });
    } else {
      respond(request, {});
    }
  };
  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const boundary = buffer.indexOf(0);
      if (boundary === -1) break;
      const frame = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      if (!frame) continue;
      const request = JSON.parse(frame);
      void handle(request).catch((error) => {
        output.write(JSON.stringify({ id: request.id, error: { message: error.message } }) + '\\0');
      });
    }
  });
  const keepAlive = setInterval(() => {}, 1000);
  const close = async () => {
    clearInterval(keepAlive);
    if (process.env.SNAPBACK_CARRIER_TEST_BROWSER_CLEANUP_STARTED) {
      writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_CLEANUP_STARTED, 'started');
    }
    const release = process.env.SNAPBACK_CARRIER_TEST_BROWSER_CLEANUP_RELEASE;
    while (release && !existsSync(release)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    if (hanging) writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_CLEANED, 'cleaned');
    process.exit(0);
  };
  process.on('SIGTERM', () => { void close(); });
  process.on('SIGINT', () => { void close(); });
  process.on('SIGHUP', () => { void close(); });
  if (hanging) {
    // This is the synchronization point for signal tests: publication means
    // all cleanup handlers are installed, not merely that the process began.
    writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_STARTED, 'started');
  }
} else {
  if (screenshot) writeFileSync(screenshot, Buffer.from('fake-png'));
  process.stdout.write('<html><body><h1>Application ready</h1><p>read/write journey retained by D2</p></body></html>');
}
`);

try {
  const simulatedLeader = {
    pid: 4242,
    startTime: 'Fri Aug 21 10:00:00 2026',
    command: 'node old-carrier.mjs',
    leaseMarker: 'old-run-marker',
  };
  const simulatedSignals = [];
  let simulatedGroup = 'owned';
  await teardownTest.stopGuardedProcessGroup(4242, simulatedLeader, 250, 250, {
    inspect: () => simulatedGroup,
    sendSignal(_pgid, name) {
      simulatedSignals.push(name);
      if (name === 'SIGTERM') simulatedGroup = 'changed';
    },
    wait: async () => {},
  });
  assert.deepEqual(
    simulatedSignals,
    ['SIGTERM'],
    'a reused PGID observed during the wait must permanently discharge before SIGKILL',
  );

  const staleReaperArtifacts = join(root, 'stale-reaper-artifacts');
  mkdirSync(staleReaperArtifacts, { recursive: true });
  const staleDescriptor = join(staleReaperArtifacts, 'expo-supervisor.json');
  const staleLease = await createCarrierCleanupLease();
  const staleResource = reserveCleanupPath(staleLease, staleDescriptor, {
    type: 'file',
    label: 'stale reaper descriptor regression',
  });
  writeFileSync(staleDescriptor, JSON.stringify({ supervisorGeneration: 'run-a' }), { mode: 0o600 });
  activateCleanupPath(staleResource, {
    runIdField: 'supervisorGeneration',
    runId: 'run-a',
  });
  const successorDescriptor = `${staleDescriptor}.run-b.tmp`;
  writeFileSync(successorDescriptor, JSON.stringify({ supervisorGeneration: 'run-b' }), { mode: 0o600 });
  renameSync(successorDescriptor, staleDescriptor);
  await closeCarrierCleanupLease(staleLease);
  assert.equal(
    JSON.parse(readFileSync(staleDescriptor, 'utf8')).supervisorGeneration,
    'run-b',
    'run A reaper must not delete run B descriptor at the same path',
  );
  rmSync(staleDescriptor, { force: true });

  const successArtifacts = join(root, 'success-artifacts');
  const successConfig = config('success');
  assert.equal(successConfig.carriers['web-browser'].origin, undefined);
  assert.equal(successConfig.carriers['web-browser'].structuredReadiness.kind, 'expo-supervisor');
  assert.equal(await runTemplateCarrierCli(successConfig, [
    'web-browser', '--browser', browser, '--artifacts', successArtifacts,
  ], { root }), 0);
  const director = JSON.parse(readFileSync(join(successArtifacts, 'director-log.json'), 'utf8'));
  assert.equal(director.status, 'completed');
  assert.equal(director.proofAuthority.kind, 'llp-0146-d2');
  assert.equal(director.observations.structuredReadiness.supervisorPid > 0, true);
  assert.equal(director.observations.structuredReadiness.listener.port > 0, true);
  assert.equal(
    Number(new URL(director.observations.origin).port),
    director.observations.structuredReadiness.listener.port,
  );
  assert.equal(director.observations.structuredReadiness.attestation.verified, true);
  assert.equal(director.observations.journey.readObserved, true);
  assert.equal(director.observations.journey.writeObserved, true);
  assert.match(readFileSync(join(successArtifacts, 'web-browser.html'), 'utf8'), /snapback-carrier-/u);
  assert.equal(director.observations.cleanup.readinessFileRemoved, true);
  assert.equal(director.observations.cleanup.browserExited, true);
  assert.equal(director.observations.cleanup.browserProfileRemoved, true);
  assert.equal(existsSync(join(successArtifacts, 'expo-supervisor.json')), false);
  assert.equal(existsSync(join(successArtifacts, 'supervisor-cleaned')), true);

  const staleArtifacts = join(root, 'stale-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('stale'), [
      'web-browser', '--browser', browser, '--artifacts', staleArtifacts,
    ], { root }),
    /does not belong to the exact web carrier child/u,
  );
  assert.equal(existsSync(join(staleArtifacts, 'supervisor-cleaned')), true);

  const unrelatedArtifacts = join(root, 'unrelated-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('unrelated'), [
      'web-browser', '--browser', browser, '--artifacts', unrelatedArtifacts,
    ], { root }),
    /Metro upstream listener was replaced/u,
  );
  assert.equal(existsSync(join(unrelatedArtifacts, 'supervisor-cleaned')), true);

  const takeoverArtifacts = join(root, 'takeover-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('takeover'), [
      'web-browser', '--browser', browser, '--artifacts', takeoverArtifacts,
    ], {
      root,
      async onWebOwnershipValidated() {
        writeFileSync(join(takeoverArtifacts, 'takeover-trigger'), 'replace');
        await eventually(
          () => existsSync(join(takeoverArtifacts, 'takeover-ready')),
          'synchronized same-project Metro takeover',
        );
      },
    }),
    /Metro process identity changed|Metro upstream listener (?:ownership changed|was replaced)/u,
  );
  assert.equal(existsSync(join(takeoverArtifacts, 'supervisor-cleaned')), true);

  const timeoutArtifacts = join(root, 'timeout-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('timeout', 10_000), [
      'web-browser', '--browser', browser, '--artifacts', timeoutArtifacts,
    ], { root }),
    /did not write structured readiness/u,
  );
  assert.equal(existsSync(join(timeoutArtifacts, 'supervisor-cleaned')), true);
  const timeoutPids = JSON.parse(readFileSync(join(timeoutArtifacts, 'descendant-pids.json')));
  await eventually(() => timeoutPids.every((pid) => !pidAlive(pid)), 'timeout detached Metro cleanup');

  const killedCliArtifacts = join(root, 'killed-cli-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('leader-sigkill'), [
      'web-browser', '--browser', browser, '--artifacts', killedCliArtifacts,
    ], { root }),
    /exited .* before readiness/u,
  );
  const killedCliPids = JSON.parse(readFileSync(join(killedCliArtifacts, 'descendant-pids.json')));
  await eventually(() => killedCliPids.every((pid) => !pidAlive(pid)), 'pre-descriptor SIGKILL descendants');

  const stubbornArtifacts = join(root, 'stubborn-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('stubborn-grandchild', 10_000), [
      'web-browser', '--browser', browser, '--artifacts', stubbornArtifacts,
    ], { root }),
    /did not write structured readiness/u,
  );
  const stubbornPids = JSON.parse(readFileSync(join(stubbornArtifacts, 'descendant-pids.json')));
  await eventually(() => stubbornPids.every((pid) => !pidAlive(pid)), 'stubborn grandchild SIGKILL');

  const signalArtifacts = join(root, 'signal-artifacts');
  const browserStarted = join(signalArtifacts, 'browser-started');
  const browserJourneyReady = join(signalArtifacts, 'browser-journey-ready');
  const browserCleaned = join(signalArtifacts, 'browser-cleaned');
  const browserCleanupStarted = join(signalArtifacts, 'browser-cleanup-started');
  const browserCleanupRelease = join(signalArtifacts, 'browser-cleanup-release');
  const browserProfile = join(signalArtifacts, 'browser-profile');
  mkdirSync(signalArtifacts, { recursive: true });
  writeFileSync(signalRunner, `
import { writeFileSync } from 'node:fs';
import { defineTemplateCarrierConfig, runTemplateCarrierCli } from ${JSON.stringify(carrierKitUrl)};
const config = defineTemplateCarrierConfig(${JSON.stringify(config('success', 5_000))});
try {
  await runTemplateCarrierCli(config, ['web-browser', '--browser', ${JSON.stringify(browser)}, '--artifacts', ${JSON.stringify(signalArtifacts)}], {
    root: ${JSON.stringify(root)},
    onBrowserJourneyReady() {
      writeFileSync(${JSON.stringify(browserJourneyReady)}, 'ready');
    },
  });
} catch (error) {
  process.exitCode = error?.carrierStatus === 'interrupted' ? 23 : 24;
}
`);
  const runner = spawn(process.execPath, [signalRunner], {
    cwd: root,
    env: {
      ...process.env,
      SNAPBACK_CARRIER_TEST_HANG_BROWSER: '1',
      SNAPBACK_CARRIER_TEST_BROWSER_STARTED: browserStarted,
      SNAPBACK_CARRIER_TEST_BROWSER_CLEANED: browserCleaned,
      SNAPBACK_CARRIER_TEST_BROWSER_CLEANUP_STARTED: browserCleanupStarted,
      SNAPBACK_CARRIER_TEST_BROWSER_CLEANUP_RELEASE: browserCleanupRelease,
      SNAPBACK_CARRIER_TEST_BROWSER_PROFILE: browserProfile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let signalOutput = '';
  runner.stdout.on('data', (chunk) => { signalOutput += chunk; });
  runner.stderr.on('data', (chunk) => { signalOutput += chunk; });
  await eventually(() => existsSync(browserJourneyReady), 'double-signal browser journey barrier');
  runner.kill('SIGTERM');
  await eventually(() => existsSync(browserCleanupStarted), 'browser cleanup-start barrier');
  runner.kill('SIGTERM');
  writeFileSync(browserCleanupRelease, 'release');
  const signalExit = await new Promise((resolveExit, rejectExit) => {
    runner.once('error', rejectExit);
    runner.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(signalExit, { code: 23, signal: null }, signalOutput);
  await eventually(() => existsSync(browserCleaned), 'double-signal browser cleanup completion');
  await eventually(
    () => existsSync(join(signalArtifacts, 'supervisor-cleaned')),
    'double-signal supervisor cleanup completion',
  );
  assert.equal(existsSync(join(signalArtifacts, 'expo-supervisor.json')), false);
  assert.equal(existsSync(readFileSync(browserProfile, 'utf8')), false);

  const carrierDeathArtifacts = join(root, 'carrier-death-artifacts');
  const carrierDeathBrowserStarted = join(carrierDeathArtifacts, 'browser-started');
  const carrierDeathBrowserProfile = join(carrierDeathArtifacts, 'browser-profile');
  const carrierDeathBrowserPid = join(carrierDeathArtifacts, 'browser-pid');
  mkdirSync(carrierDeathArtifacts, { recursive: true });
  writeFileSync(carrierDeathRunner, `
import { defineTemplateCarrierConfig, runTemplateCarrierCli } from ${JSON.stringify(carrierKitUrl)};
const config = defineTemplateCarrierConfig(${JSON.stringify(config('success', 30_000))});
await runTemplateCarrierCli(config, ['web-browser', '--browser', ${JSON.stringify(browser)}, '--artifacts', ${JSON.stringify(carrierDeathArtifacts)}], { root: ${JSON.stringify(root)} });
`);
  const deathRunner = spawn(process.execPath, [carrierDeathRunner], {
    cwd: root,
    env: {
      ...process.env,
      SNAPBACK_CARRIER_TEST_HANG_BROWSER: '1',
      SNAPBACK_CARRIER_TEST_BROWSER_STARTED: carrierDeathBrowserStarted,
      SNAPBACK_CARRIER_TEST_BROWSER_CLEANED: join(carrierDeathArtifacts, 'browser-cleaned'),
      SNAPBACK_CARRIER_TEST_BROWSER_PROFILE: carrierDeathBrowserProfile,
      SNAPBACK_CARRIER_TEST_BROWSER_PID: carrierDeathBrowserPid,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const carrierDeathPidsPath = join(carrierDeathArtifacts, 'descendant-pids.json');
  await eventually(() => existsSync(carrierDeathPidsPath), 'carrier-death descendant inventory');
  await eventually(() => existsSync(carrierDeathBrowserStarted), 'carrier-death browser start');
  const carrierDeathPids = JSON.parse(readFileSync(carrierDeathPidsPath, 'utf8'));
  carrierDeathPids.push(Number(readFileSync(carrierDeathBrowserPid, 'utf8')));
  const carrierDeathProfile = readFileSync(carrierDeathBrowserProfile, 'utf8');
  deathRunner.kill('SIGKILL');
  await new Promise((resolveExit) => deathRunner.once('close', resolveExit));
  await eventually(
    () => carrierDeathPids.every((pid) => !pidAlive(pid)),
    'carrier-death supervisor, detached Metro, and browser groups',
  );
  await eventually(() => !existsSync(carrierDeathProfile), 'carrier-death browser profile lease');
  assert.equal(existsSync(join(carrierDeathArtifacts, 'expo-supervisor.json')), false);

  console.log('carrier-kit.test.mjs: identity-discharge simulation, run-bound descriptor lease, live ownership, attestation, takeover, stubborn/SIGKILL reclamation, and double-signal cleanup pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
