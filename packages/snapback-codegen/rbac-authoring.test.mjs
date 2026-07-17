import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];
const membershipValidationParity = JSON.parse(readFileSync(
  join(repoRoot, 'tests/fixtures/membership-validation-parity-v0.json'),
  'utf8',
));

// The success case remains a literal source fixture so the guide can verify
// its author-facing excerpt byte-for-byte. The schemaSource factory below is
// reserved for adversarial variants.
const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: [],
});

export default defineSchema({
  events: defineTable({ title: v.string() }),
  organizations: defineTable({ name: v.string() }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const schemaSource = ({
  appScope = false,
  bootstrapRole = null,
  extraField = '',
  expiryType = null,
  idTarget = 'events',
  indexName = null,
  lastHolderProtect = null,
  roles = ['host', 'guest'],
  transitions = [],
} = {}) => `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('${idTarget}'),
  userId: v.principal(),
  role: v.string(),
  joinedAt: v.integer(),
  ${extraField}
  ${expiryType === null ? '' : `expiresAt: v.optional(v.${expiryType}()),`}
})${indexName === null ? '' : `.index(${JSON.stringify(indexName)}, ['userId'])`}.membership({
  id: 'eventMembers',
  principal: 'userId',
  ${appScope ? '' : "resource: 'eventId',"}
  role: 'role',
  roles: ${JSON.stringify(roles)},
  pendingRoles: ['invited'],
  ${bootstrapRole === null ? '' : `bootstrapRole: ${JSON.stringify(bootstrapRole)},`}
  ${lastHolderProtect === null ? '' : `lastHolder: { protect: ${JSON.stringify(lastHolderProtect)} },`}
  ${expiryType === null ? '' : "expiry: { field: 'expiresAt', onExpiry: 'remove' },"}
  incidental: ['joinedAt'],
  provenance: 'full',
  transitions: ${JSON.stringify(transitions)},
  scope: '${appScope ? 'app' : 'resource'}',
});

export default defineSchema({
  events: defineTable({ title: v.string() }),
  organizations: defineTable({ name: v.string() }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const parityTransition = ({ kind, value }) => {
  if (kind === 'roleCallerTargetsSelf') {
    if (value === 'insert') return { op: value, by: ['host'], target: 'self', to: ['guest'] };
    if (value === 'setRole') {
      return { op: value, by: ['host'], target: 'self', from: ['guest'], to: ['host'] };
    }
    if (value === 'remove') return { op: value, by: ['host'], target: 'self', from: ['guest'] };
    return { op: value, by: ['host'], target: 'self', fields: ['joinedAt'] };
  }
  if (kind === 'selfCallerTargetsOther') {
    if (value === 'setRole') {
      return { op: value, by: ['self'], target: 'other', from: ['guest'], to: ['host'] };
    }
    if (value === 'remove') return { op: value, by: ['self'], target: 'other', from: ['guest'] };
    return { op: value, by: ['self'], target: 'other', fields: ['joinedAt'] };
  }
  if (kind === 'patchAxis') {
    return { op: 'patch', by: ['self'], target: 'self', fields: [value] };
  }
  return null;
};

const paritySchemaSource = (testCase) => schemaSource({
  ...(testCase.kind === 'reservedProvenance'
    ? { extraField: `${testCase.value}: v.string(),` }
    : {}),
  ...(testCase.kind === 'generatedIndexCollision'
    ? { indexName: testCase.value }
    : {}),
  ...(['roleCallerTargetsSelf', 'selfCallerTargetsOther', 'patchAxis'].includes(testCase.kind)
    ? { transitions: [parityTransition(testCase)] }
    : {}),
});

const generatedSymbolCollisionSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembersSnake = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'event_members',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['member'],
});

const eventMembersCamel = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['member'],
});

export default defineSchema({
  events: defineTable({ title: v.string() }),
  eventMembersSnake,
  eventMembersCamel,
}, { auth: { mode: 'sessions' } });
`;

const axisOnlyMembershipSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
});

export default defineSchema({
  events: defineTable({ title: v.string() }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

const functions = ({ mismatchedArg = false, mismatchedRow = false } = {}) => `
import { eventMembers } from './schema.mjs';
import {
  defineLiveQuery,
  defineMutation,
  insert,
  lit,
  membershipResource,
  v,
} from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'authenticated',
  table: 'events',
  args: { eventId: v.id('${mismatchedArg ? 'organizations' : 'events'}') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'host')],
});

export const visibleNotes = defineLiveQuery({
  auth: 'authenticated',
  table: 'eventNotes',
  args: {},
  membership: [eventMembers.memberOf(membershipResource.rowField('${mismatchedRow ? 'body' : 'eventId'}'))],
});

export const createEvent = defineMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { title: v.string() },
  plan: insert('events', { title: lit('created') }),
});
`;

async function run(inputFunctions = functions(), inputSchema = schema) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-rbac-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), inputSchema);
  writeFileSync(join(dir, 'functions.mjs'), inputFunctions);
  writeFileSync(join(dir, 'bootstrap-handler.mjs'), `
globalThis.__snapbackHandlers = {
  async bootstrapEvent(ctx, args) {
    return await ctx.membership.eventMembers.bootstrap({ title: args.title });
  },
};
`);
  mkdirSync(join(dir, 'generated'));
  const result = await generate(dir);
  return { dir, result };
}

try {
  {
    const { dir, result } = await run();
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
    const functionsManifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
    const contractManifest = JSON.parse(readFileSync(join(dir, 'generated', 'contract-data.manifest.json'), 'utf8'));
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');

    const members = schemaManifest.tables.find(({ name }) => name === 'eventMembers');
    assert.deepEqual(
      members.fields.map(({ name, field_type: fieldType }) => [name, fieldType]),
      [
        ['eventId', { Id: { table: 'events' } }],
        ['userId', 'Principal'],
        ['role', 'String'],
        ['joinedAt', 'Integer'],
      ],
    );
    assert.equal(members.permissionBacking, undefined, 'membership owns permission backing derivation');
    assert.deepEqual(members.membership, {
      id: 'eventMembers',
      principal: 'userId',
      resource: 'eventId',
      role: 'role',
      roles: ['host', 'guest'],
      pendingRoles: ['invited'],
      bootstrapRole: 'host',
      lastHolder: { protect: 'host' },
      incidental: ['joinedAt'],
      provenance: 'full',
      transitions: [],
      scope: 'resource',
      resourceTable: 'events',
    });

    const eventById = functionsManifest.functions.find(({ name }) => name === 'eventById');
    assert.deepEqual(eventById.readSetSummary.tables, ['events', 'eventMembers']);
    assert.deepEqual(eventById.authorizationDependence, ['userId']);
    assert.deepEqual(eventById.runtime.HostPlan.Query.membershipFilters, [{
      declaration: 'eventMembers',
      resource: { arg: { path: 'eventId', resourceTable: 'events' } },
      roles: ['host'],
    }]);
    const visibleNotes = functionsManifest.functions.find(({ name }) => name === 'visibleNotes');
    assert.deepEqual(visibleNotes.runtime.HostPlan.Query.membershipFilters, [{
      declaration: 'eventMembers',
      resource: { rowField: 'eventId' },
    }]);
    assert.deepEqual(contractManifest.queries.eventById.reads, ['events', 'eventMembers']);
    assert.equal(
      functionsManifest.functions.find(({ name }) => name === 'createEvent').authorityCreating,
      true,
    );
    for (const expected of [
      "export type Principal = string",
      "Id<'events'>",
      "export type EventMembersRole = \"host\" | \"guest\" | \"invited\"",
      'export type EventMembersBootstrap = { title: string }',
      'export interface GeneratedPermissions',
      "eventMembers: { requireRole(resource: Id<'events'>, role: EventMembersRole, ...roles: EventMembersRole[])",
      'export interface GeneratedMembership',
      "eventMembers: { bootstrap(values: EventMembersBootstrap): Promise<Id<'events'>>",
      'export interface GeneratedMutationContext extends GeneratedQueryContext',
    ]) {
      assert(apiTypes.includes(expected), `generated API types omit ${expected}`);
    }
    assert(
      apiTypes.includes('export interface GeneratedQueryContext { readonly permissions: GeneratedPermissions }'),
      'query context must expose only the read-only permissions capability',
    );
    assert(
      apiTypes.includes('export interface GeneratedMutationContext extends GeneratedQueryContext { readonly membership: GeneratedMembership }'),
      'mutation context must add the sanctioned membership write capability',
    );
    assert(apiTypes.includes('export interface GeneratedActionContext {}'), 'actions must not receive membership authority');
    assert(apiTypes.includes('eventById: GeneratedQueryContext;'), 'live queries must use the read-only query context');
    assert(apiTypes.includes('createEvent: GeneratedMutationContext;'), 'mutations must use the membership-capable context');
    const permissionsSurface = apiTypes.slice(
      apiTypes.indexOf('export interface GeneratedPermissions'),
      apiTypes.indexOf('export type EventMembersRole'),
    );
    assert(permissionsSurface.includes('requireRole('), 'permissions must expose role checks');
    for (const forbidden of ['insert(', 'setRole(', 'remove(', 'patch(']) {
      assert(!permissionsSurface.includes(forbidden), `read-only permissions unexpectedly expose ${forbidden}`);
    }
  }

  {
    const bootstrapFunctions = `
import { defineJsMutation, v } from '${defineUrl}';

export const bootstrapEvent = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: false,
  args: { title: v.string() },
  source: 'bootstrap-handler.mjs',
  exportName: 'bootstrapEvent',
  writes: ['events', 'eventMembers'],
});
`;
    const { dir, result } = await run(bootstrapFunctions);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
    const bootstrapEvent = manifest.functions.find(({ name }) => name === 'bootstrapEvent');
    assert.equal(
      bootstrapEvent.authorityCreating,
      undefined,
      'an explicit bootstrap-only wrapper must not require authority-creating consent',
    );
  }

  for (const [label, inputFunctions] of [
    ['argument', functions({ mismatchedArg: true })],
    ['row field', functions({ mismatchedRow: true })],
  ]) {
    const { result } = await run(inputFunctions);
    assert.equal(result.ok, false, `${label} mismatch unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === 'QUERY_MEMBERSHIP_RESOURCE_TYPE_MISMATCH'),
      `${label} mismatch omitted the nominal resource diagnostic: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  for (const [label, inputSchema, expectedCode] of [
    [
      'app-scoped lastHolder',
      schemaSource({ appScope: true, bootstrapRole: 'host', lastHolderProtect: 'host' }),
      'SCHEMA_MEMBERSHIP_LAST_HOLDER_APP_SCOPE',
    ],
    [
      'app-scoped bootstrapRole',
      schemaSource({ appScope: true, bootstrapRole: 'host' }),
      'SCHEMA_MEMBERSHIP_BOOTSTRAP_APP_SCOPE',
    ],
    [
      'lastHolder/bootstrap mismatch',
      schemaSource({ bootstrapRole: 'guest', lastHolderProtect: 'host' }),
      'SCHEMA_MEMBERSHIP_LAST_HOLDER_BOOTSTRAP_MISMATCH',
    ],
    ['reserved self role', schemaSource({ roles: ['self', 'guest'] }), 'SCHEMA_MEMBERSHIP_RESERVED_ROLE'],
    ['reserved none role', schemaSource({ roles: ['none', 'guest'] }), 'SCHEMA_MEMBERSHIP_RESERVED_ROLE'],
    [
      'reserved role separator',
      schemaSource({ roles: ['appRoles:admin', 'guest'] }),
      'SCHEMA_MEMBERSHIP_ROLE_RESERVED_SEPARATOR',
    ],
    ['invalid expiry type', schemaSource({ expiryType: 'string' }), 'SCHEMA_MEMBERSHIP_EXPIRY_FIELD_TYPE'],
    ['unknown id table', schemaSource({ idTarget: 'missingEvents' }), 'SCHEMA_ID_TARGET_UNKNOWN'],
  ]) {
    const { result } = await run('export {};\n', inputSchema);
    assert.equal(result.ok, false, `${label} unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === expectedCode),
      `${label} omitted ${expectedCode}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  // This corpus is consumed by both this authoring test and Rust activation
  // tests. Adding or changing one of the duplicated closed invariants must
  // therefore update one shared fixture instead of two drifting case lists.
  for (const testCase of membershipValidationParity) {
    const { result } = await run('export {};\n', paritySchemaSource(testCase));
    assert.equal(result.ok, false, `${testCase.name} unexpectedly generated`);
    assert(
      result.diagnostics.some(({ code }) => code === testCase.codegenCode),
      `${testCase.name} omitted ${testCase.codegenCode}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  {
    const { dir, result } = await run('export {};\n', generatedSymbolCollisionSchema);
    assert.equal(result.ok, false, 'colliding generated membership symbols unexpectedly generated');
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === 'SCHEMA_MEMBERSHIP_GENERATED_SYMBOL_COLLISION',
    );
    assert(diagnostic, `generated symbol collision omitted its diagnostic: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(diagnostic.generatedSymbol, 'EventMembersRole');
    assert.deepEqual(diagnostic.declarations, ['event_members', 'eventMembers']);
    assert.deepEqual(diagnostic.tables, ['eventMembersSnake', 'eventMembersCamel']);
    assert.equal(
      existsSync(join(dir, 'generated', 'api.d.ts')),
      false,
      'generated symbol collision must fail closed before writing TypeScript',
    );
  }

  {
    const { dir, result } = await run('export {};\n', axisOnlyMembershipSchema);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      apiTypes.includes('export type EventMembersPatch = Record<string, never>;'),
      'an axis-only membership must emit an actually empty patch input',
    );
    writeFileSync(join(dir, 'consumer.ts'), `
import type { GeneratedMutationContext, Id } from './generated/api';

declare const ctx: GeneratedMutationContext;
declare const memberId: Id<'eventMembers'>;

ctx.membership.eventMembers.patch(memberId, {});
// @ts-expect-error Membership authorization axes cannot be patched.
ctx.membership.eventMembers.patch(memberId, { role: 'host' });
`);
    execFileSync(join(repoRoot, 'node_modules/.bin/tsc'), [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      'consumer.ts',
    ], { cwd: dir, stdio: 'pipe' });
  }

  console.log('rbac-authoring.test.mjs: all cases passed');
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
