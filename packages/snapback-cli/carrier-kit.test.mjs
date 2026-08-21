import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

const root = mkdtempSync(join(tmpdir(), 'snapback-carrier-kit-'));
const carrierKitUrl = pathToFileURL(join(import.meta.dirname, 'carrier-kit.mjs')).href;
const verifier = join(root, 'verify.mjs');
const supervisor = join(root, 'supervisor.mjs');
const browser = join(root, 'browser.mjs');
const signalRunner = join(root, 'signal-runner.mjs');

for (const template of ['react', 'crud-dashboard']) {
  const source = readFileSync(join(import.meta.dirname, 'templates', template, 'carrier.mjs'), 'utf8');
  assert.match(source, /origin:\s*'http:\/\/127\.0\.0\.1:5173'/u);
  assert.doesNotMatch(source, /structuredReadiness|--expo-platform/u);
}

function executable(path, source) {
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o755);
}

async function eventually(check, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function config(scenario, startupTimeoutMs = 2_000) {
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

executable(supervisor, `
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const [scenario, readiness, cleaned, started] = process.argv.slice(2);
writeFileSync(started, 'started');
if (scenario !== 'timeout') {
  const port = 30000 + (process.pid % 20000);
  const descriptor = {
    schemaVersion: 'snapback.expo-supervisor.v1',
    formatVersion: 1,
    state: 'ready',
    correlationId: 'carrier-test-correlation',
    supervisorGeneration: 'carrier-test-generation',
    pid: scenario === 'stale' ? process.pid + 100000 : process.pid,
    platform: 'web',
    connectCarrier: 'supervisor-rendezvous',
    exchangeOrigin: 'http://127.0.0.1:1',
    controlPath: '/_snapback/expo/v1/control',
    metro: { pid: process.pid, origin: 'http://127.0.0.1:' + port },
    listeners: [{
      owner: 'metro', pid: process.pid, command: 'fake-metro',
      host: scenario === 'unrelated' ? '::1' : '127.0.0.1', port, loopback: true,
    }],
    startedAt: new Date().toISOString(),
  };
  const temporary = readiness + '.tmp';
  writeFileSync(temporary, JSON.stringify(descriptor), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, readiness);
}
const keepAlive = setInterval(() => {}, 1000);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  clearInterval(keepAlive);
  rmSync(readiness, { force: true });
  writeFileSync(cleaned, 'cleaned');
  process.exit(0);
};
process.once('SIGTERM', close);
process.once('SIGINT', close);
process.once('SIGHUP', close);
`);

executable(browser, `
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
const screenshot = process.argv.find((value) => value.startsWith('--screenshot='))?.slice('--screenshot='.length);
const profile = process.argv.find((value) => value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const cdp = process.argv.includes('--remote-debugging-pipe');
const hanging = process.env.SNAPBACK_CARRIER_TEST_HANG_BROWSER === '1';
if (hanging) {
  writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_STARTED, 'started');
  writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_PROFILE, profile ?? '');
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
  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const boundary = buffer.indexOf(0);
      if (boundary === -1) break;
      const frame = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      if (!frame) continue;
      const request = JSON.parse(frame);
      if (request.method === 'Target.getTargets') {
        respond(request, { targetInfos: [{ targetId: 'page-1', type: 'page', url: origin }] });
      } else if (request.method === 'Target.attachToTarget') {
        respond(request, { sessionId: 'session-1' });
      } else if (request.method === 'Runtime.evaluate') {
        const expression = request.params.expression;
        if (expression.startsWith('globalThis.__snapbackCarrierJourneyId = ')) {
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
    }
  });
  const keepAlive = setInterval(() => {}, 1000);
  const close = () => {
    clearInterval(keepAlive);
    if (hanging) writeFileSync(process.env.SNAPBACK_CARRIER_TEST_BROWSER_CLEANED, 'cleaned');
    process.exit(0);
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  process.once('SIGHUP', close);
} else {
  if (screenshot) writeFileSync(screenshot, Buffer.from('fake-png'));
  process.stdout.write('<html><body><h1>Application ready</h1><p>read/write journey retained by D2</p></body></html>');
}
`);

try {
  const successArtifacts = join(root, 'success-artifacts');
  let successResult;
  let successHttpOrigin = null;
  const successConfig = config('success');
  assert.equal(successConfig.carriers['web-browser'].origin, undefined);
  assert.equal(successConfig.carriers['web-browser'].structuredReadiness.kind, 'expo-supervisor');
  try {
    successResult = await runTemplateCarrierCli(successConfig, [
      'web-browser', '--browser', browser, '--artifacts', successArtifacts,
    ], {
      root,
      fetch: async (origin) => {
        successHttpOrigin = origin;
        return { status: 200 };
      },
    });
  } catch (error) {
    const log = join(successArtifacts, 'web-dev.log');
    if (existsSync(log)) error.message += `\nweb-dev.log:\n${readFileSync(log, 'utf8')}`;
    throw error;
  }
  assert.equal(successResult, 0);
  const director = JSON.parse(readFileSync(join(successArtifacts, 'director-log.json'), 'utf8'));
  assert.equal(director.status, 'completed');
  assert.equal(director.proofAuthority.kind, 'llp-0146-d2');
  assert.equal(director.observations.structuredReadiness.supervisorPid > 0, true);
  assert.equal(director.observations.structuredReadiness.listener.port > 0, true);
  assert.equal(director.observations.origin, successHttpOrigin);
  assert.equal(
    Number(new URL(successHttpOrigin).port),
    director.observations.structuredReadiness.listener.port,
  );
  assert.equal(director.observations.journey.readObserved, true);
  assert.equal(director.observations.journey.writeObserved, true);
  assert.match(
    readFileSync(join(successArtifacts, 'web-browser.html'), 'utf8'),
    /snapback-carrier-/u,
  );
  assert.equal(director.observations.cleanup.readinessFileRemoved, true);
  assert.equal(director.observations.cleanup.browserExited, true);
  assert.equal(director.observations.cleanup.browserProfileRemoved, true);
  assert.equal(existsSync(join(successArtifacts, 'expo-supervisor.json')), false);
  assert.equal(existsSync(join(successArtifacts, 'supervisor-cleaned')), true);

  const staleArtifacts = join(root, 'stale-artifacts');
  let staleHttpProbes = 0;
  await assert.rejects(
    runTemplateCarrierCli(config('stale'), [
      'web-browser', '--browser', browser, '--artifacts', staleArtifacts,
    ], {
      root,
      fetch: async () => {
        staleHttpProbes += 1;
        return { status: 200 };
      },
    }),
    /does not belong to the exact web carrier child/u,
  );
  assert.equal(staleHttpProbes, 0, 'a stale listener must not receive the HTTP readiness probe');
  assert.equal(existsSync(join(staleArtifacts, 'supervisor-cleaned')), true);
  assert.equal(existsSync(join(staleArtifacts, 'expo-supervisor.json')), false);

  const unrelatedArtifacts = join(root, 'unrelated-artifacts');
  let unrelatedHttpProbes = 0;
  await assert.rejects(
    runTemplateCarrierCli(config('unrelated'), [
      'web-browser', '--browser', browser, '--artifacts', unrelatedArtifacts,
    ], {
      root,
      fetch: async () => {
        unrelatedHttpProbes += 1;
        return { status: 200 };
      },
    }),
    /lacks its verified loopback Metro listener/u,
  );
  assert.equal(unrelatedHttpProbes, 0, 'an unrelated same-port listener must not receive HTTP');
  assert.equal(existsSync(join(unrelatedArtifacts, 'supervisor-cleaned')), true);

  const timeoutArtifacts = join(root, 'timeout-artifacts');
  await assert.rejects(
    runTemplateCarrierCli(config('timeout', 150), [
      'web-browser', '--browser', browser, '--artifacts', timeoutArtifacts,
    ], { root, fetch: async () => ({ status: 200 }) }),
    /did not write structured readiness/u,
  );
  assert.equal(existsSync(join(timeoutArtifacts, 'supervisor-cleaned')), true);

  const signalArtifacts = join(root, 'signal-artifacts');
  const browserStarted = join(signalArtifacts, 'browser-started');
  const browserCleaned = join(signalArtifacts, 'browser-cleaned');
  const browserProfile = join(signalArtifacts, 'browser-profile');
  mkdirSync(signalArtifacts, { recursive: true });
  writeFileSync(signalRunner, `
import { defineTemplateCarrierConfig, runTemplateCarrierCli } from ${JSON.stringify(carrierKitUrl)};
const config = defineTemplateCarrierConfig(${JSON.stringify(config('success', 5_000))});
try {
  await runTemplateCarrierCli(config, ['web-browser', '--browser', ${JSON.stringify(browser)}, '--artifacts', ${JSON.stringify(signalArtifacts)}], { root: ${JSON.stringify(root)}, fetch: async () => ({ status: 200 }) });
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
      SNAPBACK_CARRIER_TEST_BROWSER_PROFILE: browserProfile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let signalOutput = '';
  runner.stdout.on('data', (chunk) => { signalOutput += chunk; });
  runner.stderr.on('data', (chunk) => { signalOutput += chunk; });
  await eventually(() => existsSync(browserStarted), 'signal-path browser start');
  runner.kill('SIGTERM');
  const signalExit = await new Promise((resolveExit, rejectExit) => {
    runner.once('error', rejectExit);
    runner.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(signalExit, { code: 23, signal: null }, signalOutput);
  assert.equal(existsSync(browserCleaned), true);
  assert.equal(existsSync(join(signalArtifacts, 'supervisor-cleaned')), true);
  assert.equal(existsSync(join(signalArtifacts, 'expo-supervisor.json')), false);
  assert.equal(existsSync(readFileSync(browserProfile, 'utf8')), false);

  console.log('carrier-kit.test.mjs: structured Expo origin, exact-child refusal, and success/timeout/signal cleanup pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
