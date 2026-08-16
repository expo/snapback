import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  AUTHORIZATION_REVIEW_FILE,
  compareAuthorizationReviews,
  createAuthorizationReview,
  renderAuthorizationReviewDiff,
  serializeAuthorizationReview,
} from './authorization-review.mjs';
import {
  captureElevatedDbUseSites,
  extractInlineHandlers,
} from './inline-handlers.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const schema = JSON.parse(readFileSync(join(packageRoot, 'authorization-review.schema.json')));
const validateSchema = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
  .compile(schema);

function operation({
  name,
  runtime,
  readTables = [],
  handlerForm = 'plan',
  authRequirement = 'authenticated',
}) {
  return {
    name,
    kind: name.includes('mutate') ? 'Mutation' : 'Query',
    handlerForm,
    authRequirement,
    authorizationDependence: ['userId'],
    readSetSummary: {
      mode: runtime.IbexModule ? 'handlerDeclared' : 'singleTable',
      primaryTable: readTables[0] ?? null,
      tables: readTables,
      authScopeField: name === 'messages.list' ? 'roomId' : null,
    },
    writeSetSummary: { mode: 'none', primaryTable: null, tables: [] },
    effectCeiling: {
      version: 1,
      basis: runtime.IbexModule ? 'declared' : 'static',
      reads: readTables,
      writes: [],
      hostOperations: [],
      authorizationInputs: ['authUserId'],
    },
    runtime,
  };
}

function projectionFixture({ reverse = false, publicMessages = false } = {}) {
  const profileGeneration = `sha256:${'a'.repeat(64)}`;
  const tableEntries = [
    ['messages', {
      name: 'messages',
      visibility: publicMessages ? { kind: 'public-read' } : {
        kind: 'membership',
        declaration: 'roomMembers',
        resourceField: 'roomId',
        roles: ['member', 'admin'],
      },
    }],
    ['roomMembers', {
      name: 'roomMembers',
      visibility: { kind: 'public-read' },
      membership: {
        id: 'roomMembers',
        principal: 'userId',
        resource: 'roomId',
        role: 'role',
        roles: ['member', 'admin'],
      },
      authorityProfile: {
        id: 'roomMembers',
        generation: profileGeneration,
        roleLattice: [
          { role: 'member', implies: ['member'] },
          { role: 'admin', implies: ['admin', 'member'] },
        ],
      },
    }],
    ['audit', {
      name: 'audit',
      permissionBacking: true,
      permissionFields: ['actor', 'scope'],
    }],
  ];
  const tables = Object.fromEntries(reverse ? tableEntries.toReversed() : tableEntries);
  const functions = [
    {
      ...operation({
        name: 'messages.list',
        runtime: { IbexModule: { source: '', export: 'list' } },
        readTables: ['roomMembers', 'messages'],
        handlerForm: 'inline',
      }),
      authorityProfileDependence: [{ id: 'roomMembers', generation: profileGeneration }],
      fieldBoundary: { fields: ['secret', 'email'], condition: 'viewer is a room member' },
    },
    operation({
      name: 'messages.mutate',
      runtime: { IbexModule: { source: '', export: 'mutate' } },
      readTables: ['messages'],
      handlerForm: 'inline',
      authRequirement: 'optional-user',
    }),
    {
      ...operation({
        name: 'messages.act',
        runtime: { IbexModule: { source: '', export: 'act' } },
        handlerForm: 'inline',
        authRequirement: 'public',
      }),
      kind: 'Action',
    },
    operation({
      name: 'messages.relational',
      runtime: { HostPlan: { RelationalQuery: { root: 'messages', joined: 'roomMembers' } } },
      readTables: ['messages', 'roomMembers'],
      authRequirement: 'optional-user',
    }),
    {
      ...operation({
        name: 'messages.single',
        runtime: {
          HostPlan: {
            Query: {
              table: 'messages',
              filters: [{ field: 'ownerId', op: 'Eq', value: { AuthUserId: true } }],
              membershipFilters: [
                {
                  declaration: 'roomMembers',
                  resource: { kind: 'rowField', field: 'roomId' },
                  roles: ['member'],
                },
                {
                  declaration: 'roomMembers',
                  resource: { kind: 'arg', path: 'roomId' },
                  roles: ['admin'],
                },
              ],
            },
          },
        },
        readTables: ['messages'],
      }),
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
    },
  ];
  const sourceFunctions = [
    {
      name: 'messages.list',
      authRequirement: 'authenticated',
      declaredReads: ['messages', 'roomMembers'],
      elevatedDbUses: [{
        member: 'query',
        table: 'messages',
        source: { file: 'functions.mjs', line: 12, column: 17 },
        capture: 'handler',
      }],
    },
    {
      name: 'messages.mutate',
      authRequirement: 'optional-user',
      declaredReads: ['messages'],
      elevatedDbUses: [{
        member: 'get',
        table: 'messages',
        source: { file: 'functions.mjs', line: 20, column: 17 },
        capture: 'handler',
      }],
    },
    {
      name: 'messages.act',
      authRequirement: 'public',
      elevatedDbUses: [{
        member: 'get',
        table: 'messages',
        source: { file: 'functions.mjs', line: 28, column: 17 },
        capture: 'handler',
      }],
    },
    { name: 'messages.relational' },
    {
      name: 'messages.single',
      standardPattern: { helper: 'owned-crud.v1', profile: 'owner.v1' },
    },
  ];
  const diagnostics = [
    {
      code: 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
      details: {
        function: 'messages.relational',
        surface: 'relationalPlan.root',
        table: 'messages',
        declaredPolicy: tables.messages.visibility,
        analysisLimit: 'table policy is not composed into this plan class',
      },
    },
    {
      code: 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
      details: {
        function: 'messages.relational',
        surface: 'relationalPlan.joined',
        table: 'roomMembers',
        declaredPolicy: tables.roomMembers.visibility,
        analysisLimit: 'table policy is not composed into this plan class',
      },
    },
  ];
  return createAuthorizationReview({
    appId: 'authorization-review-fixture',
    authMode: 'sessions',
    inputsHash: 'fixture-inputs',
    tables,
    functions: reverse ? functions.toReversed() : functions,
    sourceFunctions,
    uncomposedReadSurfaceDiagnostics: reverse ? diagnostics.toReversed() : diagnostics,
    summary: {
      tableVisibility: {
        declared: [
          { table: 'messages', kind: tables.messages.visibility.kind },
          { table: 'roomMembers', kind: 'public-read' },
        ],
        implicit: ['audit'],
      },
      implicitAuthRequirements: [],
    },
  });
}

