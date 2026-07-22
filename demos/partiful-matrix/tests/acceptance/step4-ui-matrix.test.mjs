import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectPartitimeManualDeviceGate } from './step4-closure-helpers.mjs';

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
