import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import {
  completenessProofDigestV1,
  createMaterializationStore,
  decodeMaterializationRecordV1,
  deriveCompletenessStatusV1,
  encodeMaterializationRecordV1,
  materializationAddressKey,
  pageIdentityDigestV1,
  resultDigestV1,
  verifyFiniteCompletenessCarrierV1,
} from './materialization-store.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import { base64UrlNoPad, hex, jcsBytes, sha256 } from './rqs.mjs';

const encoder = new TextEncoder();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

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

const qmk = (label) => `qmk1.${base64UrlNoPad(sha256(encoder.encode(label)))}`;
const digest = (character) => `sha256:${character.repeat(64)}`;

function makeAuthorityState({ incarnation = 'inc-1', epoch = 3, stream = 'stream-1' } = {}) {
  return {
    query_instance_id: null,
    query_lifecycle: 'active',
    authority_generation: 2,
    query_generation: 4,
    authority_instance_id: 'authority-1',
    expected_boot_issuer: { issuer_id: 'issuer-1', boot_sequence: 1 },
    expected_authorization: {
      incarnation,
      epoch,
      version_stream: stream,
    },
    effective_disposition: 'retain',
    accepted: null,
    retired_issuer_frontier: { incarnation, boot_sequence: 0 },
    retired_scope_frontier: null,
    pending_by_scope: {},
    scope_state: {},
  };
}

function ownerTransition(record, disposition, { lifecycle = 'active', generation = 1 } = {}) {
  return {
    authorityState: {
      ...structuredClone(record.authorityState),
      query_lifecycle: lifecycle,
      query_generation: record.authorityState.query_generation + generation,
      effective_disposition: disposition,
    },
    tombstone: { revision: record.authorityState.query_generation + generation },
  };
}

function makeFixture(label = 'fixture', { activationVersion = 1 } = {}) {
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
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'app-1',
    schemaHash: 'schema-hash',
    bundleHash: 'bundle-hash',
    inputsHash: 'inputs-hash',
  };
  const activation = activationVersion === 1 ? {
    format: 'snapback.composition-activation.v1',
    databaseId: 'db-1',
    deploymentId: 'deployment-1',
    targetProfileId: 'native.v1',
    authMode: 'sessions',
    expectedGeneration,
    proofKeyManifestDigest: hashRecord('snapback:completeness-proof-keys:v1:', proofKeys),
  } : {
    format: 'snapback.composition-activation.v2',
    databaseId: 'db-1',
    deploymentId: 'deployment-1',
    targetProfileId: 'native.v1',
    authMode: 'sessions',
    authoredSourceHash: digest('a'),
    mintedGeneration: { ...expectedGeneration, inputsHash: 'minted-inputs-hash' },
    proofKeyManifestDigest: hashRecord('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedActivation = {
    format: 'snapback.trusted-composition-activation.v1',
    activation,
    activationHash: hashRecord(
      `snapback:composition-activation:v${activationVersion}:`,
      activation,
    ),
    proofKeys,
  };
  const materializationKey = qmk(label);
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
    storageProfile: 'durable-fragments-v1',
    authorityState: makeAuthorityState(),
  };
  const resultContractHash = digest('5');
  const resultContract = { kind: 'unknown' };
  const context = {
    trustedActivation,
    planHash: identities.planHash,
    nodes,
    resultContractHash,
    resultContract,
    authorizationWitness: null,
    authorizationWitnessOwnerProduced: true,
    retentionEligible: true,
    leaseStatus: 'valid',
    authorizedLeaseHash: 'lease-hash-1',
    ownerTransitionForRetainedFailure(reason, record) {
      return ownerTransition(
        record,
        reason === 'witness-newer-epoch' ? 'quarantine' : 'delete',
      );
    },
  };

  const makeWitness = (queryInstanceId, overrides = {}) => ({
    format: 'snapback.authorization-witness.v1',
    queryInstanceId,
    compositeWitness: {
      authorization: {
        incarnation: overrides.incarnation ?? 'inc-1',
        epoch: overrides.epoch ?? 3,
      },
      data: overrides.data === undefined
        ? { versionStream: overrides.stream ?? 'stream-1', minCommitVersion: overrides.floor ?? 7 }
        : overrides.data,
    },
  });

  const makePage = ({
    input = { kind: 'first' },
    output = { kind: 'terminal' },
    boundary = digest('6'),
  } = {}) => ({
    kind: 'visible',
    input,
    boundaryVectorDigest: boundary,
    output,
  });

  const makeProof = (record, {
    page = makePage(),
    bytes = encoder.encode('[{"_id":"r1","v":1}]'),
    queryInstanceId = record.queryInstanceId,
    activationHash = record.activationHash,
    planHash = record.planHash,
    stream = 'stream-1',
    commit = 7,
    witness = makeWitness(record.queryInstanceId),
    proofNodes = nodes,
    keyId = 'proof-key-1',
  } = {}) => {
    const proof = {
      format: 'snapback.completeness-proof.v1',
      materializationKey,
      queryInstanceId,
      activationHash,
      planHash,
      version: { stream, commit },
      authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
      page,
      nodes: proofNodes,
      batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(7))}`,
      resultDigest: resultDigestV1(bytes),
      proofKeyId: keyId,
      signature: '',
    };
    const { signature: _signature, ...unsigned } = proof;
    proof.signature = base64UrlNoPad(sign(
      null,
      Buffer.from(concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned))),
      privateKey,
    ));
    return { proof, page, bytes, witness };
  };

  const fragmentFor = ({ proof, page, bytes }, freshness = 'current') => ({
    pageIdentityDigest: pageIdentityDigestV1(page),
    resultContractHash,
    bytes,
    authorizedLeaseHash: freshness === 'retained' ? 'lease-hash-1' : null,
    memberships: [{
      localRowHandle: 'row-occurrence-1',
      materializationKey,
      pageIdentityDigest: pageIdentityDigestV1(page),
    }],
    freshness,
  });

  return {
    address,
    identities,
    context,
    trustedActivation,
    makeWitness,
    makePage,
    makeProof,
    fragmentFor,
  };
}

async function setupCarrier(t, kind, label) {
  if (kind === 'memory') {
    const handle = createMemoryRqsResumeStore({ clientStoreId: 'client-store-1' });
    await handle.whenLockSettled();
    t.after(() => handle.close());
    return handle;
  }
  if (kind === 'file') {
    const directory = await mkdtemp(join(tmpdir(), `snapback-materialization-${label}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const handle = createFileRqsResumeStore({ directory, clientStoreId: 'client-store-1' });
    await handle.whenLockSettled();
    t.after(() => handle.close());
    return handle;
  }
  const handle = createIndexedDbRqsResumeStore({
    indexedDB: new IDBFactory(),
    lockManager: grantingLocks,
    databaseName: `materialization-${label}`,
    clientStoreId: 'client-store-1',
  });
  await tick();
  await handle.readStoreMeta();
  t.after(() => handle.close());
  return handle;
}

