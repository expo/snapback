// LLP 0090 / LLP 0157-A3 mixed-route client acceptance: format-2 closed
// consumption, explicit bound liveness, and ordinary read-only delivery.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import { generate } from '../snapback-codegen/index.mjs';
import { SnapbackClient } from './index.mjs';
import { createRqsRegisteredRegistry } from './rqs-preload.mjs';

const defineUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'snapback-codegen', 'define.mjs'),
).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-client-mixed-route-v2-'));
const app = join(root, 'mixed-client-app', 'snapback');
mkdirSync(app, { recursive: true });
writeFileSync(join(app, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).sync() });
`);
writeFileSync(join(app, 'functions.mjs'), `
import { defineLiveQuery, defineQuery, v } from '${defineUrl}';
const args = { context: v.object({ boardId: v.string() }) };
export const plainTodos = defineQuery({ table: 'todos', args });
export const liveTodos = defineLiveQuery({ table: 'todos', args });
`);
writeFileSync(join(app, 'routes.mjs'), `
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{ route: '/mixed/:boardId', queries: [
  { function: 'plainTodos', args: { context: { boardId: routeParam('boardId') } } },
  { function: 'liveTodos', args: { context: { boardId: routeParam('boardId') } } },
] }]);
`);

const generatedGroup = (async () => {
  const result = await generate(app);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const api = await import(`${pathToFileURL(join(app, 'generated', 'api.mjs')).href}?client-mixed`);
  return api.groups['/mixed/:boardId'];
})();

after(() => rmSync(root, { recursive: true, force: true }));

const mixedParams = { boardId: 'wall' };

function bundleFor(reference) {
  const commitVersion = 17;
  let subscription = 0;
  const entries = reference.queries.map((child, position) => {
    const live = child.liveness.kind === 'admitted';
    return {
      function: child.ref.name,
      args: { context: { boardId: mixedParams.boardId } },
      rows: [{ position }],
      resume: null,
      ...(live ? { subscriptionId: `sub-${++subscription}` } : {}),
      delivery: {
        kind: live ? 'registered-live' : 'read-only',
        nodePlanHash: child.nodePlanHash,
      },
    };
  });
  return {
    formatVersion: 2,
    profile: 'mixed-route.v2',
    planHash: reference.planHash,
    commitVersion,
    generation: 'generation-1',
    versionStream: 'stream-1',
    entries,
    connection: {
      connectionId: 'connection-1',
      grant: 'grant-1',
      attachDeadline: Date.now() + 30_000,
    },
    aggregate: {
      kind: 'mixed',
      weakest: 'read-only',
      liveChildren: 1,
      readOnlyChildren: 1,
    },
  };
}

test('0157-A3 byte-identical plans classify only from bound liveness', async () => {
  const reference = await generatedGroup;
  assert.deepEqual(
    reference.queries[0].nodePlan.normalizedPlan,
    reference.queries[1].nodePlan.normalizedPlan,
    'the storage-plan pair is byte-identical before capability binding',
  );
  assert.deepEqual(
    reference.queries.map((child) => child.liveness.kind),
    ['none', 'admitted'],
  );

  assert.throws(
    () => createRqsRegisteredRegistry(bundleFor(reference), reference, {}),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'a nested unresolved route parameter refuses mixed materialization',
  );
  const registry = createRqsRegisteredRegistry(bundleFor(reference), reference, mixedParams);
  assert.equal(registry.formatVersion, 2);
  assert.equal(registry.profile, 'mixed-route.v2');
  assert.deepEqual(registry.aggregate, {
    kind: 'mixed',
    weakest: 'read-only',
    liveChildren: 1,
    readOnlyChildren: 1,
  });

  const materializedArgs = { context: { boardId: 'wall' } };
  const plain = registry.lookup('plainTodos', materializedArgs);
  const live = registry.lookup('liveTodos', materializedArgs);
  assert.deepEqual(plain, {
    bootDelivery: 'read-only',
    subscriptionId: null,
    rows: [{ position: 0 }],
    version: 17,
    resume: null,
    freshness: 'snapshot',
    attachDeadline: null,
  });
  assert.equal(live.bootDelivery, 'registered-live');
  assert.equal(live.subscriptionId, 'sub-1');
  assert.equal(live.freshness, undefined);
  assert.equal(registry.consume('plainTodos', materializedArgs), plain);
  assert.equal(
    registry.consume('plainTodos', materializedArgs),
    null,
    'ordinary results are one-shot',
  );

  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: null });
  await assert.rejects(
    client.liveQuery(reference.queries[1].ref, {
      transport: 'stream',
      registeredSubscription: plain,
    }),
    (error) => error?.code === 'SNAPBACK_RQS_READ_ONLY_RESULT',
    'a read-only result cannot be smuggled into the subscription path',
  );
  await client.closeAuth();
});

test('mixed consumption refuses unknown versions, open records, and shape inference', async () => {
  const reference = await generatedGroup;
  const bundle = bundleFor(reference);

  assert.throws(
    () => createRqsRegisteredRegistry({ ...bundle, formatVersion: 3 }, reference, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_VERSION_UNSUPPORTED',
  );
  assert.throws(
    () => createRqsRegisteredRegistry(bundle, { ...reference, formatVersion: 3 }, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_VERSION_UNSUPPORTED',
  );
  assert.throws(
    () => createRqsRegisteredRegistry({ ...bundle, futureField: true }, reference, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'the v2 bundle root is closed',
  );
  const openArtifact = structuredClone(reference);
  openArtifact.queries[0].futureField = true;
  assert.throws(
    () => createRqsRegisteredRegistry(bundle, openArtifact, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'each generated v2 child record is closed',
  );
  const openHydratedReference = structuredClone(reference);
  openHydratedReference.queries[0].ref.futureHydrationAnnotation = true;
  assert.throws(
    () => createRqsRegisteredRegistry(bundle, openHydratedReference, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'registry normalization strips only the closed generated hydration keys',
  );
  const openEntry = structuredClone(bundle);
  openEntry.entries[0].futureField = true;
  assert.throws(
    () => createRqsRegisteredRegistry(openEntry, reference, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'each v2 response entry is closed',
  );

  const inferredFromReferenceKind = structuredClone(reference);
  delete inferredFromReferenceKind.queries[1].liveness;
  assert.equal(inferredFromReferenceKind.queries[1].ref.kind, 'LiveQuery');
  assert.throws(
    () => createRqsRegisteredRegistry(bundle, inferredFromReferenceKind, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'a LiveQuery reference and live-looking storage plan cannot replace the bound liveness fact',
  );

  const contradictoryFact = structuredClone(reference);
  contradictoryFact.queries[0].liveness = {
    kind: 'admitted',
    delivery: 'live_replace',
    pageDomain: 'whole-result',
  };
  assert.throws(
    () => createRqsRegisteredRegistry(bundle, contradictoryFact, mixedParams),
    (error) => error?.code === 'SNAPBACK_RQS_MIXED_GROUP_INVALID',
    'a duplicated liveness fact that disagrees with NodePlanHashV1 refuses',
  );
});

test('LLP 0112 format-1 registry behavior stays unchanged', () => {
  const legacy = createRqsRegisteredRegistry({
    commitVersion: 4,
    generation: 'generation-legacy',
    versionStream: 'stream-legacy',
    entries: [{
      function: 'liveTodos',
      args: {},
      rows: [{ legacy: true }],
      resume: null,
      subscriptionId: 'sub-legacy',
    }],
    connection: {
      connectionId: 'connection-legacy',
      grant: 'grant-legacy',
      attachDeadline: 123,
    },
  });
  assert.deepEqual(Object.keys(legacy).sort(), [
    'connection', 'consume', 'generation', 'lookup', 'size', 'versionStream',
  ]);
  assert.deepEqual(legacy.lookup('liveTodos', {}), {
    subscriptionId: 'sub-legacy',
    rows: [{ legacy: true }],
    version: 4,
    resume: null,
    attachDeadline: 123,
  });
});
