import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import {
  createSnapbackProviderIntrospection,
  projectContractDataManifest,
  serializeProviderIntrospection,
  validateContractDataManifestProjection,
  validateProviderIntrospection,
  validateSnapbackIntrospectionSource,
} from './provider-introspection.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(
  join(packageRoot, 'provider-introspection.schema.json'),
  'utf8',
));
assert.equal(schema.$id, 'https://schemas.snapback.dev/provider-introspection/v1.schema.json');
assert.equal(schema.properties.artifactKind.const, 'providerIntrospection');
assert.equal(schema.properties.schemaVersion.const, 'provider-introspection.v1');

const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-provider-introspection-'));

try {
  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).sync(),
}, {
  ephemeral: defineEphemeral({
    cursors: ephemeral.collection({
      scope: { roomId: v.string() },
      routing: ['roomId'],
      key: 'connection',
      ttlMs: 20000,
      maxTtlMs: 30000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({ x: v.number(), y: v.number() }),
      publish: allow.all(),
      subscribe: allow.all(),
      targets: ['local-dev-sqlite-ibex'],
    }),
  }),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineLiveQuery, defineMutation, defineQuery, patch, returnChangedCount, v } from '${defineUrl}';
export const zSnapshot = defineQuery({ table: 'todos', args: {} });
export const aLive = defineLiveQuery({ table: 'todos', args: {} });
export const editTodo = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.deepEqual(validateProviderIntrospection(generated.providerIntrospection), []);
  assert.deepEqual(
    clone(projectContractDataManifest(generated.providerIntrospection)),
    clone(generated.contractManifest),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(backend, 'generated', 'contract-data.manifest.json'), 'utf8')),
    clone(generated.contractManifest),
  );

  assert.deepEqual(
    generated.providerIntrospection.operations.queries.map(({ name }) => name),
    ['aLive', 'zSnapshot'],
  );
  assert.deepEqual(
    generated.providerIntrospection.operations.ephemeral.map(({ name }) => name),
    ['cursors'],
  );
  const live = generated.providerIntrospection.operations.queries[0];
  assert.deepEqual(live.delivery.transports, [
    { kind: 'push', role: 'primary' },
    { cadenceMs: 1500, kind: 'poll', role: 'fallback' },
  ]);

  // Reordered input maps and capability keys serialize identically. Provider
  // operation order is normalized independently of JavaScript insertion order.
  const contract = generated.contractManifest;
  const reordered = createSnapbackProviderIntrospection({
    artifactVersion: contract.schemaVersion,
    inputsHash: contract.inputsHash,
    schemaHash: contract.schemaHash,
    bundleHash: contract.bundleHash,
    capabilities: reverseObject(contract.capabilities),
    receipts: contract.receipts,
    queries: reverseObject(contract.queries),
    mutations: reverseObject(contract.mutations),
    ephemeral: reverseObject(contract.ephemeral),
  });
  assert.equal(
    serializeProviderIntrospection(reordered),
    serializeProviderIntrospection(generated.providerIntrospection),
  );

  // The neutral transport representation makes the polling/push contradiction
  // structural rather than a documentation convention.
  const dishonestPoll = clone(generated.providerIntrospection);
  dishonestPoll.operations.queries[0].delivery.mode = 'poll';
  dishonestPoll.operations.queries[0].delivery.transports = [
    { kind: 'poll', role: 'primary', cadenceMs: 1500 },
    { kind: 'push', role: 'fallback' },
  ];
  const pollDiagnostics = validateProviderIntrospection(dishonestPoll);
  assert.equal(pollDiagnostics[0]?.code, 'PROVIDER_INTROSPECTION_SCHEMA_INVALID');
  assert(pollDiagnostics[0].problems.some((problem) => problem.includes('cannot also claim push')));

  // Projection drift names the exact JSON path and uses a stable diagnostic.
  const staleContract = clone(generated.contractManifest);
  staleContract.queries.aLive.livePush = false;
  const mismatch = validateContractDataManifestProjection(
    generated.providerIntrospection,
    staleContract,
  );
  assert.equal(mismatch[0]?.code, 'PROVIDER_INTROSPECTION_CONTRACT_MAPPING_MISMATCH');
  assert(mismatch[0].problems.includes('$.queries.aLive.livePush: expected true, received false'));

  // New Snapback facts cannot be dropped by the bounded v1 mapper.
  const futureQueries = clone(generated.contractManifest.queries);
  futureQueries.aLive.futureDeliveryFact = true;
  const unmapped = validateSnapbackIntrospectionSource({
    queries: futureQueries,
    mutations: generated.contractManifest.mutations,
    ephemeral: generated.contractManifest.ephemeral,
  });
  assert.equal(unmapped[0]?.code, 'PROVIDER_INTROSPECTION_SNAPBACK_SOURCE_UNMAPPED');
  assert.deepEqual(unmapped[0].problems, ['queries.aLive.futureDeliveryFact']);
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('provider introspection tests passed');

function reverseObject(value) {
  return Object.fromEntries(Object.entries(value).reverse());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