function fence(record) {
  return {
    queryInstanceId: record.queryInstanceId,
    authorityGeneration: record.authorityState.authority_generation,
    queryGeneration: record.authorityState.query_generation,
  };
}

async function openSemantic(handle, fixture) {
  return createMaterializationStore(handle, {
    resolveValidationContext: () => fixture.context,
    resolveRetirementTransition({ phase, record }) {
      if (phase === 'begin') return ownerTransition(record, 'delete', { lifecycle: 'retiring' });
      return { remove: true };
    },
  });
}

for (const carrier of ['file', 'indexeddb']) {
  test(`single-table legacy adoption atomically switches stores and waits for outbox on ${carrier}`, async (t) => {
    const handle = await setupCarrier(t, carrier, `single-table-adoption-${carrier}`);
    const fixture = makeFixture(`single-table-adoption-${carrier}`);
    fixture.context.nodes[0].classId = 'single_table_v1';
    fixture.context.retentionAuthority = 'rqs-authority-independent-snapshot-v1';
    fixture.context.leaseStatus = 'not-required';
    fixture.context.authorizedLeaseHash = null;
    const store = await openSemantic(handle, fixture);
    let record = await store.initialize(fixture.address, fixture.identities, null);
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: { kind: 'first' } },
      fence(record),
    );
    const valid = fixture.makeProof(record);
    fixture.context.authorizationWitness = valid.witness;
    const legacyKey = `legacy-single-table-${carrier}`;
    const legacyRecord = {
      rows: [{ _id: 'r1', v: 1 }],
      meta: { contentDigest: 'mset1:legacy', version: 7 },
      token: 'legacy-token-bytes-remain-opaque',
      bytes: 128,
      savedAt: 1,
      resumedAt: 0,
      inProgress: false,
    };
    await handle.materializationTransaction('readwrite', (view) => {
      view.entries.set(legacyKey, structuredClone(legacyRecord));
    });
    const fragment = {
      ...fixture.fragmentFor(valid, 'retained'),
      authorizedLeaseHash: null,
      memberships: [],
    };
    record = await store.commitLegacyAdoption(
      fixture.address,
      legacyKey,
      legacyRecord,
      fragment,
      valid.proof,
      null,
      fence(record),
    );
    assert.equal(record.productState.freshness, 'retained');
    assert.equal(record.fragments[0].authorizedLeaseHash, null);
    assert.equal(deriveCompletenessStatusV1(record), 'complete');
    await handle.materializationTransaction('readonly', (view) => {
      assert.equal(view.entries.has(legacyKey), false);
    });

    const blockedFixture = makeFixture(`single-table-adoption-blocked-${carrier}`);
    blockedFixture.context.nodes[0].classId = 'single_table_v1';
    blockedFixture.context.retentionAuthority = 'rqs-authority-independent-snapshot-v1';
    blockedFixture.context.leaseStatus = 'not-required';
    blockedFixture.context.authorizedLeaseHash = null;
    const blockedStore = await openSemantic(handle, blockedFixture);
    let blocked = await blockedStore.initialize(
      blockedFixture.address,
      blockedFixture.identities,
      null,
    );
    blocked = await blockedStore.beginEstablishment(
      blockedFixture.address,
      { kind: 'page', input: { kind: 'first' } },
      fence(blocked),
    );
    const blockedProof = blockedFixture.makeProof(blocked);
    blockedFixture.context.authorizationWitness = blockedProof.witness;
    const blockedKey = `legacy-single-table-blocked-${carrier}`;
    const blockedLegacy = { ...legacyRecord, token: 'blocked-legacy-token' };
    await handle.materializationTransaction('readwrite', (view) => {
      view.entries.set(blockedKey, structuredClone(blockedLegacy));
    });
    await handle.outboxEnqueue({
      id: `single-table-pending-${carrier}`,
      function: 'writeWhileOffline',
      args: {},
    });
    await assert.rejects(
      blockedStore.commitLegacyAdoption(
        blockedFixture.address,
        blockedKey,
        blockedLegacy,
        {
          ...blockedFixture.fragmentFor(blockedProof, 'retained'),
          authorizedLeaseHash: null,
          memberships: [],
        },
        blockedProof.proof,
        null,
        fence(blocked),
      ),
      (error) => error?.code === 'SNAPBACK_SINGLE_TABLE_ADOPTION_PENDING_OUTBOX',
    );
    await handle.materializationTransaction('readonly', (view) => {
      assert.deepEqual(view.entries.get(blockedKey), blockedLegacy);
      const stored = decodeMaterializationRecordV1(
        view.materializations.get(materializationAddressKey(blockedFixture.address)),
      );
      assert.equal(stored.fragments.length, 0);
    });
  });
}

