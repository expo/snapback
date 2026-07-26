import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePartitimeUiClaim,
  inspectAttendedTextEvidence,
  inspectPartitimeEngineClaim,
  inspectPartitimeManualDeviceGate,
} from './step4-closure-helpers.mjs';

const required = [
  'ios-safari-current:autofill-password-manager',
  'ios-safari-current:bfcache-restore',
  'ios-safari-current:find-on-page',
  'ios-safari-current:focus-trap-restore',
  'ios-safari-current:ime-composition',
];

const passingRow = (id) => ({
  id,
  status: 'pass',
  issues: [],
  evidence: [{ kind: 'device-session', ref: `evidence/${id}` }],
});

const receipt = (rows) => ({
  schemaVersion: 'partitime.step4-web-citizenship.v1',
  auditCompleted: true,
  skipPolicy: 'forbidden',
  skipped: 0,
  structuralFailures: [],
  rows,
});

test('all preregistered current-iOS rows pass even when deferred profile rows remain red', () => {
  const result = inspectPartitimeManualDeviceGate(receipt([
    ...required.map(passingRow),
    { id: 'ios-safari-current-1:ime-composition', status: 'red', issues: ['evidence-missing'] },
  ]), required);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.requiredRowIds, required);
});

test('one arbitrary passing row cannot satisfy the manual-device gate', () => {
  const result = inspectPartitimeManualDeviceGate(receipt([
    passingRow(required[0]),
  ]), required);
  assert.equal(result.status, 'red');
  assert(result.rows.some((row) => row.issues.includes('required-row-missing')));
});

test('duplicate rows and evidence-free passes fail closed', () => {
  const rows = required.map(passingRow);
  rows.push(passingRow(required[0]));
  rows.find((row) => row.id === required[1]).evidence = [];
  const result = inspectPartitimeManualDeviceGate(receipt(rows), required);
  assert.equal(result.status, 'red');
  assert.deepEqual(result.duplicateIds, [required[0]]);
});

test('one failed engine claim does not erase independent passing claims', () => {
  const engine = {
    browserId: 'safari-ios-latest',
    revisionMatches: true,
    receiptComplete: true,
    claimResults: [
      { claimId: 'STEP4.UI.RESPONSIVE', status: 'pass' },
      { claimId: 'STEP4.UI.KEYBOARD', status: 'red' },
    ],
  };
  assert.deepEqual(inspectPartitimeEngineClaim(engine, 'STEP4.UI.RESPONSIVE'), {
    browserId: 'safari-ios-latest', status: 'pass', reason: null,
  });
  assert.deepEqual(inspectPartitimeEngineClaim(engine, 'STEP4.UI.KEYBOARD'), {
    browserId: 'safari-ios-latest', status: 'red', reason: 'claim-not-passing',
  });
});

test('engine claims fail closed when the receipt or Exact revision is invalid', () => {
  const claimResults = [{ claimId: 'STEP4.UI.RESPONSIVE', status: 'pass' }];
  assert.equal(inspectPartitimeEngineClaim({
    browserId: 'safari-ios-latest', revisionMatches: false, receiptComplete: true, claimResults,
  }, 'STEP4.UI.RESPONSIVE').reason, 'engine-revision-mismatch');
  assert.equal(inspectPartitimeEngineClaim({
    browserId: 'safari-ios-latest', revisionMatches: true, receiptComplete: false, claimResults,
  }, 'STEP4.UI.RESPONSIVE').reason, 'claim-receipt-incomplete');
});

test('engine revision diagnostics retain the fixture mismatch reason', () => {
  assert.equal(inspectPartitimeEngineClaim({
    browserId: 'safari-ios-latest',
    revisionMatches: false,
    revisionReason: 'fixture-revision-mismatch',
    receiptComplete: true,
    claimResults: [{ claimId: 'STEP4.UI.KEYBOARD', status: 'pass' }],
  }, 'STEP4.UI.KEYBOARD').reason, 'fixture-revision-mismatch');
});

test('every UI claim fails closed when current product sources drift from the approved fixture', () => {
  for (const claimId of [
    'STEP4.UI.RESPONSIVE',
    'STEP4.UI.KEYBOARD',
    'STEP4.UI.FOCUS',
    'STEP4.UI.REDUCED-MOTION',
    'STEP4.UI.A11Y',
    'STEP4.UI.VISUAL',
  ]) {
    assert.deepEqual(evaluatePartitimeUiClaim({
      claimId,
      automated: [{ status: 'pass' }],
      manualStatus: 'pass',
      visualStatus: 'pass',
      fixtureSourceParityStatus: 'red',
    }), {
      status: 'red',
      reason: 'fixture-source-parity-red',
    });
  }
});

test('UI claim diagnostics distinguish engine, manual, and visual failures', () => {
  assert.equal(evaluatePartitimeUiClaim({
    claimId: 'STEP4.UI.RESPONSIVE',
    automated: [{ status: 'red' }],
    manualStatus: 'pass',
    visualStatus: 'pass',
    fixtureSourceParityStatus: 'pass',
  }).reason, 'automated-claim-red');
  assert.equal(evaluatePartitimeUiClaim({
    claimId: 'STEP4.UI.FOCUS',
    automated: [{ status: 'pass' }],
    manualStatus: 'red',
    visualStatus: 'pass',
    fixtureSourceParityStatus: 'pass',
  }).reason, 'manual-device-gate-red');
  assert.equal(evaluatePartitimeUiClaim({
    claimId: 'STEP4.UI.VISUAL',
    automated: [{ status: 'pass' }],
    manualStatus: 'pass',
    visualStatus: 'red',
    fixtureSourceParityStatus: 'pass',
  }).reason, 'visual-approval-red');
});

test('attended text evidence requires operator soft-keyboard input and exact values', () => {
  const evidence = [{
    operator: 'Charlie Cheever',
    inputSource: 'operator-physical-soft-keyboard',
    webdriverValueCommandUsed: false,
    expectedValue: 'Keyboard Picnic',
    observation: { value: 'Keyboard Picnic' },
  }];
  assert.deepEqual(
    inspectAttendedTextEvidence(evidence, ['Keyboard Picnic'], 'Charlie Cheever'),
    { status: 'pass', errors: [] },
  );
  assert.equal(inspectAttendedTextEvidence([{
    ...evidence[0],
    inputSource: 'webdriver-element-value',
    webdriverValueCommandUsed: true,
  }], ['Keyboard Picnic'], 'Charlie Cheever').status, 'red');
});
