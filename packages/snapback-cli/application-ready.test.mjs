import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { readReadyDescriptor, runDev, scaffoldApp } from './index.mjs';

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
    'application',
    'artifacts',
    'auth',
    'capabilityManifestDigest',
    'formatVersion',
    'hostReadyDescriptorDigest',
    'networkProfile',
    'settledAtMs',
    'startupNonce',
    'targetProfile',
  ]);
  assert.deepEqual(Object.keys(receipt.application).sort(), [
    'deployment', 'mode', 'obligationsDigest',
  ]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
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

  // Reattach over a live server. The second supervisor removes any prior
  // projection, loads/evaluates against its generated target, and republishes
  // against the existing native process nonce.
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
  assert.equal(existsSync(applicationReadyFile), false);
  await owner.close();
  handles.splice(handles.indexOf(owner), 1);

  console.log('application-ready.test.mjs: all cases passed');
} finally {
  await Promise.allSettled(handles.map((handle) => handle.close?.()));
  rmSync(root, { recursive: true, force: true });
}