test('lease-free retention refuses a signed proof for a non-public-exact class', async (t) => {
  const handle = await setupCarrier(t, 'file', 'independent-class-refusal');
  const fixture = makeFixture('independent-class-refusal');
  fixture.context.retentionAuthority = 'rqs-authority-independent-snapshot-v1';
  fixture.context.leaseStatus = 'not-required';
  fixture.context.authorizedLeaseHash = null;
  const store = await openSemantic(handle, fixture);
  let record = await store.initialize(fixture.address, fixture.identities, null);
  record = await store.beginEstablishment(
    fixture.address,
    { kind: 'page', input: { kind: 'first' } },
    fence(record),
  );
  const signedProtected = fixture.makeProof(record);
  fixture.context.authorizationWitness = signedProtected.witness;
  await assert.rejects(
    store.commitPage(
      fixture.address,
      {
        ...fixture.fragmentFor(signedProtected, 'retained'),
        authorizedLeaseHash: null,
      },
      signedProtected.proof,
      null,
      fence(record),
    ),
    (error) => error?.code === 'SNAPBACK_COMPLETENESS_LEASE_INVALID',
  );
});

test('A5 installs Rust-server golden proof bytes and rejects binding near misses', async (t) => {
  const fixture = JSON.parse(await readFile(
    new URL('../../tests/conformance/completeness-proof-v1.json', import.meta.url),
    'utf8',
  ));
  const handle = await setupCarrier(t, 'memory', 'server-proof-golden');
  for (let allocated = 1; allocated < fixture.proof.queryInstanceId; allocated += 1) {
    assert.equal(await handle.allocateQueryInstanceId(), allocated);
  }
  const bytes = new Uint8Array(Buffer.from(fixture.resultBytesBase64url, 'base64url'));
  const context = {
    trustedActivation: fixture.trustedActivation,
    planHash: fixture.proof.planHash,
    nodes: fixture.proof.nodes,
    resultContractHash: digest('5'),
    resultContract: { kind: 'unknown' },
    authorizationWitness: fixture.witness,
    authorizationWitnessOwnerProduced: true,
    retentionEligible: true,
    leaseStatus: 'valid',
  };
  const address = [
    'snapback:client-materialization-address:v1',
    'client-store-server-fixture',
    fixture.proof.materializationKey,
  ];
  const store = await createMaterializationStore(handle, {
    resolveValidationContext: () => context,
  });
  let record = await store.initialize(address, {
    planHash: fixture.proof.planHash,
    activationHash: fixture.proof.activationHash,
    argsDigest: digest('3'),
    authorityPartitionDigest: digest('4'),
    storageProfile: 'volatile-online-v1',
    authorityState: makeAuthorityState({ incarnation: 'inc-1', epoch: 9, stream: 'stream-1' }),
  }, null);
  assert.equal(record.queryInstanceId, fixture.proof.queryInstanceId);
  record = await store.beginEstablishment(
    address,
    { kind: 'page', input: { kind: 'first' } },
    fence(record),
  );
  const fragment = {
    pageIdentityDigest: fixture.pageIdentityDigest,
    resultContractHash: context.resultContractHash,
    bytes,
    authorizedLeaseHash: null,
    memberships: [],
    freshness: 'current',
  };
  record = await store.commitPage(address, fragment, fixture.proof, null, fence(record));
  assert.equal(deriveCompletenessStatusV1(record), 'complete');
  assert.deepEqual(await store.readRenderable(address, fence(record)), bytes);

  const invalidProofs = [
    { ...fixture.proof, signature: `${fixture.proof.signature.slice(0, -1)}B` },
    { ...fixture.proof, queryInstanceId: fixture.proof.queryInstanceId + 1 },
    { ...fixture.proof, version: { ...fixture.proof.version, stream: 'wrong-stream' } },
    { ...fixture.proof, version: { ...fixture.proof.version, commit: 40 } },
  ];
  for (const proof of invalidProofs) {
    await assert.rejects(
      store.commitPage(address, fragment, proof, null, fence(record)),
      (error) => error?.code?.startsWith('SNAPBACK_COMPLETENESS_'),
    );
  }
  for (const witness of [
    { ...fixture.witness, compositeWitness: {
      ...fixture.witness.compositeWitness,
      authorization: { incarnation: 'wrong-incarnation', epoch: 9 },
    } },
    { ...fixture.witness, compositeWitness: {
      ...fixture.witness.compositeWitness,
      authorization: { incarnation: 'inc-1', epoch: 8 },
    } },
    { ...fixture.witness, compositeWitness: {
      ...fixture.witness.compositeWitness,
      data: { versionStream: 'wrong-stream', minCommitVersion: 41 },
    } },
    { ...fixture.witness, compositeWitness: {
      ...fixture.witness.compositeWitness,
      data: { versionStream: 'stream-1', minCommitVersion: 44 },
    } },
  ]) {
    context.authorizationWitness = witness;
    await assert.rejects(
      store.commitPage(address, fragment, fixture.proof, null, fence(record)),
      (error) => error?.code?.startsWith('SNAPBACK_COMPLETENESS_'),
    );
  }
});

