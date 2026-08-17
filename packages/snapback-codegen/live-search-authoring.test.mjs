import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  defineLiveSearchQuery,
  defineSchema,
  defineSearchQuery,
  defineTable,
  v,
} from './define.mjs';
import { generate, routeRegisterGroupEligible } from './index.mjs';
import {
  effectiveResultContract,
  searchPageResultType,
} from './result-contracts.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dirs = [];

const publicSchema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export const incidents = defineTable({
  title: v.string(), ownerId: v.principal(), status: v.string(),
})
  .visibility({ kind: 'public-read' })
  .searchIndex('search_public', {
    semanticVersion: 'live-search.public.v1',
    textFields: { title: { weight: 8, classification: 'public' } },
    fieldClassifications: { status: 'public' },
    equalityFilters: ['status'], storedFields: ['status', 'title'],
    visibility: { kind: 'public-read' },
    liveLimits: { maxLiveSubscriptions: 32, maxLiveSubscriptionsPerConnection: 4 },
  })
  .searchIndex('search_owner', {
    semanticVersion: 'live-search.owner.v1',
    textFields: { title: { weight: 8, classification: 'private' } },
    fieldClassifications: { ownerId: 'private' },
    storedFields: ['title'], visibility: { kind: 'owner', field: 'ownerId' },
  })
  .searchLiveLimits({ maxLiveSubscriptionsPerTable: 96 });
