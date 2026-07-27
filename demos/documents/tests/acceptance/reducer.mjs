import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DocumentProtocolError,
  HASH_DOMAINS,
  canonicalJson,
  hashCanonical,
  reduceDocument,
} from '../../reducer/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(here, '..', '..', 'fixtures', 'golden-corpus.v1.json');
const corpusBytes = readFileSync(corpusPath);
const corpus = JSON.parse(corpusBytes);

function permutations(operations) {
  const reversed = [...operations].reverse();
  const oddThenEven = [
    ...operations.filter((_, index) => index % 2 === 1),
    ...operations.filter((_, index) => index % 2 === 0),
  ];
  return [
    operations,
    reversed,
    oddThenEven,
    [...operations, ...reversed, ...operations],
  ];
}

function assertProtocolError(action, code) {
  assert.throws(action, (error) => (
    error instanceof DocumentProtocolError && error.code === code
  ));
}

const reports = [];

for (const scenario of corpus.scenarios) {
  const results = permutations(scenario.operations).map(reduceDocument);
  const baseline = results[0];
  for (const result of results.slice(1)) {
    assert.equal(
      result.snapshotCanonicalJson,
      baseline.snapshotCanonicalJson,
      `${scenario.id}: delivery permutation changed snapshot bytes`,
    );
    assert.equal(
      result.snapshotHash,
      baseline.snapshotHash,
      `${scenario.id}: delivery permutation changed snapshot hash`,
    );
    assert.deepEqual(
      result.pendingOperationIds,
      baseline.pendingOperationIds,
      `${scenario.id}: delivery permutation changed dependency buffering`,
    );
  }
  assert.deepEqual(
    baseline.snapshot.blocks.map(({ blockId }) => blockId),
    scenario.expected.blockIds,
    `${scenario.id}: block order`,
  );
  assert.deepEqual(
    baseline.snapshot.blocks.map(({ text }) => text),
    scenario.expected.texts,
    `${scenario.id}: visible text`,
  );
  assert.equal(
    baseline.pendingOperationIds.length,
    scenario.expected.pending,
    `${scenario.id}: pending count`,
  );
  assert.equal(
    baseline.snapshotHash,
    scenario.expected.snapshotHash,
    `${scenario.id}: frozen snapshot hash`,
  );
  assert.equal(
    baseline.frontierHash,
    scenario.expected.frontierHash,
    `${scenario.id}: frozen frontier hash`,
  );

  // A restart that reconstructs from the same immutable operation set must
  // reproduce both the snapshot bytes and the frontier.
  const restarted = reduceDocument(JSON.parse(JSON.stringify(scenario.operations)));
  assert.equal(restarted.snapshotHash, baseline.snapshotHash, `${scenario.id}: restart hash`);
  assert.equal(restarted.frontierHash, baseline.frontierHash, `${scenario.id}: restart frontier`);

  reports.push({
    scenario: scenario.id,
    snapshotHash: baseline.snapshotHash,
    frontierHash: baseline.frontierHash,
    applied: baseline.appliedOperationIds.length,
    pending: baseline.pendingOperationIds.length,
  });
}

const cycleScenario = corpus.scenarios.find(({ id }) => id === 'delete-wins-and-move-cycle');
const twoBlocks = cycleScenario.operations.slice(0, 2);
const concurrentMoves = [
  ...twoBlocks,
  {
    schemaVersion: 1,
    identity: corpus.identity,
    authorizationWitness: 'fixture-editor',
    operationId: ['move-x', 1],
    dependencies: { seed: 2 },
    payload: {
      kind: 'block.move',
      blockId: 'block-a',
      leftBlockId: 'block-b',
    },
  },
  {
    schemaVersion: 1,
    identity: corpus.identity,
    authorizationWitness: 'fixture-editor',
    operationId: ['move-y', 1],
    dependencies: { seed: 2 },
    payload: {
      kind: 'block.move',
      blockId: 'block-a',
      leftBlockId: null,
    },
  },
];
const concurrentMoveResults = permutations(concurrentMoves).map(reduceDocument);
assert.deepEqual(
  concurrentMoveResults[0].snapshot.blocks.map(({ blockId }) => blockId),
  ['block-a', 'block-b'],
  'the greatest concurrent move placement wins',
);
assert(
  concurrentMoveResults.every(
    ({ snapshotHash }) => snapshotHash === concurrentMoveResults[0].snapshotHash,
  ),
  'concurrent move selection must not depend on delivery order',
);

