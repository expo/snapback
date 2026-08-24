import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __test,
  readApplicationReadyReceipt,
  runDev,
  scaffoldApp,
  spawnManagedRuntime,
} from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(packageRoot, '..', '..', 'target', 'debug', 'snapback'),
);
assert.equal(existsSync(runtimeBinary), true, `missing runtime binary ${runtimeBinary}`);

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-admission-posture-')));
try {
  const projectRoot = join(root, 'app');
  assert.equal(scaffoldApp(projectRoot).ok, true);
  const backendDirectory = join(projectRoot, 'snapback');
  const baseEnvironment = { ...process.env, SNAPBACK_DEV_ADMISSION_POSTURE: 'hostile-parent' };
  delete baseEnvironment.SNAPBACK_DEV_AUTH_ORIGINS;

  const runCase = async ({ env = baseEnvironment, externalClientOrigin, supervisedClientOrigins }) => {
    let childEnvironment = null;
    const handle = await runDev({
      backendDirectory,
      projectRoot,
      runtimeBinary,
      port: await freePort(),
      env,
      ...(externalClientOrigin === undefined ? {} : { externalClientOrigin }),
      ...(supervisedClientOrigins === undefined ? {} : { supervisedClientOrigins }),
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      spawnManagedRuntime(binary, args, options) {
        childEnvironment = options.env;
        return spawnManagedRuntime(binary, args, options);
      },
    });
    try {
      assert.notEqual(childEnvironment, null);
      return {
        admissionPosture: childEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE,
        origins: childEnvironment.SNAPBACK_DEV_AUTH_ORIGINS,
        receiptPosture: handle.admissionPosture,
        receiptOrigins: handle.clientOrigins,
        receipt: JSON.parse(readFileSync(handle.applicationReadyFile, 'utf8')),
      };
    } finally {
      await handle.close();
    }
  };

  const noDeclarations = await runCase({});
  assert.deepEqual({ ...noDeclarations, receipt: undefined }, {
    admissionPosture: 'loopback-any',
    origins: undefined,
    receiptPosture: 'loopback-any',
    receiptOrigins: [],
    receipt: undefined,
  });
  assert.equal(noDeclarations.receipt.admissionPosture, 'loopback-any');
  assert.deepEqual(noDeclarations.receipt.clientOrigins, []);
  const legacyReceipt = { ...noDeclarations.receipt };
  delete legacyReceipt.admissionPosture;
  const legacyReceiptPath = join(root, 'legacy.application-ready.json');
  writeFileSync(legacyReceiptPath, `${JSON.stringify(legacyReceipt)}\n`, { mode: 0o600 });
  assert.equal(
    readApplicationReadyReceipt(legacyReceiptPath).admissionPosture,
    'explicit-list',
    'the new reader decodes a missing posture as the legacy exact-list contract',
  );

  const environmentOnly = await runCase({
    env: {
      ...baseEnvironment,
      SNAPBACK_DEV_AUTH_ORIGINS: 'HTTP://LOCALHOST:80,https://lane.trycloudflare.com/',
    },
  });
  assert.equal(environmentOnly.admissionPosture, 'explicit-list');
  assert.equal(environmentOnly.origins, 'http://localhost,https://lane.trycloudflare.com');
  assert.deepEqual(environmentOnly.receiptOrigins, [
    'http://localhost',
    'https://lane.trycloudflare.com',
  ]);
  assert.equal(environmentOnly.receipt.admissionPosture, 'explicit-list');
  assert.deepEqual(environmentOnly.receipt.clientOrigins, environmentOnly.receiptOrigins);

  const flagOnly = await runCase({ externalClientOrigin: 'https://lane.trycloudflare.com/' });
  assert.equal(flagOnly.admissionPosture, 'explicit-list');
  assert.equal(flagOnly.origins, 'https://lane.trycloudflare.com');
  assert.deepEqual(flagOnly.receiptOrigins, ['https://lane.trycloudflare.com']);
  assert.equal(flagOnly.receipt.admissionPosture, 'explicit-list');
  assert.deepEqual(flagOnly.receipt.clientOrigins, flagOnly.receiptOrigins);

  const supervised = await runCase({
    env: {
      ...baseEnvironment,
      SNAPBACK_DEV_AUTH_ORIGINS: 'https://lane.trycloudflare.com',
    },
    supervisedClientOrigins: ['http://localhost:5173'],
  });
  assert.equal(supervised.admissionPosture, 'explicit-list');
  assert.equal(
    supervised.origins,
    'http://localhost:5173,https://lane.trycloudflare.com',
  );
  assert.equal(supervised.receipt.admissionPosture, 'explicit-list');
  assert.deepEqual(supervised.receipt.clientOrigins, supervised.receiptOrigins);

  const attachPort = await freePort();
  const owner = await runDev({
    backendDirectory,
    projectRoot,
    runtimeBinary,
    port: attachPort,
    externalClientOrigin: 'http://localhost:5173',
    env: baseEnvironment,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    const before = JSON.parse(readFileSync(owner.readyFile, 'utf8'));
    await assert.rejects(
      runDev({
        backendDirectory,
        projectRoot,
        runtimeBinary,
        port: attachPort,
        externalClientOrigin: 'http://localhost:5174',
        env: baseEnvironment,
        watch: false,
        serverStdio: ['ignore', 'ignore', 'ignore'],
      }),
      (error) => error?.code === 'SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH'
        && error.diagnostic.details.requestedAdmissionContract.clientOrigins[0]
          === 'http://localhost:5174'
        && error.diagnostic.details.recordedAdmissionContract.clientOrigins[0]
          === 'http://localhost:5173',
    );
    const after = JSON.parse(readFileSync(owner.readyFile, 'utf8'));
    assert.deepEqual(
      { pid: after.pid, startupNonce: after.startupNonce },
      { pid: before.pid, startupNonce: before.startupNonce },
      'mismatched attach neither adopts nor restarts the live listener',
    );
  } finally {
    await owner.close();
  }

  for (const [input, expected] of [
    ['http://127.0.0.1:4287', 'http://127.0.0.1:4287'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['https://[::1]:8443', 'https://[::1]:8443'],
    ['http://127.1:4287', 'http://127.0.0.1:4287'],
    ['HTTP://LOCALHOST:80', 'http://localhost'],
    ['https://lane.trycloudflare.com', 'https://lane.trycloudflare.com'],
  ]) assert.equal(__test.canonicalDevClientOrigin(input), expected);
  for (const input of [
    'http://127.0.0.1:4287/path',
    'http://user@127.0.0.1',
    'http://127.0.0.1?x',
    'ws://127.0.0.1',
    'not a url',
  ]) assert.equal(__test.canonicalDevClientOrigin(input), null);

  // LLP 0301 §3: simulate the shipped legacy attach comparison by entering
  // through its exactRecordKeys-based receipt reader. New-format receipts are
  // refused before the legacy origin-list comparator can adopt anything.
  const oldComparison = (requestedOrigins, receiptPath) => {
    const recorded = __test.readLegacyApplicationReadyReceipt(receiptPath);
    return [...requestedOrigins].sort().join('\n')
      === [...recorded.clientOrigins].sort().join('\n');
  };
  const oldReceipt = { ...supervised.receipt };
  delete oldReceipt.admissionPosture;
  const oldReceiptPath = join(root, 'matrix-old.application-ready.json');
  const newSupervisedPath = join(root, 'matrix-new-supervised.application-ready.json');
  const newPlainPath = join(root, 'matrix-new-plain.application-ready.json');
  writeFileSync(oldReceiptPath, `${JSON.stringify(oldReceipt)}\n`, { mode: 0o600 });
  writeFileSync(newSupervisedPath, `${JSON.stringify(supervised.receipt)}\n`, { mode: 0o600 });
  writeFileSync(newPlainPath, `${JSON.stringify(noDeclarations.receipt)}\n`, { mode: 0o600 });
  assert.equal(
    oldComparison(oldReceipt.clientOrigins, oldReceiptPath),
    true,
    'old CLI + old receipt reaches the shipped origin-list comparison',
  );
  for (const [requestedOrigins, receiptPath, label] of [
    [supervised.receiptOrigins, newSupervisedPath, 'old CLI + new supervised'],
    [[], newPlainPath, 'old CLI no declarations + new plain'],
    [supervised.receiptOrigins, newPlainPath, 'old CLI declarations + new plain'],
  ]) {
    assert.throws(
      () => oldComparison(requestedOrigins, receiptPath),
      (error) => error?.code === 'SNAPBACK_DEV_APPLICATION_READY_INVALID',
      `${label} refuses through the shipped strict receipt reader`,
    );
  }
  assert.throws(
    () => __test.assertDevAdmissionContractMatches(
      { admissionPosture: 'loopback-any', clientOrigins: [] },
      legacyReceipt,
    ),
    (error) => error?.code === 'SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH'
      && error.diagnostic.details.requestedAdmissionContract.admissionPosture === 'loopback-any'
      && error.diagnostic.details.recordedAdmissionContract.admissionPosture === 'explicit-list',
    'new CLI no declarations + old receipt',
  );
  assert.doesNotThrow(
    () => __test.assertDevAdmissionContractMatches(
      { admissionPosture: 'explicit-list', clientOrigins: oldReceipt.clientOrigins },
      oldReceipt,
    ),
    'new CLI matching declarations + old receipt',
  );

  console.log('dev-admission-posture.test.mjs: 4 spawn-owned posture/receipt cases, live mismatch safety, 11 syntax vectors, and 6 attach cells passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
