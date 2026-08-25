import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { __test, readApplicationReadyReceipt, readReadyDescriptor, runDev, scaffoldApp } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

const receiptSchema = JSON.parse(
  readFileSync(join(repoRoot, 'schemas', 'application-ready.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ strict: false });
ajv.addFormat('uint64', { type: 'number', validate: Number.isSafeInteger });
const validateReceipt = ajv.compile(receiptSchema);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-application-ready-')));
const projectRoot = join(root, 'app');
const backendRoot = join(projectRoot, 'snapback');
const stateRoot = join(projectRoot, '.snapback');
const readyFile = join(stateRoot, 'dev.ready.json');
const applicationReadyFile = `${readyFile}.application-ready`;
const database = join(stateRoot, 'dev.sqlite3');
const handles = [];

async function eventually(check, { timeoutMs = 60_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function readReceipt(path = applicationReadyFile) {
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(validateReceipt(receipt), true, ajv.errorsText(validateReceipt.errors));
  assert.deepEqual(Object.keys(receipt).sort(), [
    'admissionPosture',
    'application',
    'artifacts',
    'auth',
    'binding',
    'capabilityManifestDigest',
    'clientOrigins',
    'formatVersion',
    'hostReadyDescriptorDigest',
    'networkProfile',
    'runtimeIdentity',
    'settledAtMs',
    'startupNonce',
    'targetProfile',
  ]);
  assert.deepEqual(Object.keys(receipt.application).sort(), [
    'deployment', 'mode', 'obligationsDigest',
  ]);
  assert.deepEqual(Object.keys(receipt.auth).sort(), [
    'activeMode',
    'appDataAvailability',
    'desiredMode',
    'modeState',
    'sessionActivationReady',
  ]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(receipt.binding.format, 'snapback.app-binding.v1');
  assert.ok(['loopback-any', 'explicit-list'].includes(receipt.admissionPosture));
  assert.equal(receipt.runtimeIdentity.wrapper.package, '@expo/snapback-cli');
  assert.match(receipt.runtimeIdentity.qualifiedBinary.sha256, /^sha256:[0-9a-f]{64}$/u);
  return receipt;
}

function hostDescriptorDigest(path = readyFile) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

try {
  assert.equal(scaffoldApp(projectRoot).ok, true);

  // no-early-receipt: observe the native host handshake while runDev is still
  // completing its post-bind load and server-owned readiness evaluation.
  const events = [];
  const pending = runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    watch: true,
    serverStdio: ['ignore', 'ignore', 'ignore'],
    onEvent(event) { events.push(event); },
  });
  await eventually(() => existsSync(readyFile), {
    timeoutMs: 120_000,
    label: 'host ready descriptor',
  });
  assert.equal(
    existsSync(applicationReadyFile),
    false,
    'host readiness must precede application settlement',
  );
  const dev = await pending;
  handles.push(dev);
  assert.equal(dev.applicationReadyFile, applicationReadyFile);
  assert.equal(events.at(-1).state, 'generated-and-loaded');
  assert.equal(events.at(-1).applicationReadyFile, applicationReadyFile);
  let descriptor = readReadyDescriptor(readyFile);
  let receipt = readReceipt();
  assert.equal(receipt.startupNonce, descriptor.startupNonce);
  assert.equal(receipt.hostReadyDescriptorDigest, hostDescriptorDigest());

  // Native wait proves the literal sibling derivation and the native/JS
  // schema plus live-fact checks agree end to end.
  const waited = spawnSync(runtimeBinary, [
    'wait', '--ready-file', readyFile,
    '--level', 'application', '--timeout-ms', '15000',
  ], { encoding: 'utf8', env: process.env });
  assert.equal(waited.status, 0, `${waited.stdout}\n${waited.stderr}`);

  // settled restart: removal happens at verb entry and settlement binds the
  // new process identity.
  const beforeRestart = receipt;
  const restart = dev.verbs.restart({ requestId: 'application-ready-restart' });
  await eventually(() => !existsSync(applicationReadyFile), { label: 'restart receipt removal' });
  const restarted = await restart;
  assert.equal(restarted.state, 'generated-and-loaded');
  descriptor = readReadyDescriptor(readyFile);
  receipt = readReceipt();
  assert.notEqual(receipt.startupNonce, beforeRestart.startupNonce);
  assert.equal(receipt.startupNonce, descriptor.startupNonce);

  // stale-after-reload: the server process stays fixed, but the old receipt
  // is absent throughout regeneration and a fresh evaluation time replaces it.
  const beforeReload = receipt;
  await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  const reload = dev.verbs.reload({ requestId: 'application-ready-reload' });
  await eventually(() => !existsSync(applicationReadyFile), { label: 'reload receipt removal' });
  const reloaded = await reload;
  assert.equal(reloaded.state, 'generated-and-loaded');
  receipt = readReceipt();
  assert.equal(receipt.startupNonce, beforeReload.startupNonce);
  assert(receipt.settledAtMs > beforeReload.settledAtMs);

  // dev-fresh removes the receipt together with managed database state and
  // republishes only after the fresh instance is settled.
  const fresh = dev.verbs['dev-fresh']({ requestId: 'application-ready-fresh' });
  await eventually(() => !existsSync(applicationReadyFile), { label: 'dev-fresh receipt removal' });
  const refreshed = await fresh;
  assert.equal(refreshed.state, 'generated-and-loaded');
  receipt = readReceipt();
  descriptor = readReadyDescriptor(readyFile);
  assert.equal(receipt.startupNonce, descriptor.startupNonce);

  await dev.close();
  handles.splice(handles.indexOf(dev), 1);
  assert.equal(existsSync(applicationReadyFile), false, 'close must remove the receipt');

  // Reattach over a live server only after the existing receipt proves the
  // intended server/app/runtime binding. Closing a non-owner attach must not
  // remove the owner's receipt or stop its child.
  const owner = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  handles.push(owner);
  assert.equal(readReceipt().admissionPosture, 'loopback-any');
  assert.deepEqual(readReceipt().clientOrigins, []);
  const existingNonce = readReadyDescriptor(readyFile).startupNonce;
  assert.equal(readReceipt().startupNonce, existingNonce);
  const attached = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    attach: true,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  handles.push(attached);
  assert.equal(attached.managed, false);
  assert.equal(readReceipt().startupNonce, existingNonce);
  await attached.close();
  handles.splice(handles.indexOf(attached), 1);
  assert.equal(existsSync(applicationReadyFile), true);
  await owner.close();
  handles.splice(handles.indexOf(owner), 1);
  assert.equal(existsSync(applicationReadyFile), false);

  // Fixed-profile attach is idempotent for the exact declared client origin,
  // but a wrong-origin caller is refused without adopting or killing the
  // verified owner's listener.
  const portProbe = createServer();
  await new Promise((resolveListen) => portProbe.listen(0, '127.0.0.1', resolveListen));
  const fixedPort = portProbe.address().port;
  await new Promise((resolveClose) => portProbe.close(resolveClose));
  const clientOrigin = 'http://localhost:5173';
  const ambientClientOrigin = 'http://127.0.0.1:19000';
  const fixedEnvironment = {
    ...process.env,
    SNAPBACK_DEV_AUTH_ORIGINS: ambientClientOrigin,
  };
  const actualClientOrigins = [ambientClientOrigin, clientOrigin].sort();
  const fixedOwner = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    port: fixedPort,
    externalClientOrigin: clientOrigin,
    env: fixedEnvironment,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  handles.push(fixedOwner);
  receipt = readReceipt();
  assert.deepEqual(receipt.clientOrigins, actualClientOrigins);
  assert.equal(receipt.admissionPosture, 'explicit-list');
  assert.deepEqual(fixedOwner.clientOrigins, actualClientOrigins);
  assert.equal(new URL(receipt.binding.target.origin).port, String(fixedPort));
  const fixedNonce = receipt.startupNonce;

  // A same-host receipt whose application bind-set is stale is refused before
  // attach removes the receipt or performs an idempotent generated load.
  const correctReceiptBytes = readFileSync(applicationReadyFile, 'utf8');
  const staleApplicationReceipt = JSON.parse(correctReceiptBytes);
  staleApplicationReceipt.capabilityManifestDigest = `sha256:${'0'.repeat(64)}`;
  writeFileSync(
    applicationReadyFile,
    `${JSON.stringify(staleApplicationReceipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  const staleApplicationBytes = readFileSync(applicationReadyFile, 'utf8');
  await assert.rejects(
    () => runDev({
      backendDirectory: backendRoot,
      projectRoot,
      readyFile,
      database,
      runtimeBinary,
      port: fixedPort,
      externalClientOrigin: clientOrigin,
      env: fixedEnvironment,
      attach: true,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    }),
    (error) => error.code === 'SNAPBACK_DEV_APPLICATION_READY_STALE'
      && error.diagnostic.details.mismatch.includes('capabilityManifestDigest'),
  );
  assert.equal(readFileSync(applicationReadyFile, 'utf8'), staleApplicationBytes);
  assert.equal(readReadyDescriptor(readyFile).startupNonce, fixedNonce);
  writeFileSync(applicationReadyFile, correctReceiptBytes, { mode: 0o600 });

  // Binding expiry asks the matching lifecycle to issue a fresh binding; it
  // does not classify the still-live child as foreign.
  const expiredReceipt = JSON.parse(correctReceiptBytes);
  expiredReceipt.binding.provenance.expiresAt = '2000-01-01T00:00:00.000Z';
  writeFileSync(
    applicationReadyFile,
    `${JSON.stringify(expiredReceipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  const fixedAttach = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    port: fixedPort,
    externalClientOrigin: clientOrigin,
    env: fixedEnvironment,
    attach: true,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  handles.push(fixedAttach);
  assert.equal(readReceipt().startupNonce, fixedNonce);
  assert(Date.parse(readReceipt().binding.provenance.expiresAt) > Date.now());
  await assert.rejects(
    () => runDev({
      backendDirectory: backendRoot,
      projectRoot,
      readyFile,
      database,
      runtimeBinary,
      port: fixedPort,
      externalClientOrigin: 'http://localhost:5174',
      env: fixedEnvironment,
      attach: true,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    }),
    (error) => error.code === 'SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH'
      && error.diagnostic.details.requestedAdmissionContract.clientOrigins.includes('http://localhost:5174')
      && error.diagnostic.details.recordedAdmissionContract.clientOrigins.includes(clientOrigin),
  );
  assert.equal(readReadyDescriptor(readyFile).startupNonce, fixedNonce);

  // A healthy listener whose application-ready receipt is absent exercises
  // the second fixed-port rewrite site. The port probe keeps this classified
  // as an occupied, unverified listener rather than a stale descriptor.
  const liveReadyDescriptor = readReadyDescriptor(readyFile);
  const liveReceiptBytes = readFileSync(applicationReadyFile, 'utf8');
  rmSync(applicationReadyFile);
  await assert.rejects(
    () => runDev({
      backendDirectory: backendRoot,
      projectRoot,
      readyFile,
      database,
      runtimeBinary,
      port: fixedPort,
      externalClientOrigin: clientOrigin,
      env: fixedEnvironment,
      attach: true,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    }),
    (error) => error.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER'
      && error.diagnostic.details.cause === 'SNAPBACK_DEV_APPLICATION_READY_REQUIRED',
  );
  writeFileSync(applicationReadyFile, liveReceiptBytes, { mode: 0o600 });
  await fixedAttach.close();
  handles.splice(handles.indexOf(fixedAttach), 1);
  await fixedOwner.close();
  handles.splice(handles.indexOf(fixedOwner), 1);

  // A dead process can leave a syntactically valid descriptor behind. When
  // the pinned port refuses the connection at probe time, the diagnostic
  // names the descriptor and exact remediation without inventing a listener.
  const deadReadyFile = join(stateRoot, 'dead.ready.json');
  const deadApplicationReadyFile = `${deadReadyFile}.application-ready`;
  writeFileSync(deadReadyFile, `${JSON.stringify(liveReadyDescriptor, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    () => runDev({
      backendDirectory: backendRoot,
      projectRoot,
      readyFile: deadReadyFile,
      applicationReadyFile: deadApplicationReadyFile,
      database,
      runtimeBinary,
      port: fixedPort,
      externalClientOrigin: clientOrigin,
      env: fixedEnvironment,
      attach: true,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    }),
    (error) => error.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR'
      && error.diagnostic.details.readyFile === deadReadyFile
      && error.message.includes('at probe time')
      && error.diagnostic.details.remediation.includes('rerun snapback dev without --attach'),
  );
  assert.equal(existsSync(deadReadyFile), true, 'attach refusal leaves the stale descriptor for explicit remediation');

  // A timeout or any non-refusal socket error leaves the port state unknown.
  // Neither branch may prescribe removal of a descriptor that could still
  // identify a live but backlogged listener.
  for (const probeError of ['ETIMEDOUT', 'EACCES']) {
    const indeterminate = await __test.fixedPortAttachFailure(
      Object.assign(new Error('application receipt unavailable'), {
        code: 'SNAPBACK_DEV_APPLICATION_READY_REQUIRED',
      }),
      {
        fixedPort,
        readyFile: deadReadyFile,
        applicationReadyFile: deadApplicationReadyFile,
        message: 'unused accepting-listener message',
        probePort: async () => ({ state: 'indeterminate', error: probeError }),
      },
    );
    assert.equal(indeterminate.code, 'SNAPBACK_DEV_SERVER_ATTACH_FAILED');
    assert.equal(indeterminate.diagnostic.details.probeError, probeError);
    assert.equal(indeterminate.diagnostic.details.cause, 'SNAPBACK_DEV_APPLICATION_READY_REQUIRED');
    assert.match(indeterminate.message, new RegExp(probeError));
    assert.doesNotMatch(indeterminate.message, /remove/u);
    assert.equal(existsSync(deadReadyFile), true, `${probeError} preserves the ready descriptor`);
  }
  rmSync(deadReadyFile, { force: true });

  // A listener with no receipt-bound lifecycle is a typed refusal and is
  // still accepting connections after Snapback declines it.
  const staleListener = createServer();
  await new Promise((resolveListen) => staleListener.listen(0, '127.0.0.1', resolveListen));
  const stalePort = staleListener.address().port;
  const staleReadyFile = join(stateRoot, 'stale.ready.json');
  await assert.rejects(
    () => runDev({
      backendDirectory: backendRoot,
      projectRoot,
      readyFile: staleReadyFile,
      applicationReadyFile: `${staleReadyFile}.application-ready`,
      database: join(stateRoot, 'stale.sqlite3'),
      runtimeBinary,
      port: stalePort,
      externalClientOrigin: clientOrigin,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    }),
    (error) => error.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER',
  );
  assert.equal(staleListener.listening, true);
  await new Promise((resolveClose) => staleListener.close(resolveClose));

  // LLP 0301 §3 six-cell compatibility matrix. The legacy simulation enters
  // through the shipped exactRecordKeys-based reader, which refuses the new
  // posture field before its origin-list comparison can adopt the listener.
  const oldComparison = (requestedOrigins, receiptPath) => {
    const recorded = __test.readLegacyApplicationReadyReceipt(receiptPath);
    return [...requestedOrigins].sort().join('\n')
      === [...recorded.clientOrigins].sort().join('\n');
  };
  const currentReceipt = JSON.parse(correctReceiptBytes);
  const supervisedOrigins = currentReceipt.clientOrigins;
  const oldReceipt = { ...currentReceipt };
  delete oldReceipt.admissionPosture;
  const oldBytes = `${JSON.stringify(oldReceipt)}\n`;
  const newSupervisedBytes = `${JSON.stringify({
    ...currentReceipt,
    admissionPosture: 'explicit-list',
    clientOrigins: supervisedOrigins,
  })}\n`;
  const newPlainBytes = `${JSON.stringify({
    ...currentReceipt,
    admissionPosture: 'loopback-any',
    clientOrigins: [],
  })}\n`;
  const legacyReceiptFile = join(stateRoot, 'legacy.application-ready.json');
  const newSupervisedReceiptFile = join(stateRoot, 'new-supervised.application-ready.json');
  const newPlainReceiptFile = join(stateRoot, 'new-plain.application-ready.json');
  writeFileSync(legacyReceiptFile, oldBytes, { mode: 0o600 });
  writeFileSync(newSupervisedReceiptFile, newSupervisedBytes, { mode: 0o600 });
  writeFileSync(newPlainReceiptFile, newPlainBytes, { mode: 0o600 });
  assert.equal(
    oldComparison(oldReceipt.clientOrigins, legacyReceiptFile),
    true,
    'old CLI + old receipt reaches the shipped origin-list comparison',
  );
  for (const [requestedOrigins, receiptPath, label] of [
    [supervisedOrigins, newSupervisedReceiptFile, 'old CLI + new supervised'],
    [[], newPlainReceiptFile, 'old CLI no declarations + new plain'],
    [[clientOrigin], newPlainReceiptFile, 'old CLI declarations + new plain'],
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
      { ...oldReceipt, clientOrigins: [] },
    ),
    (error) => error?.code === 'SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH'
      && error.diagnostic.details.requestedAdmissionContract.admissionPosture === 'loopback-any'
      && error.diagnostic.details.recordedAdmissionContract.admissionPosture === 'explicit-list',
    'new CLI no declarations + old receipt refuses with both contracts',
  );
  assert.doesNotThrow(
    () => __test.assertDevAdmissionContractMatches(
      { admissionPosture: 'explicit-list', clientOrigins: [clientOrigin] },
      { ...oldReceipt, clientOrigins: [clientOrigin] },
    ),
    'new CLI matching declarations + old receipt succeeds',
  );

  assert.equal(
    readApplicationReadyReceipt(legacyReceiptFile).admissionPosture,
    'explicit-list',
    'reader defaults the missing legacy field without changing the old bytes',
  );
  assert.equal(readFileSync(legacyReceiptFile, 'utf8'), oldBytes);

  console.log('application-ready.test.mjs: lifecycle, posture writer, and six attach compatibility cells passed');
} finally {
  await Promise.allSettled(handles.map((handle) => handle.close?.()));
  rmSync(root, { recursive: true, force: true });
}
