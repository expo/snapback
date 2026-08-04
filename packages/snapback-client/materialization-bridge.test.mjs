import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { authorizedLeaseActivationHash } from '@expo/snapback-contract/authorized-lease';

import { SnapbackClient } from './index.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { resultDigestV1 } from './materialization-store.mjs';
import { base64UrlNoPad, hex, jcsBytes, sha256 } from './rqs.mjs';

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

function applicationFixture() {
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
  const nodes = [{
    position: 0,
    nodePlan: {
      format: 'snapback.node-plan.v1',
      classId: 'relational_query_v1',
      classVersion: 1,
    },
    nodePlanHash: digest('4'),
  }];
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
      planHash: digest('8'),
      normalizedCompositePlan: {
        format: 'snapback.normalized-composite-plan.v1',
        profileId: 'single-node.v1',
        nodes,
        mergedArgsContractHash: digest('9'),
        classification: {
          callable: true,
          live: { kind: 'admitted', delivery: 'live_replace', pageDomain: 'cursor-free-first-page' },
          invalidation: 'table-granular-resnapshot',
          retention: 'opaque-authorized-snapshot-v1',
        },
        parentAuthorizationGroups: [],
      },
      resultContract: { kind: 'unknown' },
    },
  };
  Object.defineProperty(ref, 'artifacts', {
    value: Object.freeze({ trustedCompositionActivation }),
    enumerable: false,
  });
  return { privateKey, ref, trustedCompositionActivation };
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
  deploymentIdentity: fixture.trustedCompositionActivation.activation.expectedGeneration,
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

test('P2 public liveQuery establishes, retains, and relaunches authoritative-retained through qmk1', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-materialization-bridge-'));
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
  first.authorizedLeaseQuery = async (_ref, options) => {
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
