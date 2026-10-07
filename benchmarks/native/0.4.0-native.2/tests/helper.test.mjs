import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createFixtureDescriptor,
  queuedBodiesForRun,
  validateFixtureDescriptor,
} from '../helper/fixture.mjs';
import { committedSearchResultIds, reconcileRenderedRows } from '../helper/rendered-rows.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runId = '142ed513-dacc-4219-bf29-3098db534c1c';

test('constructor owns the exact current-run queued bodies', () => {
  const descriptor = createFixtureDescriptor({ runId, protocol: 'wrong', queuedBodies: ['wrong', 'wrong'] });
  assert.deepEqual(descriptor.queuedBodies, queuedBodiesForRun(runId));
  assert.equal(validateFixtureDescriptor(descriptor, runId), descriptor);
});

test('validator rejects bodies derived from a different valid run ID', () => {
  const foreign = 'f2106546-215d-4063-a277-99b0e0a36d4e';
  const descriptor = createFixtureDescriptor({ runId });
  descriptor.queuedBodies = queuedBodiesForRun(foreign);
  assert.throws(
    () => validateFixtureDescriptor(descriptor, runId),
    error => error.code === 'fixture-queued-bodies-current-run',
  );
});

test('validator rejects a descriptor for another current run', () => {
  const descriptor = createFixtureDescriptor({ runId });
  assert.throws(
    () => validateFixtureDescriptor(descriptor, 'f2106546-215d-4063-a277-99b0e0a36d4e'),
    error => error.code === 'fixture-run-id-current',
  );
});

test('validator rejects both real Round-7 builder formats', () => {
  const fixtures = JSON.parse(fs.readFileSync(resolve(here, 'fixtures/fixture-schema-gap.json'), 'utf8'));
  const runIds = {
    convex: '142ed513-dacc-4219-bf29-3098db534c1c',
    snapback4: 'f2106546-215d-4063-a277-99b0e0a36d4e',
  };
  for (const [backend, fixture] of Object.entries(fixtures)) {
    assert.throws(
      () => validateFixtureDescriptor({ protocol: 'clique-native/1', runId: runIds[backend], queuedBodies: fixture.queuedBodies }, runIds[backend]),
      error => error.code === 'fixture-queued-bodies-current-run',
      backend,
    );
  }
});

test('rendered-row reconciliation drops removed/recycled rows and follows current committed order', () => {
  const data = [
    { id: 'kept', body: 'new value' },
    { id: 'new-cell', body: 'recycled cell' },
  ];
  const rows = reconcileRenderedRows(
    data,
    ['removed', 'new-cell', 'kept', 'kept'],
    item => item.id,
    item => ({ messageId: item.id, bodyHash: item.body, receipt: null }),
  );
  assert.deepEqual(rows.map(row => row.messageId), ['kept', 'new-cell']);
  assert.equal(rows[0].bodyHash, 'new value');
});

test('inverted newest-first data is projected in native visual order', () => {
  const data = [
    { id: 'second', body: 'run:second' },
    { id: 'first', body: 'run:first' },
  ];
  const rows = reconcileRenderedRows(
    data,
    ['second', 'first'],
    item => item.id,
    item => ({ messageId: item.id, bodyHash: item.body, receipt: 'pending' }),
    true,
  );
  assert.deepEqual(rows.map(row => row.messageId), ['first', 'second']);
});

test('empty search never retains previous rendered result IDs', () => {
  const rows = [{ messageId: 'old-result' }];
  assert.deepEqual(committedSearchResultIds('', rows), []);
  assert.deepEqual(committedSearchResultIds('   ', rows), []);
  assert.deepEqual(committedSearchResultIds('needle', rows), ['old-result']);
});