test('projection is deterministic, schema-valid, and keeps reserved sections empty', () => {
  const first = projectionFixture();
  const reordered = projectionFixture({ reverse: true });
  assert.equal(serializeAuthorizationReview(first), serializeAuthorizationReview(reordered));
  assert.equal(validateSchema(first), true, JSON.stringify(validateSchema.errors));
  assert.deepEqual(first.fieldPolicies, []);
  assert.deepEqual(first.visibilityOverrides, []);
  assert.deepEqual(first.tablePolicyTransitions, []);
  assert.deepEqual(first.writePolicyChecks, []);
  assert(first.operations.every(({ maskedFieldUses }) => maskedFieldUses.length === 0));
  assert.equal(first.authorityProfiles[0].generation, `sha256:${'a'.repeat(64)}`);
  assert.equal(first.operations.find(({ name }) => name === 'messages.list')
    .fieldBoundary.enforcement, 'handler-residual');
  assert.equal(first.operations.find(({ name }) => name === 'messages.mutate')
    .elevatedDatabase.uses[0].member, 'get');
  assert.deepEqual(first.operations.find(({ name }) => name === 'messages.act')
    .elevatedDatabase, {
    available: false,
    captureCompleteness: 'not-applicable',
    uses: [],
  });
  assert.equal(first.operations.find(({ name }) => name === 'messages.relational')
    .authRequirement.origin, 'legacy-default');
  assert.equal(first.operations.find(({ name }) => name === 'messages.single')
    .authRequirement.origin, 'derived');
  assert.deepEqual(
    [...new Set(first.operations.map(({ authRequirement }) => authRequirement.value))].sort(),
    ['authenticated', 'optional-user', 'public'],
  );
  assert.deepEqual(
    [...new Set(first.operations.map(({ authRequirement }) => authRequirement.origin))].sort(),
    ['derived', 'explicit', 'legacy-default'],
  );
  assert.deepEqual(
    first.operations.find(({ name }) => name === 'messages.single')
      .authorizationPredicates.map(({ kind }) => kind).sort(),
    ['filter', 'membership', 'membership'],
  );
  assert.equal(first.authorizationTables.some(({ kind }) => kind === 'permission-backing'), true);
});

test('staleness comparison and human diff render structural visibility effects', () => {
  const before = projectionFixture({ publicMessages: true });
  const after = projectionFixture();
  assert.equal(compareAuthorizationReviews(serializeAuthorizationReview(after), after).current, true);
  const stale = compareAuthorizationReviews(serializeAuthorizationReview(before), after);
  assert.equal(stale.current, false);
  assert.match(stale.diff, /messages\.list:\n  visibility: public-read -> membership\(roomMembers, admin\|member\)\n  effect: narrowing/u);
  assert.equal(renderAuthorizationReviewDiff(after, after), '');
  assert.doesNotMatch(stale.diff, /safe|reviewed|approved|waived|discharged/iu);
});

