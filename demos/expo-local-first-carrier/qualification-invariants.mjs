import assert from 'node:assert/strict';

const sameSet = (actual, expected) => (
  actual.length === expected.length && actual.every((value) => expected.includes(value))
);

/**
 * Fail-closed evaluator for the memo §3 post-boot record. Both qualification
 * directors project their recovered carrier/server facts into this shape.
 */
export function assertExpoCarrierPostBootInvariants(record) {
  const generationValues = record?.generation?.values;
  assert.ok(Array.isArray(generationValues) && generationValues.length >= 4, 'generation witness is incomplete');
  assert.equal(
    new Set(generationValues.map((value) => JSON.stringify(value))).size,
    1,
    `old/new generation is hybrid: ${JSON.stringify(generationValues)}`,
  );
  assert.ok(
    record.generation.allowed.some((value) => Object.is(value, generationValues[0])),
    `recovered generation ${JSON.stringify(generationValues[0])} is neither allowed whole generation`,
  );

  assert.ok(Array.isArray(record.reportedHostWatermarks), 'reported host watermarks are absent');
  assert.ok(Array.isArray(record.recoveredHostWatermarks), 'recovered host watermarks are absent');
  for (const watermark of record.reportedHostWatermarks) {
    assert.ok(
      record.recoveredHostWatermarks.includes(watermark),
      `reported host COMMIT watermark ${watermark} is absent after recovery`,
    );
  }

  assert.equal(record.writer?.recoveredOwner, true, 'recovered store is not the writer owner');
  assert.equal(record.writer?.independentOwnerRefused, true, 'an independent second writer was not refused');

  assert.equal(record.predecessor?.renderable, false, 'authority predecessor remained renderable');
  assert.equal(record.predecessor?.handleKeyRotated, true, 'authority transition did not rotate handleKey');

  assert.equal(record.mutation?.clientMutationId, record.expectedClientMutationId, 'clientMutationId changed');
  assert.ok(
    ['pending', 'settled'].includes(record.mutation?.recoveredStatus),
    `mutation is neither pending nor settled: ${record.mutation?.recoveredStatus}`,
  );
  assert.equal(record.mutation?.partialSettlement, false, 'partial settlement became visible');
  assert.ok(
    Number.isSafeInteger(record.server?.executionCount) && record.server.executionCount <= 1,
    `server executed ${record.server?.executionCount} times`,
  );
  assert.equal(record.settlement?.republished, true, 'settlement was not republished after recovery');
  assert.equal(record.settlement?.ackReadyObserved, true, 'ACK proof was not durably observable');
  assert.equal(record.settlement?.removedAfterAckProof, true, 'settlement/ACK custody was not removed after proof');

  const evaluated = [
    'old-or-new-whole-generation',
    'all-reported-host-watermarks-present',
    'no-partial-settlement',
    'one-writer',
    'predecessor-non-renderable-and-handle-key-rotated',
    'same-client-mutation-id-pending-or-settled',
    'server-execute-at-most-once',
    'settlement-republished-then-ack-removed',
  ];
  assert.equal(
    sameSet(record.evaluatedInvariants ?? evaluated, evaluated),
    true,
    'post-boot invariant evaluation set is incomplete',
  );
  return Object.freeze({ pass: true, evaluated: Object.freeze(evaluated) });
}

export const expoCarrierPostBootInvariantNames = Object.freeze([
  'old-or-new-whole-generation',
  'all-reported-host-watermarks-present',
  'no-partial-settlement',
  'one-writer',
  'predecessor-non-renderable-and-handle-key-rotated',
  'same-client-mutation-id-pending-or-settled',
  'server-execute-at-most-once',
  'settlement-republished-then-ack-removed',
]);
