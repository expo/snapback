import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { outboxOps } from '../../../packages/snapback-client/outbox-shared.mjs';
import { createSqliteRqsResumeStore } from '../../../packages/snapback-client/rqs-store-sqlite.mjs';
import {
  acquireExpoSqliteDefaultRqsStore,
  __resetExpoSqliteCarrierRegistryForTests,
} from '../../../packages/snapback-expo/expo-sqlite-carrier.mjs';
import { createNodeSqliteNamespace } from '../node-sqlite-adapter.mjs';
import {
  runBrokenStoreNegativeControl,
  verifyRecoveredCycle,
} from './node-recovery-verifier.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, '../../..');
const evidenceRoot = resolve(scriptDirectory, '../evidence');
const phases = Object.freeze([
  'pending-durable-before-delivery',
  'server-result-before-local-settlement',
  'commit-loop',
  'committed-before-callback',
  'consumed-before-ack',
  'ack-proof-before-local-removal',
  'authority-wipe-before-successor',
]);
const startedAt = new Date();
const seed = randomBytes(8).toString('hex');
const runId = `${startedAt.toISOString().replace(/[-:.]/gu, '').replace('Z', 'Z-')}${seed.slice(0, 8)}`;
const runDirectory = join(evidenceRoot, runId);
const scratch = await mkdtemp(join(tmpdir(), 'snapback-expo-sqlite-qualification-'));
const results = [];
let sqliteFacts = null;

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const hashFile = async (path) => sha256(await readFile(path));
const record = (scenario, result, details = {}) => {
  results.push(Object.freeze({ scenario, result, ...details }));
};
const namespace = (directory) => createNodeSqliteNamespace(directory);
const openStore = (directory, options = {}) => createSqliteRqsResumeStore({
  sqlite: namespace(directory),
  databaseName: 'qualification.sqlite',
  ...options,
});
const child = (input) => spawn(
  process.execPath,
  [join(scriptDirectory, 'node-worker.mjs'), JSON.stringify(input)],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
const firstLine = (processHandle) => new Promise((resolveLine, reject) => {
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    processHandle.stdout.off('data', onData);
    resolveLine(JSON.parse(buffer.slice(0, newline)));
  };
  processHandle.stdout.on('data', onData);
  processHandle.once('error', reject);
  processHandle.once('exit', (code) => {
    if (!buffer.includes('\n')) reject(new Error(`worker exited ${code}: ${buffer}`));
  });
});
const kill = async (processHandle) => {
  processHandle.kill('SIGKILL');
  await new Promise((resolveExit) => processHandle.once('exit', resolveExit));
};

const messageStream = (processHandle) => {
  const queued = [];
  const waiting = [];
  let buffer = '';
  let terminalError = null;
  const settle = (value) => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(value);
    else queued.push(value);
  };
  processHandle.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) settle(JSON.parse(line));
    }
  });
  processHandle.once('error', (error) => {
    terminalError = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  });
  processHandle.once('exit', (code, signal) => {
    if (signal === 'SIGKILL') return;
    terminalError ??= new Error(`worker exited ${code}/${signal}: ${buffer}`);
    for (const waiter of waiting.splice(0)) waiter.reject(terminalError);
  });
  return Object.freeze({
    next() {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolveMessage, reject) => waiting.push({ resolve: resolveMessage, reject }));
    },
  });
};

async function generation(store, value) {
  return store.materializationTransaction('readwrite', (view) => {
    view.entries.set('generation', {
      rows: [{ generation: value }], meta: {}, token: String(value), bytes: 1,
      savedAt: value, resumedAt: 0, inProgress: false,
    });
    view.materializations.set('generation', { generation: value });
    view.pageSets.set('generation', { generation: value });
    view.memberships.set('generation', { generation: value });
    const existing = Object.values(view.outbox.records).find((entry) => entry.id === 'generation');
    if (existing) view.outbox = outboxOps.discard(view.outbox, 'generation').state;
    view.outbox = outboxOps.enqueue(
      view.outbox,
      { id: 'generation', function: 'commitGeneration', args: { generation: value } },
      value,
    ).state;
  });
}

