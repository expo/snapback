import assert from 'node:assert/strict';
import test from 'node:test';

import { auditCitizenshipReport } from './step4-web-citizenship.mjs';

const result = (environment, assertion, fixture) => ({
  environment,
  assertion,
  fixture,
  status: 'passed',
  notes: 'Observed in the governed browser run.',
  evidence: [{ kind: 'session', ref: `https://evidence.example/${environment}/${assertion}` }],
});

function report(results, overrides = {}) {
  return {
    schemaVersion: 1,
    provenance: { authority: 'LLP 0211 §4.3 web-citizenship-ime-forms' },
    status: 'pending-manual-device-matrix',
    requiredEnvironments: [{ id: 'browser-a', assertions: ['focus', 'find'] }],
    requiredResults: [
      { environment: 'browser-a', assertion: 'focus', acceptedFixtures: ['overlay'] },
      { environment: 'browser-a', assertion: 'find', acceptedFixtures: ['search'] },
    ],
    results,
    ...overrides,
  };
}

test('partial evidence remains an explicit red row without structural drift', () => {
  const audit = auditCitizenshipReport(report([result('browser-a', 'focus', 'overlay')]));
  assert.deepEqual(audit.structuralFailures, []);
  assert.deepEqual(
    audit.rows.map(({ id, status }) => ({ id, status })),
    [
      { id: 'browser-a:find', status: 'red' },
      { id: 'browser-a:focus', status: 'pass' },
    ],
  );
});

test('complete governed evidence passes every row', () => {
  const audit = auditCitizenshipReport(
    report(
      [result('browser-a', 'focus', 'overlay'), result('browser-a', 'find', 'search')],
      {
        status: 'passed',
        run: {
          id: 'run-1',
          operator: 'device-lab',
          baseCommit: 'abc',
          startedAt: '2026-07-21T00:00:00Z',
          completedAt: '2026-07-21T00:01:00Z',
        },
      },
    ),
  );
  assert.deepEqual(audit.structuralFailures, []);
  assert(audit.rows.every(({ status }) => status === 'pass'));
});

test('duplicate and out-of-matrix evidence cannot masquerade as coverage', () => {
  const duplicate = result('browser-a', 'focus', 'overlay');
  const audit = auditCitizenshipReport(
    report([duplicate, duplicate, result('browser-b', 'focus', 'overlay')]),
  );
  assert(audit.structuralFailures.includes('duplicate-observed-result:browser-a:focus'));
  assert(audit.structuralFailures.includes('unexpected-observed-result:browser-b:focus'));
  assert.equal(audit.rows.find(({ id }) => id === 'browser-a:find').status, 'red');
});
