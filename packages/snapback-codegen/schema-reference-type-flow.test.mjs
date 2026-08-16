import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const tsc = join(packageDir, '..', '..', 'node_modules', '.bin', 'tsc');
const packageManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
assert.deepEqual(packageManifest.exports['./ctx'], { types: './ctx.d.mts' });
assert(packageManifest.files.includes('ctx.d.mts'));
const root = mkdtempSync(join(tmpdir(), 'snapback-schema-ref-type-flow-'));
const expoModules = join(root, 'node_modules', '@expo');
mkdirSync(expoModules, { recursive: true });
symlinkSync(packageDir, join(expoModules, 'snapback-codegen'), 'dir');

const schemaSource = (extraField = '') => `
  import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
  const orgMembers = defineTable({
    orgId: v.id('orgs'),
    userId: v.principal(),
    role: v.string(),
    note: v.optional(v.string()),
  }).membership({
    id: 'orgMembers',
    principal: 'userId',
    resource: 'orgId',
    role: 'role',
    roles: ['member'],
    bootstrapRole: 'member',
    lastHolder: { protect: 'member' },
    transitions: [
      { op: 'insert', by: ['none'], target: 'self', to: ['member'] },
    ],
  });
  export default defineSchema({
    orgs: defineTable({ name: v.string(), tagline: v.optional(v.string()) }).sync(),
    customers: defineTable({
      orgId: v.id('orgs'),
      name: v.string(),
      region: v.string(),
      createdAt: v.integer(),
      nickname: v.optional(v.string()),
      ${extraField}
    }).index('by_org', ['orgId']).sync(),
    orgMembers,
  });
`;

const functionsSource = (resultTable = 'customers', args = "{ orgId: v.id('orgs') }") => `
  import { defineJsMutation, defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
  export const listCustomers = defineJsQuery({
    auth: 'authenticated',
    args: ${args},
    reads: ['customers'],
    result: results.records(v.doc(${JSON.stringify(resultTable)})),
    handler: async (ctx, args) => ctx.db.query('customers')
      .withIndex('by_org').eq('orgId', args.orgId).collect(),
  });
  export const listCustomersDocuments = defineJsQuery({
    args: { orgId: v.id('orgs') },
    reads: ['customers'],
    result: results.documents('customers'),
    handler: async (ctx, args) => ctx.db.query('customers')
      .withIndex('by_org').eq('orgId', args.orgId).collect(),
  });
  export const customerEnvelopes = defineJsQuery({
    args: { orgId: v.id('orgs') },
    reads: ['customers'],
    result: results.records(v.object({ customer: v.doc('customers') })),
    handler: async (ctx, args) => {
      const rows = await ctx.db.query('customers')
        .withIndex('by_org').eq('orgId', args.orgId).collect();
      return rows.map((customer) => ({ customer }));
    },
  });
  export const updateCustomer = defineJsMutation({
    auth: 'authenticated',
    args: { orgId: v.id('orgs'), customerId: v.id('customers') },
    writes: ['customers', 'orgMembers'],
    result: results.value(v.boolean()),
    handler: async (ctx, args) => {
      await ctx.db.patch('customers', args.customerId, { nickname: null });
      await ctx.membership.orgMembers.insert({
        orgId: args.orgId,
        userId: ctx.auth.userId,
        role: 'member',
        note: null,
      });
      return true;
    },
  });
`;

function functionManifest(name = 'listCustomers') {
  return JSON.parse(readFileSync(join(root, 'generated', 'functions.manifest.json'), 'utf8'))
    .functions.find((fn) => fn.name === name);
}

function checkJs(file) {
  return spawnSync(tsc, [
    '--allowJs',
    '--checkJs',
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    file,
  ], { cwd: root, encoding: 'utf8' });
}

