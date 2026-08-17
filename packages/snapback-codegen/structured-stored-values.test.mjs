import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { v } from './define.mjs';
import { generate, storedStructuredContractHash } from './index.mjs';
import {
  resultContractType,
  storedStructuredContractDescriptor,
} from './result-contracts.mjs';
import { createExternalQueryStore } from '../snapback-client/external-store.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from '../snapback-client/rqs-store-memory.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

async function compile(schemaBody, functions = 'export const nothing = 0;\n') {
  const root = mkdtempSync(join(packageRoot, '.tmp-structured-stored-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
${schemaBody}
`);
  writeFileSync(join(root, 'functions.mjs'), functions);
  return generate(root);
}

try {
  // Rust asserts the same carrier bytes/hash. Keep this fixture rich enough
  // to cover closed objects, arrays, bounds, and omission-only optionals.
  const clique = v.object({
    quote: v.object({
      author: v.string({ maxBytes: 64 }),
      text: v.string({ maxBytes: 512 }),
    }),
    options: v.array(v.object({
      label: v.string({ maxBytes: 80 }),
      votes: v.integer({ min: 0, max: 9_007_199_254_740_991 }),
      note: v.optional(v.string({ maxBytes: 128 })),
    }), { maxItems: 32 }),
  });
  const descriptor = storedStructuredContractDescriptor(clique);
  const contract = {
    version: 1,
    descriptor,
    encoding: 'canonical-json-text.v1',
  };
  assert.equal(
    storedStructuredContractHash(contract),
    'sha256:0969c39c1a3f91259a7949665d61ea93314a6182de90d1f82443f3f8c842a01c',
  );
  const cliqueType = resultContractType({ kind: 'value', value: descriptor });
  assert.equal(
    cliqueType,
    '{ "quote": { "author": string; "text": string }; "options": ReadonlyArray<{ "label": string; "votes": number; "note"?: string }> }',
  );
  assert.equal(descriptor.allowExtra, false);
  assert.equal(descriptor.fields[1].value.element.allowExtra, false);
  assert.equal(descriptor.fields[1].value.element.fields[2].required, false);

  // The descriptor-to-TypeScript projection is the shared document/context/
  // client path. Pin a valid seeded value and the CV-17 negative: a handler
  // returning the wrong nested leaf must fail the TypeScript checker.
  const typecheckRoot = mkdtempSync(join(packageRoot, '.tmp-structured-typecheck-'));
  roots.push(typecheckRoot);
  writeFileSync(join(typecheckRoot, 'seeded-handler.ts'), `
type CliqueStoredValue = ${cliqueType};
const seed: CliqueStoredValue = {
  quote: { author: 'Ada', text: 'Analytical Engines' },
  options: [{ label: 'yes', votes: 3 }],
};
const seededHandler = (): CliqueStoredValue => ({
  ...seed,
  quote: { author: 'Ada', text: 42 },
});
void seededHandler;
`);
  const typecheck = spawnSync(process.execPath, [
    join(packageRoot, '../../node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    join(typecheckRoot, 'seeded-handler.ts'),
  ], { encoding: 'utf8' });
  assert.notEqual(typecheck.status, 0, 'nested structured type mismatch must fail typecheck');
  assert.match(`${typecheck.stdout}\n${typecheck.stderr}`, /number.*not assignable.*string/i);

  // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
  // — after the reviewed support flip a native Clique schema is admitted and
  // still carries the capability requirement that protects older runtimes.
  const native = await compile(`
export default defineSchema({
  messages: defineTable({
    quotedPreview: v.object({ author: v.string(), text: v.string() }),
    pollOptions: v.array(v.object({ label: v.string(), votes: v.integer() })),
    recipientSnapshot: v.array(v.principal(), { maxItems: 32 }),
  }).visibility({ kind: 'public-read' }),
});
`);
  assert.equal(native.ok, true, JSON.stringify(native.diagnostics));
  assert(
    native.schemaManifest.requiredCapabilities.includes('structured_stored_value_v1'),
    JSON.stringify(native.schemaManifest),
  );
  assert(!native.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
  )), JSON.stringify(native.diagnostics));
  assert(!native.diagnostics.some((diagnostic) => (
    diagnostic.code.startsWith('SCHEMA_STRUCTURED_')
    && diagnostic.severity === 'error'
  )), JSON.stringify(native.diagnostics));

  const hints = await compile(`
export default defineSchema({
  rows: defineTable({
    nullableScalar: v.union([v.null(), v.string()]),
    nullableDomain: v.union([v.null(), v.literal('open'), v.literal('closed')]),
  }),
});
`);
  const hintCodes = new Set(hints.diagnostics.map(({ code }) => code));
  assert(hintCodes.has('SCHEMA_STRUCTURED_NULLABLE_SCALAR_HINT'));
  assert(hintCodes.has('SCHEMA_STRUCTURED_NULLABLE_LITERAL_UNION_HINT'));

  const refused = await compile(`
const platformRef = v.string();
platformRef.fieldType = {
  PlatformSchemaRef: { authority: 'platform', schema: 'snapback:search-query-ast:v1' },
};
platformRef.primitive = 'platformSchemaRef';
export default defineSchema({
  parents: defineTable({ name: v.string() }),
  rows: defineTable({
    asset: v.object({ value: v.assetRef({ upload: null }) }),
    id: v.object({ value: v.id('parents') }),
    relation: v.object({ value: v.relationIncarnationOf({
      foreignKeyField: 'parentId', parentTable: 'parents',
    }) }),
    vector: v.object({ value: v.vector(3) }),
    json: v.object({ value: v.json() }),
    platform: v.object({ value: platformRef }),
    tuple: v.object({ value: v.tuple([v.string(), v.integer()]) }),
  }),
});
`);
  const refusedCodes = new Set(refused.diagnostics.map(({ code }) => code));
  for (const code of [
    'SCHEMA_STRUCTURED_ASSET_REF_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_RELATION_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_VECTOR_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_JSON_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_PLATFORM_REF_INTERIOR_UNSUPPORTED',
    'SCHEMA_STRUCTURED_TUPLE_INTERIOR_UNSUPPORTED',
  ]) assert(refusedCodes.has(code), `${code}: ${JSON.stringify(refused.diagnostics)}`);

  // Vector used to bypass position branching. Nested optionality in arrays
  // and vectors now both hit the dedicated interior gate.
  const positions = await compile(`
export default defineSchema({
  rows: defineTable({
    optionalElement: v.array(v.optional(v.string())),
    nestedVector: v.array(v.vector(2)),
  }),
});
`);
  const positionCodes = new Set(positions.diagnostics.map(({ code }) => code));
  assert(positionCodes.has('SCHEMA_STRUCTURED_OPTIONAL_POSITION_INVALID'));
  assert(positionCodes.has('SCHEMA_STRUCTURED_VECTOR_INTERIOR_UNSUPPORTED'));

  // An out-of-bounds all-string literal union remains on the Enum row; it
  // cannot escape into Structured merely because Enum admission refused.
  const enumOverflow = await compile(`
export default defineSchema({
  rows: defineTable({
    state: v.union([
      v.literal('a'), v.literal('b'), v.literal('c'), v.literal('d'),
      v.literal('e'), v.literal('f'), v.literal('g'), v.literal('h'),
    ]),
  }),
});
`);
  assert(enumOverflow.diagnostics.some(({ code, message }) => (
    code === 'SCHEMA_INVALID_VALIDATOR'
    && message.includes('stored unions must be closed string-literal domains')
  )));
  assert(!enumOverflow.diagnostics.some(({ code }) => (
    code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
  )));

  const observation = await compile(`
export const rows = defineTable({
  title: v.string(),
  payload: v.object({ label: v.string() }),
  embedding: v.vector(2),
})
  .visibility({ kind: 'public-read' })
  .index('by_payload', ['payload'])
  .searchIndex('search_rows', {
    semanticVersion: 'structured-refusal.v1',
    textFields: { title: { weight: 1, classification: 'public' } },
    fieldClassifications: { title: 'public', payload: 'public' },
    equalityFilters: ['payload'], storedFields: ['payload'], highlightFields: [],
    visibility: { kind: 'public-read' },
  })
  .vectorIndex('vector_rows', {
    semanticVersion: 'structured-refusal.v1', vectorField: 'embedding', metric: 'l2sq',
    fieldClassifications: { embedding: 'public', payload: 'public' },
    equalityFilters: [], storedFields: ['payload'], visibility: { kind: 'public-read' },
    tieBreak: 'id-asc', maxIndexedVectorsPerPartition: 128,
  });
export default defineSchema({ rows });
`, `
import { asc, defineLiveQuery, defineQuery, eq, lit } from ${JSON.stringify(defineUrl)};
export const filtered = defineQuery({
  table: 'rows', filter: [eq('payload', lit({ label: 'x' }))], order: [asc('payload')],
});
export const matched = defineLiveQuery({
  table: 'rows', filter: [eq('payload', lit({ label: 'x' }))],
});
`);
  const observationCodes = new Set(observation.diagnostics.map(({ code }) => code));
  for (const code of [
    'SCHEMA_STRUCTURED_INDEX_UNSUPPORTED',
    'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID',
    'SNAPBACK_VECTOR_INDEX_INVALID',
  ]) assert(observationCodes.has(code), `${code}: ${JSON.stringify(observation.diagnostics)}`);
  const queryObservation = await compile(`
export default defineSchema({
  rows: defineTable({
    title: v.string(),
    payload: v.object({ label: v.string() }),
  }).visibility({ kind: 'public-read' }),
});
`, `
import { asc, defineLiveQuery, defineQuery, eq, lit } from ${JSON.stringify(defineUrl)};
export const filtered = defineQuery({
  table: 'rows', filter: [eq('payload', lit({ label: 'x' }))], order: [asc('payload')],
});
export const matched = defineLiveQuery({
  table: 'rows', filter: [eq('payload', lit({ label: 'x' }))],
});
`);
  const queryObservationCodes = new Set(queryObservation.diagnostics.map(({ code }) => code));
  for (const code of [
    'SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE',
    'SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE',
  ]) assert(queryObservationCodes.has(code), `${code}: ${JSON.stringify(queryObservation.diagnostics)}`);
  assert.equal(
    queryObservation.diagnostics.filter(({ code }) => (
      code === 'SNAPBACK_QUERY_FILTER_UNSUPPORTED_FIELD_TYPE'
    )).length,
    2,
    'ordinary filters and live matchers each refuse opaque structured fields',
  );
  const searchRefusals = observation.diagnostics.filter(({ code }) => (
    code === 'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID'
  ));
  assert(searchRefusals.some(({ message }) => message.includes('equality filter payload')));
  assert(searchRefusals.some(({ message }) => message.includes('stored field payload')));

  // Client lanes carry logical values without re-validating or exposing the
  // canonical storage bytes. Pin both the optimistic RYW overlay and a
  // retained-store close/reopen across the same nested structured value.
  const logicalValue = {
    quote: { author: 'Ada', text: 'Analytical Engines' },
    options: [{ label: 'yes', votes: 3 }, { label: 'later', votes: 0, note: 'ask again' }],
  };
  let delivery;
  let settleMutation;
  const queryStore = createExternalQueryStore({
    identity: 'structured-logical-roundtrip',
    start(controller) {
      delivery = controller;
      controller.ready([], 'live');
      return { dispose() {} };
    },
  });
  const unsubscribe = queryStore.subscribe(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const mutation = queryStore.runMutation(
    () => new Promise((resolve) => { settleMutation = resolve; }),
    { id: 'structured-write', optimisticRows: [{ id: 'row-1', payload: logicalValue }] },
  );
  assert.deepEqual(queryStore.getSnapshot().rows[0].payload, logicalValue);
  settleMutation({ receipt: { kind: 'mutation', idMap: [] } });
  await mutation;
  delivery.ready([{ id: 'row-1', payload: structuredClone(logicalValue) }], 'live');
  delivery.connection('disconnected');
  delivery.ready([{ id: 'row-1', payload: structuredClone(logicalValue) }], 'live');
  assert.deepEqual(queryStore.getSnapshot().rows[0].payload, logicalValue);
  unsubscribe();

  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'structured-client' });
  const firstStore = createMemoryRqsResumeStore({ backing });
  await firstStore.whenLockSettled();
  assert.equal((await firstStore.commit('structured-query', {
    rows: [{ id: 'row-1', payload: logicalValue }],
    meta: { answerClass: 'labeled-retained' },
    token: { resume: 'structured-v1' },
  })).persisted, true);
  await firstStore.close();
  const reopenedStore = createMemoryRqsResumeStore({ backing });
  await reopenedStore.whenLockSettled();
  assert.deepEqual(
    (await reopenedStore.load('structured-query')).rows[0].payload,
    logicalValue,
  );
  await reopenedStore.close();
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

  console.log('structured-stored-values.test.mjs: LLP 0211 structured storage corpus passed');
