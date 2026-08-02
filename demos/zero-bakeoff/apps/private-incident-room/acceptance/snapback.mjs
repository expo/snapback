#!/usr/bin/env node
import assertNode from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {SnapbackClient, createExternalSessionClient} from '../../../../_kit/client.mjs';
import {startServer} from '../../../../_kit/server-process.mjs';
import {AuthCoordinator, createMemoryAuthCustodyStorage} from '../../../../../packages/snapback-contract/index.mjs';
import {assert, eventually, createArmSuite, loadAcceptance} from '../../../shared/harness.mjs';
import api from '../snapback/generated/api.mjs';

const appDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(appDir, '../../../..');
const generatedDir = join(appDir, 'snapback', 'generated');
const manifest = await loadAcceptance('private-incident-room');
const suite = createArmSuite({app: 'private-incident-room', provider: 'snapback', manifest,
  evidencePath: join(appDir, 'evidence', 'snapback.v1.json')});
const scratch = await mkdtemp(join(tmpdir(), 'zero-bakeoff-ir-snapback-'));
const readJson = async (name) => JSON.parse(await readFile(join(generatedDir, name), 'utf8'));
const schema = await readJson('schema.manifest.json');
const functions = await readJson('functions.manifest.json');
const startup = join(scratch, 'startup.json');
await writeFile(startup, JSON.stringify({formatVersion: 1, schema, functions}));
const server = await startServer({port: 0, db: ':memory:', cwd: repoRoot,
  startupArtifacts: startup, captureImpersonationCapability: true,
  provenance: {appId: schema.appId, artifactsPath: join(generatedDir, 'artifacts.json')}});
suite.cleanup(() => server.stop());

const sessions = [];
async function mint(id) {
  const coordinator = new AuthCoordinator({appId: schema.appId,
    storage: createMemoryAuthCustodyStorage(), broadcastChannelFactory: null, hintStorage: null});
  const client = new SnapbackClient(server.baseUrl, {authCoordinator: coordinator,
    authInvalidationProtocol: 1, authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1, clientStoreId: `ir-${id}`, rqsStore: null});
  const request = await client.authRequestCode(`${id}@incident.test`);
  const response = await fetch(`${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${request.challengeId}`, {
    headers: {'x-snapback-admin-token': server.adminToken,
      'x-snapback-impersonation-capability': server.impersonationCapability},
  });
  const mailbox = await response.json();
  assert(response.ok, `mailbox failed: ${JSON.stringify(mailbox)}`);
  const credential = await client.authExchange({challengeId: request.challengeId, code: mailbox.code});
  const capture = coordinator.capture();
  const bearer = coordinator.credentialFor(capture).bearer;
  const value = {id, client, coordinator, bearer, userId: credential.session.userId};
  sessions.push(value);
  return value;
}
suite.cleanup(async () => {
  for (const session of sessions) {
    await session.client.rqsStore?.close?.();
    await session.coordinator.close?.();
  }
});

const [alice, bob, oscar, mallory] = await Promise.all(['alice','bob','oscar','mallory'].map(mint));
const ext = (session, suffix) => createExternalSessionClient(server.baseUrl, {
  bearerToken: session.bearer, clientStoreId: `ir-${session.id}-${suffix}`, rqsStore: null,
});
const aliceClient = ext(alice, 'main');
const bobClient = ext(bob, 'main');
const oscarClient = ext(oscar, 'main');
const malloryClient = ext(mallory, 'main');
const handles = [];
const incidentIds = [];

await suite.pass('ir.read-visibility', async () => {
  for (let index = 0; index < 10; index += 1) {
    const created = await aliceClient.mutate(api.createIncident, {args: {title: `Incident ${index + 1}`, severity: index % 2 ? 'sev2' : 'sev1'}});
    incidentIds.push(created.result);
    await aliceClient.mutate(api.addParticipant, {args: {incidentId: created.result, userId: bob.userId, role: 'responder'}});
    await aliceClient.mutate(api.addParticipant, {args: {incidentId: created.result, userId: oscar.userId, role: 'observer'}});
  }
  const joined = await bobClient.query(api.incidentMessages, {args: {incidentId: incidentIds[0]}});
  const observed = await oscarClient.query(api.incidentMessages, {args: {incidentId: incidentIds[0]}});
  const outsider = await malloryClient.query(api.incidentMessages, {args: {incidentId: incidentIds[0]}});
  assertNode.equal(joined.rows.length, 1);
  assertNode.equal(observed.rows.length, 1);
  assertNode.deepEqual(outsider.rows, []);
  return {fixtureIncidents: incidentIds.length, outsiderDeliveredRows: outsider.rows.length};
});

