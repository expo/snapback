import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveLegacyLeaseAnswerV1,
  deriveLegacyResumeAnswerV1,
  deriveQmk1AnswerV1,
} from './answer-classes.mjs';
import { SnapbackClient } from './index.mjs';
import { deriveCompletenessStatusV1 } from './materialization-store.mjs';
import { argsHash, digestOfRows } from './rqs.mjs';
import { verifyPersistedResumeEntry } from './rqs-store.mjs';

const QMK = `qmk1.${'A'.repeat(43)}`;
const digest = (character) => `sha256:${character.repeat(64)}`;

function materialization({ freshness = 'current', proof = false, refused = false } = {}) {
  const heldProofs = proof ? [{
    format: 'snapback.completeness-proof.v1',
    materializationKey: QMK,
    queryInstanceId: 1,
    activationHash: digest('1'),
    planHash: digest('2'),
    version: { stream: 'stream-1', commit: 7 },
    authorizationWitnessDigest: digest('3'),
    page: {
      kind: 'visible',
      input: { kind: 'first' },
      boundaryVectorDigest: digest('4'),
      output: { kind: 'terminal' },
    },
    nodes: [{ position: 0, classId: 'relational_query_v1', classVersion: 1, nodePlanHash: digest('5') }],
    batchIdentity: `sbbi1.${'A'.repeat(22)}`,
    resultDigest: digest('6'),
    proofKeyId: 'proof-key-1',
    signature: 'A'.repeat(86),
  }] : [];
  const authorityState = {
    query_instance_id: 1,
    query_lifecycle: 'active',
    authority_generation: 0,
    query_generation: 0,
    authority_instance_id: 'authority-1',
    expected_authorization: {
      incarnation: 'incarnation-1', epoch: 1, version_stream: 'stream-1',
    },
    effective_disposition: 'retain',
  };
  return {
    format: 'snapback.materialization-record.v1',
    address: ['snapback:client-materialization-address:v1', 'store-1', QMK],
    queryInstanceId: 1,
    planHash: digest('2'),
    activationHash: digest('1'),
    argsDigest: digest('7'),
    authorityPartitionDigest: digest('8'),
    storageProfile: 'durable-fragments-v1',
    productState: {
      lifecycle: 'active',
      effectiveDisposition: 'retain',
      freshness,
      requestedScope: { kind: 'page', input: { kind: 'first' } },
      requestedVersion: 'as-of-proof',
      attempt: refused ? { refused: { code: 'SNAPBACK_PLAN_REFUSED', fallback: 'fresh-only' } } : 'idle',
      heldProofs,
    },
    authorityState,
    fragments: [],
    pageSets: [],
    memberships: [],
    subscription: { delivery: 'none', connectionState: 'inactive', resumeCredentialDigest: null },
    optimisticLayerIds: [],
    outboxEntryIds: [],
    settlementIds: [],
  };
}

const qmkState = (record) => ({
  completenessStatus: deriveCompletenessStatusV1(record),
  freshness: record.productState.freshness,
});

const allLeaseFacts = Object.freeze({
  protectedRetainable: true,
  identityWitnessMatch: true,
  completeLeaseCustody: true,
  beforeDeadline: true,
  clockMonotone: true,
  cursorTargetValid: true,
  blockingFence: false,
});

const qmkExpected = (connected, mutation, action = null) => ({
  answerClass: 'unknown',
  freshness: null,
  storeMutation: mutation,
  resumeAction: action ?? (connected ? 'fresh-sync' : 'fresh-sync-on-reconnect'),
});

