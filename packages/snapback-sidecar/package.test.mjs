import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import {
  SidecarChildDiedError,
  SidecarSwapError,
  createSidecarSupervisor,
  isUpgradeRequiredRefusal,
  validateHostReadyDescriptor,
} from './index.mjs';

const until = async (predicate, label, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
};

const nextEvent = (supervisor, type) => new Promise((resolveEvent, reject) => {
  const timer = setTimeout(() => {
    unsubscribe();
    reject(new Error(`timed out waiting for ${type}`));
  }, 10_000);
  const unsubscribe = supervisor.subscribe((event) => {
    if (event.type !== type) return;
    clearTimeout(timer);
    unsubscribe();
    resolveEvent(event);
  });
});

const root = mkdtempSync(join(tmpdir(), 'snapback-sidecar-package-'));
try {
  const database = join(root, 'app.sqlite3');
  const readyFile = join(root, 'runtime.ready.json');
  const descriptor = {
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    startupId: 'startup_test',
    ready: true,
    serverUrl: 'http://127.0.0.1:51321',
    host: '127.0.0.1',
    port: 51321,
    pid: 4321,
    startupNonce: 'nonce-test',
    target: {
      appId: 'sidecar-test',
      appRoot: null,
      targetProfile: 'local-dev-sqlite-ibex',
      serverUrl: 'http://127.0.0.1:51321',
    },
    database: { mode: 'file', path: database },
    startedAtMs: 1,
    adminGated: true,
    adminTokenFile: `${database}.admin-token`,
    secretReadRootFile: `${readyFile}.secret-read-root`,
    impersonationCapabilityFile: `${readyFile}.impersonation`,
    diagnostics: [],
  };
  writeFileSync(readyFile, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
  writeFileSync(descriptor.adminTokenFile, 'secret-admin\n', { mode: 0o600 });
  writeFileSync(descriptor.secretReadRootFile, 'secret-root\n', { mode: 0o600 });
  writeFileSync(descriptor.impersonationCapabilityFile, 'secret-impersonation\n', { mode: 0o600 });

  const validated = validateHostReadyDescriptor(descriptor, {
    readyFile,
    database,
    childPid: 4321,
  });
  assert.equal(validated.port, 51321);
  assert.equal(validated.database.path, database);
  assert.throws(
    () => validateHostReadyDescriptor({ ...descriptor, port: 4287 }, { readyFile, database }),
    (error) => error.code === 'SIDECAR_READY_DESCRIPTOR_INVALID',
  );
  assert.equal(isUpgradeRequiredRefusal({ code: 'SNAPBACK_UPGRADE_REQUIRED' }), true);
  assert.equal(isUpgradeRequiredRefusal({ code: 'NOT_AN_UPGRADE' }), false);

  const died = new SidecarChildDiedError({
    pid: 4321,
    exitCode: null,
    signal: 'SIGKILL',
    generation: 1,
  });
  assert.equal(died.code, 'SIDECAR_CHILD_DIED');
  assert.equal(JSON.stringify(died).includes('secret-admin'), false);
  assert.equal(inspect(died).includes('secret-admin'), false);

  // Process-real, listener-free lifecycle double. It writes the exact
  // descriptor/capability shape and responds to the native stop command by
  // signaling the descriptor pid, so the supervisor's state machine runs
  // unchanged while package tests remain valid in socket-blocked sandboxes.
  const fakeRuntime = join(root, 'fake-snapback.mjs');
  writeFileSync(fakeRuntime, `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
if (args[0] === 'stop') {
  const ready = value('--ready-file');
  const descriptor = JSON.parse(readFileSync(ready, 'utf8'));
  process.kill(descriptor.pid, 'SIGTERM');
  process.exit(0);
}
if (args[0] !== 'start') process.exit(2);
if (Object.hasOwn(process.env, 'SNAPBACK_DEV_ADMISSION_POSTURE')) process.exit(17);
const ready = value('--ready-file');
const database = value('--db');
mkdirSync(dirname(ready), { recursive: true });
mkdirSync(dirname(database), { recursive: true });
if (!existsSync(database)) writeFileSync(database, 'fake-db');
const port = 45000 + (process.pid % 10000);
const nonce = 'fake-nonce-' + process.pid;
const descriptor = {
  schemaVersion: 'snapback.v0', descriptorKind: 'snapbackHostReady', startupId: 'startup-' + process.pid,
  ready: true, serverUrl: 'http://127.0.0.1:' + port, host: '127.0.0.1', port, pid: process.pid,
  startupNonce: nonce,
  target: { appId: 'fake-sidecar', appRoot: null, targetProfile: 'local-dev-sqlite-ibex', serverUrl: 'http://127.0.0.1:' + port },
  database: { mode: 'file', path: database }, startedAtMs: Date.now(), adminGated: true,
  adminTokenFile: database + '.admin-token', secretReadRootFile: ready + '.secret-read-root',
  impersonationCapabilityFile: ready + '.impersonation', diagnostics: [],
};
writeFileSync(descriptor.adminTokenFile, 'fake-admin-' + process.pid + '\\n', { mode: 0o600 });
writeFileSync(descriptor.secretReadRootFile, 'fake-root-' + process.pid + '\\n', { mode: 0o600 });
writeFileSync(descriptor.impersonationCapabilityFile, 'fake-impersonation-' + process.pid + '\\n', { mode: 0o600 });
writeFileSync(ready, JSON.stringify(descriptor) + '\\n', { mode: 0o600 });
const cleanup = () => {
  rmSync(ready, { force: true });
  rmSync(ready + '.secret-read-root', { force: true });
  rmSync(ready + '.impersonation', { force: true });
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
setInterval(() => {}, 1000);
`);
  chmodSync(fakeRuntime, 0o755);
  const managedDatabase = join(root, 'managed', 'app.sqlite3');
  const identities = new Map();
  let managedReadyFile = null;
  const fakeFetch = async (url) => {
    if (managedReadyFile && existsSync(managedReadyFile)) {
      const current = JSON.parse(readFileSync(managedReadyFile, 'utf8'));
      identities.set(current.serverUrl, current);
    }
    const base = String(url).replace(/\/health$/u, '');
    const current = identities.get(base);
    if (!current) throw new Error('connection refused');
    try {
      process.kill(current.pid, 0);
    } catch {
      throw new Error('connection refused');
    }
    return { ok: true, status: 200, json: async () => ({ binary: { startupNonce: current.startupNonce } }) };
  };
  const resumes = [];
  const rebinds = [];
  let strandNextResume = false;
  let underaccountNextResume = false;
  let legacyEmptyNext = false;
  const artifactGeneration = Object.freeze({
    schemaVersion: 'snapback.v0',
    appId: 'fake-sidecar',
    schemaHash: `sha256:${'a'.repeat(64)}`,
    bundleHash: `sha256:${'b'.repeat(64)}`,
    inputsHash: `sha256:${'c'.repeat(64)}`,
  });
  const freshSnapshotBarrier = Object.freeze({
    schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1',
    status: 'passed',
    kind: 'full-snapshot',
  });
  const supervisor = createSidecarSupervisor({
    database: managedDatabase,
    runtimeBinary: fakeRuntime,
    stateDirectory: join(root, 'managed-sidecar'),
    env: { ...process.env, SNAPBACK_DEV_ADMISSION_POSTURE: 'hostile-ambient-value' },
    fetch: fakeFetch,
    restartPolicy: { mode: 'restart', maxAttempts: 1, backoffMs: 0 },
    outbox: {
      async status() { return { pending: 1 }; },
      async quiesce() {
        const legacyEmpty = legacyEmptyNext;
        legacyEmptyNext = false;
        return {
          snapshot: legacyEmpty ? { pending: 0 } : {
            schemaVersion: 'snapback.desktop-sidecar-store-handoff.v1',
            clientStoreId: 'fake-sidecar-store',
            writer: true,
            artifactGeneration,
            pending: 1,
            failed: 0,
            quarantined: 0,
            resultGone: 0,
          },
          async settled() {},
          async rebind(context) {
            rebinds.push({ outcome: context.outcome, url: context.attachment.url });
            if (legacyEmpty) return { attachedUrl: context.attachment.url };
            return {
              schemaVersion: 'snapback.desktop-sidecar-binding.v2',
              attachedUrl: context.attachment.url,
              startupNonce: context.attachment.healthyStart.startupNonce,
              clientStoreId: 'fake-sidecar-store',
              writer: true,
              freshSnapshotBarrier,
              artifactGeneration,
            };
          },
          async resume(context) {
            resumes.push(context.outcome);
            if (legacyEmpty) {
              return {
                schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v1',
                attachedUrl: context.binding.attachedUrl,
                replayed: 0,
                remaining: 0,
                stopped: false,
              };
            }
            if (underaccountNextResume) {
              underaccountNextResume = false;
              return {
                schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2',
                attachedUrl: context.binding.attachedUrl,
                startupNonce: context.binding.startupNonce,
                clientStoreId: context.binding.clientStoreId,
                writer: true,
                freshSnapshotBarrier,
                artifactGeneration,
                pendingBefore: 1,
                replayed: 0,
                failedDelta: 0,
                quarantinedDelta: 0,
                resultGoneDelta: 0,
                remaining: 0,
                stopped: false,
              };
            }
            if (strandNextResume) {
              strandNextResume = false;
              return {
                schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2',
                attachedUrl: context.binding.attachedUrl,
                startupNonce: context.binding.startupNonce,
                clientStoreId: context.binding.clientStoreId,
                writer: true,
                freshSnapshotBarrier,
                artifactGeneration,
                pendingBefore: 1,
                replayed: 0,
                failedDelta: 0,
                quarantinedDelta: 0,
                resultGoneDelta: 0,
                remaining: 1,
                stopped: true,
              };
            }
            return {
              schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2',
              attachedUrl: context.binding.attachedUrl,
              startupNonce: context.binding.startupNonce,
              clientStoreId: context.binding.clientStoreId,
              writer: true,
              freshSnapshotBarrier,
              artifactGeneration,
              pendingBefore: 1,
              replayed: 1,
              failedDelta: 0,
              quarantinedDelta: 0,
              resultGoneDelta: 0,
              remaining: 0,
              stopped: false,
            };
          },
        };
      },
    },
  });
  managedReadyFile = supervisor.readyFile;
  let managed = await supervisor.start();
  assert.ok(
    managed.pid > 0,
    'sidecar start scrubs the polluted posture; the fake runtime exits 17 if it inherits it',
  );
  assert.equal(managed.healthyStart.requestedPort, 0);
  assert.match(await managed.capabilities.adminToken.read(), /^fake-admin-/u);

  const diedEvent = nextEvent(supervisor, 'child-died');
  const restartedEvent = nextEvent(supervisor, 'restarted');
  process.kill(managed.pid, 'SIGKILL');
  assert((await diedEvent).error instanceof SidecarChildDiedError);
  managed = (await restartedEvent).attachment;
  assert.equal((await supervisor.health()).ok, true);

  const candidateRuntime = join(root, 'fake-candidate.mjs');
  symlinkSync(fakeRuntime, candidateRuntime);
  const swapped = await supervisor.swap({ runtime: { runtimeBinary: candidateRuntime } });
  assert.equal(swapped.outcome, 'swapped');
  assert.equal(rebinds.at(-1).url, swapped.attachment.url);
  assert.equal(resumes.at(-1), 'swapped');
  assert.equal(swapped.outboxResume.replayed, 1);

  legacyEmptyNext = true;
  const coldSwap = await supervisor.swap({ runtime: { runtimeBinary: fakeRuntime } });
  assert.equal(coldSwap.outboxSnapshot.pending, 0);
  assert.equal(coldSwap.outboxResume.schemaVersion, 'snapback.desktop-sidecar-outbox-resume.v1');
  assert.equal(coldSwap.outboxResume.replayed, 0);

  strandNextResume = true;
  await assert.rejects(
    () => supervisor.swap({ runtime: { runtimeBinary: fakeRuntime } }),
    (error) => (
      error instanceof SidecarSwapError
      && error.details.causeCode === 'SIDECAR_OUTBOX_RESUME_INCOMPLETE'
      && ['old', 'new'].includes(error.attached)
    ),
  );
  assert.equal((await supervisor.health()).ok, true, 'a stranded resume cannot commit the candidate');

  underaccountNextResume = true;
  await assert.rejects(
    () => supervisor.swap({ runtime: { runtimeBinary: candidateRuntime } }),
    (error) => (
      error instanceof SidecarSwapError
      && error.details.causeCode === 'SIDECAR_OUTBOX_RESUME_INCOMPLETE'
      && ['old', 'new'].includes(error.attached)
    ),
  );
  assert.equal(
    (await supervisor.health()).ok,
    true,
    'zero remaining cannot commit without accounting for every pending record',
  );

  let killedCandidate = null;
  await assert.rejects(
    () => supervisor.swap({
      runtime: { runtimeBinary: fakeRuntime },
      async verifyCandidate(candidate) {
        killedCandidate = candidate.pid;
        process.kill(candidate.pid, 'SIGKILL');
        await until(() => {
          try { process.kill(candidate.pid, 0); return false; } catch { return true; }
        }, 'candidate death');
      },
    }),
    (error) => error instanceof SidecarSwapError && ['old', 'new'].includes(error.attached),
  );
  assert.notEqual(supervisor.attachment.pid, killedCandidate);
  assert.equal((await supervisor.health()).ok, true);
  const stopped = await supervisor.stop();
  assert.equal(stopped.graceful, true);
  assert.equal(stopped.escalatedTo, null);

  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
    {
      cwd: new URL('.', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: join(root, '.npm-cache') },
    },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [{ files }] = JSON.parse(packed.stdout);
  const paths = new Set(files.map(({ path }) => path));
  for (const expected of ['README.md', 'index.d.mts', 'index.mjs', 'package.json']) {
    assert.equal(paths.has(expected), true, `${expected} missing from sidecar tarball`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('desktop sidecar package test passed');
