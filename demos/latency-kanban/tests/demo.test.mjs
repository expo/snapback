import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import api from '../snapback/generated/api.mjs';

const VERBS = ['createCard', 'editCard', 'assignCard', 'archiveCard', 'reorderCard'];

test('all five app verbs ship one locally executable generated IR carrier', () => {
  for (const name of VERBS) {
    const ref = api[name];
    assert.equal(ref.mutationIr.format, 'snapback.generated-mutation-ir.v1', name);
    assert.equal(ref.mutationIr.capabilityClass, 'local-executable', name);
    assert.match(ref.mutationIr.operationHash, /^sha256:[0-9a-f]{64}$/u, name);
    assert.deepEqual(ref.mutationIr.sourceIdentity.activation, ref.expectedGeneration, name);
  }
  assert.deepEqual(
    api.createCard.mutationIr.plan.steps.map((step) => Object.keys(step)[0]),
    ['Insert'],
  );
  for (const name of VERBS.slice(1)) {
    assert.deepEqual(
      api[name].mutationIr.plan.steps.map((step) => Object.keys(step)[0]),
      ['Get', 'Guard', 'Patch'],
      name,
    );
    assert.deepEqual(api[name].mutationIr.declaredReads, ['cards']);
  }
});

test('the app calls each generated mutation once and contains no optimistic transform', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('optimisticOperation'), false);
  assert.equal(source.includes('optimisticReducer'), false);
  assert.equal(source.includes('client.mutate(reference'), true);
  for (const name of VERBS) assert.equal(source.includes(`api.${name}`), true, name);
  assert.equal(source.includes('createOptimisticMutationView'), true);
  assert.ok(
    source.indexOf('createOptimisticMutationView') < source.indexOf('client.liveQuery'),
    'boot IR replay must start before the first live-query/network path',
  );
  assert.equal(source.includes('boards-retained-or-live-delivery'), true);
  assert.equal(source.includes('cards-retained-or-live-delivery'), true);
});

test('generated result contracts are complete and the artifact has no degraded rows', async () => {
  const artifacts = JSON.parse(await readFile(
    new URL('../snapback/generated/artifacts.json', import.meta.url), 'utf8',
  ));
  assert.equal(artifacts.summary.counts.degradedResults, 0);
  assert.equal(artifacts.summary.counts.warnings, 0);
});