const rows = [
  {
    row: 1,
    family: 'qmk1',
    state: 'valid proof, retain disposition, valid witness and lease',
    derive: (connected) => deriveQmk1AnswerV1({
      connected,
      ...qmkState(materialization({ freshness: connected ? 'current' : 'retained', proof: true })),
      renderable: true,
    }),
    expected: (connected) => ({ answerClass: 'authoritative', freshness: connected ? 'current' : 'retained', storeMutation: 'none', resumeAction: 'none' }),
  },
  {
    row: 2,
    family: 'qmk1',
    state: 'proof, binding, signature, or result integrity invalid',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, integrity: 'invalid' }),
    expected: (connected) => qmkExpected(connected, 'discard-corrupt-fragment-proof'),
  },
  {
    row: 3,
    family: 'qmk1',
    state: 'stored activation mismatches trusted artifact',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, activation: 'mismatch' }),
    expected: (connected) => qmkExpected(connected, 'delete-before-read'),
  },
  {
    row: 4,
    family: 'qmk1',
    state: 'auth-scoped lease invalid',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, lease: 'invalid' }),
    expected: (connected) => qmkExpected(connected, 'delete-before-read'),
  },
  {
    row: 5,
    family: 'qmk1',
    state: 'same witness stream with a newer epoch expected',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, witness: 'newer-epoch' }),
    expected: (connected) => qmkExpected(
      connected,
      'quarantine-before-read',
      connected ? 'satisfying-resnapshot' : 'satisfying-resnapshot-on-reconnect',
    ),
  },
  {
    row: 6,
    family: 'qmk1',
    state: 'witness missing or bound to the wrong authority identity',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, witness: 'invalid' }),
    expected: (connected) => qmkExpected(connected, 'delete-before-read'),
  },
  {
    row: 7,
    family: 'qmk1',
    state: 'current establishment attempt refused without a valid proof',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization({ refused: true })), renderable: false }),
    expected: () => ({ answerClass: 'refused', freshness: null, storeMutation: 'store-refusal', resumeAction: 'safe-fallback' }),
  },
  {
    row: 8,
    family: 'qmk1',
    state: 'requested scope or version superseded',
    derive: (connected) => deriveQmk1AnswerV1({ connected, ...qmkState(materialization()), renderable: false, scope: 'superseded' }),
    expected: (connected) => qmkExpected(
      connected,
      'make-predecessor-proofs-historical',
      connected ? 're-establish' : 're-establish-on-reconnect',
    ),
  },
  {
    row: 9,
    family: 'legacy resume',
    state: 'verified entry with an empty outbox',
    derive: (connected) => deriveLegacyResumeAnswerV1({ connected, verified: true }),
    expected: (connected) => ({ answerClass: 'labeled-retained', freshness: 'retained', storeMutation: 'none', resumeAction: connected ? 'resume-ladder' : 'resume-ladder-on-reconnect' }),
  },
  {
    row: 10,
    family: 'legacy resume',
    state: 'verified entry with pending outbox intents',
    derive: (connected) => deriveLegacyResumeAnswerV1({ connected, verified: true, outboxPending: true }),
    expected: (connected) => ({ answerClass: 'labeled-retained', freshness: 'retained', storeMutation: 'none', resumeAction: connected ? 'full-resync-then-replay' : 'full-resync-then-replay-on-reconnect' }),
  },
  {
    row: 11,
    family: 'legacy resume',
    state: 'entry verification fails',
    derive: (connected) => deriveLegacyResumeAnswerV1({ connected, verified: false }),
    expected: (connected) => ({ answerClass: 'unknown', freshness: null, storeMutation: 'delete-entry', resumeAction: connected ? 'fresh-subscribe' : 'fresh-subscribe-on-reconnect' }),
  },
  {
    row: 12,
    family: 'legacy resume',
    state: 'server-admission token expired',
    derive: (connected) => deriveLegacyResumeAnswerV1({ connected, verified: true, tokenExpired: true }),
    expected: (connected) => ({ answerClass: 'labeled-retained', freshness: 'retained', storeMutation: 'replace-token-on-authoritative-answer', resumeAction: connected ? 'fresh-subscribe-rung-3' : 'none' }),
  },
  {
    row: 13,
    family: 'legacy resume',
    state: 'authorization invalidation requires retained-state purge',
    derive: (connected) => deriveLegacyResumeAnswerV1({ connected, verified: true, clearRetained: true }),
    expected: (connected) => ({ answerClass: 'unknown', freshness: null, storeMutation: 'purge-persisted-copy', resumeAction: connected ? 'fresh-subscribe' : 'fresh-subscribe-on-reconnect' }),
  },
  {
    row: 14,
    family: 'legacy lease',
    state: 'all LLP 0043 M1 authorization conditions hold',
    derive: (connected) => deriveLegacyLeaseAnswerV1({ connected, ownerFacts: allLeaseFacts }),
    expected: (connected) => ({ answerClass: 'lease-authorized-retained', freshness: 'retained', storeMutation: 'none', resumeAction: connected ? 'full-revalidate-and-fresh-snapshot' : 'full-revalidate-and-fresh-snapshot-on-reconnect' }),
  },
  {
    row: 15,
    family: 'legacy lease',
    state: 'lease authorization condition fails',
    derive: (connected) => deriveLegacyLeaseAnswerV1({ connected, ownerFacts: { ...allLeaseFacts, beforeDeadline: false } }),
    expected: (connected) => ({ answerClass: 'unknown', freshness: null, storeMutation: 'commit-delete-tombstone-before-read', resumeAction: connected ? 'full-revalidate-and-fresh-snapshot' : 'full-revalidate-and-fresh-snapshot-on-reconnect' }),
  },
  {
    row: 16,
    family: 'qmk1 / single_table_v1@1',
    state: 'authority-independent snapshot has valid proof and no lease',
    derive: (connected) => deriveQmk1AnswerV1({
      connected,
      ...qmkState(materialization({ freshness: connected ? 'current' : 'retained', proof: true })),
      renderable: true,
      lease: 'not-required',
    }),
    expected: (connected) => ({
      answerClass: 'authoritative',
      freshness: connected ? 'current' : 'retained',
      storeMutation: 'none',
      resumeAction: 'none',
    }),
  },
];

