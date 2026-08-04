import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readGeneratedJson } from '../../_kit/generated-artifacts.mjs';

const functions = readGeneratedJson(
  fileURLToPath(new URL('../snapback/generated', import.meta.url)),
  'functions.manifest.json',
).functions;
const byName = new Map(functions.map((definition) => [definition.name, definition]));

test('the required screen is generated composition, not a JavaScript collection join', async () => {
  const graph = byName.get('triageGraph');
  const inbox = byName.get('retainedInbox');
  assert.equal(graph.runtime.HostPlan.SnapshotBatch.profile, 'snapshot-batch.v1');
  assert.deepEqual(graph.runtime.HostPlan.SnapshotBatch.nodes.map((node) => node.take), [50, 20]);
  assert.equal(
    graph.runtime.HostPlan.SnapshotBatch.normalizedCompositePlan.classification.retention,
    'none',
  );
  assert.equal(inbox.retainable, true);
  assert.equal(inbox.runtime.HostPlan.RelationalQuery.take, 100);
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('.filter('), false);
  assert.equal(source.includes('.reduce('), false);
});

test('OQ13 freezes a fresh successor manifest and excludes Fleet', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../workload-manifest.2026-08-03.v1.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.reuseDecision, 'refreeze-fresh-successor-manifest');
  assert.equal(manifest.predecessorTransformsCopied, false);
  assert.equal(manifest.fixture.totalEvents, 250000);
  assert.equal(manifest.fixture.activeMatches, 100);
  assert.equal(manifest.fleetIncluded, false);
});
