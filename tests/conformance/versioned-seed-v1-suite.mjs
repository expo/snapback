#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient, newSeedOperationIdV1 } from '../../packages/snapback-client/index.mjs';
import { loadGenerated } from '../../packages/snapback-cli/index.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { buildSeedArtifactV1 } from '../../packages/snapback-codegen/seed-artifact.mjs';
import { createSnapbackViteLifecycle } from '../../packages/snapback-vite/lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outAt = process.argv.indexOf('--out');
const outputDirectory = outAt >= 0 ? resolve(process.argv[outAt + 1]) : null;
if (!outputDirectory) throw new Error('SNAPBACK_SEED_CONFORMANCE_OUTPUT_REQUIRED');
mkdirSync(outputDirectory, { recursive: true });

const caseAssertions = new Map();
const issuedAdminTokens = [];
const cases = [
  'http-install-state-matrix',
  'http-preview-byte-identity',
  'http-reset-install-clear',
  'cli-install-matched-drift',
  'cli-no-legacy-fallback',
  'host-op-ensure-v1',
  'host-op-preview-v1',
  'host-op-reset-install-v1',
  'host-op-clear-v1',
  'vite-managed-versioned-seed',
  'package-cold-install',
  'restore-leaves-identity-absent',
  'migration-refuses-identity-advance',
  'predecessor-legacy-reset-rotates-away',
  'crash-before-commit-zero-effects',
  'response-loss-replay-one-effect',
  'empty-array-target-occupancy',
  'sessions-membership-fixture-lane',
  'effect-bound-1024',
  'effect-bound-1025-refusal',
];
for (const id of cases) caseAssertions.set(id, []);

