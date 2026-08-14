import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  dataQueryDomainHash,
  resolveDataQueryCandidateV1,
} from './data-query.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture({ query, schema = null }) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-query-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), schema ?? `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({
    ownerId: v.principal(),
    status: v.string(),
    title: v.string(),
    createdAt: v.optional(v.integer()),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_status_created', ['ownerId', 'status', 'createdAt'])
    .data({ createDefaults: { createdAt: 'now' }, immutable: ['createdAt'] }),
});
`);
  writeFileSync(join(root, 'functions.mjs'), 'export const nothing = 0;\n');
  if (query !== null) writeFileSync(join(root, 'query.ts'), query);
  return root;
}

const a1Query = `
declare const data: any;
export const firstPage = data.todos
  .using('by_owner_status_created')
  .orderBy('status', 'asc')
  .take(100);
`;

test('A1 static query mints the pre-resolution witness and exact-matches todos.list', async () => {
  const result = await generate(fixture({ query: a1Query }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.dataQueries.length, 1);
  const [query] = result.dataQueries;
  assert.equal(query.core.format, 'snapback.normalized-data-query.v1');
  assert.equal(query.resolution.kind, 'existing-generated');
  assert.equal(query.resolution.exportedName, 'todos.list');
  assert.equal(query.functionReference.name, 'todos.list');
  assert.equal(query.artifactKind, 'dataQuery');
  assert.equal(query.schemaVersion, 'snapback.data-query.v1');
  assert.equal(query.generation.generationId, result.identities.generationId);
  assert.equal(query.generation.semanticId, result.identities.semanticId);
  assert.equal(query.generation.executableId, result.identities.executableId);
  assert.equal(query.generation.bundleId, result.identities.bundleId);
  assert.deepEqual(result.semanticInput.dataSurface.queryCatalog, [{
    id: query.normalizedDataQueryId,
    core: query.core,
  }]);
  const list = result.functionManifest.functions.find(({ name }) => name === 'todos.list');
  assert.equal(
    query.core.planHash,
    dataQueryDomainHash('snapback:data-plan:v1', list.runtime.HostPlan),
    'the witness plan hash must equal independent recomputation over the admitted plan',
  );
  assert.deepEqual(query.core.filters, []);
  assert.deepEqual(query.core.order, { field: 'status', direction: 'asc', totalizer: '_id' });
});

test('scalar equality canonicalizes with explicit eq and synthesis uses dense named slots', async () => {
  const result = await generate(fixture({ query: `
declare const data: any;
declare const statusValue: string;
export const scalar = data.todos.using('by_owner_status_created')
  .where({ status: statusValue }).orderBy('createdAt', 'desc')
  .select(['title', '_id']).take(25);
export const explicit = data.todos.using('by_owner_status_created')
  .where({ status: { eq: statusValue } }).orderBy('createdAt', 'desc')
  .select(['title', '_id']).take(25);
` }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.dataQueries.length, 1, 'equivalent predicate spellings share one witness');
  const [query] = result.dataQueries;
  assert.equal(query.resolution.kind, 'synthesized-generated');
  assert.match(query.resolution.exportedName, /^todos\.query_[0-9a-f]{16}$/u);
  assert.deepEqual(query.core.filters, [{ field: 'status', operator: 'eq', slots: [0] }]);
  assert.deepEqual(query.core.projection, { kind: 'selected-fields', fields: ['_id', 'title'] });
  assert.deepEqual(query.arguments, [null]);
  const synthesized = result.functionManifest.functions.find(
    ({ name }) => name === query.resolution.exportedName,
  );
  assert(synthesized, 'the synthesized member is an ordinary emitted function');
  assert.deepEqual(synthesized.argsContract.fields.map(({ name }) => name), ['status', 'after']);
  assert.deepEqual(synthesized.standardPattern, {
    helper: 'data-query.v1',
    profile: 'bounded-index.v1',
  });

  const moduleUrl = `${pathToFileURL(join(result.outDir, 'data.mjs')).href}?test=${Date.now()}`;
  const generated = await import(moduleUrl);
  const page1 = generated.data.todos.using('by_owner_status_created')
    .where({ status: 'open' }).orderBy('createdAt', 'desc')
    .select(['title', '_id']).take(25);
  const cursor = `dc1.${Buffer.from('{"v":1}').toString('base64url')}`;
  const page2 = page1.after(cursor);
  assert.deepEqual(page1.arguments, ['open']);
  assert.deepEqual(page1.namedArguments, { status: 'open' });
  assert.deepEqual(page2.namedArguments, { status: 'open', after: cursor });
  assert.equal(page2.after, undefined, 'after is terminal in the generated runtime typestate');
  assert.equal(page1.canonicalArgsDigest, page2.canonicalArgsDigest);
  assert.equal(page1.functionReference.name, query.resolution.exportedName);
  assert.deepEqual(generated.explainDataQuery(page1).filters, query.core.filters);
  assert.throws(
    () => page1.after('not-a-data-cursor'),
    ({ code }) => code === 'SNAPBACK_DATA_CURSOR_INVALID',
  );
  assert.throws(
    () => generated.data.todos.using('by_owner_status_created')
      .where({ status: 'open' }).orderBy('createdAt', 'desc')
      .select(['title', '_id']).take(24),
    ({ code }) => code === 'SNAPBACK_DATA_QUERY_NOT_CATALOGUED',
  );
});

test('index-order filters, range slots, and projection order canonicalize to one runtime descriptor', async () => {
  const result = await generate(fixture({ query: `