test('inline and module scanners census only direct or declared elevated capabilities', () => {
  const inline = extractInlineHandlers(`
import { defineJsMutation, defineJsQuery, results } from './define.mjs';
export const list = defineJsQuery({
  args: {}, reads: ['messages'], result: results.documents('messages'),
  handler: async (ctx) => {
    const rows = await ctx.db.elevated.query('messages').collect();
    await ctx.db.elevated.get('messages', 'one');
    return rows;
  },
});
export const mutate = defineJsMutation({
  args: {}, reads: ['messages'], writes: [], result: results.value(null),
  handler: async (ctx) => ctx.db.elevated.uniqueMany('messages', 'by_slug', [['one']]),
});
`);
  assert.equal(inline.diagnostics.length, 0, JSON.stringify(inline.diagnostics));
  assert.deepEqual(
    inline.handlers.get('list').elevatedDbUses.map(({ member, table, capture }) => [member, table, capture]),
    [['query', 'messages', 'handler'], ['get', 'messages', 'handler']],
  );
  assert.deepEqual(
    inline.handlers.get('mutate').elevatedDbUses.map(({ member, table }) => [member, table]),
    [['uniqueMany', 'messages']],
  );
  const moduleUses = captureElevatedDbUseSites(`
async function list(ctx) { return ctx.db.elevated.getMany('messages', ['one']); }
async function other(ctx) { return ctx.db.elevated.query('private').collect(); }
globalThis.__snapbackHandlers = { list, other };
`, { path: 'handlers.mjs', exportName: 'list' });
  assert.deepEqual(moduleUses.map(({ member, table }) => [member, table]), [['getMany', 'messages']]);

  const helperEscape = extractInlineHandlers(`
import { defineJsQuery, results } from './define.mjs';
async function inspect(ctx) { return ctx.db.elevated.get('messages', 'one'); }
export const list = defineJsQuery({
  args: {}, reads: ['messages'], result: results.documents('messages'),
  handler: async (ctx) => inspect(ctx),
});
`);
  assert.deepEqual(
    helperEscape.diagnostics.map(({ code }) => code),
    ['SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE'],
  );
});

test('visible elevated alias, destructure, computed form, and helper escape refuse exactly once', () => {
  const bodies = [
    `async (ctx) => { const elevated = ctx.db.elevated; return elevated.get('messages', 'one'); }`,
    `async (ctx) => { const { elevated } = ctx.db; return elevated.get('messages', 'one'); }`,
    `async (ctx, args) => ctx.db.elevated[args.form]('messages', 'one')`,
  ];
  for (const [index, body] of bodies.entries()) {
    const extracted = extractInlineHandlers(`
import { defineJsQuery, results } from './define.mjs';
export const list = defineJsQuery({
  args: {}, reads: ['messages'], result: results.document('messages'), handler: ${body},
});
`);
    assert.deepEqual(
      extracted.diagnostics.map(({ code }) => code),
      ['SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE'],
      `escape fixture ${index}: ${JSON.stringify(extracted.diagnostics)}`,
    );
  }
});

test('uncomposed read-surface diagnostics are listed exactly once per operation', () => {
  const projection = projectionFixture();
  const relational = projection.operations.find(({ name }) => name === 'messages.relational');
  assert.deepEqual(
    relational.uncomposedReadSurfaces.map(({ surface, table }) => [surface, table]),
    [
      ['relationalPlan.joined', 'roomMembers'],
      ['relationalPlan.root', 'messages'],
    ],
  );
  assert.deepEqual(relational.effectiveTablePolicies, []);
  assert.equal(projection.operations.find(({ name }) => name === 'messages.single')
    .effectiveTablePolicies[0].composition, 'schema-rederived');
  assert.equal(projection.operations.find(({ name }) => name === 'messages.single')
    .elevatedDatabase.available, false);
});

test('real generation emits byte-stable mandatory consumer custody with elevated capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-authorization-review-'));
  const app = join(root, 'app');
  const backend = join(app, 'snapback');
  mkdirSync(backend, { recursive: true });
  try {
    writeFileSync(join(app, 'demo.snapback.json'), JSON.stringify({ id: 'authorization-review-real' }));
    writeFileSync(join(backend, 'codegen.policy.json'), JSON.stringify({
      schemaVersion: 'snapback.codegen-policy.v1',
      committedProjections: [],
    }));
    writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  messages: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
});
`);
    writeFileSync(join(backend, 'functions.mjs'), `
import { defineJsQuery, results } from '${defineUrl}';
export const list = defineJsQuery({
  auth: 'authenticated', args: {}, reads: ['messages'], result: results.documents('messages'),
  handler: async (ctx) => ctx.db.elevated.query('messages').collect(),
});
`);
    const first = await generate(backend);
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    const firstBytes = readFileSync(join(first.outDir, AUTHORIZATION_REVIEW_FILE), 'utf8');
    const record = first.artifactIndex.files.find(({ path }) => path === AUTHORIZATION_REVIEW_FILE);
    assert.equal(record.custody, 'consumer-committed');
    assert.equal(record.authority, '@expo/snapback-codegen/authorization-review.schema.json');
    assert.equal(first.authorizationReview.inputsHash, first.artifactIndex.inputsHash);
    assert.equal(first.authorizationReview.operations[0].elevatedDatabase.uses[0].table, 'messages');
    assert.deepEqual(first.functionManifest.functions[0].elevatedDbCapabilities, [{
      form: 'query',
      tables: ['messages'],
    }]);
    assert.equal(validateSchema(first.authorizationReview), true, JSON.stringify(validateSchema.errors));
    const second = await generate(backend);
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.equal(readFileSync(join(second.outDir, AUTHORIZATION_REVIEW_FILE), 'utf8'), firstBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