async function observedGeneration(store) {
  return store.materializationTransaction('readonly', (view) => {
    const values = [
      view.entries.get('generation')?.rows?.[0]?.generation,
      view.materializations.get('generation')?.generation,
      view.pageSets.get('generation')?.generation,
      view.memberships.get('generation')?.generation,
    ];
    assert.equal(new Set(values).size, 1, `hybrid generation: ${JSON.stringify(values)}`);
    return values[0];
  });
}

async function atomicFaultMatrix() {
  const discoveryDirectory = join(scratch, 'boundary-discovery');
  await mkdir(discoveryDirectory);
  const boundaries = [];
  let armed = false;
  const discovery = await openStore(discoveryDirectory, {
    faultInjector(boundary) { if (armed) boundaries.push(boundary); },
  });
  await generation(discovery, 1);
  armed = true;
  await generation(discovery, 2);
  armed = false;
  sqliteFacts = discovery.qualificationFacts();
  await discovery.close();
  const unique = [...new Set(boundaries)];
  for (let index = 0; index < unique.length; index += 1) {
    const directory = join(scratch, `fault-${index}`);
    await mkdir(directory);
    let target = null;
    let cut = false;
    const store = await openStore(directory, {
      faultInjector(boundary) {
        if (!cut && target === boundary) {
          cut = true;
          throw new Error(`qualification-cut:${boundary}`);
        }
      },
    });
    await generation(store, 1);
    target = unique[index];
    await assert.rejects(generation(store, 2), /qualification-cut/u);
    target = null;
    await store.close();
    const recovered = await openStore(directory);
    assert.ok([1, 2].includes(await observedGeneration(recovered)));
    await recovered.close();
    assert.equal(cut, true);
  }
  record('atomic-fault-after-every-observed-sql-boundary', 'pass', {
    statementAndBoundaryCuts: unique.length,
    boundaries: unique,
  });
}

async function ownershipAndTakeover() {
  const directory = join(scratch, 'ownership');
  await mkdir(directory);
  const owner = child({ command: 'hold', directory, databaseName: 'qualification.sqlite' });
  const ready = await firstLine(owner);
  assert.equal(ready.status, 'ready');
  const contender = child({ command: 'probe', directory, databaseName: 'qualification.sqlite' });
  const refused = await firstLine(contender);
  assert.deepEqual(refused, {
    status: 'refused',
    code: 'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE',
  });
  await kill(owner);
  const successor = child({ command: 'probe', directory, databaseName: 'qualification.sqlite' });
  const acquired = await firstLine(successor);
  assert.equal(acquired.status, 'acquired');
  assert.equal(acquired.sqliteSourceId, ready.sqliteSourceId);
  record('two-process-exclusive-owner-and-kill-takeover', 'pass', {
    loserCode: refused.code,
    sqliteSourceId: ready.sqliteSourceId,
  });
}

async function crashPhaseMatrix() {
  const phaseEvidence = [];
  for (const phase of phases) {
    const directory = join(scratch, `phase-${phase}`);
    await mkdir(directory);
    const worker = child({ command: 'phase', phase, directory, databaseName: 'qualification.sqlite' });
    const messages = messageStream(worker);
    const armed = await messages.next();
    assert.equal(armed.status, 'armed');
    const reportedHostWatermarks = [];
    let cutReady;
    while (cutReady === undefined) {
      const message = await messages.next();
      if (message.status === 'committed') reportedHostWatermarks.push(message.hostWatermark);
      else if (message.status === 'cut-ready') cutReady = message;
      else if (message.status === 'error') throw new Error(`phase worker failed: ${message.message}`);
    }
    await kill(worker);
    const recovered = await openStore(directory);
    assert.equal((await recovered.inspection()).corrupt, false);
    const verified = await verifyRecoveredCycle({
      directory,
      store: recovered,
      phase,
      armed,
      reportedHostWatermarks,
      openIndependentStore: openStore,
    });
    phaseEvidence.push({
      phase,
      cutBoundary: cutReady.boundary,
      insideTransaction: cutReady.insideTransaction,
      evaluatedInvariants: verified.verdict.evaluated,
      serverExecutionCount: verified.server.executionCount,
    });
    await recovered.close();
  }
  record('crash-recovery-at-every-named-phase', 'pass', {
    phaseCuts: phases.length,
    phases,
    realSigkillCuts: phases.length,
    openTransactionSigkillCuts: phaseEvidence.filter((entry) => entry.insideTransaction).length,
    phaseEvidence,
  });
}

