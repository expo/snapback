import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { authorizedLeaseActivationHash } from '@expo/snapback-contract/authorized-lease';

import { SnapbackClient } from './index.mjs';
import {
  deriveGeneratedMaterializationBridge,
  loadMaterializationLeaseCustody,
} from './materialization-bridge.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { rqsEntryKey } from './rqs-store.mjs';
import { resultDigestV1 } from './materialization-store.mjs';
import {
  argsHash,
  base64UrlNoPad,
  digestOfRows,
  hex,
  jcsBytes,
  sha256,
} from './rqs.mjs';

const encoder = new TextEncoder();
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const USER = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7b14-7a22-8c33-445566778899';
const digest = (character) => `sha256:${character.repeat(64)}`;

const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const hashRecord = (domain, value) => (
  `sha256:${hex(sha256(concat(encoder.encode(domain), jcsBytes(value))))}`
);

function applicationFixture({
  classId = 'relational_query_v1',
  retention = 'opaque-authorized-snapshot-v1',
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const proofKeys = {
    format: 'snapback.completeness-proof-keys.v1',
    keys: [{
      proofKeyId: 'proof-key-1',
      algorithm: 'Ed25519',
      publicKeyBase64url: publicKey.export({ format: 'jwk' }).x,
    }],
  };
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'bridge-test-app',
    schemaHash: digest('1'),
    bundleHash: digest('2'),
    inputsHash: digest('3'),
  };
  const activation = {
    format: 'snapback.composition-activation.v1',
    databaseId: 'bridge-stream',
    deploymentId: 'bridge-deployment',
    targetProfileId: 'local-dev-sqlite-ibex',
    authMode: 'sessions',
    expectedGeneration,
    proofKeyManifestDigest: hashRecord('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedCompositionActivation = {
    format: 'snapback.trusted-composition-activation.v1',
    activation,
    activationHash: hashRecord('snapback:composition-activation:v1:', activation),
    proofKeys,
  };
  const nodePlan = {
    format: 'snapback.node-plan.v1',
    classId,
    classVersion: 1,
  };
  const nodes = [{
    position: 0,
    nodePlan,
    nodePlanHash: hashRecord('snapback:node-plan:v1:', nodePlan),
  }];
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'single-node.v1',
    nodes,
    mergedArgsContractHash: digest('9'),
    classification: {
      callable: true,
      live: { kind: 'admitted', delivery: 'live_replace', pageDomain: 'cursor-free-first-page' },
      invalidation: 'table-granular-resnapshot',
      retention,
    },
    parentAuthorizationGroups: [],
  };
  const ref = {
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: expectedGeneration.appId,
    id: 'listRetained',
    name: 'listRetained',
    kind: 'LiveQuery',
    implementationHash: digest('5'),
    argsContractHash: digest('6'),
    resultContractHash: digest('7'),
    expectedGeneration,
    argumentSchema: { type: 'object', additionalProperties: false, properties: {} },
    composition: {
      planHash: hashRecord('snapback:plan-hash:v1:', normalizedCompositePlan),
      normalizedCompositePlan,
      resultContract: { kind: 'unknown' },
    },
  };
  Object.defineProperty(ref, 'artifacts', {
    value: Object.freeze({ trustedCompositionActivation }),
    enumerable: false,
  });
  return { privateKey, ref, trustedCompositionActivation };
}

function v2ApplicationFixture() {
  const fixture = applicationFixture();
  const authoredSourceHash = digest('a');
  const activation = {
    format: 'snapback.composition-activation.v2',
    databaseId: fixture.trustedCompositionActivation.activation.databaseId,
    deploymentId: fixture.trustedCompositionActivation.activation.deploymentId,
    targetProfileId: fixture.trustedCompositionActivation.activation.targetProfileId,
    authMode: fixture.trustedCompositionActivation.activation.authMode,
    authoredSourceHash,
    mintedGeneration: {
      ...fixture.ref.expectedGeneration,
      inputsHash: digest('b'),
    },
    proofKeyManifestDigest: fixture.trustedCompositionActivation.activation.proofKeyManifestDigest,
  };
  const trustedCompositionActivation = {
    ...fixture.trustedCompositionActivation,
    activation,
    activationHash: hashRecord('snapback:composition-activation:v2:', activation),
  };
  const ref = { ...fixture.ref, authoredSourceHash };
  Object.defineProperty(ref, 'artifacts', {
    value: Object.freeze({ trustedCompositionActivation }),
    enumerable: false,
  });
  return { ...fixture, ref, trustedCompositionActivation };
}