export default defineSchema({ incidents });
`;

const functionsSource = `
import { defineLiveSearchQuery, defineSearchQuery } from ${JSON.stringify(defineUrl)};
import { incidents } from './schema.mjs';
export const liveIncidents = defineLiveSearchQuery({ table: incidents, index: 'search_public' });
export const ownerLiveIncidents = defineLiveSearchQuery({ table: incidents, index: 'search_owner' });
export const searchIncidents = defineSearchQuery({ table: incidents, index: 'search_public' });
`;

async function run({ schema = publicSchema, functions = functionsSource, routes } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-live-search-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  if (routes !== undefined) writeFileSync(join(dir, 'routes.mjs'), routes);
  return { dir, result: await generate(dir) };
}

function refused(result, pattern, label) {
  assert.equal(result.ok, false, `${label} unexpectedly generated`);
  assert.match(
    result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('\n'),
    pattern,
    label,
  );
}

try {
  const incidents = defineTable({
    title: v.string(), ownerId: v.principal(), status: v.string(),
  })
    .visibility({ kind: 'public-read' })
    .searchIndex('search_public', {
      semanticVersion: 'live-search.public.v1',
      textFields: { title: { weight: 8, classification: 'public' } },
      fieldClassifications: { status: 'public' },
      equalityFilters: ['status'], storedFields: ['status', 'title'],
      visibility: { kind: 'public-read' },
      liveLimits: { maxLiveSubscriptions: 32, maxLiveSubscriptionsPerConnection: 4 },
    })
    .searchIndex('search_owner', {
      semanticVersion: 'live-search.owner.v1',
      textFields: { title: { weight: 8, classification: 'private' } },
      fieldClassifications: { ownerId: 'private' },
      storedFields: ['title'], visibility: { kind: 'owner', field: 'ownerId' },
    })
    .searchLiveLimits({ maxLiveSubscriptionsPerTable: 96 });
  defineSchema({ incidents });
  const live = defineLiveSearchQuery({ table: incidents, index: 'search_public' });
  const ownerLive = defineLiveSearchQuery({ table: incidents, index: 'search_owner' });
  const ordinary = defineSearchQuery({ table: incidents, index: 'search_public' });

  assert.equal(live.__kind, 'LiveQuery');
  assert.equal(live.auth, 'public');
  assert.equal(live.authorityIndependent, true);
  assert.equal(Object.hasOwn(live, 'publicInline'), false);
  assert.deepEqual(Object.keys(live.args).sort(), ['limit', 'query']);
  assert.equal(Object.hasOwn(live.args, 'after'), false);
  assert.deepEqual(live.searchPlan, {
    table: 'incidents',
    index: 'search_public',
    parser: 'snapback-search-parser-v1',
    resultProjection: 'search-page-v1',
    requiredCapability: 'full_text_search_v1',
  });
  assert.equal(ownerLive.auth, 'authenticated');
  assert.equal(Object.hasOwn(ownerLive, 'authorityIndependent'), false);
  assert.equal(ordinary.__kind, 'Query');
  assert.equal(Object.hasOwn(ordinary.args, 'after'), true, 'ordinary search remains pageable');
  assert.deepEqual(incidents.searchIndexes[0].liveLimits, {
    maxLiveSubscriptions: 32,
    maxLiveSubscriptionsPerConnection: 4,
  });
  assert.deepEqual(incidents.searchLiveLimitsDeclaration, {
    maxLiveSubscriptionsPerTable: 96,
  });
  const liveResult = effectiveResultContract({
    def: live,
    functionKind: 'LiveQuery',
    runtime: { HostPlan: { SearchQuery: live.searchPlan } },
    tables: {
      incidents: {
        fields: Object.entries(incidents.fields).map(([name, field]) => ({
          name,
          field_type: field.fieldType,
          optional: field.optional,
        })),
        searchIndexes: incidents.searchIndexes,
      },
    },
  });
  assert.equal(liveResult.kind, 'records');
  const liveResultFields = Object.fromEntries(
    liveResult.record.fields.map((field) => [field.name, field]),
  );
  assert.deepEqual(liveResultFields.rowId.value, { kind: 'id', table: 'incidents' });
  assert.deepEqual(
    liveResultFields.fields.value.fields.map(({ name }) => name),
    ['status', 'title'],
  );
  assert.equal(
    searchPageResultType(liveResult),
    'SearchPageV1<{ "status": string; "title": string }, Id<"incidents">>',
  );
  assert.equal(
    routeRegisterGroupEligible(
      [{ function: 'liveIncidents', args: { query: {} } }],
      { liveIncidents: live },
    ),
    false,
    'live-search children remain excluded from register mode',
  );

  const { result } = await run();
  refused(
    result,
    /SNAPBACK_CAPABILITY_UNSUPPORTED.*live_full_text_search_v1|live_full_text_search_v1.*SNAPBACK_CAPABILITY_UNSUPPORTED/u,
    'unpublished live-search target capability',
  );
  assert.match(
    JSON.stringify(result.diagnostics),
    /https:\/\/github\.com\/expo\/snapback\/blob\/main\/guide\/operating\/diagnostics\.md#diagnose-snapbackcapabilityunsupported/u,
    'capability refusals name the public recovery guide',
  );

  const members = defineTable({
    roomId: v.string(), userId: v.principal(), role: v.string(),
  }).membership({
    id: 'members', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'],
  });
  const messages = defineTable({ roomId: v.string(), body: v.string() }).searchIndex('search', {
    semanticVersion: 'membership.v1',
    textFields: { body: { weight: 1, classification: 'private' } },
    fieldClassifications: { roomId: 'private' },
    visibility: {
      kind: 'membership', declaration: members, resourceField: 'roomId', roles: ['member'],
    },
  });
  defineSchema({ members, messages }, { auth: { mode: 'sessions' } });
  assert.throws(
    () => defineLiveSearchQuery({ table: messages, index: 'search' }),
    /does not admit membership-visible indexes/u,
  );
  assert.throws(
    () => defineLiveSearchQuery({
      table: incidents, index: 'search_public', auth: 'authenticated',
    }),
    /public-read live search requires public auth/u,
  );

  {
    const { result: invalid } = await run({
      schema: `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
const rows = defineTable({ body: v.string() }).searchLiveLimits();
export default defineSchema({ rows });
`,
      functions: 'export const none = 0;\n',
    });
    refused(invalid, /searchLiveLimits requires at least one search index/u, 'orphan table ceiling');
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log('live-search authoring tests passed');