test('finite carriers verify Rust-minted proof bytes and reject tamper or wrong identity', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../../tests/conformance/completeness-proof-v1.json', import.meta.url),
    'utf8',
  ));
  const resultBytes = new Uint8Array(Buffer.from(fixture.resultBytesBase64url, 'base64url'));
  const context = {
    trustedActivation: fixture.trustedActivation,
    materializationKey: fixture.proof.materializationKey,
    queryInstanceId: fixture.proof.queryInstanceId,
    planHash: fixture.proof.planHash,
    nodes: fixture.proof.nodes,
    resultBytes,
    resultContractHash: digest('5'),
    resultContract: { kind: 'unknown' },
    authorizationWitnessOwnerProduced: true,
    authorization: {
      incarnation: fixture.witness.compositeWitness.authorization.incarnation,
      epoch: fixture.witness.compositeWitness.authorization.epoch,
      versionStream: fixture.witness.compositeWitness.data.versionStream,
    },
    pageIdentityDigest: fixture.pageIdentityDigest,
    expectedVersion: fixture.proof.version,
  };
  const carrier = {
    completenessProof: fixture.proof,
    authorizationWitness: fixture.witness,
  };
  const verified = await verifyFiniteCompletenessCarrierV1(carrier, context);
  assert.deepEqual(verified.proof, fixture.proof);
  assert.deepEqual(verified.authorizationWitness, fixture.witness);
  assert.equal(verified.pageSetManifest, null);

  await assert.rejects(
    verifyFiniteCompletenessCarrierV1({
      ...carrier,
      completenessProof: {
        ...fixture.proof,
        signature: `${fixture.proof.signature.slice(0, -1)}B`,
      },
    }, context),
    (error) => error?.code?.startsWith('SNAPBACK_COMPLETENESS_'),
  );
  await assert.rejects(
    verifyFiniteCompletenessCarrierV1(carrier, {
      ...context,
      materializationKey: qmk('wrong-finite-identity'),
    }),
    (error) => error?.code === 'SNAPBACK_COMPLETENESS_BINDING_INVALID',
  );
});

test('v2 trusted activation verifies proof custody with provenance generation drift', async (t) => {
  const handle = await setupCarrier(t, 'memory', 'v2-trusted-activation');
  const fixture = makeFixture('v2-trusted-activation', { activationVersion: 2 });
  fixture.identities.storageProfile = 'volatile-online-v1';
  const store = await openSemantic(handle, fixture);
  let record = await store.initialize(fixture.address, fixture.identities, null);
  const valid = fixture.makeProof(record);
  fixture.context.authorizationWitness = valid.witness;
  record = await store.beginEstablishment(
    fixture.address,
    { kind: 'page', input: { kind: 'first' } },
    fence(record),
  );
  record = await store.commitPage(
    fixture.address,
    fixture.fragmentFor(valid),
    valid.proof,
    null,
    fence(record),
  );
  assert.equal(deriveCompletenessStatusV1(record), 'complete');
});

