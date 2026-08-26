import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  __test as carrierKitTest,
  defineTemplateCarrierConfig,
  runTemplateCarrierCli as runTemplateCarrierCliRaw,
} from './carrier-kit.mjs';
import {
  __test as teardownTest,
  activateCleanupPath,
  closeCarrierCleanupLease,
  createCarrierCleanupLease,
  reserveCleanupPath,
  spawnLeasedProcess,
  stopProcessGroup,
} from './process-teardown.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-carrier-kit-'));
const carrierKitUrl = pathToFileURL(join(import.meta.dirname, 'carrier-kit.mjs')).href;
const expoDevUrl = pathToFileURL(join(import.meta.dirname, 'expo-dev.mjs')).href;
const teardownUrl = pathToFileURL(join(import.meta.dirname, 'process-teardown.mjs')).href;
const verifier = join(root, 'verify.mjs');
const npxShim = join(root, 'npx');
const server = join(root, 'server.mjs');
const supervisor = join(root, 'supervisor.mjs');
const browser = join(root, 'browser.mjs');
const signalRunner = join(root, 'signal-runner.mjs');
const carrierDeathRunner = join(root, 'carrier-death-runner.mjs');
const carrierStatePaths = new Map();
const carrierState = (artifacts) => {
  const key = resolve(artifacts);
  const pointer = join(key, 'carrier-state-path');
  if (!carrierStatePaths.has(key) && existsSync(pointer)) {
    carrierStatePaths.set(key, readFileSync(pointer, 'utf8'));
  }
  return carrierStatePaths.get(key) ?? join(key, '.snapback-carrier-state');
};
const runTemplateCarrierCli = (configValue, argv, options = {}) => runTemplateCarrierCliRaw(
  configValue,
  argv,
  {
    ...options,
    onSupervisorStatePrepared(prepared) {
      carrierStatePaths.set(resolve(prepared.artifacts), prepared.directory);
      return options.onSupervisorStatePrepared?.(prepared);
    },
    onBeforeSupervisorStateCleanup(prepared) {
      const snapshot = join(prepared.artifacts, 'carrier-state-snapshot');
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(prepared.directory, snapshot, { recursive: true });
      carrierStatePaths.set(resolve(prepared.artifacts), snapshot);
      return options.onBeforeSupervisorStateCleanup?.(prepared);
    },
  },
);

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
          '{supervisorState}/expo-supervisor.json',
          '{supervisorState}/supervisor-cleaned',
          '{supervisorState}/supervisor-started',
          '{supervisorState}/descendant-pids.json',
          '{supervisorState}/takeover-trigger',
          '{supervisorState}/takeover-ready',
          '{artifacts}/proof.json',
        ],
        structuredReadiness: {
          kind: 'expo-supervisor',
          file: '{supervisorState}/expo-supervisor.json',
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

const pathContractConfig = defineTemplateCarrierConfig({
  schemaVersion: 'snapback.template-carriers.v1',
  verifyCommand: ['snapback', 'verify'],
  verifyReceipt: '.snapback/verify-receipt.json',
  carriers: {
    'web-browser': {
      command: ['expo', 'start', '{artifacts}/proof.json', '{supervisorState}/child-state.json'],
      structuredReadiness: {
        kind: 'expo-supervisor',
        file: '{supervisorState}/expo-supervisor.json',
      },
    },
  },
});
assert.deepEqual(pathContractConfig.carriers['web-browser'].command, [
  'expo',
  'start',
  '{artifacts}/proof.json',
  '{supervisorState}/child-state.json',
]);
assert.equal(
  pathContractConfig.carriers['web-browser'].structuredReadiness.file,
  '{supervisorState}/expo-supervisor.json',
  'runtime must accept the same supervisor-state readiness path as the public declaration',
);
assert.throws(
  () => defineTemplateCarrierConfig({
    schemaVersion: 'snapback.template-carriers.v1',
    verifyCommand: ['snapback', 'verify'],
    verifyReceipt: '.snapback/verify-receipt.json',
    carriers: {
      'web-browser': {
        command: ['expo', 'start', '{artifacts}/proof.json'],
        structuredReadiness: {
          kind: 'expo-supervisor',
          file: '{artifacts}/expo-supervisor.json',
        },
      },
    },
  }),
  /must be a path below \{supervisorState\}/u,
  'runtime must reject the same public-artifacts readiness path as the public declaration',
);

executable(verifier, `
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.snapback', { recursive: true });
writeFileSync('.snapback/verify-receipt.json', JSON.stringify({
  schemaVersion: 'snapback.verify-receipt.v1',
  ok: true,
  status: 'passed',
}));
`);

executable(npxShim, `
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [started, mutate, ready] = args.slice(-3);
writeFileSync(started, String(process.pid));
const timer = setInterval(() => {
  if (!existsSync(mutate)) return;
  clearInterval(timer);
  process.title = ['npm', 'exec', ...args.slice(1)].join(' ');
  writeFileSync(ready, String(process.pid));
}, 10);
`);

// Every lifecycle case below uses a real TCP listener and real descendant
// process. The stubborn mode deliberately survives SIGTERM.
executable(server, `
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [mode, requestedPort, requestedHost, statePath] = process.argv.slice(2);
let lingeringChild = null;
if (mode === 'leader-exits-child-lingers') {
  lingeringChild = spawn(process.execPath, [process.argv[1], 'stubborn', '0', requestedHost, statePath + '.child'], {
    stdio: 'ignore',
  });
}
const http = createServer((request, response) => {
  response.statusCode = 200;
  response.end('<html><body><h1>Application ready</h1></body></html>');
});
http.listen(Number(requestedPort), requestedHost, () => {
  const temporaryState = statePath + '.' + process.pid + '.tmp';
  writeFileSync(temporaryState, JSON.stringify({
    pid: process.pid,
    ...(lingeringChild === null ? {} : { lingeringChildPid: lingeringChild.pid }),
    host: requestedHost,
    port: http.address().port,
  }));
  renameSync(temporaryState, statePath);
});
const close = () => {
  if (mode === 'stubborn') return;
  if (mode === 'leader-exits-child-lingers') process.exit(0);
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
  artifactProof,
] = process.argv.slice(2);
writeFileSync(artifactProof, JSON.stringify({ location: 'public-artifacts' }));
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
} else if (scenario === 'leader-exits-child-lingers') {
  const leader = await startServer({ mode: 'leader-exits-child-lingers' });
  writeFileSync(pidFile, JSON.stringify([leader.child.pid, leader.state.lingeringChildPid]));
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
  const unsafeStateOnly = process.argv.includes('--unsafe-state-only');
  const simulatedLeader = {
    pid: 4242,
    startTime: 'Fri Aug 21 10:00:00 2026',
    command: 'node old-carrier.mjs',
    leaseMarker: 'old-run-marker',
  };
  if (!unsafeStateOnly) {
    const alreadyExitingSignals = [];
    let alreadyExitingInspection = 0;
    const alreadyExitingOutcome = await teardownTest.stopGuardedProcessGroup(
      4141,
      { ...simulatedLeader, pid: 4141 },
      250,
      250,
      {
        inspect() {
          alreadyExitingInspection += 1;
          return alreadyExitingInspection === 1 ? 'changed' : 'empty';
        },
        sendSignal(_pgid, name) { alreadyExitingSignals.push(name); },
        wait: async () => {},
      },
    );
    assert.deepEqual(
      alreadyExitingOutcome,
      { status: 'stopped' },
      'a pre-signal cooperative exit must prove the discharged group empty',
    );
    assert.deepEqual(
      alreadyExitingSignals,
      [],
      'a pre-signal identity discharge must never signal the numeric group',
    );

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

    const ambiguousSignals = [];
    const ambiguousOutcome = await teardownTest.stopGuardedProcessGroup(
      4343,
      { ...simulatedLeader, pid: 4343 },
      0,
      0,
      {
        inspect: () => 'ambiguous',
        sendSignal(_pgid, name) { ambiguousSignals.push(name); },
        wait: async () => {},
      },
    );
    assert.deepEqual(
      ambiguousOutcome,
      { status: 'ambiguous' },
      'an ambiguous post-signal inspection must not report the owned group stopped',
    );
    assert.deepEqual(
      ambiguousSignals,
      [],
      'ambiguity must retain custody without signaling an unverified group',
    );
    console.log('process-group ambiguity: stop outcome remains ambiguous and custody is retained');
  }

  const npxStarted = join(root, 'npx-shim-started');
  const npxMutate = join(root, 'npx-shim-mutate');
  const npxReady = join(root, 'npx-shim-ready');
  const npxLease = await createCarrierCleanupLease();
  const npxProcess = spawnLeasedProcess([
    npxShim,
    '--no-install',
    'expo',
    'start',
    '--localhost',
    npxStarted,
    npxMutate,
    npxReady,
  ], {
    cleanupLease: npxLease,
    label: 'mutable npx shim',
    stdio: 'ignore',
  });
  await eventually(() => existsSync(npxStarted), 'npx shim start');
  await eventually(
    () => readdirSync(npxLease.directory)
      .filter((name) => name.startsWith('resource-') && name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(npxLease.directory, name), 'utf8')))
      .some((resource) => resource.label === 'mutable npx shim' && resource.state === 'active'),
    'npx shim active lease',
  );
  writeFileSync(npxMutate, 'mutate');
  await eventually(() => existsSync(npxReady), 'npx shim command-title mutation');
  assert.equal(await stopProcessGroup(npxProcess, { graceMs: 250, killWaitMs: 1_000 }), true);
  await eventually(() => !pidAlive(Number(readFileSync(npxReady, 'utf8'))), 'npx shim cleanup');
  await closeCarrierCleanupLease(npxLease);

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

  const looseStateArtifacts = join(root, 'loose-state-artifacts');
  const looseStateDirectory = carrierState(looseStateArtifacts);
  mkdirSync(looseStateDirectory, { recursive: true, mode: 0o755 });
  chmodSync(looseStateDirectory, 0o755);
  const preparedState = carrierKitTest.prepareSupervisorStateDirectory();
  assert.equal(
    lstatSync(preparedState).mode & 0o777,
    0o700,
    'supervisor state must be owner-only',
  );
  assert.notEqual(
    preparedState,
    looseStateDirectory,
    'caller-owned artifacts must not carry supervisor state',
  );
  assert.equal(
    lstatSync(looseStateDirectory).mode & 0o777,
    0o755,
    'pre-existing caller artifacts must not be chmodded',
  );
  rmSync(preparedState, { recursive: true, force: true });
  console.log('supervisor state custody: run-unique owner-only temp tree leaves artifacts untouched');

  const headlessConfig = defineTemplateCarrierConfig({
    schemaVersion: 'snapback.template-carriers.v1',
    verifyCommand: [process.execPath, verifier],
    verifyReceipt: '.snapback/verify-receipt.json',
    carriers: { headless: {} },
  });
  const headlessLooseArtifacts = join(root, 'headless-loose-state-artifacts');
  const headlessLooseState = carrierState(headlessLooseArtifacts);
  mkdirSync(headlessLooseState, { recursive: true, mode: 0o755 });
  chmodSync(headlessLooseState, 0o755);
  assert.equal(await runTemplateCarrierCli(headlessConfig, [
    'headless', '--artifacts', headlessLooseArtifacts,
  ], { root }), 0);
  assert.equal(
    lstatSync(headlessLooseState).mode & 0o777,
    0o755,
    'headless verification must not validate or change unused supervisor state',
  );
  const headlessFreshArtifacts = join(root, 'headless-fresh-artifacts');
  assert.equal(await runTemplateCarrierCli(headlessConfig, [
    'headless', '--artifacts', headlessFreshArtifacts,
  ], { root }), 0);
  assert.equal(
    existsSync(carrierState(headlessFreshArtifacts)),
    false,
    'headless verification must not create unused supervisor state',
  );

  const publishedReadiness = join(root, 'published-after-exit.json');
  writeFileSync(publishedReadiness, JSON.stringify({
    schemaVersion: 'snapback.expo-supervisor.v1',
    formatVersion: 1,
    state: 'ready',
    correlationId: 'carrier-test-published-after-exit',
    supervisorGeneration: 'carrier-test-published-after-exit-generation',
    pid: 4242,
    supervisor: { pid: 4242, startTime: 'published-supervisor-start' },
    platform: 'web',
    connectCarrier: 'supervisor-rendezvous',
    metro: {
      pid: 4343,
      startTime: 'published-metro-start',
      origin: 'http://127.0.0.1:4101',
      upstreamOrigin: 'http://127.0.0.1:4102',
    },
    attestation: {
      path: '/_snapback/expo/v1/web-attestation/published-after-exit',
      nonce: 'published-after-exit-' + 'x'.repeat(32),
    },
    listeners: [
      {
        owner: 'metro',
        pid: 4343,
        startTime: 'published-metro-start',
        host: '127.0.0.1',
        port: 4102,
        loopback: true,
      },
      {
        owner: 'metro-front',
        pid: 4242,
        startTime: 'published-supervisor-start',
        host: '127.0.0.1',
        port: 4101,
        loopback: true,
      },
    ],
  }), { mode: 0o600 });
  chmodSync(publishedReadiness, 0o600);
  const published = await carrierKitTest.waitForExpoSupervisorWebReadiness(
    publishedReadiness,
    1_000,
    { pid: 4242, exitCode: 0, signalCode: null },
  );
  assert.equal(
    published.origin,
    'http://127.0.0.1:4101',
    'an existing descriptor is authoritative even when the child has already exited',
  );

  const successArtifacts = join(root, 'success-artifacts');
  mkdirSync(successArtifacts, { mode: 0o755 });
  chmodSync(successArtifacts, 0o755);
  const successConfig = config('success');
  assert.equal(successConfig.carriers['web-browser'].origin, undefined);
  assert.equal(successConfig.carriers['web-browser'].structuredReadiness.kind, 'expo-supervisor');
  assert.equal(await runTemplateCarrierCli(successConfig, [
    'web-browser', '--browser', browser, '--artifacts', successArtifacts,
  ], { root }), 0);
  assert.equal(
    lstatSync(successArtifacts).mode & 0o777,
    0o755,
    '--artifacts must not change the caller-owned directory mode',
  );
  assert.equal(
    existsSync(join(successArtifacts, '.snapback-carrier-state')),
    false,
    'authority-bearing supervisor state must not live under caller artifacts',
  );
  const groupWritableProject = join(root, 'group-writable-web-project');
  const groupWritableArtifacts = join(groupWritableProject, 'artifacts');
  mkdirSync(groupWritableProject, { mode: 0o775 });
  chmodSync(groupWritableProject, 0o775);
  assert.equal(await runTemplateCarrierCli(successConfig, [
    'web-browser', '--browser', browser, '--artifacts', groupWritableArtifacts,
  ], { root: groupWritableProject }), 0);
  assert.equal(
    existsSync(join(groupWritableArtifacts, 'director-log.json')),
    true,
    'a 0775 template project must still spawn snapback dev and reach web readiness',
  );
  console.log('0775 template project: web carrier spawns and reaches structured readiness');
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
  assert.deepEqual(
    JSON.parse(readFileSync(join(successArtifacts, 'proof.json'), 'utf8')),
    { location: 'public-artifacts' },
    'an unrelated {artifacts} command argument must land in the caller-visible artifacts directory',
  );
  assert.equal(existsSync(join(carrierState(successArtifacts), 'proof.json')), false);
  assert.equal(director.observations.cleanup.readinessFileRemoved, true);
  assert.equal(director.observations.cleanup.browserExited, true);
  assert.equal(director.observations.cleanup.browserProfileRemoved, true);
  assert.equal(existsSync(join(carrierState(successArtifacts), 'expo-supervisor.json')), false);
  assert.equal(existsSync(join(carrierState(successArtifacts), 'supervisor-cleaned')), true);

  const staleArtifacts = join(root, 'stale-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('stale'), [
      'web-browser', '--browser', browser, '--artifacts', staleArtifacts,
    ], { root }),
    /does not belong to the exact web carrier child/u,
  );
  assert.equal(existsSync(join(carrierState(staleArtifacts), 'supervisor-cleaned')), true);

  const unrelatedArtifacts = join(root, 'unrelated-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('unrelated'), [
      'web-browser', '--browser', browser, '--artifacts', unrelatedArtifacts,
    ], { root }),
    /Metro upstream listener was replaced/u,
  );
  assert.equal(existsSync(join(carrierState(unrelatedArtifacts), 'supervisor-cleaned')), true);

  const takeoverArtifacts = join(root, 'takeover-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('takeover'), [
      'web-browser', '--browser', browser, '--artifacts', takeoverArtifacts,
    ], {
      root,
      async onWebOwnershipValidated() {
        writeFileSync(join(carrierState(takeoverArtifacts), 'takeover-trigger'), 'replace');
        await eventually(
          () => existsSync(join(carrierState(takeoverArtifacts), 'takeover-ready')),
          'synchronized same-project Metro takeover',
        );
      },
    }),
    /Metro process identity changed|Metro upstream listener (?:ownership changed|was replaced)/u,
  );
  assert.equal(existsSync(join(carrierState(takeoverArtifacts), 'supervisor-cleaned')), true);

  const timeoutArtifacts = join(root, 'timeout-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('timeout', 10_000), [
      'web-browser', '--browser', browser, '--artifacts', timeoutArtifacts,
    ], { root }),
    /did not write structured readiness/u,
  );
  assert.equal(existsSync(join(carrierState(timeoutArtifacts), 'supervisor-cleaned')), true);
  const timeoutPids = JSON.parse(readFileSync(join(carrierState(timeoutArtifacts), 'descendant-pids.json')));
  await eventually(() => timeoutPids.every((pid) => !pidAlive(pid)), 'timeout detached Metro cleanup');

  const killedCliArtifacts = join(root, 'killed-cli-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('leader-sigkill'), [
      'web-browser', '--browser', browser, '--artifacts', killedCliArtifacts,
    ], { root }),
    /exited .* before readiness; did not write structured readiness/u,
  );
  const killedCliPids = JSON.parse(readFileSync(join(carrierState(killedCliArtifacts), 'descendant-pids.json')));
  await eventually(() => killedCliPids.every((pid) => !pidAlive(pid)), 'pre-descriptor SIGKILL descendants');

  const stubbornArtifacts = join(root, 'stubborn-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('stubborn-grandchild', 10_000), [
      'web-browser', '--browser', browser, '--artifacts', stubbornArtifacts,
    ], { root }),
    /did not write structured readiness/u,
  );
  const stubbornPids = JSON.parse(readFileSync(join(carrierState(stubbornArtifacts), 'descendant-pids.json')));
  await eventually(() => stubbornPids.every((pid) => !pidAlive(pid)), 'stubborn grandchild SIGKILL');

  const leaderExitArtifacts = join(root, 'leader-exit-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('leader-exits-child-lingers', 10_000), [
      'web-browser', '--browser', browser, '--artifacts', leaderExitArtifacts,
    ], { root }),
    /did not write structured readiness/u,
  );
  const leaderExitPids = JSON.parse(readFileSync(join(carrierState(leaderExitArtifacts), 'descendant-pids.json')));
  await eventually(
    () => leaderExitPids.every((pid) => !pidAlive(pid)),
    'SIGTERM-exited leader with lingering leased child cleanup',
  );
  console.log('process-group cleanup: leader SIGTERM exit still escalates the lingering leased child');

  const signalArtifacts = join(root, 'signal-artifacts');
  const browserStarted = join(signalArtifacts, 'browser-started');
  const browserJourneyReady = join(signalArtifacts, 'browser-journey-ready');
  const browserCleaned = join(signalArtifacts, 'browser-cleaned');
  const browserCleanupStarted = join(signalArtifacts, 'browser-cleanup-started');
  const browserCleanupRelease = join(signalArtifacts, 'browser-cleanup-release');
  const browserProfile = join(signalArtifacts, 'browser-profile');
  mkdirSync(signalArtifacts, { recursive: true });
  writeFileSync(signalRunner, `
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { defineTemplateCarrierConfig, runTemplateCarrierCli } from ${JSON.stringify(carrierKitUrl)};
const config = defineTemplateCarrierConfig(${JSON.stringify(config('success', 5_000))});
try {
  await runTemplateCarrierCli(config, ['web-browser', '--browser', ${JSON.stringify(browser)}, '--artifacts', ${JSON.stringify(signalArtifacts)}], {
    root: ${JSON.stringify(root)},
    onSupervisorStatePrepared({ directory }) {
      writeFileSync(${JSON.stringify(join(signalArtifacts, 'carrier-state-path'))}, directory);
    },
    onBeforeSupervisorStateCleanup({ directory }) {
      const snapshot = ${JSON.stringify(join(signalArtifacts, 'carrier-state-snapshot'))};
      rmSync(snapshot, { recursive: true, force: true });
      cpSync(directory, snapshot, { recursive: true });
      writeFileSync(${JSON.stringify(join(signalArtifacts, 'carrier-state-path'))}, snapshot);
    },
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
    () => existsSync(join(carrierState(signalArtifacts), 'supervisor-cleaned')),
    'double-signal supervisor cleanup completion',
  );
  assert.equal(existsSync(join(carrierState(signalArtifacts), 'expo-supervisor.json')), false);
  assert.equal(existsSync(readFileSync(browserProfile, 'utf8')), false);

  const carrierDeathArtifacts = join(root, 'carrier-death-artifacts');
  const carrierDeathBrowserStarted = join(carrierDeathArtifacts, 'browser-started');
  const carrierDeathBrowserProfile = join(carrierDeathArtifacts, 'browser-profile');
  const carrierDeathBrowserPid = join(carrierDeathArtifacts, 'browser-pid');
  const carrierDeathLeaseDirectory = join(carrierDeathArtifacts, 'cleanup-lease-directory');
  const carrierDeathFinalizeBarrier = join(carrierDeathArtifacts, 'allow-browser-finalization');
  mkdirSync(carrierDeathArtifacts, { recursive: true });
  writeFileSync(carrierDeathRunner, `
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { defineTemplateCarrierConfig, runTemplateCarrierCli } from ${JSON.stringify(carrierKitUrl)};
const config = defineTemplateCarrierConfig(${JSON.stringify(config('success', 30_000))});
await runTemplateCarrierCli(config, ['web-browser', '--browser', ${JSON.stringify(browser)}, '--artifacts', ${JSON.stringify(carrierDeathArtifacts)}], {
  root: ${JSON.stringify(root)},
  onSupervisorStatePrepared({ directory }) {
    writeFileSync(${JSON.stringify(join(carrierDeathArtifacts, 'carrier-state-path'))}, directory);
  },
  onBeforeSupervisorStateCleanup({ directory }) {
    const snapshot = ${JSON.stringify(join(carrierDeathArtifacts, 'carrier-state-snapshot'))};
    rmSync(snapshot, { recursive: true, force: true });
    cpSync(directory, snapshot, { recursive: true });
    writeFileSync(${JSON.stringify(join(carrierDeathArtifacts, 'carrier-state-path'))}, snapshot);
  },
  browserLeaseFinalizationReady() {
    return existsSync(${JSON.stringify(carrierDeathFinalizeBarrier)});
  },
  onBrowserLeaseReserved(lease) {
    writeFileSync(${JSON.stringify(carrierDeathLeaseDirectory)}, lease.directory);
  },
});
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
  await eventually(
    () => existsSync(join(carrierDeathArtifacts, 'carrier-state-path')),
    'carrier-death supervisor-state publication',
  );
  const carrierDeathPidsPath = join(carrierState(carrierDeathArtifacts), 'descendant-pids.json');
  await eventually(() => existsSync(carrierDeathPidsPath), 'carrier-death descendant inventory');
  await eventually(() => existsSync(carrierDeathBrowserStarted), 'carrier-death browser start');
  const cleanupLeaseDirectory = readFileSync(carrierDeathLeaseDirectory, 'utf8');
  const pendingBrowserLease = readdirSync(cleanupLeaseDirectory)
    .filter((name) => name.startsWith('resource-') && name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(cleanupLeaseDirectory, name), 'utf8')))
    .find((resource) => resource.kind === 'process-group' && resource.label === 'carrier browser');
  assert.equal(pendingBrowserLease?.state, 'pending');
  assert.equal(pendingBrowserLease?.runId.length > 0, true);
  assert.deepEqual(pendingBrowserLease?.intendedCommand.slice(0, 2), [browser, '--headless=new']);
  assert.equal(pendingBrowserLease?.profileDirectory, readFileSync(carrierDeathBrowserProfile, 'utf8'));
  assert.equal(pendingBrowserLease?.spawned.pid, Number(readFileSync(carrierDeathBrowserPid, 'utf8')));
  assert.equal(typeof pendingBrowserLease?.spawned.startTime, 'string');
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
  assert.equal(existsSync(join(carrierState(carrierDeathArtifacts), 'expo-supervisor.json')), false);

  console.log('carrier-kit.test.mjs: supervisor-state declaration/runtime path parity, identity discharge, run-bound descriptor and pending child leases, live ownership, attestation, takeover, stubborn/SIGKILL reclamation, and double-signal cleanup pass');
} finally {
  for (const directory of new Set(carrierStatePaths.values())) {
    rmSync(directory, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}