const session = (fixture) => ({
  activeMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  clientProtocols: { authInvalidation: 1, authorizedLease: 1 },
  availability: { retainedReads: { available: true } },
  provider: { key: 'email-code', available: true },
  authority: { kind: 'humanSession', userId: USER, sessionId: SESSION, isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY,
    sessionGeneration: 1,
  },
  authorizedLease: {
    protocolVersion: 1,
    defaultMs: 86_400_000,
    hardMaxMs: 86_400_000,
    configuredMs: 60_000,
    clamps: ['session', 'provider'],
    renewal: 'full-revalidation',
    timeBasis: 'server-absolute+client-request-elapsed',
    clockRollback: 'delete-before-read',
  },
  deploymentIdentity: fixture.ref.expectedGeneration,
});

const scope = () => ({
  principalScope: {
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    userId: USER,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY,
    sessionGeneration: 1,
  },
  queryAuthorization: {},
});

function attachAuthority(client, fixture) {
  client.authSession = async () => session(fixture);
  client.currentAuthorizationScope = async () => scope();
  client.unsubscribeLive = async () => ({ disposed: true });
}

test('offline volatile query and liveQuery establishment expose the D4 unknown answer', async (t) => {
  const originalFetch = globalThis.fetch;
  const transportFailure = new TypeError('fetch failed');
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw transportFailure;
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const reference = {
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'offline-query-test',
    id: 'offline-query-test:triageGraph',
    name: 'triageGraph',
    kind: 'LiveQuery',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { boardId: { type: 'string' } },
      required: ['boardId'],
    },
    composition: {
      normalizedCompositePlan: {
        classification: { retention: 'none' },
      },
    },
  };
  const client = new SnapbackClient('https://offline-query.test', {
    rqsStore: false,
    offlineQueue: false,
  });
  let storeRuntimeInvocations = 0;
  client.__storeRuntimeInvoke = async () => {
    storeRuntimeInvocations += 1;
    throw new TypeError('simulated store-runtime chunk rejection');
  };

  await assert.rejects(
    () => client.liveQuery(reference, {
      connectionId: 'offline-query-invalid',
      args: { forged: true },
    }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED');
      assert.equal(error.diagnostic.details.reason, 'unknown object property');
      assert.equal(error.diagnostic.details.path, 'args.forged');
      return true;
    },
  );
  assert.equal(fetchCalls, 0, 'argument validation must precede establishment transport');

  const assertOfflineUnavailable = (error) => {
    assert.equal(error.name, 'SnapbackQueryOfflineUnavailableError');
    assert.equal(error.code, 'SNAPBACK_QUERY_OFFLINE_UNAVAILABLE');
    assert.equal(error.diagnostic.schemaVersion, 'snapback.client-diagnostic.v1');
    assert.equal(error.diagnostic.code, error.code);
    assert.equal(error.diagnostic.severity, 'error');
    assert.equal(error.diagnostic.subsystem, 'client');
    assert.equal(error.diagnostic.details.function, 'triageGraph');
    assert.equal(error.diagnostic.details.retentionClass, 'none');
    assert.equal(error.diagnostic.details.retentionDisposition, 'volatile');
    assert.deepEqual(error.diagnostic.details.localAnswer, {
      answerClass: 'unknown',
      freshness: null,
      reason: 'query retention class "none" does not admit an authoritative retained local answer',
    });
    assert(error.cause instanceof TypeError);
    assert.equal(error.cause.message, 'fetch failed');
    assert.equal(error.cause.fetchDispatchFailed, true);
    return true;
  };

  await assert.rejects(
    () => client.query(reference, { args: { boardId: 'board-1' } }),
    assertOfflineUnavailable,
  );
  await assert.rejects(
    () => client.liveQuery(reference, {
      connectionId: 'offline-query-valid',
      args: { boardId: 'board-1' },
    }),
    assertOfflineUnavailable,
  );
  assert.equal(fetchCalls, 2, 'query and live establishment each reach transport once');
  assert.equal(
    storeRuntimeInvocations,
    0,
    'the root D4 builder types offline failure without depending on the optional chunk',
  );
});