declare const data: any;
declare const statusValue: string;
declare const lower: number;
declare const upper: number;
export const authoredOrder = data.todos.using('by_owner_status_created')
  .where({ createdAt: { lt: upper, gte: lower }, status: statusValue })
  .orderBy('createdAt', 'desc').select(['title', '_id']).take(20);
export const canonicalOrder = data.todos.using('by_owner_status_created')
  .where({ status: { eq: statusValue }, createdAt: { gte: lower, lt: upper } })
  .orderBy('createdAt', 'desc').select(['_id', 'title']).take(20);
` }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.dataQueries.length, 1, 'source key/list order is outside query identity');
  const [query] = result.dataQueries;
  assert.deepEqual(query.core.filters, [
    { field: 'status', operator: 'eq', slots: [0] },
    { field: 'createdAt', operator: 'gte-lt', slots: [1, 2] },
  ]);
  assert.deepEqual(query.core.projection, {
    kind: 'selected-fields',
    fields: ['_id', 'title'],
  });
  const synthesized = result.functionManifest.functions.find(
    ({ name }) => name === query.resolution.exportedName,
  );
  assert.deepEqual(
    synthesized.argsContract.fields.map(({ name }) => name),
    ['status', 'createdAt_gte', 'createdAt_lt', 'after'],
  );
  assert.deepEqual(
    synthesized.runtime.HostPlan.Query.order.map(({ field, direction }) => ({ field, direction })),
    [
      { field: 'status', direction: 'Desc' },
      { field: 'createdAt', direction: 'Desc' },
    ],
    'the executable order carries every post-policy-prefix index field',
  );

  const generated = await import(
    `${pathToFileURL(join(result.outDir, 'data.mjs')).href}?test=${Date.now()}`,
  );
  const descriptor = generated.data.todos.using('by_owner_status_created')
    .where({ createdAt: { lt: 9, gte: 2 }, status: 'open' })
    .orderBy('createdAt', 'desc').select(['title', '_id']).take(20);
  assert.deepEqual(descriptor.arguments, ['open', 2, 9]);
  assert.deepEqual(descriptor.namedArguments, {
    status: 'open',
    createdAt_gte: 2,
    createdAt_lt: 9,
  });
  assert.equal(JSON.stringify(descriptor.explain).includes('open'), false, 'explain redacts row/filter values');
});

test('in predicates deduplicate values and enforce the first runtime ceiling', async () => {
  const result = await generate(fixture({ query: `
declare const data: any;
declare const statuses: readonly string[];
data.todos.using('by_owner_status_created')
  .where({ status: { in: statuses } }).orderBy('status', 'asc').take(10);
