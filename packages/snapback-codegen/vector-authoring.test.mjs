import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defineSchema,
  defineTable,
  defineVectorQuery,
  v,
} from './define.mjs';
import { generate, renderOperationSchemas } from './index.mjs';
import {
  effectiveArgsContract,
  effectiveResultContract,
  vectorPageResultType,
} from './result-contracts.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-vector-authoring-'));

function manifestTable(table) {
  return {
    fields: Object.entries(table.fields).map(([name, field]) => ({
      name,
      field_type: field.fieldType,
      optional: field.optional,
    })),
    vectorIndexes: table.vectorIndexes,
  };
}

try {
  const documents = defineTable({
    embedding: v.vector(3),
    category: v.optional(v.string()),
    title: v.string(),
  }).vectorIndex('by_embedding', {
    semanticVersion: 'documents.embedding.v1',
    vectorField: 'embedding',
    metric: 'l2sq',
    fieldClassifications: {
      embedding: 'public',
      category: 'public',
      title: 'public',
    },
    equalityFilters: ['category'],
    storedFields: ['title'],
    visibility: { kind: 'public-read' },
    tieBreak: 'id-asc',
    maxIndexedVectorsPerPartition: 128,
  });
  defineSchema({ documents });

  assert.deepEqual(documents.vectorIndexes, [{
    formatVersion: 1,
    name: 'by_embedding',
    semanticVersion: 'documents.embedding.v1',
    vectorField: 'embedding',
    dimensions: 3,
    metric: 'l2sq',
    distanceProfile: 'snapback-vector-distance-v1',
    orderingProfile: 'nearest-first-row-id.v1',
    fieldClassifications: {
      category: 'public',
      embedding: 'public',
      title: 'public',
    },
    equalityFilters: ['category'],
    storedFields: ['title'],
    visibility: { kind: 'public-read' },
    tieBreak: 'id-asc',
    maxIndexedVectorsPerPartition: 128,
    maxScalarPairs: 384,
    maintenanceLimits: {
      vectorMaintenanceEffects: 1_024,
      vectorBytes: 4 * 1_024 * 1_024,
    },
  }]);

  const nearest = defineVectorQuery({ table: documents, index: 'by_embedding' });
  assert.equal(nearest.__kind, 'Query');
  assert.equal(nearest.auth, 'public');
  assert.deepEqual(nearest.vectorPlan, {
    table: 'documents',
    index: 'by_embedding',
    distanceProfile: 'snapback-vector-distance-v1',
    resultProjection: 'vector-page-v1',
    requiredCapability: 'vector_search_v1',
  });
  const [operationArgs] = renderOperationSchemas(
    'vector-test',
    [{ name: 'nearestDocuments' }],
    { nearestDocuments: nearest },
  );
  assert.deepEqual(operationArgs.value.properties.vector, {
    type: 'array',
    items: { type: 'number', minimum: -(2 ** 100), maximum: 2 ** 100 },
    minItems: 3,
    maxItems: 3,
  });
  assert.deepEqual(
    operationArgs.value.properties.filters.items.properties.field,
    { const: 'category' },
  );
  const argsContract = effectiveArgsContract(nearest.args);
  const args = Object.fromEntries(argsContract.fields.map((field) => [field.name, field]));
  assert.deepEqual(args.vector.value, { kind: 'vector', dimensions: 3 });
  assert.equal(args.vector.required, true);
  assert.equal(args.k.required, false);
  assert.equal(args.filters.value.maxItems, 8);
  const filterFields = Object.fromEntries(
    args.filters.value.element.fields.map((field) => [field.name, field]),
  );
  assert.deepEqual(filterFields.field.value, { kind: 'literal', value: 'category' });
  assert.deepEqual(filterFields.value.value.variants.map(({ kind }) => kind), [
    'string', 'finiteReal', 'boolean',
  ]);

  const resultContract = effectiveResultContract({
    def: nearest,
    functionKind: 'Query',
    runtime: { HostPlan: { VectorQuery: nearest.vectorPlan } },
    tables: { documents: manifestTable(documents) },
  });
  assert.equal(resultContract.kind, 'records');
  assert.deepEqual(resultContract.rows, { minItems: 0, maxItems: 64 });
  const resultFields = Object.fromEntries(
    resultContract.record.fields.map((field) => [field.name, field]),
  );
  assert.deepEqual(resultFields.rowId.value, { kind: 'id', table: 'documents' });
  const sharedRequestSchema = JSON.parse(readFileSync(
    join(repoRoot, 'schemas', 'vector.request.schema.json'),
    'utf8',
  ));
  assert.deepEqual(sharedRequestSchema.properties.vector, {
    type: 'array',
    items: {
      type: 'number',
      format: 'double',
      minimum: -(2 ** 100),
      maximum: 2 ** 100,
    },
    minItems: 1,
    maxItems: 4_096,
  });
  const sharedItemSchema = JSON.parse(readFileSync(
    join(repoRoot, 'schemas', 'vector.item.schema.json'),
    'utf8',
  ));
  assert.equal(sharedItemSchema.properties.fields.additionalProperties, true);
  assert.deepEqual(
    resultFields.fields.value.fields.map(({ name }) => name),
    ['title'],
    'operation result closes the shared item field map over storedFields',
  );
  assert.equal(
    vectorPageResultType(resultContract),
    'VectorPageV1<{ "title": string }, Id<"documents">>',
  );

  const unfiltered = defineTable({ embedding: v.vector(2) }).vectorIndex('by_embedding', {
    semanticVersion: 'unfiltered.embedding.v1',
    vectorField: 'embedding',
    metric: 'dot',
    fieldClassifications: { embedding: 'public' },
    visibility: { kind: 'public-read' },
    maxIndexedVectorsPerPartition: 1,
  });
  defineSchema({ unfiltered });
  const unfilteredQuery = defineVectorQuery({ table: unfiltered, index: 'by_embedding' });
  assert.equal(Object.hasOwn(unfilteredQuery.args, 'filters'), false);
  const [unfilteredOperation] = renderOperationSchemas(
    'vector-test',
    [{ name: 'unfiltered' }],
    { unfiltered: unfilteredQuery },
  );
  assert.equal(Object.hasOwn(unfilteredOperation.value.properties, 'filters'), false);

  for (const forbidden of [
    { maxScalarPairs: 384 },
    { maintenanceLimits: { vectorMaintenanceEffects: 1_024, vectorBytes: 4_194_304 } },
  ]) {
    assert.throws(
      () => defineTable({ embedding: v.vector(3) }).vectorIndex('forged', {
        semanticVersion: 'forged.v1',
        vectorField: 'embedding',
        metric: 'dot',
        fieldClassifications: { embedding: 'public' },
        visibility: { kind: 'public-read' },
        maxIndexedVectorsPerPartition: 1,
        ...forbidden,
      }),
      /unknown field/u,
      'derived/fixed facts are not authoring knobs',
    );
  }
  assert.throws(
    () => defineTable({ embedding: v.vector(3) }).vectorIndex('leak', {
      semanticVersion: 'leak.v1',
      vectorField: 'embedding',
      metric: 'dot',
      fieldClassifications: { embedding: 'public' },
      storedFields: ['embedding'],
      visibility: { kind: 'public-read' },
      maxIndexedVectorsPerPartition: 1,
    }),
    /must not expose vector field/u,
  );
  assert.throws(() => v.vector(0), /1\.\.4096/u);
  assert.throws(() => v.vector(4_097), /1\.\.4096/u);

  const declarationOrder = defineTable({
    embedding: v.vector(2),
    second: v.string(),
    first: v.integer(),
  }).vectorIndex('ordered_filters', {
    semanticVersion: 'ordered-filters.v1',
    vectorField: 'embedding',
    metric: 'l2sq',
    fieldClassifications: {
      embedding: 'public',
      second: 'public',
      first: 'public',
    },
    equalityFilters: ['second', 'first'],
    visibility: { kind: 'public-read' },
    maxIndexedVectorsPerPartition: 2,
  });
  assert.deepEqual(
    declarationOrder.vectorIndexes[0].equalityFilters,
    ['second', 'first'],
    'logical filter work follows authored declaration order, not sorted field names',
  );
  assert.throws(
    () => defineTable({ embedding: v.vector(2), approximate: v.real() }).vectorIndex('float_filter', {
      semanticVersion: 'float-filter.v1',
      vectorField: 'embedding',
      metric: 'l2sq',
      fieldClassifications: { embedding: 'public', approximate: 'public' },
      equalityFilters: ['approximate'],
      visibility: { kind: 'public-read' },
      maxIndexedVectorsPerPartition: 2,
    }),
    /LLP 0080 portable exact scalar equality/u,
  );

  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export const documents = defineTable({
  embedding: v.vector(3), category: v.optional(v.string()), title: v.string(),
}).visibility({ kind: 'public-read' }).vectorIndex('by_embedding', {
  semanticVersion: 'documents.embedding.v1', vectorField: 'embedding', metric: 'l2sq',
  fieldClassifications: { embedding: 'public', category: 'public', title: 'public' },
  equalityFilters: ['category'], storedFields: ['title'],
  visibility: { kind: 'public-read' },
  maxIndexedVectorsPerPartition: 128,
});
export default defineSchema({ documents });
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineVectorQuery } from ${JSON.stringify(defineUrl)};
import { documents } from './schema.mjs';
export const nearestDocuments = defineVectorQuery({ table: documents, index: 'by_embedding' });
`);
  // VEC-4 shipped the qualified local implementation, so the local target's
  // published facts admit generation; the artifact records the knowing bind
  // to the experimental capability (LLP 0058 capability maturity).
  const generated = await generate(backend);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const manifest = JSON.parse(
    readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  assert(
    (manifest.acknowledgedExperimentalCapabilities ?? []).includes('vector_search_v1'),
    `qualified local generation must acknowledge experimental vector_search_v1: ${
      JSON.stringify(manifest.acknowledgedExperimentalCapabilities)}`,
  );
  // A target whose capability manifest reports the structured vector GAP
  // still refuses: authoring cannot mint runtime support the target facts
  // do not publish.
  writeFileSync(join(backend, 'remote-service.publication.json'), JSON.stringify({
    profileId: 'remote-service-sqlite-ibex',
    targetProfileId: 'remote-service-sqlite-ibex',
    authCapabilityId: 'snapback.auth.vector-test',
    dataCapabilityId: 'snapback.data.vector-test',
    operations: ['nearestDocuments'],
  }));
  const refused = await generate(backend, { targetProfile: 'remote-service-sqlite-ibex' });
  assert.equal(refused.ok, false, 'a target without vector facts cannot mint runtime support');
  assert(
    refused.diagnostics.some(({ code, capability }) => (
      code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
      && capability === 'vector_search_v1'
    )),
    JSON.stringify(refused.diagnostics),
  );
  assert.equal(existsSync(join(backend, 'generated-remote-service')), false);
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('vector-authoring.test.mjs: exact authoring and target-gated support pass');
