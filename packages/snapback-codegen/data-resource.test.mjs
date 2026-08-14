import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDataFunctionRecordParity } from './data-resource.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function explicitFixture(schemaBody, { dataSync, functions = 'export const nothing = 0;\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-resource-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
${schemaBody}
`);
  writeFileSync(join(root, 'functions.mjs'), functions);
  if (dataSync !== undefined) {
    writeFileSync(join(root, 'codegen.policy.json'), JSON.stringify({
      schemaVersion: 'snapback.codegen-policy.v1',
      committedProjections: [],
      dataSync,
    }));
  }
  return root;
}

function familiarFixture(schemaBody, { dataSync } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-resource-familiar-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.ts'), `
import { defineSchema, defineTable, v } from './_generated/server';
${schemaBody}
`);
  writeFileSync(join(root, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
    ...(dataSync === undefined ? {} : { dataSync }),
  }));
  return root;
}

const ownerSchema = `
export default defineSchema({
  todos: defineTable({
    ownerId: v.principal(),
    title: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] }),
});
`;

async function expectRefusal(schema, code, options = {}) {
  const result = await generate(explicitFixture(schema, options));
  assert.equal(result.ok, false, `expected ${code}: ${JSON.stringify(result.diagnostics)}`);
  const diagnostic = result.diagnostics.find((candidate) => candidate.code === code);
  assert(diagnostic, `missing ${code}: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(typeof diagnostic.alternative, 'string', `${code} must carry remediation`);
  assert.equal(typeof diagnostic.guideAnchor, 'string', `${code} must carry a guide anchor`);
  return diagnostic;
}

test('owner DataResourceV1 lowers through canonical functions and emits conditional artifacts', async () => {
  const result = await generate(explicitFixture(ownerSchema));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.functionManifest.functions
      .filter(({ standardPattern }) => standardPattern?.helper === 'data-resource.v1')
      .map(({ name, kind }) => [name, kind]),
    [
      ['todos.list', 'LiveQuery'],
      ['todos.get', 'LiveQuery'],
      ['todos.create', 'Mutation'],
      ['todos.update', 'Mutation'],
      ['todos.delete', 'Mutation'],
    ],
  );
  const byName = Object.fromEntries(result.functionManifest.functions.map((fn) => [fn.name, fn]));
  assert.deepEqual(byName['todos.list'].argsContract.fields.map(({ name }) => name), ['after']);
  assert.equal(byName['todos.list'].resultContract.kind, 'documents');
  assert.deepEqual(byName['todos.get'].resultContract.rows, { minItems: 0, maxItems: 1 });
  assert.equal(byName['todos.create'].resultContract.kind, 'document');
  assert.equal(byName['todos.update'].resultContract.kind, 'document');
  assert.equal(byName['todos.delete'].resultContract.value.kind, 'null');
  assert.deepEqual(byName['todos.list'].runtime.HostPlan.Query.filters, [{
    field: 'ownerId',
    op: 'Eq',
    value: 'AuthUserId',
  }]);
  assert.equal(byName['todos.list'].runtime.HostPlan.Query.indexed_by, 'by_owner_created');
  const createInsert = byName['todos.create'].runtime.HostPlan.Mutation.steps[0].Insert;
  assert.equal(createInsert.values.ownerId, 'AuthUserId');
  assert.equal(createInsert.values.createdAt, 'RuntimeNow');
  assert.equal(byName['todos.create'].argsContract.fields.some(({ name }) => name === 'ownerId'), false);
  for (const operation of ['update', 'delete']) {
    const steps = byName[`todos.${operation}`].runtime.HostPlan.Mutation.steps;
    assert.equal(steps[0].Get.else_error, 'SNAPBACK_ROW_NOT_FOUND');
    assert.equal(steps[1].Guard.else_error, 'SNAPBACK_ROW_NOT_FOUND');
    assert.equal(steps[1].Guard.cond.Binary.right, 'AuthUserId');
  }
  assert.equal(byName['todos.update'].argsContract.fields.some(({ name }) => name === 'ownerId'), false);
  assert.equal(byName['todos.update'].argsContract.fields.some(({ name }) => name === 'createdAt'), false);
  assert.equal(result.schemaManifest.dataResources.length, 1);
  assert.equal(result.dataResources.length, 1);
  assert.equal(result.dataResources[0].core.surfaceProfile, 'snapback.data-surface.v1');
  assert.equal(result.dataResources[0].generation.schemaVersion, 1);
  assert.equal(result.dataResources[0].core.access.kind, 'owner');
  assert.equal(result.dataResources[0].core.capabilities.cursor, 'data-cursor.v1');
  assert.equal(result.dataResources[0].core.capabilities.retained, false);
  assert.equal(result.dataResources[0].core.operations.find(({ name }) => name === 'list').refusals[0].code, 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE');
  assert.equal(result.dataResources[0].functionReferences.find(
    ({ name }) => name === 'todos.list',
  ).argumentCapabilityRefusals, undefined, 'Phase 2 admits a present data cursor');
  assert.match(readFileSync(join(result.outDir, 'api.d.ts'), 'utf8'), /after\?: DataCursorV1/u);
  assert(readFileSync(join(result.outDir, 'data.mjs'), 'utf8').includes('normalizedDataResourceId'));
  assert(readFileSync(join(result.outDir, 'data.d.ts'), 'utf8').includes('DataResourceName'));
});