` }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const generated = await import(
    `${pathToFileURL(join(result.outDir, 'data.mjs')).href}?test=${Date.now()}`,
  );
  const descriptor = generated.data.todos.using('by_owner_status_created')
    .where({ status: { in: ['open', 'open', 'closed'] } })
    .orderBy('status', 'asc').take(10);
  assert.deepEqual(descriptor.arguments, [['open', 'closed']]);
  assert.throws(
    () => generated.data.todos.using('by_owner_status_created')
      .where({}).orderBy('status', 'asc').take(10),
    ({ code }) => code === 'SNAPBACK_DATA_QUERY_SHAPE_INVALID',
  );
  assert.throws(
    () => generated.data.todos.using('by_owner_status_created')
      .where({ status: { in: Array.from({ length: 33 }, (_, index) => String(index)) } })
      .orderBy('status', 'asc').take(10),
    ({ code }) => code === 'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
  );
});

test('static extraction refuses dynamic shapes, invalid grammar, and first exceeded bounds', async () => {
  const cases = [
    {
      code: 'SNAPBACK_DATA_QUERY_NOT_CATALOGUED',
      query: `declare const data:any; declare const index:string; data.todos.using(index).orderBy('status','asc').take(2);`,
    },
    {
      code: 'SNAPBACK_DATA_QUERY_SHAPE_INVALID',
      query: `declare const data:any; data.todos.using('by_owner_status_created').take(2).orderBy('status','asc');`,
    },
    {
      code: 'SNAPBACK_DATA_QUERY_BOUND_EXCEEDED',
      query: `declare const data:any; data.todos.using('by_owner_status_created').orderBy('status','asc').take(201);`,
    },
  ];
  for (const entry of cases) {
    const result = await generate(fixture({ query: entry.query }));
    assert.equal(result.ok, false, `${entry.code}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(result.diagnostics[0].code, entry.code, 'the first violated rule owns refusal');
  }
});

test('table-scoped slot grammar collisions refuse resource eligibility', async () => {
  const schema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), foo: v.integer(), foo_gt: v.integer() })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_foo', ['ownerId', 'foo'])
    .data(),
});
`;
  const result = await generate(fixture({ schema, query: null }));
  assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0].code, 'SNAPBACK_DATA_RESOURCE_INELIGIBLE');
});

test('public-read query resolution preserves authority-independent executable policy shape', async () => {
  const schema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  posts: defineTable({ slug: v.string(), title: v.string() })
    .visibility({ kind: 'public-read' })
    .index('by_slug', ['slug'])
    .data({ listIndex: 'by_slug' }),
});
`;
  const result = await generate(fixture({ schema, query: `
declare const data: any;
data.posts.using('by_slug').orderBy('slug', 'asc').take(100);
` }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const [query] = result.dataQueries;
  assert.equal(query.resolution.kind, 'existing-generated');
  assert.equal(query.resolution.exportedName, 'posts.list');
  const list = result.functionManifest.functions.find(({ name }) => name === 'posts.list');
  assert.equal(list.authorityIndependent, true);
  assert.equal(Object.hasOwn(list.runtime.HostPlan.Query, 'tableVisibility'), false);
  assert.equal(
    query.core.planHash,
    dataQueryDomainHash('snapback:data-plan:v1', list.runtime.HostPlan),
  );
});

test('owner-only index preserves descending _id direction without duplicating the cursor key', async () => {
  const schema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  notes: defineTable({ ownerId: v.principal(), body: v.string() })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner', ['ownerId'])
    .data(),
});
`;
  const result = await generate(fixture({ schema, query: `
declare const data: any;
data.notes.using('by_owner').orderBy('_id', 'desc').take(1);
` }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const [query] = result.dataQueries;
  assert.equal(query.resolution.kind, 'synthesized-generated');
  const synthesized = result.functionManifest.functions.find(
    ({ name }) => name === query.resolution.exportedName,
  );
  assert.deepEqual(synthesized.runtime.HostPlan.Query.order, [{
    field: '_id',
    direction: 'Desc',
  }]);
  assert.deepEqual(query.core.order, {
    field: '_id',
    direction: 'desc',
    totalizer: '_id',
  });
});

test('ambiguous exact resolution is a typed refusal with no ordering tie-break', () => {
  assert.throws(
    () => resolveDataQueryCandidateV1([
      { id: 'app:todos.list-a' },
      { id: 'app:todos.list-b' },
    ], `sha256:${'a'.repeat(64)}`),
    (error) => error.code === 'SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS'
      && error.details.candidates.length === 2,
  );
});
