#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  SUPERVISED_EXCHANGE_PATH,
  runExpoDev,
} from '../../../packages/snapback-cli/expo-dev.mjs';
import { launchChromeCdp } from '../../_kit/chrome-process.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const witnessRoot = resolve(scriptRoot, '..');
const appRoot = join(witnessRoot, 'app');
const repoRoot = resolve(witnessRoot, '..', '..');
const { chromium } = await import(pathToFileURL(
  join(appRoot, 'node_modules', 'playwright-core', 'index.mjs'),
).href);
const stateRoot = join(witnessRoot, '.state');
const iosBundleIdentifier = 'dev.snapback.checkoutwitness';
const androidComponent = 'dev.snapback.checkoutwitness/.MainActivity';
const devClientScheme = 'snapback-checkout-witness';

function flag(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const platform = flag('--platform');
const androidSerial = flag('--android-serial');
const iosSimulator = flag('--ios-simulator', 'booted');
const browserBinary = flag(
  '--browser',
  process.env.SNAPBACK_BROWSER_EXECUTABLE
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
);
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
if (!['ios', 'android', 'web'].includes(platform)) {
  throw new Error('usage: node run-witness.mjs --platform ios|android|web [--android-serial <serial>] [--ios-simulator <udid>] [--browser <path>]');
}
if (platform === 'android' && !androidSerial) {
  throw new Error('--android-serial is required for Android emulator and USB rows');
}
if (platform === 'web' && !existsSync(browserBinary)) {
  throw new Error(`--browser is not an existing browser executable: ${browserBinary}`);
}

const runId = `${platform}-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const receiptRoot = resolve(flag('--receipts', join(witnessRoot, 'receipts', runId)));
const runStateRoot = join(stateRoot, runId);
const managedStateRoot = join(runStateRoot, '.snapback');
const readyFile = join(managedStateRoot, 'snapback.ready.json');
mkdirSync(receiptRoot, { recursive: true });
mkdirSync(managedStateRoot, { recursive: true });

function receiptPath(row) {
  return join(receiptRoot, `${row}.json`);
}

const secretValues = new Set();
function writeReceipt(row, facts) {
  const document = {
    ...facts,
    format: 'snapback.expo-dev-identity-witness.v1',
    row,
    platform,
    capturedAt: new Date().toISOString(),
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret)) {
      throw new Error(`receipt ${row} attempted to retain checkout material`);
    }
  }
  writeFileSync(receiptPath(row), serialized, { mode: 0o600 });
}

function projectAppReceipt(report) {
  const { format: appFormat, row: appRow, ...facts } = report;
  return { appFormat, appRow, ...facts };
}

function waitFor(predicate, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const poll = () => {
      const value = predicate();
      if (value) return resolveWait(value);
      if (Date.now() >= deadline) return rejectWait(new Error(`timed out waiting for ${label}`));
      setTimeout(poll, 100);
    };
    poll();
  });
}

const appReports = [];
const receiptServer = createHttpServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/receipt') {
    response.statusCode = 404;
    response.end();
    return;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 32_768) {
      response.statusCode = 413;
      response.end();
      return;
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    response.statusCode = 400;
    response.end();
    return;
  }
  appReports.push(payload);
  response.statusCode = 204;
  response.end();
});
await new Promise((resolveListen, rejectListen) => {
  receiptServer.once('error', rejectListen);
  receiptServer.listen(0, '127.0.0.1', resolveListen);
});
const receiptPort = receiptServer.address().port;

const runNative = (binary, args, options) => {
  const result = spawnSync(binary, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(`${platform} native launch failed without retaining its secret arguments`);
  }
};
const capturedLaunches = [];
const captureNativeLaunch = (binary, args, options) => {
  capturedLaunches.push({ binary, args, options });
  return { status: 0, stdout: '', stderr: '' };
};
const nonceFor = (launch) => platform === 'ios'
  ? launch.options.env[`SIMCTL_CHILD_${SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV}`]
  : launch.args.at(-1);
const commandsPerLaunch = platform === 'ios' ? 1 : 2;
const launchSequence = (index) => {
  const sequence = capturedLaunches.slice(
    index * commandsPerLaunch,
    (index + 1) * commandsPerLaunch,
  );
  if (sequence.length !== commandsPerLaunch) {
    throw new Error(`native launch sequence ${index} is incomplete`);
  }
  return sequence;
};
const runLaunchSequence = (index) => {
  for (const command of launchSequence(index)) {
    runNative(command.binary, command.args, command.options);
  }
};

function assertBootstrapSecretIsolation(response, body, checkoutNonce) {
  const headers = JSON.stringify(Object.fromEntries(response.headers.entries()));
  const surfaces = [body, headers];
  const inspection = Object.freeze({
    nonceAbsent: surfaces.every((value) => !value.includes(checkoutNonce)),
    capabilityPrefixAbsent: surfaces.every((value) => !value.includes('sbdev_')),
    capabilityFieldAbsent: surfaces.every((value) => !value.includes('devIdentityCapability')),
    checkoutFieldAbsent: surfaces.every((value) => !value.includes('checkoutNonce')),
  });
  if (Object.values(inspection).some((absent) => absent !== true)) {
    throw new Error('tunneled bootstrap response exposed checkout material');
  }
  return inspection;
}

let supervisor = null;
let tunnel = null;
let androidReceiptReverse = false;
let browserLifecycle = null;
let browserConnection = null;
try {
  if (platform === 'android') {
    const reverse = spawnSync('adb', [
      '-s', androidSerial, 'reverse', `tcp:${receiptPort}`, `tcp:${receiptPort}`,
    ], { encoding: 'utf8' });
    if (reverse.error || reverse.status !== 0) throw new Error('witness receipt adb reverse failed');
    androidReceiptReverse = true;
  }

  supervisor = await runExpoDev({
    backendDirectory: join(appRoot, 'snapback'),
    // `dev-fresh` may recursively reset only the canonical project-owned
    // `.snapback/dev.sqlite3`; keep the witness state in its per-run project.
    projectRoot: runStateRoot,
    expoDirectory: appRoot,
    database: join(managedStateRoot, 'dev.sqlite3'),
    readyFile,
    applicationReadyFile: join(managedStateRoot, 'application-ready.json'),
    runtimeBinary,
    platform,
    ...(platform === 'android'
      ? { androidSerial }
      : platform === 'ios' ? { iosSimulator } : {}),
    ...(platform === 'web' ? {} : {
      nativeCheckout: true,
      expoAppScheme: devClientScheme,
      ...(platform === 'ios' ? { iosBundleIdentifier } : { androidComponent }),
      nativeLaunchRun: captureNativeLaunch,
    }),
    env: {
      ...process.env,
      EXPO_PUBLIC_SNAPBACK_CHECKOUT_WITNESS_ORIGIN: `http://127.0.0.1:${receiptPort}`,
    },
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  if (platform === 'web') {
    // @ref LLP 0262#d2-carriers-per-shipped-topology — a real Expo-web
    //   browser proves ordinary sessions compose while native custody is absent.
    browserLifecycle = await launchChromeCdp({
      chromeBin: browserBinary,
      initialUrl: 'about:blank',
      userDataPrefix: 'snapback-expo-web-dev-identity-',
      startupTimeoutMs: 30_000,
    });
    browserConnection = await chromium.connectOverCDP(browserLifecycle.ws);
    const page = browserConnection.contexts().flatMap((context) => context.pages())[0];
    if (!page) throw new Error('Expo web Chrome launch did not expose a page');
    await page.goto(supervisor.metroOrigin, { waitUntil: 'domcontentloaded' });
    const webReport = await waitFor(
      () => appReports.find((report) => report.row === 'web-session-isolation'),
      'Expo web session/custody receipt',
      180_000,
    );
    const hostDirectRefusal = await fetch(`${supervisor.binding.target.origin}/connection/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-auth-client-protocol': '1',
        'x-snapback-dev-identity': 'sbdev_expo_web_host_probe_wrong_boot',
      },
      body: '{}',
    });
    const hostDirectRefusalBody = await hostDirectRefusal.json();
    const hostRefusalPassed = hostDirectRefusal.status === 403
      && hostDirectRefusalBody.diagnostic?.code === 'SNAPBACK_DEV_IDENTITY_REFUSED';
    writeReceipt('web-session-isolation', {
      ...projectAppReceipt(webReport),
      hostDirectRefusalStatus: hostDirectRefusal.status,
      hostDirectRefusalCode: hostDirectRefusalBody.diagnostic?.code ?? null,
    });
    writeReceipt('run-summary', {
      status: webReport.status === 'passed' && hostRefusalPassed ? 'passed' : 'failed',
      receiptRows: ['web-session-isolation'],
      device: { class: 'browser' },
    });
    if (webReport.status !== 'passed' || !hostRefusalPassed) {
      throw new Error(`Expo web witness failed with ${webReport.code ?? 'UNKNOWN'}`);
    }
  } else {
  await waitFor(
    () => capturedLaunches.length >= commandsPerLaunch,
    'initial native checkout launch sequence',
  );
  const initialNonce = nonceFor(launchSequence(0)[0]);
  secretValues.add(initialNonce);

  const browserOriginAttempt = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:8081',
        [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: initialNonce,
      },
    },
  );
  writeReceipt('browser-origin-redemption-refusal', {
    status: browserOriginAttempt.status === 403 ? 'passed' : 'failed',
    httpStatus: browserOriginAttempt.status,
    corsGranted: browserOriginAttempt.headers.has('access-control-allow-origin'),
    requestRuntime: 'node-global-fetch',
    claimScope: 'server-origin-gate-only',
  });

  const upstream = new URL(supervisor.exchangeOrigin);
  tunnel = createHttpServer((request, response) => {
    const forwarded = httpRequest({
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    }, (forwardedResponse) => {
      response.writeHead(forwardedResponse.statusCode ?? 500, forwardedResponse.headers);
      forwardedResponse.pipe(response);
    });
    request.pipe(forwarded);
  });
  await new Promise((resolveListen, rejectListen) => {
    tunnel.once('error', rejectListen);
    tunnel.listen(0, '127.0.0.1', resolveListen);
  });
  const tunneledBootstrap = await fetch(
    `http://127.0.0.1:${tunnel.address().port}${SUPERVISED_EXCHANGE_PATH}`,
    { headers: { Origin: 'http://localhost:8081' } },
  );
  const tunneledBootstrapBody = await tunneledBootstrap.text();
  const tunneledInspection = assertBootstrapSecretIsolation(
    tunneledBootstrap,
    tunneledBootstrapBody,
    initialNonce,
  );
  writeReceipt('tunneled-raw-http-isolation', {
    status: tunneledBootstrap.status === 200 ? 'passed' : 'failed',
    httpStatus: tunneledBootstrap.status,
    method: 'GET',
    path: SUPERVISED_EXCHANGE_PATH,
    inspectedSurfaces: ['response-body', 'response-headers'],
    ...tunneledInspection,
  });

  const rotate = async (requestId) => {
    const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
    let operatorToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
    try {
      const response = await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_CONTROL_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-operator-token': operatorToken,
        },
        body: JSON.stringify({ verb: 'dev-fresh', requestId }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) {
        const code = payload?.diagnostic?.code
          ?? payload?.diagnostics?.[0]?.code
          ?? payload?.code
          ?? 'UNKNOWN';
        const shape = Array.isArray(payload)
          ? 'array'
          : Object.keys(payload ?? {}).sort().join(',');
        throw new Error(`supervisor rotation failed (HTTP ${response.status}, ${code}, keys=${shape})`);
      }
    } finally {
      operatorToken = null;
    }
  };

  await rotate('unspent-old-nonce-refusal');
  await waitFor(
    () => capturedLaunches.length >= commandsPerLaunch * 2,
    'post-rotation native checkout launch sequence',
  );
  const freshNonce = nonceFor(launchSequence(1)[0]);
  secretValues.add(freshNonce);
  if (freshNonce === initialNonce) throw new Error('backend rotation reused checkout delivery');
  const staleAttempt = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
    {
      method: 'POST',
      headers: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: initialNonce },
    },
  );
  writeReceipt('post-rotation-refusal', {
    status: staleAttempt.status === 403 ? 'passed' : 'failed',
    httpStatus: staleAttempt.status,
    priorNonceWasUnspent: true,
  });

  runLaunchSequence(1);
  const firstAppReport = await waitFor(() => appReports[0], 'native reader application receipt');
  writeReceipt(`${platform}-native-reader`, projectAppReceipt(firstAppReport));

  const replayAttempt = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
    {
      method: 'POST',
      headers: { [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: freshNonce },
    },
  );
  writeReceipt('replay-refusal', {
    status: replayAttempt.status === 403 ? 'passed' : 'failed',
    httpStatus: replayAttempt.status,
    priorRedemptionSucceeded: firstAppReport.status === 'passed',
  });

  await rotate('fresh-launch-replacement');
  await waitFor(
    () => capturedLaunches.length >= commandsPerLaunch * 3,
    'replacement native checkout launch sequence',
  );
  const replacementNonce = nonceFor(launchSequence(2)[0]);
  secretValues.add(replacementNonce);
  if (replacementNonce === freshNonce) throw new Error('fresh launch reused checkout delivery');
  runLaunchSequence(2);
  const replacementReport = await waitFor(
    () => appReports[1],
    'native reader rotation-replacement receipt',
  );
  writeReceipt(`${platform}-rotation-replacement`, {
    ...projectAppReceipt(replacementReport),
    freshLaunchDeliveryReplacedPriorBoot: true,
  });

  const nativeStatuses = [
      firstAppReport.status,
      replacementReport.status,
      browserOriginAttempt.status === 403 ? 'passed' : 'failed',
      tunneledBootstrap.status === 200 ? 'passed' : 'failed',
      staleAttempt.status === 403 ? 'passed' : 'failed',
      replayAttempt.status === 403 ? 'passed' : 'failed',
    ];
  const nativePassed = nativeStatuses.every((status) => status === 'passed');
  writeReceipt('run-summary', {
    status: nativePassed ? 'passed' : 'failed',
    receiptRows: [
      `${platform}-native-reader`,
      `${platform}-rotation-replacement`,
      'browser-origin-redemption-refusal',
      'tunneled-raw-http-isolation',
      'post-rotation-refusal',
      'replay-refusal',
    ],
    device: platform === 'ios'
      ? { class: 'simulator' }
      : { class: supervisor.device.class, serial: supervisor.device.serial },
  });
  if (!nativePassed) throw new Error(`${platform} native witness reported a failed row`);
  }
  process.stdout.write(`${receiptRoot}\n`);
} finally {
  await browserConnection?.close?.().catch(() => {});
  await browserLifecycle?.stop?.().catch(() => {});
  await supervisor?.close?.().catch(() => {});
  await new Promise((resolveClose) => receiptServer.close(resolveClose));
  if (tunnel) await new Promise((resolveClose) => tunnel.close(resolveClose));
  if (androidReceiptReverse) {
    spawnSync('adb', [
      '-s', androidSerial, 'reverse', '--remove', `tcp:${receiptPort}`,
    ], { encoding: 'utf8' });
  }
}