for (const entry of rows) {
  for (const connected of [true, false]) {
    test(`S2 row ${entry.row} — ${entry.family}: ${entry.state} — ${connected ? 'connected' : 'offline'}`, () => {
      assert.deepEqual(entry.derive(connected), entry.expected(connected));
    });
  }
}

test('S2 legacy rows 9-12 consume the shipped verifier without changing its behavior', () => {
  const rowsValue = [{ _id: 'todo-1', title: 'retained' }];
  const entry = {
    rows: rowsValue,
    token: 'sbrt1.example',
    meta: {
      app: 'app-1',
      generation: 'generation-1',
      versionStream: 'stream-1',
      queryArtifact: digest('9'),
      argsHash: argsHash({}),
      contentDigest: digestOfRows('mset1', rowsValue),
      version: 3,
    },
  };
  assert.deepEqual(verifyPersistedResumeEntry(entry, { args: {} }), { ok: true, reason: null });
  assert.equal(deriveLegacyResumeAnswerV1({ connected: false, verified: true }).answerClass, 'labeled-retained');
  assert.equal(deriveLegacyResumeAnswerV1({ connected: true, verified: true, outboxPending: true }).resumeAction, 'full-resync-then-replay');
  assert.equal(deriveLegacyResumeAnswerV1({ connected: false, verified: true, tokenExpired: true }).answerClass, 'labeled-retained');
  assert.equal(verifyPersistedResumeEntry({ ...entry, inProgress: true }, { args: {} }).ok, false);
  assert.equal(deriveLegacyResumeAnswerV1({ connected: true, verified: false }).answerClass, 'unknown');
});

test('S2 qmk1 client read wiring calls L2 readRenderable and returns bytes only as authoritative', async () => {
  let reads = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const client = new SnapbackClient('https://answer-table.test', {
    rqsStore: null,
    __materializationStore: {
      observeMaterialization(_address, listener) {
        listener({ present: true, status: 'complete', freshness: 'current' });
        return () => {};
      },
      async readRenderable(address, fence) {
        reads += 1;
        assert.equal(address[2], QMK);
        assert.equal(fence.queryInstanceId, 1);
        return bytes;
      },
    },
  });
  const result = await client.__readQmk1LocalAnswer({
    address: ['snapback:client-materialization-address:v1', 'store-1', QMK],
    expectedFence: { queryInstanceId: 1, authorityGeneration: 0, queryGeneration: 0 },
    connected: true,
  });
  assert.equal(reads, 1);
  assert.equal(result.answerClass, 'authoritative');
  assert.equal(result.freshness, 'current');
  assert.deepEqual(result.value, bytes);
});

test('S2 shipped liveQuery exposes labeled-retained then authoritative without altering Channel B', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const rowsValue = [{ _id: 'todo-1', title: 'retained' }];
  const resume = {
    token: 'sbrt1.example',
    meta: {
      app: 'app-1', generation: 'generation-1', versionStream: 'stream-1',
      queryArtifact: digest('9'), argsHash: argsHash({}),
      contentDigest: digestOfRows('mset1', rowsValue), version: 3,
    },
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      return Response.json({ connectionId: 'answer-table', connectionToken: 'token-1' });
    }
    if (path === '/live/listTodos/subscribe') {
      return Response.json({ subscription_id: 'sub-1', snapshot: { rows: rowsValue, version: 4 }, resume });
    }
    if (path === '/live/listTodos/unsubscribe') return Response.json({ disposed: true });
    throw new Error(`unexpected request ${path}`);
  };
  const updates = [];
  const client = new SnapbackClient('https://answer-table.test', { rqsStore: null });
  const handle = await client.liveQuery('listTodos', {
    connectionId: 'answer-table',
    preloadedResume: { rows: rowsValue, resume },
    onUpdate: (_rows, detail) => updates.push(detail),
  });
  assert.equal(updates[0].freshness, 'retained');
  assert.equal(updates[0].answerClass, 'labeled-retained');
  assert.equal(handle.answerClass, 'authoritative');
  assert.equal(handle.freshness, 'current');
  await handle.dispose();
});