try {
  writeFileSync(join(root, 'schema.mjs'), schemaSource());
  writeFileSync(join(root, 'functions.mjs'), functionsSource());

  let generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const first = functionManifest();
  assert.equal(first.resultContract.kind, 'documents');
  assert.equal(first.resultContract.document.kind, 'object');
  assert.equal(first.resultContract.document.allowExtra, false);
  assert.deepEqual(
    first.resultContract.document.fields.map(({ name }) => name),
    ['_id', '_version', '_createdAt', '_updatedAt', 'orgId', 'name', 'region', 'createdAt', 'nickname'],
    'v.doc() expands to the same complete frozen document contract as the schema manifest',
  );
  assert.deepEqual(first.resultContract, functionManifest('listCustomersDocuments').resultContract);
  assert.equal(
    first.resultContractHash,
    functionManifest('listCustomersDocuments').resultContractHash,
    'top-level v.doc(table) preserves the shipped results.documents(table) witness',
  );
  const nestedDocument = functionManifest('customerEnvelopes').resultContract.record.fields
    .find(({ name }) => name === 'customer').value;
  assert.deepEqual(nestedDocument, first.resultContract.document);
  assert.doesNotMatch(
    JSON.stringify(first.resultContract),
    /appSchemaRef/u,
    'the authoring reference never becomes a second deployed contract node',
  );

  const firstHash = first.resultContractHash;
  const firstTypes = readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8');
  assert.match(firstTypes, /export type \* from '@expo\/snapback-codegen\/ctx'/u);
  assert.match(firstTypes, /export type GeneratedQueryDatabase = QueryDatabase<GeneratedHandlerSchema>/u);
  assert.match(firstTypes, /export type GeneratedMutationDatabase = MutationDatabase<GeneratedHandlerSchema>/u);
  assert.match(firstTypes, /GeneratedReadableTableName = Exclude<GeneratedTableName, "orgMembers">/u);
  assert.match(firstTypes, /GeneratedInsertableTableName = Exclude<GeneratedReadableTableName, "orgs">/u);
  assert.match(firstTypes, /GeneratedPatchableTableName = GeneratedReadableTableName/u);
  assert.match(firstTypes, /GeneratedDeletableTableName = Exclude<GeneratedReadableTableName, "orgs">/u);
  assert.match(firstTypes, /"nickname"\?: null \| string/u);
  assert.match(firstTypes, /export type OrgMembersInsert = \{[^\n]+note\?: null \| string/u);
  assert.match(firstTypes, /export type OrgMembersPatch = \{ note\?: null \| string \}/u);
  assert.match(firstTypes, /export type OrgMembersBootstrap = \{ name: string; tagline\?: null \| string \}/u);
  assert.match(firstTypes, /GeneratedAnonymousAuthContext = AnonymousAuthContext/u);
  assert.match(firstTypes, /GeneratedAuthenticatedAuthContext = AuthenticatedAuthContext<Principal>/u);
  assert.match(firstTypes, /GeneratedMutationSettlement = MutationSettlement/u);
  assert.match(firstTypes, /GeneratedMutationContext<Auth[^\n]+MutationContext<GeneratedHandlerSchema/u);
  assert.match(firstTypes, /JobsContext, SequenceContext, MutationIdentityContext/u);
  assert.match(firstTypes, /"listCustomers": GeneratedQueryContext<GeneratedAuthenticatedAuthContext>;/u);
  assert.match(firstTypes, /"listCustomers": FunctionReference<[^\n]+ReadonlyArray<\{ "_id": Id<"customers">/u);
  assert.doesNotMatch(firstTypes, /"listCustomers": FunctionReference<[^\n]+GeneratedDataModel\["customers"\]/u);
  assert.match(firstTypes, /"customerEnvelopes": FunctionReference<[^\n]+"createdAt": number/u);

  // A context-reader helper and its handler both consume the one generated
  // schema/contract artifact. The query context must not acquire write power.
  writeFileSync(join(root, 'interior-types.fixture.mjs'), `
    // @ts-check
    /**
     * @param {import('./generated/api.js').GeneratedQueryDatabase} db
     * @param {import('./generated/api.js').Id<'orgs'>} orgId
     */
    async function customerRows(db, orgId) {
      return db.query('customers').withIndex('by_org').eq('orgId', orgId).collect();
    }
    /** @type {import('./generated/api.js').GeneratedHandler<'listCustomers'>} */
    export const handler = async (ctx, args) => {
      const rows = await customerRows(ctx.db, args.orgId);
      await ctx.db.elevated.get(
        'customers',
        /** @type {import('./generated/api.js').Id<'customers'>} */ ('customer_1'),
      );
      await ctx.db.elevated.query('customers').take(1).collect();
      // @ts-expect-error query contexts are read-only
      await ctx.db.insert('customers', { orgId: args.orgId, name: 'x', region: 'y', createdAt: 1 });
      return rows;
    };
    /** @type {import('./generated/api.js').GeneratedHandler<'listCustomers'>} */
    export const membershipBoundary = async (ctx, args) => {
      // @ts-expect-error generic reads cannot inspect private membership rows
      await ctx.db.query('orgMembers').collect();
      // @ts-expect-error generic point reads cannot inspect private membership rows
      await ctx.db.get('orgMembers', /** @type {import('./generated/api.js').Id<'orgMembers'>} */ ('member_1'));
      return customerRows(ctx.db, args.orgId);
    };
    /** @type {import('./generated/api.js').GeneratedHandler<'updateCustomer'>} */
    export const mutationBoundary = async (ctx, args) => {
      await ctx.db.insert('customers', {
        orgId: args.orgId,
        name: 'Ada',
        region: 'west',
        createdAt: 1,
        nickname: null,
      });
      await ctx.db.patch('customers', args.customerId, { nickname: null });
      // @ts-expect-error required fields stay non-null
      await ctx.db.patch('customers', args.customerId, { name: null });
      await ctx.membership.orgMembers.insert({
        orgId: args.orgId,
        userId: ctx.auth.userId,
        role: 'member',
        note: null,
      });
      await ctx.membership.orgMembers.patchSelf(args.orgId, { note: null });
      await ctx.membership.orgMembers.bootstrap({ name: 'New org', tagline: null });
      await ctx.membership.orgMembers.bootstrap(
        { name: 'New group', tagline: null },
        [{ userId: ctx.auth.userId, role: 'member', note: null }],
      );
      // @ts-expect-error membership rows are private to ctx.membership
      await ctx.db.query('orgMembers').collect();
      // @ts-expect-error membership rows are private to ctx.membership
      await ctx.db.get('orgMembers', /** @type {import('./generated/api.js').Id<'orgMembers'>} */ ('member_1'));
      // @ts-expect-error membership rows cannot use generic inserts
      await ctx.db.insert('orgMembers', { orgId: args.orgId, userId: ctx.auth.userId, role: 'member' });
      // @ts-expect-error membership rows cannot use generic patches
      await ctx.db.patch('orgMembers', /** @type {import('./generated/api.js').Id<'orgMembers'>} */ ('member_1'), { role: 'member' });
      // @ts-expect-error membership rows cannot use generic deletes
      await ctx.db.delete('orgMembers', /** @type {import('./generated/api.js').Id<'orgMembers'>} */ ('member_1'));
      // @ts-expect-error last-holder resource creation belongs to bootstrap
      await ctx.db.insert('orgs', { name: 'blocked' });
      await ctx.db.patch('orgs', args.orgId, { name: 'allowed' });
      // @ts-expect-error last-holder resource deletion belongs to teardown
      await ctx.db.delete('orgs', args.orgId);
      return true;
    };
  `);
  let checked = checkJs('interior-types.fixture.mjs');
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);

  writeFileSync(join(root, 'mismatch.fixture.mjs'), `
    // @ts-check
    /** @type {import('./generated/api.js').GeneratedHandler<'listCustomers'>} */
    export const handler = async () => [{ name: 42 }];
  `);
  checked = checkJs('mismatch.fixture.mjs');
  assert.notEqual(checked.status, 0, 'a seeded handler/result mismatch must fail checkJs');
  assert.match(
    `${checked.stdout}\n${checked.stderr}`,
    /not assignable|missing the following properties/u,
  );

  writeFileSync(join(root, 'schema.mjs'), schemaSource('priority: v.integer(),'));
  generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const evolved = functionManifest();
  assert.notEqual(evolved.resultContractHash, firstHash);
  assert.equal(evolved.resultContract.document.fields.at(-1).name, 'priority');
  assert.equal(
    evolved.resultContractHash,
    functionManifest('listCustomersDocuments').resultContractHash,
  );
  assert.match(
    readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8'),
    /"customerEnvelopes": FunctionReference<[^\n]+"priority": number/u,
    'schema evolution regenerates the referenced handler result type',
  );

  writeFileSync(join(root, 'functions.mjs'), functionsSource('missingTable'));
  generated = await generate(root);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(({ code, message }) => (
    code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID'
      && /unknown table missingTable/u.test(message)
  )), JSON.stringify(generated.diagnostics));

  writeFileSync(
    join(root, 'functions.mjs'),
    functionsSource('customers', "{ orgId: v.id('orgs'), forbidden: v.doc('customers') }"),
  );
  generated = await generate(root);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(({ code, message }) => (
    code === 'FUNCTION_INVALID_VALIDATOR'
      && /unsupported validator primitive\/field type/u.test(message)
  )), JSON.stringify(generated.diagnostics));

  writeFileSync(join(root, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      customers: defineTable({ forbidden: v.doc('customers') }).sync(),
    });
  `);
  writeFileSync(join(root, 'functions.mjs'), '');
  generated = await generate(root);
  assert.equal(generated.ok, false);
  assert(generated.diagnostics.some(({ code, message }) => (
    code === 'SCHEMA_INVALID_VALIDATOR'
      && /unsupported validator primitive\/field type/u.test(message)
  )), JSON.stringify(generated.diagnostics));

  writeFileSync(join(root, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      conversations: defineTable({ memberHandles: v.array(v.string()) }).sync(),
    });
  `);
  generated = await generate(root);
  // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
  // — the reviewed support flip admits the typed carrier while preserving
  // the explicit capability requirement for older runtimes.
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert(
    generated.schemaManifest.requiredCapabilities.includes('structured_stored_value_v1'),
    JSON.stringify(generated.schemaManifest),
  );
  assert(!generated.diagnostics.some(({ code }) => (
    code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
  )), JSON.stringify(generated.diagnostics));
  assert(!generated.diagnostics.some(({ code }) => (
    code === 'SCHEMA_INVALID_VALIDATOR'
  )), JSON.stringify(generated.diagnostics));

  console.log('schema-reference type-flow checks passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