for (const carrier of ['memory', 'file', 'indexeddb']) {
  test(`A5 proof installation and invalid-proof refusals are atomic on ${carrier}`, async (t) => {
    const handle = await setupCarrier(t, carrier, `a5-${carrier}`);
    const fixture = makeFixture(`a5-${carrier}`);
    if (carrier === 'memory') fixture.identities.storageProfile = 'volatile-online-v1';
    const store = await openSemantic(handle, fixture);
    let record = await store.initialize(fixture.address, fixture.identities, null);
    const valid = fixture.makeProof(record);
    fixture.context.authorizationWitness = valid.witness;
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: { kind: 'first' } },
      fence(record),
    );
    record = await store.commitPage(
      fixture.address,
      fixture.fragmentFor(valid),
      valid.proof,
      null,
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'complete');
    assert.deepEqual(
      decodeMaterializationRecordV1(encodeMaterializationRecordV1(record)),
      record,
    );
    assert.deepEqual(await store.readRenderable(fixture.address, fence(record)), valid.bytes);
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: { kind: 'first' } },
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'complete');
    record = await store.recordAttemptOutcome(
      fixture.address,
      { kind: 'transient' },
      fence(record),
    );
    const otherInput = { kind: 'cursor', profileId: 'relational-query.v1', digest: digest('d') };
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: otherInput },
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'unknown');
    const v2BatchInput = { kind: 'cursor', profileId: 'snapshot-batch.v2', digest: digest('e') };
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: v2BatchInput },
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'unknown');
    record = await store.recordAttemptOutcome(
      fixture.address,
      { kind: 'refused', code: 'SNAPBACK_TEST_REFUSAL', fallback: null },
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'refused');
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page', input: { kind: 'first' } },
      fence(record),
    );
    assert.equal(deriveCompletenessStatusV1(record), 'complete');
    if (carrier === 'memory') {
      await assert.rejects(
        store.commitPage(
          fixture.address,
          fixture.fragmentFor(valid, 'retained'),
          valid.proof,
          null,
          fence(record),
        ),
        (error) => (
          error.code === 'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP'
          && error.diagnostic.details.requiredCapability === 'durable_fragments_v1'
        ),
      );
    }

    const invalidCases = [
      ['tampered signature', (entry) => ({
        ...entry,
        signature: `${entry.signature[0] === 'A' ? 'B' : 'A'}${entry.signature.slice(1)}`,
      })],
      ['wrong instance', (entry) => ({ ...entry, queryInstanceId: entry.queryInstanceId + 1 })],
      ['wrong activation', (entry) => ({ ...entry, activationHash: digest('a') })],
      ['wrong plan', (entry) => ({ ...entry, planHash: digest('b') })],
      ['wrong stream', (entry) => ({ ...entry, version: { stream: 'other-stream', commit: 7 } })],
      ['commit below witness floor', (entry) => ({ ...entry, version: { stream: 'stream-1', commit: 6 } })],
      ['wrong node binding', (entry) => ({ ...entry, nodes: [{ ...entry.nodes[0], nodePlanHash: digest('c') }] })],
    ];
    for (const [name, mutate] of invalidCases) {
      await assert.rejects(
        store.commitPage(
          fixture.address,
          fixture.fragmentFor(valid),
          mutate(valid.proof),
          null,
          fence(record),
        ),
        (error) => error?.code?.startsWith('SNAPBACK_COMPLETENESS_'),
        name,
      );
      assert.deepEqual(await store.readRenderable(fixture.address, fence(record)), valid.bytes);
    }

    fixture.context.publicationAdmitted = false;
    await assert.rejects(
      store.commitPage(
        fixture.address,
        fixture.fragmentFor(valid),
        valid.proof,
        null,
        fence(record),
      ),
      (error) => error?.code === 'SNAPBACK_MATERIALIZATION_AUTHORITY_STALE',
      'an authority barrier that lands during async proof verification fences the final commit',
    );
    fixture.context.publicationAdmitted = true;
    assert.deepEqual(await store.readRenderable(fixture.address, fence(record)), valid.bytes);

    for (const [name, witness] of [
      ['wrong authorization incarnation', fixture.makeWitness(record.queryInstanceId, { incarnation: 'inc-other' })],
      ['wrong authorization epoch', fixture.makeWitness(record.queryInstanceId, { epoch: 2 })],
      ['wrong authorization stream', fixture.makeWitness(record.queryInstanceId, { stream: 'stream-other' })],
    ]) {
      fixture.context.authorizationWitness = witness;
      const candidate = fixture.makeProof(record, { witness, stream: witness.compositeWitness.data.versionStream });
      await assert.rejects(
        store.commitPage(
          fixture.address,
          fixture.fragmentFor(candidate),
          candidate.proof,
          null,
          fence(record),
        ),
        (error) => error?.code?.startsWith('SNAPBACK_COMPLETENESS_'),
        name,
      );
    }

    fixture.context.authorizationWitness = valid.witness;
    const noncanonical = fixture.makeProof(record, {
      bytes: encoder.encode('[{ "_id":"r1","v":1}]'),
    });
    await assert.rejects(
      store.commitPage(
        fixture.address,
        fixture.fragmentFor(noncanonical),
        noncanonical.proof,
        null,
        fence(record),
      ),
      (error) => error.code === 'SNAPBACK_COMPLETENESS_RESULT_INVALID',
    );

    fixture.context.authorizationWitnessOwnerProduced = false;
    fixture.context.authorizationWitness = fixture.makeWitness(record.queryInstanceId, { data: null });
    const clientNull = fixture.makeProof(record, { witness: fixture.context.authorizationWitness });
    await assert.rejects(
      store.commitPage(
        fixture.address,
        fixture.fragmentFor(clientNull),
        clientNull.proof,
        null,
        fence(record),
      ),
      (error) => error.code === 'SNAPBACK_COMPLETENESS_WITNESS_INVALID',
    );
  });
}

