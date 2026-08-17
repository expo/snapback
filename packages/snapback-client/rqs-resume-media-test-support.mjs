import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

import { authorizedLeaseActivationHash } from '@expo/snapback-contract/authorized-lease';

import { SnapbackClient } from './index.mjs';
import { resultDigestV1 } from './materialization-store.mjs';
import {
  base64UrlNoPad,
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

export const MEDIA_ROWS_STALE = Object.freeze([Object.freeze({
  _id: 'profile-1',
  avatar: Object.freeze({ assetId: 'asset-old', kind: 'image' }),
})]);

export const MEDIA_ROWS_CURRENT = Object.freeze([Object.freeze({
  _id: 'profile-1',
  avatar: Object.freeze({ assetId: 'asset-new', kind: 'image' }),
})]);

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

function mediaResultContract() {
  return {
    kind: 'documents',
    table: 'profiles',
    document: {
      kind: 'object',
      allowExtra: false,
      fields: [{
        name: '_id',
        required: true,
        value: { kind: 'id', table: 'profiles' },
      }, {
        name: 'avatar',
        required: true,
        value: {
          kind: 'mediaRef.v1',
          sourceTable: 'profiles',
          sourceField: 'avatar',
          sourceFieldGeneration: digest('a'),
          optional: false,
          uploadIntent: 'profileImageUpload',
          policyGeneration: 'profile-image.v1',
          kinds: ['image'],
          delivery: 'primary',
          variants: ['primary'],
          classificationProfile: 'detected-content-type.v1',
          retentionClass: 'media-reference.v1',
          classMTreatment: 'class-m.none.v1',
        },
      }],
    },
  };
}

function createMediaFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const proofKeys = {
    format: 'snapback.completeness-proof-keys.v1',
    keys: [{
      proofKeyId: 'proof-key-media',
      algorithm: 'Ed25519',
      publicKeyBase64url: publicKey.export({ format: 'jwk' }).x,
    }],
  };
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'media-retained-supersession',
    schemaHash: digest('1'),
    bundleHash: digest('2'),
    inputsHash: digest('3'),
  };
  const activation = {
    format: 'snapback.composition-activation.v1',
    databaseId: 'media-retained-stream',
    deploymentId: 'media-retained-deployment',
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
    classId: 'relational_query_v1',
    classVersion: 1,
  };
  const nodes = [{
    position: 0,
    nodePlan,
    nodePlanHash: hashRecord('snapback:node-plan:v1:', nodePlan),
  }];
  const resultContract = mediaResultContract();
  const normalizedCompositePlan = {
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'single-node.v1',
    nodes,
    mergedArgsContractHash: digest('9'),
    classification: {
      callable: true,
      live: {
        kind: 'admitted',
        delivery: 'live_replace',
        pageDomain: 'cursor-free-first-page',
      },
      invalidation: 'table-granular-resnapshot',
      // A media projection reads both the application row and the asset
      // system record, so it deliberately uses protected QMK retention
      // instead of the single-table RQS resume class (LLP 0244 D4).
      retention: 'opaque-authorized-snapshot-v1',
    },
    parentAuthorizationGroups: [],
  };
  const ref = {
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: expectedGeneration.appId,
    id: `${expectedGeneration.appId}:listProfiles`,
    name: 'listProfiles',
    kind: 'LiveQuery',
    implementationHash: digest('5'),
    argsContractHash: digest('6'),
    resultContractHash: digest('7'),
    resultContract,
    expectedGeneration,
    argumentSchema: { type: 'object', additionalProperties: false, properties: {} },
    composition: {
      planHash: hashRecord('snapback:plan-hash:v1:', normalizedCompositePlan),
      normalizedCompositePlan,
      resultContract,
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
  authority: {
    kind: 'humanSession',
    userId: USER,
    sessionId: SESSION,
    isAuthenticated: true,
  },
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

function snapshotResponse(fixture, namespace, rows, version, subscriptionId) {
  const witness = {
    format: 'snapback.authorization-witness.v1',
    queryInstanceId: namespace.queryInstanceId,
    compositeWitness: {
      authorization: { incarnation: INCARNATION, epoch: 0 },
      data: { versionStream: 'media-retained-stream', minCommitVersion: version },
    },
  };
  const page = {
    kind: 'visible',
    input: { kind: 'first' },
    boundaryVectorDigest: digest('b'),
    output: { kind: 'terminal' },
  };
  const proof = {
    format: 'snapback.completeness-proof.v1',
    materializationKey: namespace.queryKey,
    queryInstanceId: namespace.queryInstanceId,
    activationHash: fixture.trustedCompositionActivation.activationHash,
    planHash: fixture.ref.composition.planHash,
    version: { stream: 'media-retained-stream', commit: version },
    authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
    page,
    nodes: fixture.ref.composition.normalizedCompositePlan.nodes.map((node) => ({
      position: node.position,
      classId: node.nodePlan.classId,
      classVersion: node.nodePlan.classVersion,
      nodePlanHash: node.nodePlanHash,
    })),
    batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(version))}`,
    resultDigest: resultDigestV1(jcsBytes(rows)),
    proofKeyId: 'proof-key-media',
    signature: '',
  };
  const { signature: _signature, ...unsigned } = proof;
  proof.signature = base64UrlNoPad(sign(
    null,
    Buffer.from(concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned))),
    fixture.privateKey,
  ));
  return {
    subscription_id: subscriptionId,
    snapshot: { rows, version },
    completenessProof: proof,
    authorizationWitness: witness,
    // A media-bearing plan must never mint a current RQS resume token.
    resume: null,
  };
}

function attachScriptedBackend(client, fixture, current) {
  client.authSession = async () => session(fixture);
  client.currentAuthorizationScope = async () => scope();
  client.unsubscribeLive = async () => ({ disposed: true });
  client.subscribeLive = async (_ref, options) => {
    assert.equal(
      options.resumeFromToken,
      null,
      'media-bearing re-entry must fresh-establish without an RQS token',
    );
    return snapshotResponse(
      fixture,
      options.authorizationNamespace,
      current.rows,
      current.version,
      `media-subscription-${current.version}`,
    );
  };
  client.authorizedLeaseQuery = async (_ref, options) => {
    const now = Date.now();
    return {
      rows: current.rows,
      version: current.version,
      authorizedLease: {
        protocolVersion: 1,
        leaseId: `lease_media_${current.version}`,
        leaseRequestId: options.leaseRequestId,
        issuerId: {
          authorizationIncarnation: INCARNATION,
          bootSequence: 1,
          bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
        },
        clientStoreId: options.authorizationNamespace.clientStoreId,
        queryKey: options.authorizationNamespace.queryKey,
        queryInstanceId: options.authorizationNamespace.queryInstanceId,
        principalId: USER,
        sessionIdAtIssue: SESSION,
        providerKey: 'email-code',
        authorization: { incarnation: INCARNATION, epoch: 0 },
        data: {
          versionStream: 'media-retained-stream',
          snapshotCommitVersion: current.version,
        },
        activationHash: authorizedLeaseActivationHash({
          ...fixture.trustedCompositionActivation.activation.expectedGeneration,
          authMode: 'sessions',
        }),
        issuedAtServerMs: now,
        authorizedUntilServerMs: now + 60_000,
        sessionNotAfterMs: now + 60_000,
        providerNotAfterMs: null,
        authorityInstanceId: AUTHORITY,
        keyId: 'lease-key-media',
        mac: 'A'.repeat(43),
      },
    };
  };
}

export async function exerciseMediaRetainedSupersession(ctx) {
  const fixture = createMediaFixture();
  const backend = {
    rows: structuredClone(MEDIA_ROWS_STALE),
    version: 7,
  };

  // Session A: establish the media-bearing query and persist the protected
  // QMK materialization through the real carrier supplied by the suite.
  const storeA = await ctx.makeStore();
  const clientA = new SnapbackClient('https://media-retained.test', {
    bearerToken: 'sbs_media_retained',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: storeA,
    offlineQueue: false,
  });
  attachScriptedBackend(clientA, fixture, backend);
  let liveA = null;
  try {
    liveA = await clientA.liveQuery(fixture.ref, {
      connectionId: 'media-session-a',
      persistResume: true,
    });
    assert.deepEqual(liveA.rows, MEDIA_ROWS_STALE);
    assert.equal(liveA.freshness, 'current');
    assert.equal(liveA.rqsResume, null);
  } finally {
    await liveA?.dispose();
    await storeA.close();
  }

  // Out-of-band Session 2: a distinct client changes the media field while
  // Session A is closed. The scripted backend keeps server behavior out of
  // scope while preserving the real second-client lifecycle shape.
  const writer = new SnapbackClient('https://media-retained.test', { rqsStore: null });
  writer.mutate = async () => {
    backend.rows = structuredClone(MEDIA_ROWS_CURRENT);
    backend.version = 8;
    return { status: 'committed', version: backend.version };
  };
  await writer.mutate({ kind: 'Mutation', name: 'changeAvatar' }, {
    args: { avatar: MEDIA_ROWS_CURRENT[0].avatar.assetId },
    queue: false,
  });

  // Session B: a fresh client over the same store must render the retained
  // old ref first, then publish the fresh baseline containing the new ref.
  const storeB = await ctx.makeStore();
  const clientB = new SnapbackClient('https://media-retained.test', {
    bearerToken: 'sbs_media_retained',
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorizedLeaseProtocol: 1,
    rqsStore: storeB,
    offlineQueue: false,
  });
  attachScriptedBackend(clientB, fixture, backend);
  const updates = [];
  let liveB = null;
  try {
    liveB = await clientB.liveQuery(fixture.ref, {
      connectionId: 'media-session-b',
      persistResume: true,
      onUpdate: (rows, detail) => updates.push({ rows: structuredClone(rows), detail }),
    });
    // Authority-observation delivery is deliberately isolated from the
    // establishment promise. A fast establishment can therefore return the
    // handle before both consumer frames have crossed that boundary.
    const updateDeadline = Date.now() + 1_000;
    while (updates.length < 2 && Date.now() < updateDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(liveB.rows, MEDIA_ROWS_CURRENT, 'the live handle adopted the fresh baseline');
    assert.equal(liveB.freshness, 'current');
    assert.equal(liveB.rqsResume, null, 'the media-bearing query still has no RQS resume class');
    assert.deepEqual(
      updates.map((update) => update.detail.kind),
      ['materialization_retained', 'snapshot'],
      'the consumer observes retained first paint followed by authoritative supersession',
    );
    assert.deepEqual(updates[0].rows, MEDIA_ROWS_STALE);
    assert.equal(updates[0].detail.freshness, 'retained');
    assert.deepEqual(updates[1].rows, MEDIA_ROWS_CURRENT);
  } finally {
    await liveB?.dispose();
    await storeB.close();
  }
}
