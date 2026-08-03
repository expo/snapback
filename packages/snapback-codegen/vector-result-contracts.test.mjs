// @ref LLP 0132#acceptance — schema, plan, generated types, capability fact,
// client carrier, and provider contract must agree on one closed profile.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(packageRoot));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-vector-result-contract-'));

try {
  const snapbackModules = join(backend, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(
    join(repositoryRoot, 'packages', 'snapback-client'),
    join(snapbackModules, 'snapback-client'),
    'dir',
  );
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};

export const papers = defineTable({
  ownerId: v.principal(),
  category: v.string(),
  title: v.string(),
  embedding: v.vector(3),
}).vectorIndex('by_embedding', {
  semanticVersion: 'research-room.embedding.v1',
  vectorField: 'embedding',
  metric: 'l2sq',
  fieldClassifications: {
    embedding: 'private',
    category: 'private',
    title: 'private',
  },
  equalityFilters: ['category'],
  storedFields: ['title'],
  visibility: { kind: 'owner', field: 'ownerId' },
  tieBreak: 'id-asc',
  maxIndexedVectorsPerPartition: 64,
});

export default defineSchema({ papers });
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineVectorQuery } from ${JSON.stringify(defineUrl)};
import { papers } from './schema.mjs';

export const nearestPapers = defineVectorQuery({
  table: papers,
  index: 'by_embedding',
});
`);

  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(generated.summary.counts.degradedResults, 0);

  const schema = JSON.parse(readFileSync(join(backend, 'generated', 'schema.manifest.json')));
  assert.deepEqual(schema.requiredCapabilities, ['vector_search_v1']);
  const table = schema.tables.find(({ name }) => name === 'papers');
  assert.deepEqual(table.fields.find(({ name }) => name === 'embedding').field_type, {
    Vector: { dimensions: 3 },
  });
  assert.deepEqual(table.vectorIndexes[0], {
    formatVersion: 1,
    name: 'by_embedding',
    semanticVersion: 'research-room.embedding.v1',
    vectorField: 'embedding',
    dimensions: 3,
    metric: 'l2sq',
    distanceProfile: 'snapback-vector-distance-v1',
    orderingProfile: 'nearest-first-row-id.v1',
    fieldClassifications: {
      category: 'private',
      embedding: 'private',
      title: 'private',
    },
    equalityFilters: ['category'],
    storedFields: ['title'],
    visibility: { kind: 'owner', field: 'ownerId' },
    tieBreak: 'id-asc',
    maxIndexedVectorsPerPartition: 64,
    maintenanceLimits: { vectorMaintenanceEffects: 1024, vectorBytes: 4194304 },
  });

  const functions = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json')));
  const operation = functions.functions.find(({ name }) => name === 'nearestPapers');
  assert.deepEqual(operation.runtime.HostPlan.VectorQuery, {
    table: 'papers',
    index: 'by_embedding',
    distanceProfile: 'snapback-vector-distance-v1',
    resultProjection: 'vector-page-v1',
    requiredCapability: 'vector_search_v1',
  });
  assert.deepEqual(operation.resultContract.rows, { minItems: 0, maxItems: 64 });
  assert.deepEqual(
    operation.resultContract.record.fields.map(({ name }) => name),
    ['rowId', 'distance', 'fields'],
  );
  assert.deepEqual(
    operation.resultContract.record.fields.find(({ name }) => name === 'fields').value.fields,
    [{ name: 'title', required: true, value: { kind: 'string', maxBytes: 1048576 } }],
  );

  const generatedApi = (await import(pathToFileURL(
    join(backend, 'generated', 'api.mjs'),
  ).href)).default;
  const argumentSchema = generatedApi.nearestPapers.argumentSchema;
  assert.equal(argumentSchema.properties.vector.maxItems, 3);
  assert.equal(argumentSchema.properties.vector.items.minimum, -(2 ** 100));
  assert.equal(argumentSchema.properties.vector.items.maximum, 2 ** 100);
  assert.equal(argumentSchema.properties.k.maximum, 64);
  assert.equal(argumentSchema.properties.filters.maxItems, 8);

  const capability = JSON.parse(readFileSync(join(backend, 'generated', 'capability.manifest.json')));
  assert.equal(capability.vectorSearch.capabilityId, 'vector_search_v1');
  assert.equal(capability.vectorSearch.accelerator, 'none');
  assert.deepEqual(capability.vectorSearch.nonclaims.includes('ann'), true);

  const apiTypes = readFileSync(join(backend, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /VectorPageV1 as ClientVectorPageV1/u);
  assert.match(apiTypes, /nearestPapers: FunctionReference<'nearestPapers', 'Query', VectorRequestV1, VectorPageV1<\{ "title": string \}, Id<"papers">>>/u);
  assert.doesNotMatch(apiTypes, /VectorPageV1[^\n]+cursor/u);

  const introspection = JSON.parse(readFileSync(
    join(backend, 'generated', 'provider-introspection.json'),
  ));
  const provider = introspection.operations.queries.find(({ name }) => name === 'nearestPapers');
  assert.equal(provider.contract.result.kind, 'records');
  assert.equal(JSON.stringify(provider.contract.result).includes('unknown'), false);
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('vector-result-contracts.test.mjs: authoring and generated carriers agree');
