import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExpectation,
  loadRowAttackLedger,
  parseRuntimeObservation,
} from '../scripts/run-row-attacks.mjs';

const fixtureRoot = new URL('./fixtures/row-attacks/', import.meta.url).pathname;

test('row-attack ledger carries the nine audited rows and both feature cells', () => {
  const ledger = loadRowAttackLedger(fixtureRoot);
  assert.deepEqual(
    ledger.attacks.map(({ row }) => row),
    ['F157', 'F170', 'F171', 'F172', 'F173', 'F175', 'F188', 'F190', 'F191'],
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
    },
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