async function killedAndTruncatedWalEvidence() {
  const directory = join(scratch, 'wal-kill');
  await mkdir(directory);
  const baseline = await openStore(directory);
  await generation(baseline, 1);
  await baseline.close();
  const worker = child({
    command: 'wal-candidate',
    directory,
    databaseName: 'qualification.sqlite',
  });
  const messages = messageStream(worker);
  assert.equal((await messages.next()).status, 'armed');
  let cutReady;
  while (cutReady === undefined) {
    const message = await messages.next();
    if (message.status === 'cut-ready') cutReady = message;
  }
  const walPath = join(directory, 'qualification.sqlite-wal');
  const walBytes = await readFile(walPath);
  assert.ok(walBytes.length > 32);
  const copyDirectory = join(scratch, 'wal-truncated-copy');
  await mkdir(copyDirectory);
  for (const suffix of ['', '-wal', '-shm']) {
    const source = join(directory, `qualification.sqlite${suffix}`);
    try { await copyFile(source, join(copyDirectory, `qualification.sqlite${suffix}`)); } catch (error) {
      if (suffix !== '-shm') throw error;
    }
  }
  await kill(worker);
  const truncatedWalBytes = Math.max(32, Math.floor(walBytes.length / 2));
  await truncate(join(copyDirectory, 'qualification.sqlite-wal'), truncatedWalBytes);
  let outcome = 'recovered';
  let recoveredGeneration = null;
  let recoveredInspection = null;
  try {
    const copy = await openStore(copyDirectory);
    recoveredInspection = await copy.inspection();
    recoveredGeneration = await observedGeneration(copy);
    assert.ok([1, 2].includes(recoveredGeneration));
    assert.equal(recoveredInspection.corrupt, false);
    await copy.close();
  } catch (error) {
    outcome = error?.code ?? 'refused';
  }
  assert.ok(outcome === 'recovered' || outcome === 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT');
  record('kill-and-truncated-wal-copy', 'pass', {
    originalWalBytes: walBytes.length,
    truncatedWalBytes,
    outcome,
    recoveredGeneration,
    recoveredInspection,
    classification: 'supporting-only-not-power-loss-proof',
  });
}

async function corruptionMatrix() {
  const baseDirectory = join(scratch, 'corruption-base');
  await mkdir(baseDirectory);
  const base = await openStore(baseDirectory);
  await generation(base, 1);
  await base.close();
  const cases = ['header', 'page-truncation', 'future-schema', 'bad-row-digest'];
  for (const kind of cases) {
    const directory = join(scratch, `corruption-${kind}`);
    await mkdir(directory);
    await cp(join(baseDirectory, 'qualification.sqlite'), join(directory, 'qualification.sqlite'));
    const path = join(directory, 'qualification.sqlite');
    if (kind === 'header') {
      const handle = await openFile(path, 'r+');
      await handle.write(Buffer.from('BROKEN!!'), 0, 8, 0);
      await handle.close();
    } else if (kind === 'page-truncation') {
      await truncate(path, Math.max(512, Math.floor((await stat(path)).size / 2)));
    } else {
      const raw = new DatabaseSync(path);
      if (kind === 'future-schema') raw.exec('PRAGMA user_version=99');
      else raw.exec("UPDATE entries SET content_digest='sha256:bad' WHERE record_key='generation'");
      raw.close();
    }
    const before = await hashFile(path);
    let code = null;
    try { await openStore(directory); } catch (error) { code = error?.code ?? null; }
    assert.equal(code, 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT', kind);
    assert.equal(await hashFile(path), before, `${kind} original database bytes preserved`);
  }
  record('corruption-header-page-future-schema-bad-digest', 'pass', {
    cases,
    exactCode: 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT',
    originalBytesPreserved: true,
  });
}

async function quotaMatrix() {
  const directory = join(scratch, 'quota');
  await mkdir(directory);
  const store = await openStore(directory, {
    maxBytes: 8 * 1024 * 1024,
    qualificationMaxPageCount: 24,
  });
  assert.equal((await store.commit('prior', { rows: [{ value: 'prior' }], meta: {}, token: 'prior' })).persisted, true);
  const result = await store.commit('large', {
    rows: [{ value: 'x'.repeat(1024 * 1024) }],
    meta: {},
    token: 'large',
  });
  assert.deepEqual(result, { persisted: false, reason: 'capacity' });
  assert.equal((await store.load('prior')).token, 'prior');
  assert.equal(await store.load('large'), null);
  await store.close();
  record('quota-max-page-count-full-rollback', 'pass', {
    maxPageCount: 24,
    priorCommitSurvived: true,
    candidatePublished: false,
  });
}

async function sameRealmCoalescing() {
  const directory = join(scratch, 'same-realm');
  await mkdir(directory);
  const sqlite = namespace(directory);
  const factsProbe = await createSqliteRqsResumeStore({ sqlite, databaseName: 'facts.sqlite' });
  const facts = factsProbe.qualificationFacts();
  await factsProbe.close();
  const app = { identity: { app: 'qualification', schema: 's', functions: 'f', descriptor: 'd' } };
  const binding = { target: { origin: 'https://qualification.invalid' } };
  const environment = {
    async resolveExpoSqliteOperatingSystem() { return 'android'; },
    async resolveExpoSqliteTarget() { return { operatingSystem: 'android' }; },
    async resolveExpoSqliteModule() { return sqlite; },
  };
  const qualificationRow = {
    profile: 'durable-fragments-v1',
    target: { operatingSystem: 'android' },
    sqlite: { sourceId: facts.sqliteSourceId, compileOptions: facts.compileOptions },
  };
  const first = await acquireExpoSqliteDefaultRqsStore({ app, binding, environment, qualificationRow });
  const second = await acquireExpoSqliteDefaultRqsStore({ app, binding, environment, qualificationRow });
  assert.strictEqual(first.resolution.store, second.resolution.store);
  await first.release();
  assert.equal((await second.resolution.store.inspection()).writer, true);
  await second.release();
  await __resetExpoSqliteCarrierRegistryForTests();
  record('same-js-realm-global-registry-coalescing', 'pass', { roots: 2, stores: 1 });
}

async function deliberatelyBrokenStoreNegativeControl() {
  const directory = join(scratch, 'negative-control-broken-store');
  await mkdir(directory);
  const outcome = await runBrokenStoreNegativeControl({
    directory,
    workerPath: join(scriptDirectory, 'node-worker.mjs'),
    openStore,
  });
  assert.equal(outcome.observedHarnessVerdict, 'fail');
  assert.match(outcome.failureMessage, /generation is hybrid/u);
  record('negative-control-deliberately-broken-store-is-rejected', 'pass', {
    ...outcome,
    pipeline: 'child-worker-store-write->SIGKILL->recovery->settlement/ACK->observation->verdict',
  });
}

async function sourceClosure() {
  const files = [
    'packages/snapback-client/rqs-store-sqlite.mjs',
    'packages/snapback-client/outbox-shared.mjs',
    'packages/snapback-client/rqs-store-meta.mjs',
    'packages/snapback-expo/expo-sqlite-carrier.mjs',
    'packages/snapback-expo/provider.mjs',
    'packages/snapback-expo/expo-sqlite-carrier-publication.v1.json',
    'demos/expo-local-first-carrier/qualification-invariants.mjs',
    'demos/expo-local-first-carrier/scripts/node-worker.mjs',
    'demos/expo-local-first-carrier/scripts/node-recovery-verifier.mjs',
    'demos/expo-local-first-carrier/scripts/qualify-node.mjs',
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await hashFile(join(repoRoot, file))])));
}

