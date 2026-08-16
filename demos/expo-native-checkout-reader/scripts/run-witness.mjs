#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER,
  SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH,
  runExpoDev,
} from '../../../packages/snapback-cli/expo-dev.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const witnessRoot = resolve(scriptRoot, '..');
const appRoot = join(witnessRoot, 'app');
const repoRoot = resolve(witnessRoot, '..', '..');
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
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
if (!['ios', 'android'].includes(platform)) {
  throw new Error('usage: node run-witness.mjs --platform ios|android [--android-serial <serial>]');
}
if (platform === 'android' && !androidSerial) {
  throw new Error('--android-serial is required for Android emulator and USB rows');
}

const runId = `${platform}-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const receiptRoot = resolve(flag('--receipts', join(witnessRoot, 'receipts', runId)));
const runStateRoot = join(stateRoot, runId);
const readyFile = join(runStateRoot, 'snapback.ready.json');
mkdirSync(receiptRoot, { recursive: true });
mkdirSync(runStateRoot, { recursive: true });

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

function openDevClient(metroOrigin) {
  const deepLink = `${devClientScheme}://expo-development-client/?url=${encodeURIComponent(metroOrigin)}`;
  if (platform === 'ios') {
    runNative('xcrun', ['simctl', 'openurl', 'booted', deepLink], {
      encoding: 'utf8',
      timeout: 30_000,
      env: process.env,
    });
    return;
  }
  runNative('adb', [
    '-s', androidSerial,
    'shell', 'am', 'start',
    '-a', 'android.intent.action.VIEW',
    '-d', deepLink,
  ], { encoding: 'utf8', timeout: 30_000, env: process.env });
}

let supervisor = null;
let tunnel = null;
let androidReceiptReverse = false;
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
    projectRoot: appRoot,
    expoDirectory: appRoot,
    database: join(runStateRoot, 'snapback.sqlite3'),
    readyFile,
    applicationReadyFile: join(runStateRoot, 'application-ready.json'),
    runtimeBinary,
    platform,
    ...(platform === 'android' ? { androidSerial } : {}),
    nativeCheckout: true,
    ...(platform === 'ios' ? { iosBundleIdentifier } : { androidComponent }),
    nativeLaunchRun: captureNativeLaunch,
    env: {
      ...process.env,
      EXPO_PUBLIC_SNAPBACK_CHECKOUT_WITNESS_ORIGIN: `http://127.0.0.1:${receiptPort}`,
    },
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitFor(() => capturedLaunches.length >= 1, 'initial native checkout launch');
  const initialNonce = nonceFor(capturedLaunches[0]);
  secretValues.add(initialNonce);

  const webAttempt = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:8081',
        [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: initialNonce,
      },
    },
  );
  writeReceipt('expo-web-isolation', {
    status: webAttempt.status === 403 ? 'passed' : 'failed',
    httpStatus: webAttempt.status,
    corsGranted: webAttempt.headers.has('access-control-allow-origin'),
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
  const tunneledAttempt = await fetch(
    `http://127.0.0.1:${tunnel.address().port}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`,
    { method: 'POST' },
  );
  writeReceipt('tunneled-raw-http-refusal', {
    status: tunneledAttempt.status === 403 ? 'passed' : 'failed',
    httpStatus: tunneledAttempt.status,
    nativeLaunchDeliveryAvailable: false,
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
      if (!response.ok || payload.ok !== true) throw new Error('supervisor rotation failed');
    } finally {
      operatorToken = null;
    }
  };

  await rotate('unspent-old-nonce-refusal');
  await waitFor(() => capturedLaunches.length >= 2, 'post-rotation native checkout launch');
  const freshNonce = nonceFor(capturedLaunches[1]);
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

  runNative(
    capturedLaunches[1].binary,
    capturedLaunches[1].args,
    capturedLaunches[1].options,
  );
  openDevClient(supervisor.metroOrigin);
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
  await waitFor(() => capturedLaunches.length >= 3, 'replacement native checkout launch');
  const replacementNonce = nonceFor(capturedLaunches[2]);
  secretValues.add(replacementNonce);
  if (replacementNonce === freshNonce) throw new Error('fresh launch reused checkout delivery');
  runNative(
    capturedLaunches[2].binary,
    capturedLaunches[2].args,
    capturedLaunches[2].options,
  );
  openDevClient(supervisor.metroOrigin);
  const replacementReport = await waitFor(
    () => appReports[1],
    'native reader rotation-replacement receipt',
  );
  writeReceipt(`${platform}-rotation-replacement`, {
    ...projectAppReceipt(replacementReport),
    freshLaunchDeliveryReplacedPriorBoot: true,
  });

  writeReceipt('run-summary', {
    status: [
      firstAppReport.status,
      replacementReport.status,
      webAttempt.status === 403 ? 'passed' : 'failed',
      tunneledAttempt.status === 403 ? 'passed' : 'failed',
      staleAttempt.status === 403 ? 'passed' : 'failed',
      replayAttempt.status === 403 ? 'passed' : 'failed',
    ].every((status) => status === 'passed') ? 'passed' : 'failed',
    receiptRows: [
      `${platform}-native-reader`,
      `${platform}-rotation-replacement`,
      'expo-web-isolation',
      'tunneled-raw-http-refusal',
      'post-rotation-refusal',
      'replay-refusal',
    ],
    device: platform === 'ios'
      ? { class: 'simulator' }
      : { class: supervisor.device.class, serial: supervisor.device.serial },
  });
  process.stdout.write(`${receiptRoot}\n`);
} finally {
  await supervisor?.close?.().catch(() => {});
  await new Promise((resolveClose) => receiptServer.close(resolveClose));
  if (tunnel) await new Promise((resolveClose) => tunnel.close(resolveClose));
  if (androidReceiptReverse) {
    spawnSync('adb', [
      '-s', androidSerial, 'reverse', '--remove', `tcp:${receiptPort}`,
    ], { encoding: 'utf8' });
  }
}