test('dataSync disabled emits Query reads while retaining server writes', async () => {
  const result = await generate(explicitFixture(ownerSchema, { dataSync: 'disabled' }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const generated = result.functionManifest.functions.filter(
    ({ standardPattern }) => standardPattern?.helper === 'data-resource.v1',
  );
  assert.deepEqual(generated.slice(0, 2).map(({ kind }) => kind), ['Query', 'Query']);
  assert.deepEqual(generated.slice(2).map(({ kind }) => kind), ['Mutation', 'Mutation', 'Mutation']);
  assert.equal(result.dataResources[0].core.sync.enabled, false);
  assert.equal(result.dataResources[0].core.capabilities.localMaterialization, false);
});

test('canonical function parity gate refuses top-level and recursive drift', () => {
  const base = {
    name: 'todos.list',
    id: 'app:todos.list',
    exportedName: 'todos.list',
    kind: 'Query',
    sourceSpan: null,
    handlerForm: 'plan',
    implementationHash: 'sha256:test',
    argsContractHash: 'sha256:test',
    argsContract: { fields: [] },
    resultContract: { kind: 'value', value: { kind: 'null' } },
    resultContractHash: 'sha256:test',
    requiredCapabilities: [],
    authRequirement: 'public',
    syncabilityClass: 'query',
    readSetSummary: { mode: 'query', primaryTable: 'todos', tables: ['todos'], authScopeField: null },
    writeSetSummary: { mode: 'none', primaryTable: null, tables: [] },
    effectCeiling: { version: 'EffectCeilingV1', basis: 'plan', reads: [], writes: [], authorizationInputs: [], hostOperations: [] },
    standardPattern: { helper: 'data-resource.v1', profile: 'public-read.v1' },
    bundleEntrypoint: 'todos.list',
    uses: [],
    runtime: {
      HostPlan: {
        Query: {
          filters: [],
          indexed_by: 'by_title',
          limit: 100,
          membershipFilters: [],
          order: [],
          table: 'todos',
          tableVisibility: { kind: 'public-read' },
        },
      },
    },
  };
  assert.equal(assertDataFunctionRecordParity(base), true);
  assert.throws(
    () => assertDataFunctionRecordParity({ ...base, futureFact: true }),
    /unclassified canonical field futureFact/,
  );
  assert.throws(
    () => assertDataFunctionRecordParity({
      ...base,
      effectCeiling: { ...base.effectCeiling, futureFact: true },
    }),
    /unclassified canonical field effectCeiling\.futureFact/,
  );
  assert.throws(
    () => assertDataFunctionRecordParity({
      ...base,
      runtime: {
        HostPlan: {
          Query: { ...base.runtime.HostPlan.Query, futureFact: true },
        },
      },
    }),
    /unclassified canonical field runtime\.HostPlan\.Query\.futureFact/,
  );
});

test('explicit and familiar A1 declarations mint the same normalized resource witness', async () => {
  const explicit = await generate(join(repoRoot, 'tests', 'fixtures', 'data-resource-a1-explicit'));
  const familiar = await generate(join(repoRoot, 'tests', 'fixtures', 'data-resource-a1-familiar'));
  assert.equal(explicit.ok, true, JSON.stringify(explicit.diagnostics));
  assert.equal(familiar.ok, true, JSON.stringify(familiar.diagnostics));
  assert.equal(
    familiar.dataResources[0].normalizedDataResourceId,
    explicit.dataResources[0].normalizedDataResourceId,
  );
  assert.deepEqual(familiar.dataResources[0].core, explicit.dataResources[0].core);
  assert.equal(familiar.dataResources[0].generation.authoringProfile, 'snapback-familiar-ts-v1');
  assert.equal(explicit.dataResources[0].generation.authoringProfile, 'snapback-explicit-v1');
});

test('Appendix A2 explicit defineOwnedCrud remains executable and unchanged', async () => {
  const result = await generate(join(repoRoot, 'tests', 'fixtures', 'data-resource-a2-explicit'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(Object.hasOwn(result.schemaManifest, 'dataResources'), false);
  assert.deepEqual(result.functionManifest.functions.map(({ name }) => name).sort(), [
    'listTodos', 'getTodo', 'createTodo', 'updateTodo', 'deleteTodo',
  ].sort());
  assert(result.functionManifest.functions.every(
    ({ standardPattern }) => standardPattern?.helper === 'owned-crud.v1',
  ));
});

test('public-read resources generate only bounded reads and admit bare v.id fields', async () => {
  const stringOwner = await generate(explicitFixture(`
export default defineSchema({
  notes: defineTable({ ownerKey: v.string(), body: v.string() })
    .index('by_owner', ['ownerKey'])
    .visibility({ kind: 'owner', field: 'ownerKey' })
    .data(),
});
`));
  assert.equal(stringOwner.ok, true, JSON.stringify(stringOwner.diagnostics));
  assert.equal(stringOwner.dataResources[0].core.access.ownerField, 'ownerKey');

  const result = await generate(explicitFixture(`
export default defineSchema({
  posts: defineTable({ authorId: v.id('authors'), title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title' }),
  authors: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
});
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const generated = result.functionManifest.functions.filter(
    ({ standardPattern }) => standardPattern?.helper === 'data-resource.v1',
  );
  assert.deepEqual(generated.map(({ name, kind }) => [name, kind]), [
    ['posts.list', 'LiveQuery'],
    ['posts.get', 'LiveQuery'],
  ]);
  assert.equal(result.dataResources[0].core.capabilities.write, false);
  assert.equal(result.dataResources[0].core.capabilities.offlineCustody, false);
  assert(result.dataResources[0].core.fields.some(({ name }) => name === 'authorId'));
});

test('search/vector indexes and asset sharing stay preserved but invisible to data resources', async () => {
  const result = await generate(explicitFixture(`
export default defineSchema({
  z_searchable: defineTable({ title: v.string() })
    .index('by_title', ['title'])
    .searchIndex('search_title', {
      semanticVersion: 'data-resource-search.v1',
      textFields: { title: { weight: 1, classification: 'public' } },
      storedFields: ['title'],
      visibility: { kind: 'public-read' },
    })
    .assetSharing({ kind: 'public-read' })
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title' }),
  a_vectorized: defineTable({ embedding: v.vector(2), title: v.string() })
    .index('by_title', ['title'])
    .vectorIndex('by_embedding', {
      semanticVersion: 'data-resource-vector.v1',
      vectorField: 'embedding',
      metric: 'l2sq',
      fieldClassifications: { embedding: 'public', title: 'public' },
      storedFields: ['title'],
      visibility: { kind: 'public-read' },
      tieBreak: 'id-asc',
      maxIndexedVectorsPerPartition: 128,
    })
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title' }),
});
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.dataResources.map(({ core }) => core.resource), ['a_vectorized', 'z_searchable']);
  assert(result.schemaManifest.tables.find(({ name }) => name === 'z_searchable').searchIndexes.length === 1);
  assert(result.schemaManifest.tables.find(({ name }) => name === 'a_vectorized').vectorIndexes.length === 1);
  for (const { core } of result.dataResources) {
    assert.equal(Object.hasOwn(core, 'searchIndexes'), false);
    assert.equal(Object.hasOwn(core, 'vectorIndexes'), false);
    assert.equal(Object.hasOwn(core, 'assetSharing'), false);
    assert.equal(core.operations.every(({ name }) => name === 'list' || name === 'get'), true);
  }
});

test('zero-resource generation omits every data semantic and bundle byte', async () => {
  const result = await generate(explicitFixture(`
export default defineSchema({
  notes: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
});
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(Object.hasOwn(result.schemaManifest, 'dataResources'), false);
  assert.equal(Object.hasOwn(result.functionManifest, 'dataQueryCatalog'), false);
  assert.equal(Object.hasOwn(result.semanticInput, 'dataSurface'), false);
  assert.equal(result.artifactIndex.files.some(({ path }) => path === 'data.mjs'), false);
  assert.equal(result.artifactIndex.files.some(({ path }) => path === 'data.d.ts'), false);
});

test('the complete Phase 1 declaration and eligibility refusal matrix fails closed', async () => {
  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.optional(v.principal()) })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() }).index('by_owner', ['ownerId']).data(),
});
`, 'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ firstOwner: v.principal(), secondOwner: v.principal() })
    .index('by_owner', ['firstOwner'])
    .visibility({ kind: 'any-of', arms: [
      { kind: 'owner', field: 'firstOwner' },
      { kind: 'owner', field: 'secondOwner' },
    ] })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() })
    .permissionBacking()
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  await expectRefusal(`
export default defineSchema({
  grants: defineTable({ principalId: v.principal(), role: v.string() })
    .membership({ scope: 'app', principal: 'principalId', role: 'role', roles: ['member'] })
    .authorityProfile({
      name: 'grants',
      hierarchy: { member: [] },
      roster: { visible: ['principalId', 'role'] },
    })
    .index('by_principal', ['principalId'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_principal' }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  await expectRefusal(`
export default defineSchema({
  seats: defineTable({ principalId: v.principal(), role: v.string() })
    .membership({ scope: 'app', principal: 'principalId', role: 'role', roles: ['member'] })
    .index('by_principal', ['principalId'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_principal' }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() })
    .history({ retainMs: 1000, maxVersionsPerRecord: 2 })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  await expectRefusal(`
export default defineSchema({
  parents: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  children: defineTable({
    parentId: v.id('parents'),
    parentIncarnation: v.relationIncarnationOf({ foreignKeyField: 'parentId', parentTable: 'parents' }),
  })
    .index('by_parent', ['parentId'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_parent' }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  const tooManyFields = Array.from({ length: 65 }, (_, index) => `f${index}: v.string()`).join(',\n');
  await expectRefusal(`
export default defineSchema({
  records: defineTable({ ${tooManyFields} })
    .index('by_f0', ['f0'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_f0' }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  const tooManyIndexes = Array.from(
    { length: 17 },
    (_, index) => `.index('by_owner_${index}', ['ownerId'])`,
  ).join('\n');
  await expectRefusal(`
export default defineSchema({
  records: defineTable({ ownerId: v.principal() })
    ${tooManyIndexes}
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ listIndex: 'by_owner_0' }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), slug: v.string() })
    .index('by_owner', ['ownerId'])
    .index('by_slug', ['slug'], { unique: true })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  for (const ownerWriteFact of [
    "createDefaults: { ownerId: 'id' }",
    "updateDefaults: { ownerId: 'id' }",
    "immutable: ['ownerId']",
  ]) {
    await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ ${ownerWriteFact} }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');
  }

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), touchedAt: v.integer() })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ updateDefaults: { touchedAt: 'now' }, immutable: ['touchedAt'] }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');

  for (const forbidden of ['createDefaults: {}', 'updateDefaults: {}', 'immutable: []']) {
    await expectRefusal(`
export default defineSchema({
  posts: defineTable({ title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title', ${forbidden} }),
});
`, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');
  }
});

test('terminal grammar, list-index fill, sync provenance, and name collisions have stable diagnostics', async () => {
  await expectRefusal(`
export default defineSchema({
  posts: defineTable({ title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title', surprise: true }),
});
`, 'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID');

  await expectRefusal(`
export default defineSchema({
  posts: defineTable({ title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title' })
    .index('late', ['title']),
});
`, 'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID');

  await expectRefusal(`
export default defineSchema({
  posts: defineTable({ title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'public-read' })
    .data({ listIndex: 'by_title' })
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), title: v.string() })
    .index('by_title', ['title'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED');

  const explicitPrecedence = await generate(explicitFixture(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), createdAt: v.integer() })
    .index('by_owner', ['ownerId'])
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ listIndex: 'by_owner_created' }),
});
`));
  assert.equal(explicitPrecedence.ok, true, JSON.stringify(explicitPrecedence.diagnostics));
  assert.equal(explicitPrecedence.dataResources[0].core.indexes.find(({ listIndex }) => listIndex).name, 'by_owner_created');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), createdAt: v.integer() })
    .index('by_owner', ['ownerId'])
    .index('by_owner_created', ['ownerId', 'createdAt'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data(),
});
`, 'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), title: v.string() })
    .index('by_owner', ['ownerId'])
    .index('by_title', ['title'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .data({ listIndex: 'by_title' }),
});
`, 'SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED');

  await expectRefusal(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync()
    .data(),
});
`, 'SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN');

  const familiarAuthoredSync = await generate(familiarFixture(`
export default defineSchema({
  todos: defineTable({ ownerId: v.principal() })
    .index('by_owner', ['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync()
    .data(),
});
`));
  assert.equal(familiarAuthoredSync.ok, false);
  const familiarSyncDiagnostic = familiarAuthoredSync.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN',
  );
  assert(familiarSyncDiagnostic, JSON.stringify(familiarAuthoredSync.diagnostics));
  assert.equal(typeof familiarSyncDiagnostic.guideAnchor, 'string');

  const collisionFunctions = `
import { defineQuery } from ${JSON.stringify(defineUrl)};
const collision = defineQuery({ table: 'todos', auth: 'authenticated' });
export { collision as 'todos.list' };
`;
  await expectRefusal(ownerSchema, 'SNAPBACK_DATA_OPERATION_NAME_COLLISION', {
    functions: collisionFunctions,
  });

  await expectRefusal(`
export default defineSchema({
  notes: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
});
`, 'SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID', { dataSync: 'disabled' });
});