test('page-set manifest validates a same-version first-to-terminal proof chain', async (t) => {
  const handle = await setupCarrier(t, 'memory', 'page-set');
  const fixture = makeFixture('page-set');
  fixture.identities.storageProfile = 'volatile-online-v1';
  const store = await openSemantic(handle, fixture);
  let record = await store.initialize(fixture.address, fixture.identities, null);
  const cursor = { kind: 'cursor', profileId: 'relational-query.v1', digest: digest('7') };
  const first = fixture.makeProof(record, { page: fixture.makePage({ output: cursor }) });
  const last = fixture.makeProof(record, {
    page: fixture.makePage({ input: cursor, boundary: digest('8') }),
  });
  fixture.context.authorizationWitness = first.witness;
  record = await store.commitPage(fixture.address, fixture.fragmentFor(first), first.proof, null, fence(record));
  record = await store.commitPage(fixture.address, {
    ...fixture.fragmentFor(last),
    memberships: [{
      ...fixture.fragmentFor(last).memberships[0],
      localRowHandle: 'row-occurrence-2',
    }],
  }, last.proof, null, fence(record));
  record = await store.beginEstablishment(
    fixture.address,
    { kind: 'page-set', from: 'first', through: 'terminal' },
    fence(record),
  );
  const orderedProofDigests = [
    completenessProofDigestV1(first.proof),
    completenessProofDigestV1(last.proof),
  ];
  const identity = hashRecord('snapback:page-set:v1:', {
    format: 'snapback.page-set.v1',
    materializationKey: fixture.address[2],
    activationHash: record.activationHash,
    planHash: record.planHash,
    version: first.proof.version,
    authorizationWitnessDigest: first.proof.authorizationWitnessDigest,
    orderedProofDigests,
  });
  record = await store.commitPageSet(fixture.address, { identity, orderedProofDigests }, fence(record));
  assert.equal(deriveCompletenessStatusV1(record), 'complete');
  assert.equal((await store.readRenderable(fixture.address, fence(record))).length, 2);
  await assert.rejects(
    store.commitPageSet(fixture.address, {
      identity,
      orderedProofDigests: [...orderedProofDigests].reverse(),
    }, fence(record)),
    (error) => error.code === 'SNAPBACK_PAGE_SET_INVALID',
  );
});

for (const carrier of ['file', 'indexeddb']) {
test(`A7 retained boot executes every failure-table store effect with zero render on ${carrier}`, async (t) => {
  const handle = await setupCarrier(t, carrier, `a7-${carrier}`);

  const establish = async (label) => {
    const fixture = makeFixture(label);
    const store = await openSemantic(handle, fixture);
    let record = await store.initialize(fixture.address, fixture.identities, null);
    const valid = fixture.makeProof(record);
    fixture.context.authorizationWitness = valid.witness;
    record = await store.commitPage(
      fixture.address,
      fixture.fragmentFor(valid, 'retained'),
      valid.proof,
      null,
      fence(record),
    );
    return { fixture, store, record, valid };
  };

  {
    const { fixture, store, record } = await establish('a7-corrupt');
    const key = materializationAddressKey(fixture.address);
    await handle.materializationTransaction('readwrite', (view) => {
      const raw = view.materializations.get(key);
      const signature = raw.fragments[0].proof.signature;
      raw.fragments[0].proof.signature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
      view.materializations.set(key, raw);
    });
    const bootStore = await openSemantic(handle, fixture);
    assert.equal(await bootStore.readRenderable(fixture.address, fence(record)), null);
    const after = await bootStore.initialize(fixture.address, fixture.identities, null);
    assert.equal(after.fragments.length, 0);
    assert.equal(after.productState.effectiveDisposition, 'retain');
  }

  for (const [label, mutate, expectedDisposition, expectedFragments] of [
    ['trust-absent', (fixture) => { fixture.context.trustedActivation = null; }, 'retain', 1],
    ['classification-absent', (fixture) => { fixture.context.retentionEligible = false; }, 'retain', 1],
    ['activation-mismatch', (fixture) => {
      fixture.context.trustedActivation = makeFixture('other-activation').trustedActivation;
    }, 'delete', 0],
    ['lease-invalid', (fixture) => { fixture.context.leaseStatus = 'expired'; }, 'delete', 0],
    ['witness-newer-epoch', (fixture, record) => {
      fixture.context.authorizationWitness = fixture.makeWitness(record.queryInstanceId, { epoch: 4 });
    }, 'quarantine', 1],
    ['witness-invalid', (fixture, record) => {
      fixture.context.authorizationWitness = fixture.makeWitness(record.queryInstanceId + 1);
    }, 'delete', 0],
  ]) {
    const established = await establish(`a7-${label}`);
    mutate(established.fixture, established.record);
    const bootStore = await openSemantic(handle, established.fixture);
    assert.equal(
      await bootStore.readRenderable(established.fixture.address, fence(established.record)),
      null,
      `${label} renders nothing`,
    );
    const after = await bootStore.initialize(
      established.fixture.address,
      established.fixture.identities,
      null,
    );
    assert.equal(after.productState.effectiveDisposition, expectedDisposition, label);
    assert.equal(after.fragments.length, expectedFragments, label);
    assert.equal(deriveCompletenessStatusV1(after), 'unknown', label);
  }
});
}

