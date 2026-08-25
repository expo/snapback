import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExpectation,
  loadRowAttackLedger,
  parseRuntimeObservation,
} from '../scripts/run-row-attacks.mjs';

const fixtureRoot = new URL('./fixtures/row-attacks/', import.meta.url).pathname;

test('row-attack ledger carries the 24 measured rows and both feature cells', () => {
  const ledger = loadRowAttackLedger(fixtureRoot);
  assert.deepEqual(
    ledger.attacks.map(({ row }) => row),
    [
      'F157', 'F170', 'F171', 'F172', 'F173', 'F175', 'F188', 'F190', 'F191',
      'C005', 'C009', 'F094', 'F143', 'F182', 'F112', 'F113', 'C006', 'F115',
      'F149', 'F150', 'F279', 'F280', 'C012', 'F053',
    ],
  );
  assert.deepEqual(ledger.featureCells.map(({ id }) => id), [
    'production',
    'additive-test-support',
  ]);
  assert.deepEqual(
    Object.fromEntries(ledger.attacks.map(({ row, expected }) => [row, expected])),
    {
      F157: 'CLOSED',
      F170: 'OPEN',
      F171: 'CLOSED',
      F172: 'CLOSED',
      F173: 'CLOSED',
      F175: 'CLOSED',
      F188: 'CLOSED',
      F190: 'CLOSED',
      F191: 'CLOSED',
      C005: 'CLOSED',
      C009: 'CLOSED',
      F094: 'CLOSED',
      F143: 'CLOSED',
      F182: 'CLOSED',
      F112: 'OPEN',
      F113: 'OPEN',
      C006: 'OPEN',
      F115: 'OPEN',
      F149: 'OPEN',
      F150: 'OPEN',
      F279: 'OPEN',
      F280: 'OPEN',
      C012: 'OPEN',
      F053: 'OPEN',
    },
  );
  assert.ok(
    ledger.attacks
      .filter(({ row }) => ['C005', 'C009', 'F094', 'F143', 'F182'].includes(row))
      .every(({ expectedCode }) => /^E\d{4}$/u.test(expectedCode)),
  );
});

test('row-attack mismatch classes distinguish regressions from newly closed rows', () => {
  assert.equal(classifyExpectation('CLOSED', 'OPEN'), 'REGRESSION / FALSE CLOSURE');
  assert.equal(classifyExpectation('OPEN', 'CLOSED'), 'NEWLY CLOSED');
  assert.equal(classifyExpectation('OPEN', 'OPEN'), 'MATCH');
  assert.equal(classifyExpectation('CLOSED', 'ERROR'), 'HARNESS ERROR');
});

test('runtime observations require the exact row and one machine-readable line', () => {
  assert.deepEqual(
    parseRuntimeObservation(
      'SNAPBACK_ROW_ATTACK {"row":"F157","observed":"OPEN","diagnostic":"accepted"}\n',
      'F157',
    ),
    { row: 'F157', observed: 'OPEN', diagnostic: 'accepted' },
  );
  assert.equal(
    parseRuntimeObservation(
      'SNAPBACK_ROW_ATTACK {"row":"F175","observed":"OPEN","diagnostic":"wrong"}\n',
      'F157',
    ).observed,
    'ERROR',
  );
});