try {
  await atomicFaultMatrix();
  await ownershipAndTakeover();
  await crashPhaseMatrix();
  await killedAndTruncatedWalEvidence();
  await corruptionMatrix();
  await quotaMatrix();
  await sameRealmCoalescing();
  await deliberatelyBrokenStoreNegativeControl();

  await mkdir(runDirectory, { recursive: true });
  const gitRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  const dirtyPaths = spawnSync('git', ['status', '--porcelain=v1'], { cwd: repoRoot, encoding: 'utf8' })
    .stdout.split('\n').filter(Boolean).map((line) => line.slice(3));
  const expoPackagePath = join(repoRoot, 'packages/snapback-expo/package.json');
  const clientPackagePath = join(repoRoot, 'packages/snapback-client/package.json');
  const [expoPackage, clientPackage, closure] = await Promise.all([
    readFile(expoPackagePath, 'utf8').then((value) => JSON.parse(value)),
    readFile(clientPackagePath, 'utf8').then((value) => JSON.parse(value)),
    sourceClosure(),
  ]);
  const receipt = {
    schemaVersion: 'snapback.expo-sqlite-carrier-qualification.v1',
    verdict: 'supporting-pass',
    supportingOnly: true,
    promotionalAuthority: false,
    qualificationMode: true,
    capabilityCells: [{ arm: 'expo', carrier: 'expo-sqlite', profile: 'durable-fragments-v1', target: 'node-supporting-only' }],
    governingLlpAnchors: ['LLP 0166 D1/D6/D9', 'LLP 0043 settlement publication', 'LLP 0053 identity fences', 'LLP 0189 claim gating', 'LLP 0270 D6'],
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    runId,
    seed,
    git: { revision: gitRevision, dirtyPaths },
    claimSourceClosure: closure,
    packageArtifacts: [
      { name: expoPackage.name, version: expoPackage.version, sha256: await hashFile(expoPackagePath) },
      { name: clientPackage.name, version: clientPackage.version, sha256: await hashFile(clientPackagePath) },
      {
        name: 'node:sqlite',
        version: process.versions.sqlite,
        sha256: await hashFile(process.execPath),
      },
    ],
    jsBundleIdentity: {
      kind: 'node-esm-entry-supporting-only',
      path: 'demos/expo-local-first-carrier/scripts/qualify-node.mjs',
      sha256: closure['demos/expo-local-first-carrier/scripts/qualify-node.mjs'],
    },
    nativeBinaryIdentity: { path: process.execPath, sha256: await hashFile(process.execPath) },
    targetCell: {
      operatingSystem: process.platform,
      architecture: process.arch,
      distribution: 'node-supporting-only',
      deviceClass: 'host-process',
    },
    sqlite: {
      version: sqliteFacts.sqliteVersion,
      sourceId: sqliteFacts.sqliteSourceId,
      compileOptions: sqliteFacts.compileOptions,
      pragmas: sqliteFacts.pragmas,
      databaseDirectoryClass: 'temporary-host-filesystem',
    },
    scenarios: results,
    scenarioTotals: {
      required: results.length,
      passed: results.filter((entry) => entry.result === 'pass').length,
      failed: results.filter((entry) => entry.result !== 'pass').length,
      namedCrashPhaseCuts: phases.length,
    },
    hostPublicationWatermarks: { model: 'COMMIT-promise-resolution', observedHybridGenerations: 0 },
    serverExecutionSettlementIdentities: { modelOnly: true, secretsPresent: false },
    rawLogHashes: {},
    completeBatteryReference: {
      eligible: false,
      reason: 'node-supporting-only',
      reference: 'LLP 0189 D-6 complete battery',
      qualifiedCommit: gitRevision,
    },
    limitations: [
      'Node receipt is supporting-only and cannot activate an iOS or Android publication row.',
      'Node does not exercise an Expo bridge, mobile VFS, F_FULLFSYNC effect, or real power interruption.',
    ],
  };
  const raw = {
    schemaVersion: 'snapback.expo-sqlite-carrier-qualification.raw.v1',
    sqliteSourceId: sqliteFacts.sqliteSourceId,
    runId,
    seed,
    results,
  };
  const rawPath = join(runDirectory, 'scenario-log.supporting.v1.json');
  await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
  receipt.rawLogHashes[basename(rawPath)] = await hashFile(rawPath);
  const receiptPath = join(runDirectory, 'qualification.supporting.v1.json');
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(
    `[expo-sqlite-node-qualification] PASS supporting-only: ${results.length}/${results.length} scenario groups; sqlite_source_id=${sqliteFacts.sqliteSourceId}; receipt=${relative(repoRoot, receiptPath)}\n`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