for (const carrier of ['memory', 'file', 'indexeddb']) {
test(`A8 fence, quarantine/release, delete, observation, and terminal-retirement races fail closed on ${carrier}`, async (t) => {
  const handle = await setupCarrier(t, carrier, `a8-${carrier}`);
  const fixture = makeFixture(`a8-${carrier}`);
  if (carrier === 'memory') fixture.identities.storageProfile = 'volatile-online-v1';
  const store = await openSemantic(handle, fixture);
  const observations = [];
  const unsubscribe = store.observeMaterialization(fixture.address, (snapshot) => observations.push(snapshot));
  assert.equal(observations.length, 1);
  assert.equal(observations[0].present, false);
  let record = await store.initialize(fixture.address, fixture.identities, null);
  const originalFence = fence(record);
  const valid = fixture.makeProof(record);
  fixture.context.authorizationWitness = valid.witness;
  record = await store.commitPage(fixture.address, fixture.fragmentFor(valid), valid.proof, null, fence(record));
  assert.throws(() => {
    observations.at(-1).requestedScope.input.kind = 'cursor';
  }, TypeError);
  const quarantine = ownerTransition(record, 'quarantine');
  record = await store.applyAuthorizationTransition(fixture.address, quarantine);
  assert.equal(await store.readRenderable(fixture.address, fence(record)), null);
  await assert.rejects(
    store.commitPage(fixture.address, fixture.fragmentFor(valid), valid.proof, null, originalFence),
    (error) => error.code === 'SNAPBACK_MATERIALIZATION_FENCE_STALE',
  );
  assert.equal(await store.readRenderable(fixture.address, originalFence), null);
  record = await store.applyAuthorizationTransition(fixture.address, ownerTransition(record, 'retain'));
  assert.deepEqual(await store.readRenderable(fixture.address, fence(record)), valid.bytes);
  record = await store.applyAuthorizationTransition(fixture.address, ownerTransition(record, 'delete'));
  assert.equal(record.fragments.length, 0);
  assert.equal(await store.readRenderable(fixture.address, fence(record)), null);
  assert.equal(await store.retire(fixture.address), true);
  assert.equal(await store.readRenderable(fixture.address, fence(record)), null);
  assert.equal(observations.at(-2).lifecycle, 'retiring');
  assert.equal(observations.at(-1).present, false);
  const successor = await store.initialize(fixture.address, fixture.identities, null);
  assert.equal(successor.queryInstanceId > record.queryInstanceId, true);
  unsubscribe();
  unsubscribe();
});
}

for (const carrier of ['memory', 'file', 'indexeddb']) {
  test(`S3 payload compaction preserves fences, registrations, tombstones, and same instance on ${carrier}`, async (t) => {
    const handle = await setupCarrier(t, carrier, `s3-${carrier}`);
    const fixture = makeFixture(`s3-${carrier}`);
    if (carrier === 'memory') fixture.identities.storageProfile = 'volatile-online-v1';
    const store = await openSemantic(handle, fixture);
    let record = await store.initialize(fixture.address, fixture.identities, null);
    const valid = fixture.makeProof(record);
    fixture.context.authorizationWitness = valid.witness;
    record = await store.commitPage(
      fixture.address,
      fixture.fragmentFor(valid, carrier === 'memory' ? 'current' : 'retained'),
      valid.proof,
      null,
      fence(record),
    );
    record = await store.beginEstablishment(
      fixture.address,
      { kind: 'page-set', from: 'first', through: 'terminal' },
      fence(record),
    );
    const orderedProofDigests = [completenessProofDigestV1(valid.proof)];
    record = await store.commitPageSet(fixture.address, {
      identity: hashRecord('snapback:page-set:v1:', {
        format: 'snapback.page-set.v1',
        materializationKey: fixture.address[2],
        activationHash: record.activationHash,
        planHash: record.planHash,
        version: valid.proof.version,
        authorizationWitnessDigest: valid.proof.authorizationWitnessDigest,
        orderedProofDigests,
      }),
      orderedProofDigests,
    }, fence(record));
    assert.equal(record.pageSets.length, 1);
    const key = materializationAddressKey(fixture.address);
    const meta = await handle.readStoreMeta();
    meta.durableRegistrations[key] = { source: 'programmatic', slot: 'keep-me' };
    meta.tombstoneHighWaters[key] = { revision: 9 };
    await handle.writeStoreMeta(meta);
    const beforeFence = fence(record);
    const beforeInstance = record.queryInstanceId;
    record = await store.compactPayload(fixture.address, beforeFence);
    assert.deepEqual(fence(record), beforeFence);
    assert.equal(record.queryInstanceId, beforeInstance);
    assert.equal(record.fragments.length, 0);
    assert.equal(record.pageSets.length, 0);
    assert.equal(record.memberships.length, 0);
    assert.equal(record.productState.heldProofs.length, 0);
    assert.equal(deriveCompletenessStatusV1(record), 'unknown');
    const afterMeta = await handle.readStoreMeta();
    assert.deepEqual(afterMeta.durableRegistrations[key], { source: 'programmatic', slot: 'keep-me' });
    assert.deepEqual(afterMeta.tombstoneHighWaters[key], { revision: 9 });
    await handle.materializationTransaction('readonly', (view) => {
      assert.equal(view.pageSets.size, 0);
      assert.equal(view.memberships.size, 0);
    });
    const rehydrated = await store.initialize(fixture.address, fixture.identities, null);
    assert.equal(rehydrated.queryInstanceId, beforeInstance);
  });
}

