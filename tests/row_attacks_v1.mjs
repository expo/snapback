import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyExpectation,
  expectedInCell,
  loadRowAttackLedger,
  parseRuntimeObservation,
  securityUnmappedDigest,
  validateSecurityRowCoverage,
} from '../scripts/run-row-attacks.mjs';

const fixtureRoot = new URL('./fixtures/row-attacks/', import.meta.url).pathname;

function withMutatedLedger(mutate, check) {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-row-ledger-'));
  try {
    const ledger = JSON.parse(readFileSync(join(fixtureRoot, 'attacks.v1.json'), 'utf8'));
    mutate(ledger);
    writeFileSync(join(directory, 'attacks.v1.json'), `${JSON.stringify(ledger)}\n`);
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('row-attack ledger carries every measured row and all feature cells', () => {
  const ledger = loadRowAttackLedger(fixtureRoot);
  assert.deepEqual(
    ledger.attacks.map(({ row }) => row),
    [
      'F157', 'F170', 'F171', 'F172', 'F173', 'F175', 'F188', 'F190', 'F191',
      'C005', 'C009', 'F094', 'F143', 'F182', 'F112', 'F113', 'C006', 'F115',
      'F149', 'F150', 'F279', 'F280', 'C012', 'F053', 'F145', 'F272', 'F220',
      'F082', 'F129', 'F126', 'F318', 'F314', 'F315', 'F316', 'F317', 'F313',
      'F319', 'F320', 'F321',
    ],
  );
  assert.deepEqual(ledger.featureCells.map(({ id }) => id), [
    'production',
    'additive-test-support',
    'services-remainder-tests',
    'additive-services-remainder-tests',
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
      F112: 'CLOSED',
      F113: 'CLOSED',
      C006: 'CLOSED',
      F115: 'CLOSED',
      F149: 'CLOSED',
      F150: 'CLOSED',
      F279: 'CLOSED',
      F280: 'CLOSED',
      C012: 'CLOSED',
      F053: 'OPEN',
      F145: 'OPEN',
      F272: 'OPEN',
      F220: 'CLOSED',
      F082: 'CLOSED',
      F129: 'CLOSED',
      F126: 'CLOSED',
      F318: 'OPEN',
      F314: 'CLOSED',
      F315: 'CLOSED',
      F316: 'CLOSED',
      F317: 'CLOSED',
      F313: 'CLOSED',
      F319: 'OPEN',
      F320: 'OPEN',
      F321: 'OPEN',
    },
  );
  assert.ok(
    ledger.attacks
      .filter(({ row }) => ['C005', 'C009', 'F094', 'F143'].includes(row))
      .every(({ expectedCode }) => /^E\d{4}$/u.test(expectedCode)),
  );
  assert.deepEqual(
    ledger.attacks
      .filter(({ expected, expectedCode }) => expected === 'CLOSED' && expectedCode === undefined)
      .map(({ row }) => row),
    ['F157', 'F171', 'F172', 'F173', 'F188', 'F190', 'F191', 'F182', 'F126'],
    'only runtime-refusal CLOSED rows may omit a Rust expectedCode',
  );
  const rawSql = ledger.attacks.find(({ row }) => row === 'F313');
  assert.deepEqual(rawSql.requiredFeatures, ['kernel-push-fixture']);
  assert.equal(expectedInCell(rawSql, 'production'), 'CLOSED');
  assert.equal(expectedInCell(rawSql, 'services-remainder-tests'), 'CLOSED');
  assert.equal(expectedInCell(rawSql, 'additive-services-remainder-tests'), 'CLOSED');
});

test('security attacks must map a row or match the pinned unmapped-debt digest', () => {
  const unmapped = ['legacy-structural-control'];
  const security = {
    attacks: [
      { id: 'mapped', row: 'F313' },
      { id: unmapped[0] },
    ],
    rowCoverage: {
      unmappedAttackCount: 1,
      unmappedAttackIdsSha256: securityUnmappedDigest(unmapped),
      unmappedReason: 'Legacy security controls await explicit row classification.',
    },
  };
  assert.deepEqual(validateSecurityRowCoverage(security, new Set(['F313'])), []);
  security.attacks.push({ id: 'silently-omitted' });
  assert.match(
    validateSecurityRowCoverage(security, new Set(['F313'])).join('\n'),
    /unmapped row debt drifted/u,
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

test('OPEN rows cannot carry a speculative rustc code', () => {
  withMutatedLedger(
    (ledger) => {
      ledger.attacks.find(({ row }) => row === 'F319').expectedCode = 'E0599';
    },
    (directory) => assert.throws(
      () => loadRowAttackLedger(directory),
      /invalid or duplicate attack row/u,
    ),
  );
});

test('only listed runtime-refusal rows can be CLOSED without a rustc code', () => {
  withMutatedLedger(
    (ledger) => {
      ledger.attacks.find(({ row }) => row === 'F319').expected = 'CLOSED';
    },
    (directory) => assert.throws(
      () => loadRowAttackLedger(directory),
      /invalid or duplicate attack row/u,
    ),
  );
});
