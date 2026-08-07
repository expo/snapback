import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readGeneratedJson } from '../../_kit/generated-artifacts.mjs';
import {
  FLEET_WORKLOAD,
  generateEventBatch,
  mainViewRollups,
  telemetryBurst,
} from '../fixture.mjs';

const generatedDirectory = fileURLToPath(new URL('../snapback/generated', import.meta.url));
const functions = readGeneratedJson(generatedDirectory, 'functions.manifest.json').functions;
const byName = new Map(functions.map((definition) => [definition.name, definition]));

test('the required Fleet route is one mixed generated snapshot-batch.v2 composite', () => {
  const route = byName.get('fleetObservatory');
  const plan = route.runtime.HostPlan.SnapshotBatchV2;
  assert.equal(plan.profile, 'snapshot-batch.v2');
  assert.deepEqual(plan.nodes.map((node) => node.classId), [
    'relational_query_v1',
    'bounded_children_v1',
  ]);
  assert.deepEqual(plan.nodes.map((node) => node.plan.take), [100, 100]);
  assert.equal(plan.normalizedCompositePlan.classification.retention, 'none');
  assert.deepEqual(
    plan.normalizedCompositePlan.parentAuthorizationGroups.map((group) => group.members),
    [[1]],
  );
  assert.ok(route.requiredCapabilities.includes('snapshot_batch_v2'));
  assert.ok(route.requiredCapabilities.includes('bounded_children_v1'));
  assert.ok(route.requiredCapabilities.includes('relational_query_v1'));
});

test('the required screen consumes that one generated composite directly', async () => {
  const screen = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal((screen.match(/useSnapbackQuery\(/gu) ?? []).length, 1);
  assert.match(screen, /useSnapbackQuery\(\s*api\.fleetObservatory,/u);
  assert.equal(screen.includes('api.latestEventsWithVehicles'), false);
  assert.equal(screen.includes('api.vehicleRollupPage'), false);
  assert.equal(screen.includes('.reduce('), false);
});

test('the relational node joins vehicle and owner facts without a JS collection join', async () => {
  const relational = byName.get('latestEventsWithVehicles');
  assert.equal(relational.runtime.HostPlan.RelationalQuery.take, 100);
  assert.equal(relational.runtime.HostPlan.RelationalQuery.joined, 'vehicleFacts');
  const source = await readFile(new URL('../snapback/functions.mjs', import.meta.url), 'utf8');
  assert.match(source, /export const latestEventsWithVehicles[\s\S]*?retention: 'none'/u);
  const composite = source.slice(
    source.indexOf('export const fleetObservatory'),
    source.indexOf('async function ownedView'),
  );
  assert.equal(composite.includes('.filter('), false);
  assert.equal(composite.includes('.reduce('), false);
  assert.equal(composite.includes('defineSnapshotBatchQuery'), true);
});

test('the fresh deterministic workload preserves Fleet scale and exact burst cardinality', () => {
  assert.deepEqual(FLEET_WORKLOAD, {
    devices: 25_000,
    events: 250_000,
    updateBurst: 1_000,
    activeMatches: 100,
    queryChanges: 20,
    pageSize: 100,
  });
  const activeEvents = generateEventBatch(49_000, 1_000)
    .filter((event) => event.activeForOwner);
  assert.equal(activeEvents.length, 100);
  assert.deepEqual(activeEvents.map((event) => event.queryRank),
    Array.from({ length: 100 }, (_, index) => 99 - index));
  const burst = telemetryBurst();
  assert.equal(burst.length, 1_000);
  assert.equal(burst.filter((update) => update.activeRank !== undefined).length, 100);
  assert.equal(new Set(burst.map((update) => update.eventKey)).size, 1_000);
  assert.equal(mainViewRollups().length, 100);
});

test('the workload manifest is fresh and leaves predecessor evidence immutable', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../workload-manifest.2026-08-06.v1.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.reuseDecision, 'refreeze-fresh-successor-manifest');
  assert.equal(manifest.predecessorEvidenceRewritten, false);
  assert.equal(manifest.fixture.events, 250_000);
  assert.equal(manifest.fixture.updateBurst, 1_000);
  assert.equal(manifest.fixture.activeMatches, 100);
});