test('store authority barrier covers every predecessor before its receipt initializes a successor', async (t) => {
  const handle = await setupCarrier(t, 'memory', 'barrier');
  const first = makeFixture('barrier-first');
  const second = makeFixture('barrier-second');
  first.identities.storageProfile = 'volatile-online-v1';
  second.identities.storageProfile = 'volatile-online-v1';
  second.identities.authorityPartitionDigest = first.identities.authorityPartitionDigest;
  const store = await openSemantic(handle, first);
  const firstRecord = await store.initialize(first.address, first.identities, null);
  const secondRecord = await store.initialize(second.address, second.identities, null);
  const receipt = {
    barrierId: 'barrier-1',
    predecessor: first.identities.authorityPartitionDigest,
    successor: digest('9'),
    authorityGeneration: 3,
  };
  const published = await store.applyStoreAuthorityBarrier(
    'client-store-1',
    first.identities.authorityPartitionDigest,
    digest('9'),
    {
      barrierId: 'barrier-1',
      authorityGeneration: 3,
      receipt,
      records: [
        {
          address: first.address,
          ...ownerTransition(firstRecord, 'quarantine'),
          authorityState: {
            ...ownerTransition(firstRecord, 'quarantine').authorityState,
            authority_generation: 3,
          },
        },
        {
          address: second.address,
          ...ownerTransition(secondRecord, 'quarantine'),
          authorityState: {
            ...ownerTransition(secondRecord, 'quarantine').authorityState,
            authority_generation: 3,
          },
        },
      ],
    },
  );
  assert.deepEqual(published, receipt);
  const successor = makeFixture('barrier-successor');
  successor.identities.storageProfile = 'volatile-online-v1';
  successor.identities.authorityPartitionDigest = digest('9');
  await assert.rejects(
    store.initialize(successor.address, successor.identities, null),
    (error) => error.code === 'SNAPBACK_STORE_AUTHORITY_BARRIER_REQUIRED',
  );
  const successorRecord = await store.initialize(successor.address, successor.identities, receipt);
  assert.equal(successorRecord.productState.effectiveDisposition, 'retain');
});

test('single-record materialization budget refusal atomically leaves a compacted same-instance stub', async (t) => {
  const handle = await setupCarrier(t, 'memory', 'single-budget');
  const fixture = makeFixture('single-budget');
  fixture.identities.storageProfile = 'volatile-online-v1';
  const store = await createMaterializationStore(handle, {
    resolveValidationContext: () => fixture.context,
    policyLimits: { byteCeiling: 1, recordCeiling: 256, fragmentCeiling: 1_024 },
  });
  let record = await store.initialize(fixture.address, fixture.identities, null);
  const queryInstanceId = record.queryInstanceId;
  const valid = fixture.makeProof(record);
  fixture.context.authorizationWitness = valid.witness;
  await assert.rejects(
    store.commitPage(
      fixture.address,
      fixture.fragmentFor(valid),
      valid.proof,
      null,
      fence(record),
    ),
    (error) => error.code === 'SNAPBACK_MATERIALIZATION_BUDGET_EXCEEDED',
  );
  record = decodeMaterializationRecordV1(await handle.materializationTransaction(
    'readonly',
    (view) => view.materializations.get(materializationAddressKey(fixture.address)),
  ));
  assert.equal(record.queryInstanceId, queryInstanceId);
  assert.equal(record.fragments.length, 0);
  assert.equal(record.memberships.length, 0);
  assert.equal(deriveCompletenessStatusV1(record), 'unknown');
});

test('integration regression: a non-writer context constructs the shipped read surface', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'materialization-reader' });
  const writerHandle = createMemoryRqsResumeStore({ backing });
  const readerHandle = createMemoryRqsResumeStore({ backing });
  await writerHandle.whenLockSettled();
  t.after(async () => {
    await readerHandle.close();
    await writerHandle.close();
  });
  const writerStore = await createMaterializationStore(writerHandle);
  const fixture = makeFixture('reader-construction');
  fixture.identities.storageProfile = 'volatile-online-v1';
  await writerStore.initialize(fixture.address, fixture.identities, null);
  const readerStore = await createMaterializationStore(readerHandle);
  let observed = null;
  readerStore.observeMaterialization(fixture.address, (value) => { observed = value; })();
  assert.equal(observed.present, true);
});