test('unhashed retention/class mutation of a protected composition is refused', () => {
  const fixture = applicationFixture();
  fixture.ref.composition.normalizedCompositePlan.nodes[0].nodePlan.classId = 'single_table_v1';
  fixture.ref.composition.normalizedCompositePlan.classification.retention =
    'rqs-authority-independent-snapshot-v1';
  assert.equal(deriveGeneratedMaterializationBridge({
    ref: fixture.ref,
    args: {},
    clientStoreId: 'tampered-single-table-store',
    authorizationScope: { ...scope(), session: session(fixture) },
    durableCarrier: true,
    persistResume: true,
    authorizedLeaseAvailable: false,
  }), null);
});

test('composition activation v2 uses current generated identity after minted-generation drift', () => {
  const fixture = v2ApplicationFixture();
  const bridge = deriveGeneratedMaterializationBridge({
    ref: fixture.ref,
    args: {},
    clientStoreId: 'v2-rotation-store',
    authorizationScope: { ...scope(), session: session(fixture) },
    durableCarrier: true,
    persistResume: true,
    authorizedLeaseAvailable: true,
  });
  assert(bridge, 'matching authoredSourceHash admits the v2 generated reference');
  assert.notDeepEqual(
    fixture.trustedCompositionActivation.activation.mintedGeneration,
    fixture.ref.expectedGeneration,
  );
  const wrongRef = { ...fixture.ref, authoredSourceHash: digest('c') };
  Object.defineProperty(wrongRef, 'artifacts', {
    value: fixture.ref.artifacts,
    enumerable: false,
  });
  assert.equal(deriveGeneratedMaterializationBridge({
    ref: wrongRef,
    args: {},
    clientStoreId: 'v2-authored-drift-store',
    authorizationScope: { ...scope(), session: session(fixture) },
    durableCarrier: true,
    persistResume: true,
    authorizedLeaseAvailable: true,
  }), null);
});