const causalMoves = [
  ...twoBlocks,
  {
    schemaVersion: 1,
    identity: corpus.identity,
    authorizationWitness: 'fixture-editor',
    operationId: ['z-move', 1],
    dependencies: { seed: 2 },
    payload: {
      kind: 'block.move',
      blockId: 'block-a',
      leftBlockId: 'block-b',
    },
  },
  {
    schemaVersion: 1,
    identity: corpus.identity,
    authorizationWitness: 'fixture-editor',
    operationId: ['a-move', 1],
    dependencies: { seed: 2, 'z-move': 1 },
    payload: {
      kind: 'block.move',
      blockId: 'block-a',
      leftBlockId: null,
    },
  },
];
assert.deepEqual(
  reduceDocument(causalMoves).snapshot.blocks.map(({ blockId }) => blockId),
  ['block-a', 'block-b'],
  'a causally later move supersedes an observed placement even when its tuple id is smaller',
);

const first = corpus.scenarios[0].operations;
assertProtocolError(
  () => reduceDocument([]),
  'SNAPBACK_DOCUMENT_BATCH_INVALID',
);
const substituted = structuredClone(first[0]);
substituted.payload.attributes.tone = 'substituted';
assertProtocolError(
  () => reduceDocument([first[0], substituted]),
  'SNAPBACK_DOCUMENT_OPERATION_ID_REUSED',
);

const wrongStream = structuredClone(first[1]);
wrongStream.identity.streamIncarnation = 'stream-2';
assertProtocolError(
  () => reduceDocument([first[0], wrongStream]),
  'SNAPBACK_DOCUMENT_IDENTITY_MISMATCH',
);

const invalidCounter = structuredClone(first[1]);
invalidCounter.dependencies = {};
assertProtocolError(
  () => reduceDocument([invalidCounter]),
  'SNAPBACK_DOCUMENT_COUNTER_PREDECESSOR_INVALID',
);

const unsupportedMark = structuredClone(first[1]);
unsupportedMark.payload = { kind: 'mark.add' };
assertProtocolError(
  () => reduceDocument([unsupportedMark]),
  'SNAPBACK_DOCUMENT_OPERATION_UNSUPPORTED',
);

assert.equal(
  canonicalJson({ z: 1, 'é': 2, a: 3 }),
  '{"a":3,"z":1,"é":2}',
  'canonical keys use unsigned UTF-8 ordering',
);
assert.notEqual(
  hashCanonical(HASH_DOMAINS.operation, { value: 1 }),
  hashCanonical(HASH_DOMAINS.snapshot, { value: 1 }),
  'hash domains must separate identical canonical payloads',
);
assertProtocolError(
  () => canonicalJson({ value: null, omitted: undefined }),
  'SNAPBACK_DOCUMENT_CANONICAL_VALUE_INVALID',
);
assertProtocolError(
  () => canonicalJson({ invalid: '\ud800' }),
  'SNAPBACK_DOCUMENT_CANONICAL_STRING_INVALID',
);

const report = {
  schemaVersion: 'snapback.documents-exploratory-reducer-report.v1',
  profileId: 'documents/reducer-experiment-v0',
  roadmapClaim: 'STEP6.DOCUMENTS',
  status: 'red',
  claimEligible: false,
  corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
  permutationsPerScenario: 4,
  scenarios: reports,
  explicitNonclaims: [
    'LLP 0068 remains Draft and unratified',
    'inline marks and grapheme-aware editor adapters',
    'server admission, settlement, authorization, and live invalidation',
    'retained offline outbox, resynchronization, and quarantine',
    'history, comments, presence, compaction, backup, and restore',
    'large-document windows and preregistered resource budgets',
    'web and Exact Native cross-language reducer tuples',
  ],
};

console.log(JSON.stringify(report, null, 2));