function check(id, condition, claim, facts = {}) {
  assert.ok(condition, `${id}: ${claim}: ${JSON.stringify(facts)}`);
  caseAssertions.get(id).push({ claim, facts });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileDigest(path) {
  return existsSync(path) ? sha256File(path) : 'absent';
}

function diagnosticCode(body) {
  return body?.diagnostic?.code
    ?? body?.diagnostics?.[0]?.code
    ?? body?.code
    ?? null;
}

async function eventually(work, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await work();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}

async function startServer(binary, database, readyFile, extra = []) {
  mkdirSync(dirname(database), { recursive: true });
  const child = spawn(binary, [
    'start',
    '--ready-file', readyFile,
    '--db', database,
    '--cron-disabled',
    ...extra,
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      SNAPBACK_CRON_DISABLED: '1',
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const descriptor = await eventually(() => {
    if (child.exitCode !== null) {
      throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    }
    return existsSync(readyFile) ? JSON.parse(readFileSync(readyFile, 'utf8')) : null;
  }, `ready file ${readyFile}`);
  const token = readFileSync(`${database}.admin-token`, 'utf8').trim();
  issuedAdminTokens.push(token);
  return {
    binary,
    child,
    database,
    readyFile,
    descriptor,
    token,
    serverUrl: descriptor.serverUrl,
    async stop() {
      spawnSync(binary, ['stop', '--ready-file', readyFile], {
        cwd: root,
        encoding: 'utf8',
      });
      await eventually(
        () => child.exitCode !== null || child.signalCode !== null,
        `server ${child.pid} stop`,
        10_000,
      ).catch(() => child.kill('SIGKILL'));
    },
  };
}

async function jsonRequest(server, path, body, { token = server.token } = {}) {
  const response = await fetch(`${server.serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-snapback-admin-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  let value = null;
  try {
    value = await response.json();
  } catch {
    // Status plus a null body remains closed failure evidence.
  }
  return { status: response.status, body: value };
}

async function hostOp(server, operation, members = {}) {
  return jsonRequest(server, '/_snapback/api/host-ops', {
    schemaVersion: 'snapback.v0',
    requestId: `seed-conformance-${newSeedOperationIdV1()}`,
    operation,
    ...members,
  });
}

function installBody(artifact, operationId = newSeedOperationIdV1()) {
  return {
    formatVersion: 'snapback.seed.install-request.v1',
    operationId,
    artifact,
    requestedMode: 'dev',
  };
}

function resetBody(operation, expectedDataVersionStream, artifact, operationId = newSeedOperationIdV1()) {
  return {
    formatVersion: 'snapback.seed.reset-request.v1',
    operationId,
    operation,
    requestedMode: 'dev',
    expectedDataVersionStream,
    ...(artifact ? { artifact } : {}),
  };
}

function writeGeneratedBackend(directory, schema, functions, artifact, capabilities) {
  const generated = join(directory, 'generated');
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(generated, 'schema.manifest.json'), `${JSON.stringify(schema, null, 2)}\n`);
  writeFileSync(join(generated, 'functions.manifest.json'), `${JSON.stringify(functions, null, 2)}\n`);
  writeFileSync(join(generated, 'seed.artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(generated, 'capability.manifest.json'), `${JSON.stringify({
    artifactKind: 'capabilityManifest',
    supportedCapabilities: capabilities,
  }, null, 2)}\n`);
  writeFileSync(join(generated, 'artifacts.json'), `${JSON.stringify({
    artifactKind: 'artifactIndex',
    appId: schema.appId,
    artifacts: [
      'schema.manifest.json',
      'functions.manifest.json',
      'seed.artifact.json',
      'capability.manifest.json',
    ],
  }, null, 2)}\n`);
  return generated;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'snapback-seed-conformance-'));
const explicitCurrentBinary = process.env.SNAPBACK_BINARY;
const currentBinary = resolve(explicitCurrentBinary ?? join(root, 'target/debug/snapback'));
// The canonical proof supplies a staged, readiness-qualified package binary.
// Rebuilding the root target here would neither produce that path nor improve
// its evidence; it would overwrite target/debug/snapback after readiness was
// issued and make every later real-server consumer reject the prepared binary.
if (!explicitCurrentBinary) {
  const build = spawnSync('cargo', ['build', '--quiet', '--bin', 'snapback'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`current binary build failed:\n${build.stderr}`);
} else if (!existsSync(currentBinary)) {
  throw new Error(`SNAPBACK_SEED_CONFORMANCE_BINARY_MISSING: ${currentBinary}`);
}
chmodSync(currentBinary, 0o755);

// @ref LLP 0109#18-dated-amendment-the-membership-fixture-lane-lands-2026-08-01 —
// The closed evidence consumes both the original conformance witnesses and
// the `versioned_seed_membership_fixture_*` pair. Pin their owning crate and
// filter on the shared family prefix so a later crate move fails non-vacuously.
const rustProofCommand = [
  'test', '-p', 'snapback-kernel', '--lib', 'versioned_seed', '--', '--nocapture',
];
const expectedRustWitnesses = [
  'versioned_seed_conformance_effect_boundaries_and_migration_refusal',
  'versioned_seed_conformance_empty_target_and_sessions_membership_lane',
  'versioned_seed_membership_fixture_lane_installs_resets_and_retires_runtime_authority',
  'versioned_seed_membership_fixture_lane_fails_closed',
  'versioned_seed_conformance_precommit_fault_restores_complete_predecessor',
];
const rustProof = spawnSync('cargo', rustProofCommand, { cwd: root, encoding: 'utf8' });
if (rustProof.status !== 0) {
  throw new Error(
    `SNAPBACK_SEED_CONFORMANCE_RUST_TESTS_FAILED: cargo ${rustProofCommand.join(' ')} `
      + `exited ${rustProof.status ?? rustProof.signal ?? 'unknown'}\n`
      + `${rustProof.stdout}\n${rustProof.stderr}`,
  );
}
const rustOutput = `${rustProof.stdout}\n${rustProof.stderr}`;
const executedRustWitnesses = expectedRustWitnesses.filter((name) => rustOutput.includes(name));
if (executedRustWitnesses.length !== expectedRustWitnesses.length) {
  const missing = expectedRustWitnesses.filter((name) => !executedRustWitnesses.includes(name));
  const diagnostic = executedRustWitnesses.length === 0
    ? 'SNAPBACK_SEED_CONFORMANCE_RUST_WITNESSES_NOT_EXECUTED: selected no tests'
    : 'SNAPBACK_SEED_CONFORMANCE_RUST_WITNESSES_INCOMPLETE';
  const missingDetail = executedRustWitnesses.length === 0 ? '' : `; missing=${missing.join(',')}`;
  throw new Error(
    `${diagnostic}; executed ${executedRustWitnesses.length}/`
      + `${expectedRustWitnesses.length} expected witnesses${missingDetail}; `
      + `command=cargo ${rustProofCommand.join(' ')}`,
  );
}

const schema = JSON.parse(readFileSync(
  join(root, 'demos/todo/snapback/generated/schema.manifest.json'),
  'utf8',
));
const functions = JSON.parse(readFileSync(
  join(root, 'demos/todo/snapback/generated/functions.manifest.json'),
  'utf8',
));
const legacySeed = JSON.parse(
  readFileSync(join(root, 'demos/todo/snapback/seed.json'), 'utf8'),
);
const artifact = buildSeedArtifactV1({
  seedVersion: 'conformance-v1',
  tables: legacySeed.tables,
}, schema.appId).artifact;
const changedSameVersion = buildSeedArtifactV1({
  seedVersion: 'conformance-v1',
  tables: {
    ...legacySeed.tables,
    todos: legacySeed.tables.todos.map((row, index) =>
      index === 0 ? { ...row, title: `${row.title} changed` } : row),
  },
}, schema.appId).artifact;
const successorArtifact = buildSeedArtifactV1({
  seedVersion: 'conformance-v2',
  tables: legacySeed.tables,
}, schema.appId).artifact;

let mainServer;
let cliServer;
let authBackupSourceServer;
let viteLifecycle;
try {
  mainServer = await startServer(
    currentBinary,
    join(temporaryRoot, 'main', 'app.sqlite3'),
    join(temporaryRoot, 'main', 'ready.json'),
  );
  const loadedSchema = await hostOp(mainServer, 'schema.load', { schema });
  const loadedFunctions = await hostOp(mainServer, 'functions.load', { functions });
  assert.equal(loadedSchema.body?.ok, true, JSON.stringify(loadedSchema.body));
  assert.equal(loadedFunctions.body?.ok, true, JSON.stringify(loadedFunctions.body));

  const publicInspect = await fetch(`${mainServer.serverUrl}/inspect`).then((response) => response.json());
  const advertised = publicInspect?.capabilityManifest?.supportedCapabilities ?? [];
  check('http-install-state-matrix', advertised.includes('versioned_seed_install_v1'),
    'public target advertises the passed install gate', { advertised });
  check('http-reset-install-clear', advertised.includes('versioned_seed_reset_v1'),
    'public target advertises the passed reset gate', { advertised });

  const beforeDb = fileDigest(mainServer.database);
  const beforeWal = fileDigest(`${mainServer.database}-wal`);
  const preview = await jsonRequest(mainServer, '/_snapback/api/app/seed/preview-v1', {
    formatVersion: 'snapback.seed.preview-request.v1',
    artifact,
    requestedMode: 'dev',
    operation: 'install',
  });
  check('http-preview-byte-identity', preview.status === 200, 'install preview succeeds', preview);
  check('http-preview-byte-identity', preview.body?.state === 'installable',
    'fresh preview classifies installable', preview.body);
  check('http-preview-byte-identity', preview.body?.directApplicationRows === 4,
    'preview reports authored row effects', preview.body);
  check('http-preview-byte-identity', fileDigest(mainServer.database) === beforeDb,
    'preview preserves the main database bytes');
  check('http-preview-byte-identity', fileDigest(`${mainServer.database}-wal`) === beforeWal,
    'preview preserves WAL bytes');

  const operationId = newSeedOperationIdV1();
  const installRequest = installBody(artifact, operationId);
  const installed = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/ensure-v1',
    installRequest,
  );
  const receipt = installed.body?.receipt;
  check('http-install-state-matrix', installed.status === 200 && installed.body?.state === 'installed',
    'fresh HTTP ensure installs', installed);
  check('http-install-state-matrix', receipt?.outcome === 'installed',
    'fresh install returns an installed receipt', receipt);
  check('http-install-state-matrix', receipt?.directApplicationRows === 4,
    'receipt counts direct rows', receipt);

  const inspectBeforeReplay = await hostOp(mainServer, 'app.inspect');
  const replay = await jsonRequest(mainServer, '/_snapback/api/app/seed/ensure-v1', installRequest);
  const inspectAfterReplay = await hostOp(mainServer, 'app.inspect');
  check('response-loss-replay-one-effect', replay.status === 200
    && replay.body?.receipt?.requestDigest === receipt?.requestDigest,
  'identical retry replays the stored receipt', replay.body);
  check('response-loss-replay-one-effect',
    inspectAfterReplay.body?.artifacts?.databaseVersion
      === inspectBeforeReplay.body?.artifacts?.databaseVersion,
  'response-loss retry does not advance the database version');
  check('response-loss-replay-one-effect',
    replay.body?.receipt?.dataVersionStream === receipt?.dataVersionStream,
  'response-loss retry preserves the successor stream');

  const matched = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/ensure-v1',
    installBody(artifact),
  );
  check('http-install-state-matrix', matched.status === 200 && matched.body?.state === 'matched',
    'new operation id observes an exact match', matched);
  check('http-install-state-matrix',
    matched.body?.observation?.establishingReceipt?.operationId === operationId,
  'matched returns the original establishing receipt', matched.body);
  check('http-install-state-matrix',
    !Object.hasOwn(matched.body?.observation ?? {}, 'operationId')
      && !Object.hasOwn(matched.body?.observation ?? {}, 'requestDigest'),
  'matched remains a pure observation without caller replay identity', matched.body);

  const versionReused = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/ensure-v1',
    installBody(changedSameVersion),
  );
  check('http-install-state-matrix', versionReused.status === 409
    && diagnosticCode(versionReused.body) === 'SNAPBACK_SEED_VERSION_REUSED',
  'same version with changed bytes refuses', versionReused);
  const migration = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/ensure-v1',
    installBody(successorArtifact),
  );
  check('http-install-state-matrix', migration.status === 409
    && diagnosticCode(migration.body) === 'SNAPBACK_SEED_MIGRATION_REQUIRED',
  'changed identity requires migration/reset', migration);

  const reusedId = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/ensure-v1',
    installBody(changedSameVersion, operationId),
  );
  check('http-install-state-matrix', reusedId.status === 409
    && diagnosticCode(reusedId.body) === 'SNAPBACK_SEED_OPERATION_ID_REUSED',
  'operation id cannot bind changed request bytes', reusedId);

  const expectedInstalled = { state: 'present', value: receipt.dataVersionStream };
  const resetPreview = await jsonRequest(mainServer, '/_snapback/api/app/seed/preview-v1', {
    formatVersion: 'snapback.seed.preview-request.v1',
    artifact: successorArtifact,
    requestedMode: 'dev',
    operation: 'resetInstall',
    expectedDataVersionStream: expectedInstalled,
  });
  check('http-preview-byte-identity', resetPreview.body?.state === 'reset-installable',
    'reset preview classifies the exact predecessor', resetPreview.body);

  const resetOperationId = newSeedOperationIdV1();
  const resetRequest = resetBody(
    'resetInstall',
    expectedInstalled,
    successorArtifact,
    resetOperationId,
  );
  const reset = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/reset-install-v1',
    resetRequest,
  );
  check('http-reset-install-clear', reset.status === 200
    && reset.body?.outcome === 'reset-installed',
  'reset-install succeeds through the reset coordinator', reset);
  check('http-reset-install-clear', reset.body?.resetDeletedRows === 4,
    'reset receipt reports predecessor deletions separately', reset.body);
  check('http-reset-install-clear',
    reset.body?.dataVersionStream !== receipt.dataVersionStream,
  'reset-install rotates the data-version stream', reset.body);

  const resetReplay = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/reset-install-v1',
    resetRequest,
  );
  check('response-loss-replay-one-effect',
    resetReplay.status === 200 && resetReplay.body?.requestDigest === reset.body?.requestDigest,
  'reset response loss replays the completed reset receipt', resetReplay);
  check('response-loss-replay-one-effect',
    resetReplay.body?.dataVersionStream === reset.body?.dataVersionStream,
  'reset replay rotates exactly once', resetReplay.body);

  const expectedReset = { state: 'present', value: reset.body.dataVersionStream };
  const clearRequest = resetBody('clear', expectedReset, null);
  const cleared = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/clear-v1',
    clearRequest,
  );
  check('http-reset-install-clear', cleared.status === 200 && cleared.body?.outcome === 'cleared',
    'clear succeeds through the reset coordinator', cleared);
  check('http-reset-install-clear', cleared.body?.totalApplicationEffects === 0,
    'clear has zero successor application effects', cleared.body);
  check('http-reset-install-clear', cleared.body?.resetDeletedRows === 4,
    'clear reports deleted predecessor rows', cleared.body);

  const stale = await jsonRequest(
    mainServer,
    '/_snapback/api/app/seed/reset-install-v1',
    resetRequest,
  );
  check('http-reset-install-clear', stale.status === 409
    && diagnosticCode(stale.body) === 'SNAPBACK_SEED_OPERATION_HISTORICAL',
  'a completed operation is historical after a later stream rotation', stale);

  const hostEnsure = await hostOp(mainServer, 'app.seed.ensure.v1', {
    input: installBody(artifact),
  });
  check('host-op-ensure-v1', hostEnsure.status === 200 && hostEnsure.body?.ok === true,
    'host ensure uses a standard success envelope', hostEnsure.body);
  check('host-op-ensure-v1', hostEnsure.body?.data?.state === 'installed',
    'host ensure installs the closed carrier', hostEnsure.body);
  const hostStream = hostEnsure.body?.data?.receipt?.dataVersionStream;

  const hostPreview = await hostOp(mainServer, 'app.seed.preview.v1', {
    input: {
      formatVersion: 'snapback.seed.preview-request.v1',
      artifact,
      requestedMode: 'dev',
      operation: 'install',
    },
  });
  check('host-op-preview-v1', hostPreview.status === 200 && hostPreview.body?.ok === true,
    'host preview uses a standard success envelope', hostPreview.body);
  check('host-op-preview-v1', hostPreview.body?.data?.state === 'matched',
    'host preview observes the installed identity', hostPreview.body);

  const forbiddenSibling = await hostOp(mainServer, 'app.seed.preview.v1', {
    args: {},
    input: {
      formatVersion: 'snapback.seed.preview-request.v1',
      artifact,
      requestedMode: 'dev',
      operation: 'install',
    },
  });
  check('host-op-preview-v1', forbiddenSibling.body?.ok === false
    && diagnosticCode(forbiddenSibling.body) === 'SNAPBACK_SEED_DECLARATION_INVALID',
  'host seed wrapper forbids legacy siblings', forbiddenSibling.body);

  const hostReset = await hostOp(mainServer, 'app.seed.reset-install.v1', {
    input: resetBody(
      'resetInstall',
      { state: 'present', value: hostStream },
      successorArtifact,
    ),
  });
  check('host-op-reset-install-v1', hostReset.status === 200 && hostReset.body?.ok === true,
    'host reset-install uses the coordinated success envelope', hostReset.body);
  check('host-op-reset-install-v1',
    hostReset.body?.data?.outcome === 'reset-installed',
  'host reset-install returns the exact receipt', hostReset.body);

  const hostClear = await hostOp(mainServer, 'app.seed.clear.v1', {
    input: resetBody(
      'clear',
      { state: 'present', value: hostReset.body.data.dataVersionStream },
      null,
    ),
  });
  check('host-op-clear-v1', hostClear.status === 200 && hostClear.body?.ok === true,
    'host clear uses the coordinated success envelope', hostClear.body);
  check('host-op-clear-v1', hostClear.body?.data?.outcome === 'cleared',
    'host clear returns the exact receipt', hostClear.body);

  // Packaged client/CLI: use the real package client against the running
  // process, then exercise CLI generated-artifact loading on an owned target.
  const client = new SnapbackClient(mainServer.serverUrl, { adminToken: mainServer.token });
  const clientInstalled = await client.ensureVersionedSeed(artifact);
  check('cli-install-matched-drift', clientInstalled?.state === 'installed',
    'packaged client installs after public capability preflight', clientInstalled);
  const clientMatched = await client.ensureVersionedSeed(artifact);
  check('cli-install-matched-drift', clientMatched?.state === 'matched',
    'packaged client exposes matched observation', clientMatched);
  await assert.rejects(
    () => client.ensureVersionedSeed(successorArtifact),
    (error) => error?.diagnostic?.code === 'SNAPBACK_SEED_MIGRATION_REQUIRED',
  );
  check('cli-install-matched-drift', true,
    'packaged client preserves migration-required diagnostic');

  const cliBackend = join(temporaryRoot, 'cli-backend');
  writeGeneratedBackend(
    cliBackend,
    schema,
    functions,
    artifact,
    ['versioned_seed_install_v1', 'versioned_seed_reset_v1'],
  );
  cliServer = await startServer(
    currentBinary,
    join(temporaryRoot, 'cli', 'app.sqlite3'),
    join(temporaryRoot, 'cli', 'ready.json'),
  );
  await loadGenerated(
    currentBinary,
    root,
    cliBackend,
    cliServer.readyFile,
    cliServer.token,
    { seed: false, database: cliServer.database },
  );
  const cliPreview = await new SnapbackClient(
    cliServer.serverUrl,
    { adminToken: cliServer.token },
  ).previewVersionedSeed(artifact);
  check('cli-install-matched-drift', cliPreview?.state === 'matched',
    'managed CLI loads and ensures the generated seed artifact', cliPreview);

  const closedBackend = join(temporaryRoot, 'cli-closed');
  writeGeneratedBackend(closedBackend, schema, functions, artifact, []);
  await assert.rejects(
    () => loadGenerated(
      currentBinary,
      root,
      closedBackend,
      cliServer.readyFile,
      cliServer.token,
      { seed: true, database: cliServer.database },
    ),
    (error) => error?.code === 'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
  );
  check('cli-no-legacy-fallback', true,
    'CLI refuses before invoking any legacy reset when capability is absent');
  const stillMatched = await new SnapbackClient(
    cliServer.serverUrl,
    { adminToken: cliServer.token },
  ).previewVersionedSeed(artifact);
  check('cli-no-legacy-fallback', stillMatched?.state === 'matched',
    'refused CLI fallback leaves the active identity unchanged', stillMatched);

  // Vite lifecycle: a managed child loads the exact generated pair and uses
  // reset-install-v1 for a new database.
  const viteProject = join(temporaryRoot, 'vite-project');
  const viteBackend = join(viteProject, 'snapback');
  writeGeneratedBackend(
    viteBackend,
    schema,
    functions,
    artifact,
    ['versioned_seed_install_v1', 'versioned_seed_reset_v1'],
  );
  const viteEvents = [];
  viteLifecycle = createSnapbackViteLifecycle({
    mode: 'managed',
    projectRoot: viteProject,
    database: join(viteProject, '.snapback/dev.sqlite3'),
    readyFile: join(viteProject, '.snapback/dev.ready.json'),
    runtimeBinary: currentBinary,
    serverStdio: 'ignore',
    setup: { backendDirectory: viteBackend },
    channel: { emit: (event) => viteEvents.push(event) },
  });
  const viteState = await viteLifecycle.start();
  check('vite-managed-versioned-seed', viteState.ready && viteState.managed,
    'Vite lifecycle owns a ready managed backend', viteState);
  const viteDescriptor = JSON.parse(readFileSync(viteLifecycle.readyFile, 'utf8'));
  const viteToken = readFileSync(`${viteLifecycle.database}.admin-token`, 'utf8').trim();
  const vitePreview = await new SnapbackClient(
    viteDescriptor.serverUrl,
    { adminToken: viteToken },
  ).previewVersionedSeed(artifact);
  check('vite-managed-versioned-seed', vitePreview?.state === 'matched',
    'Vite reset-install establishes versioned identity', vitePreview);
  check('vite-managed-versioned-seed',
    viteEvents.some((event) => event.event === 'server-setup' && event.reset === true),
  'Vite emits a reset setup event for the new database', { viteEvents });

  // True package-cold-install: pack, install into an empty project, import,
  // and validate the seed API/UUIDv7 surface from the installed tarball.
  const packRoot = join(temporaryRoot, 'package-pack');
  mkdirSync(packRoot, { recursive: true });
  const packedContract = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', packRoot, join(root, 'packages/snapback-contract')],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(packedContract.status, 0, packedContract.stderr);
  const contractInfo = JSON.parse(packedContract.stdout);
  const contractTarball = join(packRoot, contractInfo[0].filename);
  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--pack-destination', packRoot, join(root, 'packages/snapback-client')],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const packedInfo = JSON.parse(packed.stdout);
  const tarball = join(packRoot, packedInfo[0].filename);
  const cold = join(temporaryRoot, 'package-cold');
  mkdirSync(cold, { recursive: true });
  writeFileSync(join(cold, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@expo/snapback-client': `file:${tarball}`,
      '@expo/snapback-contract': `file:${contractTarball}`,
    },
  }));
  const installedPackage = spawnSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: cold, encoding: 'utf8' },
  );
  assert.equal(installedPackage.status, 0, installedPackage.stderr);
  const coldModule = await import(join(cold, 'node_modules/@expo/snapback-client/index.mjs'));
  check('package-cold-install', typeof coldModule.SnapbackClient === 'function',
    'cold-installed package exports SnapbackClient');
  check('package-cold-install', typeof coldModule.newSeedOperationIdV1 === 'function',
    'cold-installed package exports UUIDv7 seed ids');
  check('package-cold-install',
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(coldModule.newSeedOperationIdV1()),
  'cold-installed seed id is canonical UUIDv7');

  // The remaining storage/auth/fault assertions are the real Rust execution
  // proof above; each named result is emitted only after that suite passed.
  check('migration-refuses-identity-advance',
    rustOutput.includes('versioned_seed_conformance_effect_boundaries_and_migration_refusal'),
  'Rust migration-refusal case executed');
  check('crash-before-commit-zero-effects',
    rustOutput.includes('versioned_seed_conformance_precommit_fault_restores_complete_predecessor'),
  'deterministic precommit fault case executed');
  check('crash-before-commit-zero-effects', true,
    'fault case proves predecessor row and identity remain active');
  check('empty-array-target-occupancy',
    rustOutput.includes('versioned_seed_conformance_empty_target_and_sessions_membership_lane'),
  'empty-array named target occupancy case executed');
  // LLP 0100 §8b / LLP 0109 §8 (dated amendment 2026-08-01): the declared
  // membership fixture lane replaced the first-landing refusal. The case id
  // keeps its slot; the witnessed behavior is now admission + fixture
  // install/reset/retire + fail-closed row validation.
  check('sessions-membership-fixture-lane',
    rustOutput.includes('versioned_seed_conformance_empty_target_and_sessions_membership_lane')
      && rustOutput.includes('versioned_seed_membership_fixture_lane_installs_resets_and_retires_runtime_authority')
      && rustOutput.includes('versioned_seed_membership_fixture_lane_fails_closed'),
  'membership fixture lane cases executed (admission, install/reset/retire witness, fail-closed)');
  check('effect-bound-1024',
    rustOutput.includes('versioned_seed_conformance_effect_boundaries_and_migration_refusal'),
  '1024-effect success case executed');
  check('effect-bound-1025-refusal',
    rustOutput.includes('versioned_seed_conformance_effect_boundaries_and_migration_refusal'),
  '1025-effect refusal case executed');

  // Offline physical restore rotates the governed data stream at declared
  // startup. A versioned installation restored from backup therefore has no
  // active identity even though the copied application rows remain.
  await cliServer.stop();
  cliServer = null;
  const restoreSource = join(temporaryRoot, 'cli', 'app.sqlite3');
  // Activate the sessions catalog through the real cold-start artifact path
  // before invoking the offline backup CLI. The source already carries the
  // versioned dev seed identity established above; auth backup deliberately
  // publishes only its protected catalog, so restore must not resurrect that
  // app-data identity.
  const sessionsBackend = join(
    temporaryRoot,
    'sessions-deployment',
    'todo',
    'snapback',
  );
  mkdirSync(sessionsBackend, { recursive: true });
  const defineModule = new URL(
    '../../packages/snapback-codegen/define.mjs',
    import.meta.url,
  ).href;
  writeFileSync(join(sessionsBackend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineModule}';
export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  }).index('by_user', ['userId']).sync(),
}, { auth: { mode: 'sessions' } });
`);
  writeFileSync(join(sessionsBackend, 'functions.mjs'), 'export {};\n');
  const generatedSessions = await generate(sessionsBackend);
  assert.equal(
    generatedSessions.ok,
    true,
    JSON.stringify(generatedSessions.diagnostics),
  );
  const sessionsGenerated = join(sessionsBackend, 'generated');
  const startupCarrier = join(
    temporaryRoot,
    'sessions-deployment',
    'startup-artifacts.json',
  );
  writeFileSync(startupCarrier, `${JSON.stringify({
    formatVersion: 1,
    schema: JSON.parse(readFileSync(
      join(sessionsGenerated, 'schema.manifest.json'),
      'utf8',
    )),
    functions: JSON.parse(readFileSync(
      join(sessionsGenerated, 'functions.manifest.json'),
      'utf8',
    )),
  })}\n`, { mode: 0o600 });
  const devStartupCarrier = join(
    temporaryRoot,
    'sessions-deployment',
    'dev-startup-artifacts.json',
  );
  writeFileSync(devStartupCarrier, `${JSON.stringify({
    formatVersion: 1,
    schema,
    functions,
  })}\n`, { mode: 0o600 });
  authBackupSourceServer = await startServer(
    currentBinary,
    restoreSource,
    join(temporaryRoot, 'sessions-deployment', 'ready.json'),
    ['--startup-artifacts', startupCarrier],
  );
  await authBackupSourceServer.stop();
  authBackupSourceServer = null;
  const backupDir = join(temporaryRoot, 'backup');
  const backup = spawnSync(
    currentBinary,
    ['auth', 'backup', '--db', restoreSource, '--output', backupDir],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(backup.status, 0, `${backup.stdout}\n${backup.stderr}`);
  const restoredDb = join(temporaryRoot, 'restored', 'app.sqlite3');
  const restore = spawnSync(
    currentBinary,
    ['auth', 'restore', '--from', backupDir, '--db', restoredDb],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(restore.status, 0, `${restore.stdout}\n${restore.stderr}`);
  const restoreRecord = JSON.parse(restore.stdout);
  const declarationId = restoreRecord?.declarationId
    ?? restoreRecord?.next?.restoredFromBackup;
  check('restore-leaves-identity-absent', typeof declarationId === 'string',
    'restore emits a declaration id', { declarationId });
  const restoredServer = await startServer(
    currentBinary,
    restoredDb,
    join(temporaryRoot, 'restored', 'ready.json'),
    [
      '--restored-from-backup',
      declarationId,
      '--startup-artifacts',
      startupCarrier,
    ],
  );
  try {
    const stagedDowngrade = await jsonRequest(restoredServer, '/app/ensure', {
      intent: 'provision',
      requestedMode: 'dev',
      schema,
      functions,
    });
    check('restore-leaves-identity-absent',
      stagedDowngrade.status === 200 && stagedDowngrade.body?.intent === 'provision',
    'declared restore admits an explicit dev downgrade', stagedDowngrade);
  } finally {
    await restoredServer.stop();
  }
  const downgradedServer = await startServer(
    currentBinary,
    restoredDb,
    join(temporaryRoot, 'restored', 'downgraded.ready.json'),
    ['--startup-artifacts', devStartupCarrier, '--allow-auth-downgrade'],
  );
  try {
    const restoredPreview = await jsonRequest(
      downgradedServer,
      '/_snapback/api/app/seed/preview-v1',
      {
        formatVersion: 'snapback.seed.preview-request.v1',
        artifact,
        requestedMode: 'dev',
        operation: 'install',
      },
    );
    check('restore-leaves-identity-absent',
      restoredPreview.status === 200
        && restoredPreview.body?.state === 'refused'
        && restoredPreview.body?.diagnosticCode === 'SNAPBACK_SEED_NONEMPTY_UNTRACKED',
    'restored application rows require explicit reset-install', restoredPreview);
    check('restore-leaves-identity-absent', restoredPreview.body?.current == null,
      'restore leaves active versioned identity absent', restoredPreview.body);
  } finally {
    await downgradedServer.stop();
  }

  // Build and execute the exact predecessor. A verified cache is reused only
  // after commit/build identity/binary digest all revalidate.
  const predecessorCommit = '3db3185a8325b5e8209b637080ab65d775c880ea';
  const repositoryCacheKey = createHash('sha256')
    .update(spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim())
    .digest('hex')
    .slice(0, 16);
  const predecessorRoot = join(
    tmpdir(),
    'snapback-versioned-seed-predecessor',
    repositoryCacheKey,
    predecessorCommit,
  );
  const predecessorSource = join(predecessorRoot, 'source');
  const predecessorBinary = join(predecessorSource, 'target/debug/snapback');
  const predecessorCacheReceipt = join(predecessorRoot, 'verified-build.json');
  const cargoLockDigest = createHash('sha256')
    .update(spawnSync('git', ['show', `${predecessorCommit}:Cargo.lock`], {
      cwd: root,
      encoding: null,
    }).stdout)
    .digest('hex');
  const buildInputsDigest = createHash('sha256')
    .update(`${predecessorCommit}\n${cargoLockDigest}\n`)
    .digest('hex');
  mkdirSync(predecessorRoot, { recursive: true });
  if (!existsSync(predecessorSource)) {
    const worktree = spawnSync(
      'git',
      ['worktree', 'add', '--detach', predecessorSource, predecessorCommit],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(worktree.status, 0, worktree.stderr);
  }
  let predecessorIdentity = null;
  let predecessorCacheValid = false;
  if (existsSync(predecessorBinary)) {
    let cached = null;
    try {
      cached = JSON.parse(readFileSync(predecessorCacheReceipt, 'utf8'));
    } catch {
      // A binary without its content-addressed receipt is rebuilt.
    }
    predecessorCacheValid = cached?.gitCommit === predecessorCommit
      && cached?.buildInputsDigest === buildInputsDigest
      && cached?.binarySha256 === sha256File(predecessorBinary);
  }
  if (!predecessorCacheValid) {
    const predecessorBuildEnvironment = {
      ...process.env,
      SNAPBACK_BUILD_GIT_COMMIT: predecessorCommit,
      SNAPBACK_BUILD_GIT_DIRTY: 'false',
      // @ref LLP 0109#18-dated-amendment-the-membership-fixture-lane-lands-2026-08-01 —
      // The predecessor and current runtime pin different patched Hermes
      // revisions. Keep the historical source/build cache inside its
      // content-addressed predecessor root so either build can reset its tree
      // without colliding with the other revision's persistent cache.
      XDG_CACHE_HOME: join(predecessorRoot, 'xdg-cache'),
    };
    const bootstrap = spawnSync('scripts/bootstrap-ibex-runtime', [], {
      cwd: predecessorSource,
      encoding: 'utf8',
      env: {
        ...predecessorBuildEnvironment,
        SNAPBACK_IBEX_CHECKOUT: resolve(root, '../ibex'),
      },
    });
    assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);
    const predecessorBuild = spawnSync(
      'cargo',
      ['build', '--locked', '--bin', 'snapback'],
      {
        cwd: predecessorSource,
        encoding: 'utf8',
        env: predecessorBuildEnvironment,
      },
    );
    assert.equal(
      predecessorBuild.status,
      0,
      `${predecessorBuild.stdout}\n${predecessorBuild.stderr}`,
    );
    writeFileSync(predecessorCacheReceipt, `${JSON.stringify({
      gitCommit: predecessorCommit,
      buildInputsDigest,
      binarySha256: sha256File(predecessorBinary),
    }, null, 2)}\n`);
  }
  const predecessorSha256 = sha256File(predecessorBinary);
  check('predecessor-legacy-reset-rotates-away', /^[0-9a-f]{64}$/u.test(predecessorSha256),
    'predecessor binary digest is content-addressed', { predecessorSha256 });
  check('predecessor-legacy-reset-rotates-away', /^[0-9a-f]{64}$/u.test(buildInputsDigest),
    'predecessor build inputs digest is recorded', { buildInputsDigest });

  const predecessorDb = join(temporaryRoot, 'predecessor', 'app.sqlite3');
  let currentForPredecessor = await startServer(
    currentBinary,
    predecessorDb,
    join(temporaryRoot, 'predecessor', 'current.ready.json'),
  );
  await hostOp(currentForPredecessor, 'schema.load', { schema });
  await hostOp(currentForPredecessor, 'functions.load', { functions });
  const established = await jsonRequest(
    currentForPredecessor,
    '/_snapback/api/app/seed/ensure-v1',
    installBody(artifact),
  );
  check('predecessor-legacy-reset-rotates-away', established.body?.state === 'installed',
    'current binary establishes versioned identity before downgrade', established.body);
  await currentForPredecessor.stop();
  currentForPredecessor = null;

  const predecessorServer = await startServer(
    predecessorBinary,
    predecessorDb,
    join(temporaryRoot, 'predecessor', 'old.ready.json'),
  );
  try {
    const predecessorHealth = await fetch(`${predecessorServer.serverUrl}/health`)
      .then((response) => response.json());
    predecessorIdentity = predecessorHealth?.binary;
    check('predecessor-legacy-reset-rotates-away',
      predecessorIdentity?.gitCommit === predecessorCommit,
    'predecessor public health reports the exact checkpoint commit', predecessorIdentity);
    const legacyReset = await hostOp(predecessorServer, 'app.reset');
    check('predecessor-legacy-reset-rotates-away',
      legacyReset.status === 200 && legacyReset.body?.ok === true,
    'unmodified predecessor executes its legacy reset', legacyReset.body);
  } finally {
    await predecessorServer.stop();
  }
  const reopened = await startServer(
    currentBinary,
    predecessorDb,
    join(temporaryRoot, 'predecessor', 'reopened.ready.json'),
  );
  try {
    const afterLegacy = await jsonRequest(reopened, '/_snapback/api/app/seed/preview-v1', {
      formatVersion: 'snapback.seed.preview-request.v1',
      artifact,
      requestedMode: 'dev',
      operation: 'install',
    });
    check('predecessor-legacy-reset-rotates-away', afterLegacy.body?.current == null,
      'new binary sees no stale active identity after predecessor reset', afterLegacy.body);
    check('predecessor-legacy-reset-rotates-away', afterLegacy.body?.state === 'installable',
      'new binary classifies predecessor-reset database installable', afterLegacy.body);
  } finally {
    await reopened.stop();
  }

  const predecessorEvidence = {
    gitCommit: predecessorCommit,
    buildRecipe:
      'git worktree add --detach <dir> 3db3185a8325b5e8209b637080ab65d775c880ea && scripts/bootstrap-ibex-runtime && cargo build --locked --bin snapback',
    buildInputsDigest,
    binarySha256: predecessorSha256,
    binaryBuildIdentity: JSON.stringify(predecessorIdentity),
    legacyResetObservation: 'active-versioned-seed-identity-absent',
  };

  for (const [id, assertions] of caseAssertions) {
    const evidence = {
      artifactKind: 'snapback.versioned-seed-case-evidence.v1',
      id,
      outcome: 'passed',
      assertionCount: assertions.length,
      assertions,
      ...(id === 'predecessor-legacy-reset-rotates-away'
        ? { predecessor: predecessorEvidence }
        : {}),
    };
    const encoded = JSON.stringify(evidence, null, 2);
    assert.ok(
      issuedAdminTokens.every((token) => !encoded.includes(token)),
      `${id}: conformance evidence must not contain an admin credential`,
    );
    writeFileSync(join(outputDirectory, `${id}.json`), `${encoded}\n`);
  }
} finally {
  await viteLifecycle?.close().catch(() => {});
  await authBackupSourceServer?.stop().catch(() => {});
  await cliServer?.stop().catch(() => {});
  await mainServer?.stop().catch(() => {});
  if (process.env.SNAPBACK_KEEP_VERSIONED_SEED_CONFORMANCE_TEMP !== '1') {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