await suite.pass('ir.write-authority', async () => {
  await bobClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'Responder update'}});
  await assertNode.rejects(() => oscarClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'observer write'}}),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED');
  await assertNode.rejects(() => malloryClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'outsider write'}}),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED');
  return {observerReadOnly: true, outsiderDenied: true};
});

await suite.pass('ir.cross-client-live', async () => {
  for (const [label, client] of [['alice', aliceClient], ['bob', bobClient], ['oscar', oscarClient]]) {
    handles.push(await client.liveQuery(api.incidentMessages, {args: {incidentId: incidentIds[0]},
      connectionId: `ir-${label}-live`, transport: 'stream', fallbackToPoll: false}));
  }
  await aliceClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'Live commander update'}});
  await eventually(() => handles.every((handle) => handle.rows.some((row) => row.body === 'Live commander update')),
    {label: 'three authorized live clients'});
  return {clients: 3, transport: 'Snapback durable WebSocket stream'};
});

await suite.pass('ir.revocation-retirement', async () => {
  const started = performance.now();
  await bobClient.mutate(api.removeParticipant, {args: {incidentId: incidentIds[0], userId: bob.userId}});
  await eventually(() => handles[1].rows.length === 0, {timeoutMs: 8_000, label: 'revoked responder result retirement'});
  await aliceClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'After Bob revocation'}});
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  assert(!handles[1].rows.some((row) => row.body === 'After Bob revocation'), 'future row crossed revocation');
  return {retirementMs: performance.now() - started, retainedRows: handles[1].rows.length};
});

await suite.pass('ir.pending-write-revocation', async () => {
  const intent = new Promise((resolvePromise) => setTimeout(resolvePromise, 75)).then(() =>
    bobClient.mutate(api.postMessage, {args: {incidentId: incidentIds[0], body: 'Delayed revoked intent'}}));
  await assertNode.rejects(intent, (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED');
  const rows = await aliceClient.query(api.incidentMessages, {args: {incidentId: incidentIds[0]}});
  assert(!rows.rows.some((row) => row.body === 'Delayed revoked intent'), 'revoked intent committed');
  return {authorityCheckedAtExecution: true, transportDelaySimulatedClientSide: true};
});

await suite.pass('ir.user-switch-custody', async () => {
  const switchClient = ext(bob, 'switch');
  const handle = await switchClient.liveQuery(api.incidentMessages, {args: {incidentId: incidentIds[1]},
    connectionId: 'ir-user-switch', transport: 'stream', fallbackToPoll: false});
  handles.push(handle);
  assert(handle.rows.length > 0, 'predecessor result missing');
  try { await switchClient.replaceBearerToken(mallory.bearer); } catch (error) {
    const codes = (error instanceof AggregateError ? error.errors : [error]).map((item) => item?.diagnostic?.code);
    assert(codes.every((code) => code === 'SNAPBACK_UNKNOWN_SUBSCRIPTION'), `unexpected switch cleanup: ${codes}`);
  }
  assertNode.deepEqual(handle.rows, []);
  const outsider = await switchClient.query(api.incidentMessages, {args: {incidentId: incidentIds[1]}});
  assertNode.deepEqual(outsider.rows, []);
  return {predecessorRowsBlanked: true, successorDeliveredRows: 0};
});

await suite.pass('ir.out-of-band-permission-change', async () => {
  await aliceClient.mutate(api.addParticipant, {args: {incidentId: incidentIds[0], userId: bob.userId, role: 'responder'}});
  const outOfBand = ext(bob, 'other-context');
  const live = await bobClient.liveQuery(api.incidentMessages, {args: {incidentId: incidentIds[0]},
    connectionId: 'ir-oob-bob', transport: 'stream', fallbackToPoll: false});
  handles.push(live);
  assert(live.rows.length > 0, 'rejoined responder did not receive room');
  const started = performance.now();
  await outOfBand.mutate(api.removeParticipant, {args: {incidentId: incidentIds[0], userId: bob.userId}});
  await eventually(() => live.rows.length === 0, {timeoutMs: 8_000, label: 'out-of-band revocation'});
  return {observedWithinMs: performance.now() - started, boundMs: 8_000};
});

await suite.pass('ir.cleanup', async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
  assertNode.equal(handles.length, 0);
  return {disposedLiveHandles: 5, ownedServer: true};
});

const receipt = await suite.finish({target: 'local-dev-sqlite-ibex', providerVersion: 'repository-source',
  server: {identity: server.identity},
  nonclaims: ['hosted auth', 'hostile-device byte secrecy', 'protected offline retention']});
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.ok) process.exitCode = 1;
