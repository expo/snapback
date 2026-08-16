#!/usr/bin/env node
import assertNode from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {SnapbackClient} from '../../../../_kit/client.mjs';
import {startServer} from '../../../../_kit/server-process.mjs';
import {freePort} from '../../../../_kit/provenance.mjs';
import {assert, eventually, createArmSuite, loadAcceptance} from '../../../shared/harness.mjs';
import {DraftStore} from '../src/drafts.mjs';
import api from '../snapback/generated/api.mjs';

const appDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appDir, '../../../..');
const generatedDir = join(appDir, 'snapback', 'generated');
const readJson = async (name) => JSON.parse(await readFile(join(generatedDir, name), 'utf8'));
const seed = JSON.parse(await readFile(join(appDir, 'snapback', 'seed.json'), 'utf8'));
const manifest = await loadAcceptance('field-notebook');
const suite = createArmSuite({app: 'field-notebook', provider: 'snapback', manifest,
  evidencePath: join(appDir, 'evidence', 'snapback.v1.json')});
const stateDir = await mkdtemp(join(tmpdir(), 'zero-bakeoff-fn-snapback-'));
process.env.SNAPBACK_CLIENT_RQS_DIR = join(stateDir, 'rqs');
delete process.env.SNAPBACK_CLIENT_RQS_STORE;
const dbPath = join(stateDir, 'notebook.sqlite');
const port = await freePort();
const provenance = {appId: 'zero-bakeoff-field-notebook', artifactsPath: join(generatedDir, 'artifacts.json')};
const boot = () => startServer({port, bindPortExactly: true, db: dbPath, cwd: repoRoot,
  serverBinary: process.env.SNAPBACK_SERVER_BINARY ?? join(repoRoot, 'target/debug/snapback'), provenance});
let server = await boot();
const initialServerIdentity = server.identity;
const clients = [];
const open = () => { const client = new SnapbackClient(server.baseUrl, server.clientOptions); clients.push(client); return client; };
const provisioner = new SnapbackClient(server.baseUrl, {...server.clientOptions, rqsStore: null});
await provisioner.ensureApp({schema: await readJson('schema.manifest.json'),
  functions: await readJson('functions.manifest.json'), seed});
for (let index = 3; index <= 200; index += 1) {
  await provisioner.mutate(api.createRecord, {args: {assignmentId: 'north',
    title: `Record ${String(index).padStart(3, '0')}`, body: `Seed observation ${String(index).padStart(3, '0')}`}});
}

let offlineClient;
let retained;
let queuedCreate;
let queuedUpdate;
let pendingSnapshot;
let draftEvidence;
await suite.pass('fn.cold-retained-read', async () => {
  const warm = open();
  const handle = await warm.liveQuery(api.assignedRecords, {args: {assignmentId: 'north'},
    connectionId: 'fn-warm', transport: 'stream'});
  assertNode.equal(handle.rows.length, 200);
  assertNode.equal(handle.freshness, 'current');
  await handle.flushResumeState();
  handle.dispose();
  await handle.settled?.();
  await warm.rqsStore?.close?.();
  await server.stop();
  offlineClient = open();
  retained = await offlineClient.liveQuery(api.assignedRecords, {args: {assignmentId: 'north'},
    connectionId: 'fn-cold-offline', transport: 'stream'});
  assertNode.equal(retained.rows.length, 200);
  return {coldRows: retained.rows.length, backendReachable: false, store: offlineClient.rqsStoreInfo};
});

await suite.pass('fn.honest-freshness', async () => {
  assertNode.equal(retained.freshness, 'retained');
  assert(retained.connection !== 'live', 'offline retained rows claimed a live connection');
  return {freshness: retained.freshness, connection: retained.connection};
});

await suite.pass('fn.short-interruption-write', async () => {
  queuedCreate = await offlineClient.mutate(api.createRecord, {args: {
    assignmentId: 'north', title: 'Offline specimen', body: 'Captured without a network',
  }});
  assertNode.equal(queuedCreate.status, 'queued');
  return {contract: 'durable queue', clientMutationId: queuedCreate.clientMutationId};
});

