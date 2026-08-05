import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readGeneratedJson } from '../../_kit/generated-artifacts.mjs';

const generatedDirectory = fileURLToPath(new URL('../snapback/generated', import.meta.url));
const functions = readGeneratedJson(
  generatedDirectory,
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

test('retained inbox publishes its complete derived row contract without degradation', async () => {
  const introspection = readGeneratedJson(generatedDirectory, 'provider-introspection.json');
  const retained = introspection.operations.queries
    .find(({ name }) => name === 'retainedInbox');
  assert.deepEqual(retained.result.row, {
    shape: 'object',
    fields: {
      issueKey: { shape: 'primitive', name: 'string' },
      priority: { shape: 'primitive', name: 'number' },
      projectKey: { shape: 'primitive', name: 'string' },
      projectName: { shape: 'primitive', name: 'string' },
      rank: { shape: 'primitive', name: 'number' },
      state: { shape: 'primitive', name: 'string' },
      title: { shape: 'primitive', name: 'string' },
    },
  });

  const artifacts = readGeneratedJson(generatedDirectory, 'artifacts.json');
  assert.equal(artifacts.summary.counts.degradedResults, 0);
  assert.equal(artifacts.summary.counts.warnings, 0);
  assert.deepEqual(artifacts.summary.degradedResults, []);

  const apiTypes = await readFile(new URL('../snapback/generated/api.d.ts', import.meta.url), 'utf8');
  const retainedLine = apiTypes.split('\n')
    .find((line) => line.includes("FunctionReference<'retainedInbox'"));
  assert.match(retainedLine, /ReadonlyArray<\{ "issueKey": string; .*"projectName": string \}>/u);
  assert.equal(retainedLine.includes('unknown'), false);

  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<RetainedInboxRows>/u);
  assert.equal(source.includes('useState<any[]>([])'), false);
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

test('retained registration uses the public durable authoring surface', async () => {
  const source = await readFile(new URL('../src/retained-registration.ts', import.meta.url), 'utf8');
  assert.match(source, /\.registerQuery\(reference, \{/u);
  assert.match(source, /result\.outcome\.kind === 'refused'/u);
  assert.equal(source.includes('__registerDurableQuery'), false);
  assert.equal(source.includes('__prepareGeneratedMaterializationBridge'), false);
});