test('single-table connected prove arm atomically adopts legacy bytes and discards its token', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-single-table-adoption-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = applicationFixture({
    classId: 'single_table_v1',
    retention: 'rqs-authority-independent-snapshot-v1',
  });
  const rows = [{ _id: 'legacy-row', title: 'proved-current' }];
  const legacyResume = {
    token: 'sbrt1.legacy_key.eyJ2ZXJzaW9uIjo3fQ.bGVnYWN5LW1hYw',
    meta: {
      app: fixture.ref.appId,
      version: 7,
      contentDigest: digestOfRows('mset1', rows),
      generation: 'legacy-generation',
      versionStream: 'bridge-stream',
      queryArtifact: digest('e'),
      argsHash: argsHash({}),
    },
  };
  const store = createFileRqsResumeStore({
    directory,
    identity: 'single-table-adoption-owner',
    clientStoreId: 'single-table-adoption-store',
  });
  await store.whenLockSettled();
  const legacyKey = rqsEntryKey(fixture.ref.name, {});
  await store.commit(legacyKey, { rows, ...legacyResume });
  const client = new SnapbackClient('https://single-table-adoption.test', {
    bearerToken: 'sbs_single_table_adoption',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: store,
    offlineQueue: false,
  });
  attachAuthority(client, fixture);
  client.subscribeLive = async (_ref, options) => {
    assert.equal(options.resumeFromToken.resume.token, legacyResume.token);
    assert.equal(Object.hasOwn(options.resumeFromToken, 'membershipWitness'), false);
    const namespace = options.authorizationNamespace;
    const witness = {
      format: 'snapback.authorization-witness.v1',
      queryInstanceId: namespace.queryInstanceId,
      compositeWitness: {
        authorization: { incarnation: INCARNATION, epoch: 0 },
        data: { versionStream: 'bridge-stream', minCommitVersion: 7 },
      },
    };
    const proof = {
      format: 'snapback.completeness-proof.v1',
      materializationKey: namespace.queryKey,
      queryInstanceId: namespace.queryInstanceId,
      activationHash: fixture.trustedCompositionActivation.activationHash,
      planHash: fixture.ref.composition.planHash,
      version: { stream: 'bridge-stream', commit: 7 },
      authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
      page: {
        kind: 'visible',
        input: { kind: 'first' },
        boundaryVectorDigest: digest('a'),
        output: { kind: 'terminal' },
      },
      nodes: fixture.ref.composition.normalizedCompositePlan.nodes.map((node) => ({
        position: node.position,
        classId: node.nodePlan.classId,
        classVersion: node.nodePlan.classVersion,
        nodePlanHash: node.nodePlanHash,
      })),
      batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(9))}`,
      resultDigest: resultDigestV1(jcsBytes(rows)),
      proofKeyId: 'proof-key-1',
      signature: '',
    };
    const { signature: _signature, ...unsigned } = proof;
    proof.signature = base64UrlNoPad(sign(
      null,
      concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned)),
      fixture.privateKey,
    ));
    return {
      subscription_id: 'single-table-proved-current',
      completenessProof: proof,
      authorizationWitness: witness,
      resume: legacyResume,
    };
  };

  const live = await client.liveQuery(fixture.ref, {
    connectionId: 'single-table-adoption-connection',
    persistResume: true,
  });
  assert.deepEqual(live.rows, rows);
  assert.equal(live.freshness, 'current');
  assert.equal(live.answerClass, 'authoritative');
  assert.equal(live.rqsResume, null, 'post-adoption QMK re-entry is fresh in v1');
  assert.equal(await store.load(legacyKey), null);
  await store.materializationTransaction('readonly', (view) => {
    assert.equal(view.materializations.size, 1);
  });
  await live.dispose();
  await store.outboxEnqueue({
    id: 'single-table-pending-intent',
    function: 'writeWhileOffline',
    args: {},
  });
  await store.close();

  const retainedStore = createFileRqsResumeStore({
    directory,
    identity: 'single-table-adoption-owner',
    clientStoreId: 'single-table-adoption-store',
  });
  await retainedStore.whenLockSettled();
  const offline = new SnapbackClient('https://single-table-adoption.test', {
    bearerToken: 'sbs_single_table_adoption',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: retainedStore,
    offlineQueue: false,
  });
  offline.authSession = async () => { throw new TypeError('backend unreachable'); };
  offline.unsubscribeLive = async () => ({ disposed: true });
  offline.subscribeLive = async () => { throw new TypeError('backend unreachable'); };
  const retainedUpdates = [];
  const retained = await offline.liveQuery(fixture.ref, {
    connectionId: 'single-table-retained-pending',
    persistResume: true,
    onUpdate: (_rows, detail) => retainedUpdates.push(detail),
  });
  assert.deepEqual(retained.rows, rows);
  assert.equal(retained.freshness, 'retained');
  assert.equal(retained.rqsResume, null);
  assert.equal(retained.pendingIntentsAtSeed, 1);
  assert.equal(retainedUpdates[0].pendingIntents, 1);
  await retained.dispose();
  await retainedStore.close();
});

test('protected generated liveQuery keeps explicit lease-backed retention and retained relaunch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-materialization-bridge-protected-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = applicationFixture();
  const rows = [{ _id: 'retained-1', title: 'proof-backed' }];
  const openStore = () => createFileRqsResumeStore({
    directory,
    identity: 'bridge-owner',
    clientStoreId: 'bridge-client-store',
  });

  const firstStore = openStore();
  await firstStore.whenLockSettled();
  const first = new SnapbackClient('https://materialization-bridge.test', {
    bearerToken: 'sbs_materialization_bridge',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: firstStore,
    offlineQueue: false,
  });
  attachAuthority(first, fixture);
  let subscribedNamespace = null;
  first.subscribeLive = async (_ref, options) => {
    subscribedNamespace = structuredClone(options.authorizationNamespace);
    const witness = {
      format: 'snapback.authorization-witness.v1',
      queryInstanceId: subscribedNamespace.queryInstanceId,
      compositeWitness: {
        authorization: { incarnation: INCARNATION, epoch: 0 },
        data: { versionStream: 'bridge-stream', minCommitVersion: 7 },
      },
    };
    const page = {
      kind: 'visible',
      input: { kind: 'first' },
      boundaryVectorDigest: digest('a'),
      output: { kind: 'terminal' },
    };
    const proof = {
      format: 'snapback.completeness-proof.v1',
      materializationKey: subscribedNamespace.queryKey,
      queryInstanceId: subscribedNamespace.queryInstanceId,
      activationHash: fixture.trustedCompositionActivation.activationHash,
      planHash: fixture.ref.composition.planHash,
      version: { stream: 'bridge-stream', commit: 7 },
      authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
      page,
      nodes: fixture.ref.composition.normalizedCompositePlan.nodes.map((node) => ({
        position: node.position,
        classId: node.nodePlan.classId,
        classVersion: node.nodePlan.classVersion,
        nodePlanHash: node.nodePlanHash,
      })),
      batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(7))}`,
      resultDigest: resultDigestV1(jcsBytes(rows)),
      proofKeyId: 'proof-key-1',
      signature: '',
    };
    const { signature: _signature, ...unsigned } = proof;
    proof.signature = base64UrlNoPad(sign(
      null,
      Buffer.from(concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned))),
      fixture.privateKey,
    ));
    return {
      subscription_id: 'bridge-subscription-1',
      snapshot: { rows, version: 7 },
      completenessProof: proof,
      authorizationWitness: witness,
    };
  };
  let leaseRequests = 0;
  first.authorizedLeaseQuery = async (_ref, options) => {
    leaseRequests += 1;
    const now = Date.now();
    return {
      rows,
      version: 7,
      authorizedLease: {
        protocolVersion: 1,
        leaseId: 'lease_bridge_1',
        leaseRequestId: options.leaseRequestId,
        issuerId: {
          authorizationIncarnation: INCARNATION,
          bootSequence: 1,
          bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
        },
        clientStoreId: subscribedNamespace.clientStoreId,
        queryKey: subscribedNamespace.queryKey,
        queryInstanceId: subscribedNamespace.queryInstanceId,
        principalId: USER,
        sessionIdAtIssue: SESSION,
        providerKey: 'email-code',
        authorization: { incarnation: INCARNATION, epoch: 0 },
        data: { versionStream: 'bridge-stream', snapshotCommitVersion: 7 },
        activationHash: authorizedLeaseActivationHash({
          ...fixture.trustedCompositionActivation.activation.expectedGeneration,
          authMode: 'sessions',
        }),
        issuedAtServerMs: now,
        authorizedUntilServerMs: now + 60_000,
        sessionNotAfterMs: now + 60_000,
        providerNotAfterMs: null,
        authorityInstanceId: AUTHORITY,
        keyId: 'lease-key-1',
        mac: 'A'.repeat(43),
      },
    };
  };

  const live = await first.liveQuery(fixture.ref, {
    connectionId: 'bridge-connection',
    persistResume: true,
  });
  assert.deepEqual(live.rows, rows);
  assert.equal(live.answerClass, 'authoritative');
  assert.equal(live.freshness, 'current');
  assert.equal(live.retention.retainable, true);
  assert.equal(leaseRequests, 1, 'protected retention still requires its authorized lease');
  assert.match(subscribedNamespace.queryKey, /^qmk1\.[A-Za-z0-9_-]{43}$/u);
  await live.dispose();
  await firstStore.close();

  const secondStore = openStore();
  await secondStore.whenLockSettled();
  const second = new SnapbackClient('https://materialization-bridge.test', {
    bearerToken: 'sbs_materialization_bridge',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: secondStore,
    offlineQueue: false,
  });
  second.authSession = async () => { throw new TypeError('backend unreachable'); };
  second.unsubscribeLive = async () => ({ disposed: true });
  second.subscribeLive = async () => { throw new TypeError('backend unreachable'); };
  const updates = [];
  const retained = await second.liveQuery(fixture.ref, {
    connectionId: 'bridge-connection-relaunch',
    persistResume: true,
    onUpdate: (_nextRows, detail) => updates.push(detail),
  });
  assert.deepEqual(retained.rows, rows);
  assert.equal(retained.answerClass, 'authoritative');
  assert.equal(retained.freshness, 'retained');
  assert.equal(updates[0].kind, 'materialization_retained');
  assert.equal(updates[0].answerClass, 'authoritative');
  assert.equal(updates[0].freshness, 'retained');
  await retained.dispose();
  await secondStore.close();
});