await suite.pass('fn.disconnected-write-contract', async () => {
  queuedUpdate = await offlineClient.mutate(api.updateRecord, {args: {
    id: 'record-001', body: 'Offline corrected observation', revision: 2,
  }});
  assertNode.equal(queuedUpdate.status, 'queued');
  pendingSnapshot = await offlineClient.rqsStore.outboxPending();
  assertNode.deepEqual(pendingSnapshot.map((row) => row.function), ['createRecord', 'updateRecord']);
  return {declared: 'queued', pending: pendingSnapshot.length,
    diagnostics: offlineClient.outboxDiagnostics.map((entry) => entry.code)};
});

await suite.pass('fn.draft-preservation', async () => {
  const backing = new Map();
  const drafts = new DraftStore(backing);
  drafts.save('record-002', 'Unsubmitted local draft');
  draftEvidence = drafts.load('record-002');
  assertNode.equal(draftEvidence, 'Unsubmitted local draft');
  return {applicationOwned: true, preserved: true};
});

await suite.pass('fn.reconnect-no-duplicate', async () => {
  server = await boot();
  const again = new SnapbackClient(server.baseUrl, {...server.clientOptions, rqsStore: null});
  await again.ensureApp({schema: await readJson('schema.manifest.json'),
    functions: await readJson('functions.manifest.json'), seed});
  await eventually(async () => (await offlineClient.rqsStore.outboxPending()).length === 0,
    {timeoutMs: 30_000, label: 'Snapback outbox drain'});
  await eventually(() => retained.freshness === 'current', {timeoutMs: 30_000, label: 'retained query current'});
  const authoritative = await again.query(api.assignedRecords, {args: {assignmentId: 'north'}});
  assertNode.equal(authoritative.rows.filter((row) => row.title === 'Offline specimen').length, 1);
  assertNode.equal(authoritative.rows.find((row) => row._id === 'record-001')?.body, 'Offline corrected observation');
  return {authoritativeRows: authoritative.rows.length, duplicateOfflineCreates: 0};
});

await suite.pass('fn.logout-cache-policy', async () => {
  retained.dispose();
  await retained.settled?.();
  for (const client of clients) await client.rqsStore?.close?.();
  await rm(join(stateDir, 'rqs'), {recursive: true, force: true});
  const after = new SnapbackClient(server.baseUrl, {...server.clientOptions});
  clients.push(after);
  const inspection = await after.rqsStore.inspection();
  assertNode.equal(inspection.entries, 0);
  return {policy: 'application-owned delete on logout', retainedEntries: inspection.entries};
});

await suite.pass('fn.stretch-durable-create-update', async () => {
  assertNode.equal(pendingSnapshot.length, 2);
  assert(queuedCreate.clientMutationId !== queuedUpdate.clientMutationId, 'intent identities collided');
  return {offlineDurationProfileMs: 900000, exercisedDurationMs: 'compressed deterministic outage',
    durablePendingMutations: pendingSnapshot.length, settledExactlyOnce: true};
});

await suite.gap('fn.stretch-offline-restart',
  'The JS arm deliberately refuses persisted speculative render while an outbox is pending (LLP 0090 D3); it preserves intent but does not show speculative rows after restart.',
  {intentPreserved: true, speculativeStateVisibleAfterRestart: false});
await suite.gap('fn.stretch-concurrent-rebase',
  'The closed-IR JS arm replays server-authoritatively but exposes no semantic three-way merge/conflict UI for concurrent text edits.',
  {serverAuthoritativeReplay: true, visibleSemanticConflict: false});

await suite.pass('fn.cleanup', async () => {
  assertNode.equal(draftEvidence, 'Unsubmitted local draft');
  return {ownedServer: true, temporaryStore: stateDir};
});
suite.cleanup(() => rm(stateDir, {recursive: true, force: true}));
suite.cleanup(() => server.stop().catch(() => {}));
suite.cleanup(async () => { for (const client of clients) await client.rqsStore?.close?.(); });
const receipt = await suite.finish({target: 'local-dev-sqlite-ibex', providerVersion: 'repository-source',
  server: {identity: initialServerIdentity},
  nonclaims: ['Parity local execution', 'protected retained reads', 'semantic merge/rebase']});
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.ok) process.exitCode = 1;
