import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateMemoryConstructAmendment,
  validateMemoryConstructRegistration,
} from './step4-memory-authority.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const amendment = JSON.parse(readFileSync(
  resolve(here, '../../acceptance/memory-construct-amendment.2026-07-23.json'),
  'utf8',
));
const protocol = JSON.parse(readFileSync(
  resolve(here, '../../acceptance/comparison-protocol.v1.json'),
  'utf8',
));

test('accepts the frozen two-part memory construct', () => {
  const result = validateMemoryConstructAmendment(amendment);
  validateMemoryConstructRegistration(protocol, amendment);
  assert.equal(result.status, 'ratified');
  assert.deepEqual(result.metricNames, [
    'warmHeapTotalBytesP95',
    'marginalHeapBytesPerLogicalSubscriptionUpper95',
  ]);
});

test('rejects a registry status that diverges from the authority', () => {
  const mutated = structuredClone(protocol);
  const registration = mutated.amendments.find(({ id }) =>
    id === amendment.amendmentId);
  registration.status = 'proposed';
  assert.throws(
    () => validateMemoryConstructRegistration(mutated, amendment),
    /proposed.*ratified/,
  );
});

test('requires the exact owner statement when authority becomes ratified', () => {
  const mutated = structuredClone(amendment);
  mutated.status = 'ratified';
  mutated.ratifiedAt = '2026-07-24';
  mutated.ratificationStatement =
    'I generally approve partitime-ws8-memory-construct-v2-2026-07-23.';
  assert.throws(
    () => validateMemoryConstructAmendment(mutated),
    /exact required ratification statement/,
  );
});

test('rejects a judged-cell-dependent target', () => {
  const mutated = structuredClone(amendment);
  mutated.construct.total.judgedCellFeedsOwnThreshold = true;
  assert.throws(
    () => validateMemoryConstructAmendment(mutated),
    /true !== false/,
  );
});

test('rejects a post-hoc count or threshold change', () => {
  const changedCounts = structuredClone(amendment);
  changedCounts.construct.marginal.counts = [1, 2, 4, 8];
  assert.throws(
    () => validateMemoryConstructAmendment(changedCounts),
    /Expected values to be strictly deep-equal/,
  );

  const changedFloor = structuredClone(amendment);
  changedFloor.construct.marginal.absoluteFloorBytes = 65536;
  assert.throws(
    () => validateMemoryConstructAmendment(changedFloor),
    /65536 !== 4096/,
  );

  const changedSeed = structuredClone(amendment);
  changedSeed.sampling.holdoutSeed = changedSeed.sampling.calibrationSeed;
  assert.throws(
    () => validateMemoryConstructAmendment(changedSeed),
    /calibration and holdout seeds must remain distinct/,
  );
});
