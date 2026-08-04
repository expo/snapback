import { generateKeyPairSync, sign } from 'node:crypto';

import {
  createMaterializationStore,
  pageIdentityDigestV1,
  resultDigestV1,
} from './materialization-store.mjs';
import { base64UrlNoPad, hex, jcsBytes, sha256 } from './rqs.mjs';

const encoder = new TextEncoder();
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

const fence = (record) => ({
  queryInstanceId: record.queryInstanceId,
  authorityGeneration: record.authorityState.authority_generation,
  queryGeneration: record.authorityState.query_generation,
});

export async function createMaterializationTestHarness(handle, label, {
  storageProfile = 'volatile-online-v1',
  bytes = encoder.encode('[{"_id":"successor","value":1}]'),
  freshness = 'current',
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const proofKeys = {
    format: 'snapback.completeness-proof-keys.v1',
    keys: [{
      proofKeyId: 'proof-key-1',
      algorithm: 'Ed25519',
      publicKeyBase64url: publicJwk.x,
    }],
  };
  const activation = {
    format: 'snapback.composition-activation.v1',
    databaseId: 'db-1',
    deploymentId: 'deployment-1',
    targetProfileId: 'native.v1',
    authMode: 'sessions',
    expectedGeneration: {
      schemaVersion: 'snapback.v1',
      appId: 'app-1',
      schemaHash: 'schema-hash',
      bundleHash: 'bundle-hash',
      inputsHash: 'inputs-hash',
    },
    proofKeyManifestDigest: hashRecord('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedActivation = {
    format: 'snapback.trusted-composition-activation.v1',
    activation,
    activationHash: hashRecord('snapback:composition-activation:v1:', activation),
    proofKeys,
  };
  const materializationKey = `qmk1.${base64UrlNoPad(sha256(encoder.encode(label)))}`;
  const address = ['snapback:client-materialization-address:v1', 'client-store-1', materializationKey];
  const nodes = [{
    position: 0,
    classId: 'relational_query_v1',
    classVersion: 1,
    nodePlanHash: digest('1'),
  }];
  const identities = {
    planHash: digest('2'),
    activationHash: trustedActivation.activationHash,
    argsDigest: digest('3'),
    authorityPartitionDigest: digest('4'),
    storageProfile,
    authorityState: {
      query_instance_id: null,
      query_lifecycle: 'active',
      authority_generation: 2,
      query_generation: 4,
      authority_instance_id: 'authority-1',
      expected_boot_issuer: { issuer_id: 'issuer-1', boot_sequence: 1 },
      expected_authorization: {
        incarnation: 'inc-1',
        epoch: 3,
        version_stream: 'stream-1',
      },
      effective_disposition: 'retain',
      accepted: null,
      retired_issuer_frontier: { incarnation: 'inc-1', boot_sequence: 0 },
      retired_scope_frontier: null,
      pending_by_scope: {},
      scope_state: {},
    },
  };
  const context = {
    trustedActivation,
    planHash: identities.planHash,
    nodes,
    resultContractHash: digest('5'),
    resultContract: { kind: 'unknown' },
    authorizationWitness: null,
    authorizationWitnessOwnerProduced: true,
    retentionEligible: true,
    leaseStatus: 'valid',
    authorizedLeaseHash: freshness === 'retained' ? 'lease-hash-1' : null,
  };
  const store = await createMaterializationStore(handle, {
    resolveValidationContext: () => context,
  });

  const establish = async () => {
    let record = await store.initialize(address, identities, null);
    const witness = {
      format: 'snapback.authorization-witness.v1',
      queryInstanceId: record.queryInstanceId,
      compositeWitness: {
        authorization: { incarnation: 'inc-1', epoch: 3 },
        data: { versionStream: 'stream-1', minCommitVersion: 7 },
      },
    };
    context.authorizationWitness = witness;
    const page = {
      kind: 'visible',
      input: { kind: 'first' },
      boundaryVectorDigest: digest('6'),
      output: { kind: 'terminal' },
    };
    const proof = {
      format: 'snapback.completeness-proof.v1',
      materializationKey,
      queryInstanceId: record.queryInstanceId,
      activationHash: record.activationHash,
      planHash: record.planHash,
      version: { stream: 'stream-1', commit: 7 },
      authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
      page,
      nodes,
      batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(7))}`,
      resultDigest: resultDigestV1(bytes),
      proofKeyId: 'proof-key-1',
      signature: '',
    };
    const { signature: _signature, ...unsigned } = proof;
    proof.signature = base64UrlNoPad(sign(
      null,
      Buffer.from(concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned))),
      privateKey,
    ));
    record = await store.commitPage(address, {
      pageIdentityDigest: pageIdentityDigestV1(page),
      resultContractHash: context.resultContractHash,
      bytes,
      authorizedLeaseHash: freshness === 'retained' ? 'lease-hash-1' : null,
      memberships: [],
      freshness,
    }, proof, null, fence(record));
    return record;
  };

  return Object.freeze({ address, bytes, establish, fence, store });
}
