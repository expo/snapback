import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

async function run(inputFunctions = functions(), inputSchema = schema, generateOptions = undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-rbac-authoring-'));
  dirs.push(dir);
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(dirname(fileURLToPath(import.meta.url)), join(snapbackModules, 'snapback-codegen'), 'dir');
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
  const result = await generate(dir, generateOptions);
  return { dir, result };
}

const authorityProfileSchema = ({
  bootstrapRole = 'owner',
  consumerVisibility = true,
  duplicateProfile = false,
  hierarchy = "{ owner: ['admin', 'member'], admin: ['member'], member: [] }",
  indexName = null,
  lastHolderProtect = 'owner',
  legacyAuthority = false,
  membershipId = 'eventMembers',
  membershipMutation = '',
  omitMembershipId = false,
  pendingRoles = ['invited'],
  principalValidator = 'v.principal()',
  profileBeforeMembership = false,
  profileExtra = '',
  profileName = 'eventMembers',
  resourceValidator = "v.id('events')",
  roleField = 'role',
  roles = ['owner', 'admin', 'member'],
  roster = "{ visible: ['userId', 'role', 'displayName'] }",
  transitions = [],
  unsupportedComposition = null,
} = {}) => {
  const profile = `.authorityProfile({
    name: ${JSON.stringify(profileName)},
    hierarchy: ${hierarchy},
    roster: ${roster},
    ${profileExtra}
  })`;
  const membership = `.membership({
    ${omitMembershipId ? '' : `id: ${JSON.stringify(membershipId)},`}
    principal: 'userId',
    resource: 'eventId',
    role: ${JSON.stringify(roleField)},
    roles: ${JSON.stringify(roles)},
    pendingRoles: ${JSON.stringify(pendingRoles)},
    bootstrapRole: ${JSON.stringify(bootstrapRole)},
    lastHolder: { protect: ${JSON.stringify(lastHolderProtect)} },
    provenance: 'full',
    transitions: ${JSON.stringify(transitions)},
  })`;
  const searchIndex = unsupportedComposition === 'search'
    ? `.searchIndex('search_notes', {
        semanticVersion: 'authority-profile-refusal.v1',
        textFields: { body: { weight: 1, classification: 'private' } },
        fieldClassifications: { eventId: 'private' },
        storedFields: ['body'],
        visibility: {
          kind: 'membership',
          declaration: 'eventMembers',
          resourceField: 'eventId',
          roles: ['member'],
        },
      })`
    : '';
  const visibility = unsupportedComposition === 'search' || !consumerVisibility
    ? ''
    : `.visibility({
        kind: 'membership',
        declaration: 'eventMembers',
        resourceField: 'eventId',
        roles: ['member'],
      })`;
  const assetSharing = unsupportedComposition === 'asset'
    ? `.assetSharing({ kind: 'membership', membership: 'eventMembers', roles: ['member'] })`
    : '';
  return `
import { defineSchema, defineTable, v } from '${defineUrl}';

const eventMembersBase = defineTable({
  eventId: ${resourceValidator},
  userId: ${principalValidator},
  ${roleField}: v.string(),
  displayName: v.string(),
})${indexName === null ? '' : `.index(${JSON.stringify(indexName)}, ['userId'])`};

export const eventMembers = eventMembersBase${profileBeforeMembership ? `${profile}${membership}` : `${membership}${profile}`};
${duplicateProfile ? `eventMembers${profile};` : ''}
${legacyAuthority ? 'eventMembers.permissionBackingDeclared = true;' : ''}
${membershipMutation}

const eventNotes = defineTable({ eventId: v.id('events'), body: v.string() })
  ${searchIndex}${visibility}${assetSharing};

export default defineSchema({
  events: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
  eventNotes,
}, { auth: { mode: 'sessions' } });
`;
};

const authorityProfileFunctions = `
import { eventMembers } from './schema.mjs';
import {
  defineJsMutation,
  defineLiveQuery,
  membershipResource,
  v,
} from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'authenticated',
  table: 'events',
  args: { eventId: v.id('events') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'member')],
});

export const visibleNotes = defineLiveQuery({
  auth: 'authenticated',
  table: 'eventNotes',
  args: {},
});

export const writeMembers = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string() },
  source: 'bootstrap-handler.mjs',
  exportName: 'bootstrapEvent',
  writes: ['eventMembers'],
});
`;

function authorityProfileDiagnostic(result, code, detail = undefined) {
  assert.equal(result.ok, false, `${code} unexpectedly generated`);
  const diagnostic = result.diagnostics.find(({ code: candidate, details }) => (
    candidate === code && (detail === undefined || detail(details))
  ));
  assert(diagnostic, `${code} missing: ${JSON.stringify(result.diagnostics)}`);
  assert.match(diagnostic.message, /\S/u);
  assert.match(diagnostic.details?.repair ?? '', /\S/u, `${code} omitted a repair`);
  assert.match(diagnostic.sourceSpan?.file ?? '', /schema\.mjs$/u, `${code} omitted its authored span`);
  assert(Number.isInteger(diagnostic.sourceSpan?.line) && diagnostic.sourceSpan.line > 0);
  return diagnostic;
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
      'export type EventMembersBootstrapMember = { userId: Principal; role: EventMembersRole',
      "eventMembers: { bootstrap(values: EventMembersBootstrap, initialMembers?: readonly EventMembersBootstrapMember[]): Promise<Id<'events'>>",
      'export type GeneratedMutationSettlement = MutationSettlement',
      'export type GeneratedMutationContext<Auth extends GeneratedAuthContext',
    ]) {
      assert(apiTypes.includes(expected), `generated API types omit ${expected}`);
    }
    assert(
      apiTypes.includes('export type GeneratedQueryContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = QueryContext<GeneratedHandlerSchema, Auth, GeneratedPermissions'),
      'query context must expose the read-only database and permissions capabilities',
    );
    assert(
      apiTypes.includes('export type GeneratedMutationContext<Auth extends GeneratedAuthContext = GeneratedAuthContext> = MutationContext<GeneratedHandlerSchema, Auth, GeneratedPermissions, GeneratedAssetsContext, GeneratedRuntimeContext, GeneratedMembership'),
      'mutation context must add the write database and sanctioned membership capabilities',
    );
    assert(
      apiTypes.includes('JobsContext, SequenceContext, MutationIdentityContext>'),
      'mutation context must expose the durable settlement identity projection',
    );
    const actionContext = apiTypes.slice(
      apiTypes.indexOf('export type GeneratedActionContext'),
      apiTypes.indexOf('export interface GeneratedFunctionContexts'),
    );
    assert(!actionContext.includes('GeneratedMembership'), 'actions must not receive membership authority');
    assert(!actionContext.includes('GeneratedQueryDatabase'), 'actions must not receive transactional database authority');
    assert(apiTypes.includes('"eventById": GeneratedQueryContext<GeneratedAuthenticatedAuthContext>;'), 'authenticated live queries must use the read-only context with narrowed authority');
    assert(apiTypes.includes('"createEvent": GeneratedMutationContext<GeneratedAuthenticatedAuthContext>;'), 'authenticated mutations must use the membership-capable context with narrowed authority');
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

  {
    const authorityIndependentMembership = `
import { eventMembers } from './schema.mjs';
import { defineLiveQuery, membershipResource, v } from '${defineUrl}';

export const eventById = defineLiveQuery({
  auth: 'public',
  authorityIndependent: true,
  table: 'events',
  args: { eventId: v.id('events') },
  membership: [eventMembers.hasRole(membershipResource.arg('eventId'), 'host')],
});
`;
    const { result } = await run(authorityIndependentMembership);
    assert.equal(result.ok, false, 'membership-dependent query claimed authority independence');
    assert(
      result.diagnostics.some(({ code }) => code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'),
      `authority-independent membership query omitted its diagnostic: ${JSON.stringify(result.diagnostics)}`,
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
const settlement = ctx.mutation.settlement();
const clientMutationId: string | null = settlement.clientMutationId;
const settlementId: string | null = settlement.settlementId;
void clientMutationId;
void settlementId;
// @ts-expect-error Settlement projections are read-only.
settlement.settlementId = 'replacement';
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

  // LLP 0240 rollout 1: the authority-profile facade closes hierarchy sugar
  // into the existing membership/table-policy IR, projects one generation
  // identity, and refuses every D1 ambiguity with a repair-bearing source span.
  {
    const sourceWithPublicWitness = `${authorityProfileFunctions}
export const publicEvents = defineLiveQuery({
  auth: 'public',
  table: 'events',
  args: {},
});
`;
    const baseline = await run(sourceWithPublicWitness, authorityProfileSchema());
    assert.equal(baseline.result.ok, true, JSON.stringify(baseline.result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(
      join(baseline.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const functionManifest = JSON.parse(readFileSync(
      join(baseline.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const tables = Object.fromEntries(schemaManifest.tables.map((table) => [table.name, table]));
    const profile = tables.eventMembers.authorityProfile;
    assert.equal(profile.version, 1);
    assert.equal(profile.id, 'eventMembers');
    assert.match(profile.generation, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(profile.membership, {
      declaration: 'eventMembers',
      manifestPath: 'tables.eventMembers.membership',
      predicateIdentity: 'snapback.membership-predicate.v1',
    });
    assert.deepEqual(profile.tablePolicy, {
      identity: 'snapback.table-visibility.v1',
      membershipDeclaration: 'eventMembers',
    });
    assert.deepEqual(profile.scopeRelation, {
      table: 'eventMembers',
      resourceField: 'eventId',
      resourceTable: 'events',
      principalKey: 'userId',
    });
    assert.deepEqual(profile.statusPredicates, {
      active: 'membership.roles',
      invited: 'membership.pendingRoles',
    });
    assert.deepEqual(profile.roleLattice, [
      { role: 'owner', implies: ['admin', 'member', 'owner'] },
      { role: 'admin', implies: ['admin', 'member'] },
      { role: 'member', implies: ['member'] },
    ]);
    assert.deepEqual(profile.authorizationEventFields, [
      'eventId',
      'userId',
      'role',
      'displayName',
      'grantedByActor',
      'grantedByEffective',
      'grantedByGrant',
    ]);
    assert.deepEqual(profile.requiredIndexes, [
      {
        name: '_membership_pk',
        fields: ['userId', 'eventId'],
        unique: true,
        lookup: 'principal-in-scope-point',
      },
      {
        name: '_membership_reverse',
        fields: ['eventId', 'role', 'userId'],
        unique: false,
        lookup: 'protected-holders-and-scope-invalidation-range',
      },
    ]);
    assert.deepEqual(profile.permittedCompositionClasses, ['table-visibility.membership.v1']);
    assert.deepEqual(profile.notYetQualifiedCompositionClasses, [
      'membership-visible-search.v1',
      'authority-profile-asset-sharing.v1',
    ]);
    assert.deepEqual(profile.subjectDerivation.coarseGlobalWakeUniverse, [
      'membership-relation-insert-update-delete',
      'protected-resource-row-insert-update-delete',
      'effective-principal-or-auth-context-change',
      'authority-profile-generation-activation',
    ]);
    assert.deepEqual(tables.eventNotes.visibility.roles, ['admin', 'member', 'owner']);

    const functionsByName = Object.fromEntries(
      functionManifest.functions.map((operation) => [operation.name, operation]),
    );
    assert.deepEqual(
      functionsByName.eventById.runtime.HostPlan.Query.membershipFilters[0].roles,
      ['admin', 'member', 'owner'],
    );
    for (const name of ['eventById', 'visibleNotes', 'writeMembers']) {
      assert.deepEqual(functionsByName[name].authorityProfileDependence, [{
        id: 'eventMembers',
        generation: profile.generation,
      }]);
    }
    assert.equal(
      Object.hasOwn(functionsByName.publicEvents, 'authorityProfileDependence'),
      false,
      'an unrelated function must not acquire profile dependence',
    );

    const transitionEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      transitions: [{
        op: 'setRole',
        by: ['owner'],
        target: 'other',
        from: ['member'],
        to: ['admin'],
      }],
    }));
    assert.equal(transitionEdit.result.ok, true, JSON.stringify(transitionEdit.result.diagnostics));
    const transitionSchema = JSON.parse(readFileSync(
      join(transitionEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    const transitionFunctions = JSON.parse(readFileSync(
      join(transitionEdit.dir, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const transitionGeneration = transitionSchema.tables
      .find(({ name }) => name === 'eventMembers').authorityProfile.generation;
    assert.notEqual(transitionGeneration, profile.generation, 'a transition edit rotates the generation');
    const transitionFunctionsByName = Object.fromEntries(
      transitionFunctions.functions.map((operation) => [operation.name, operation]),
    );
    assert.notEqual(
      transitionFunctionsByName.eventById.implementationHash,
      functionsByName.eventById.implementationHash,
      'a dependent function rotates with the authority profile',
    );
    assert.equal(
      transitionFunctionsByName.publicEvents.implementationHash,
      functionsByName.publicEvents.implementationHash,
      'profile edits preserve unrelated implementation identities',
    );

    const roleFieldEdit = await run(sourceWithPublicWitness, authorityProfileSchema({
      roleField: 'accessRole',
      roster: "{ visible: ['userId', 'accessRole', 'displayName'] }",
    }));
    assert.equal(roleFieldEdit.result.ok, true, JSON.stringify(roleFieldEdit.result.diagnostics));
    const roleFieldSchema = JSON.parse(readFileSync(
      join(roleFieldEdit.dir, 'generated', 'schema.manifest.json'),
      'utf8',
    ));
    assert.notEqual(
      roleFieldSchema.tables.find(({ name }) => name === 'eventMembers').authorityProfile.generation,
      profile.generation,
      'a role-field edit rotates the generation',
    );
  }

  for (const [label, variant, code, detail] of [
    [
      'profile before membership',
      { profileBeforeMembership: true },
      'SNAPBACK_AUTHORITY_PROFILE_MEMBERSHIP_REQUIRED',
    ],
    [
      'unpinned membership id',
      { omitMembershipId: true },
      'SNAPBACK_AUTHORITY_PROFILE_STABLE_ID_REQUIRED',
    ],
    [
      'invalid profile id',
      { profileName: 'invalid-profile' },
      'SNAPBACK_AUTHORITY_PROFILE_ID_INVALID',
    ],
    [
      'facade owns only name hierarchy and roster',
      { profileExtra: 'transitions: [],' },
      'SNAPBACK_AUTHORITY_PROFILE_SPEC_INVALID',
    ],
    [
      'profile/membership id mismatch',
      { profileName: 'eventAccess' },
      'SNAPBACK_AUTHORITY_PROFILE_ID_MISMATCH',
    ],
    [
      'principal nominal type',
      { principalValidator: 'v.string()' },
      'SNAPBACK_AUTHORITY_PROFILE_PRINCIPAL_TYPE_MISMATCH',
    ],
    [
      'scope nominal type',
      { resourceValidator: 'v.string()', consumerVisibility: false },
      'SNAPBACK_AUTHORITY_PROFILE_SCOPE_TYPE_MISMATCH',
    ],
    [
      'resource binding',
      { resourceValidator: "v.id('missingEvents')", consumerVisibility: false },
      'SNAPBACK_AUTHORITY_PROFILE_RESOURCE_BINDING_INVALID',
    ],
    [
      'closed roles/statuses',
      { membershipMutation: "eventMembers.membershipDeclaration.pendingRoles = ['member'];" },
      'SNAPBACK_AUTHORITY_PROFILE_ROLE_VOCABULARY_INVALID',
    ],
    [
      'pending status in lattice',
      { hierarchy: "{ owner: ['admin', 'member'], admin: ['member'], member: [], invited: [] }" },
      'SNAPBACK_AUTHORITY_PROFILE_PENDING_STATUS_INVALID',
    ],
    [
      'ambiguous owner',
      { bootstrapRole: 'admin' },
      'SNAPBACK_AUTHORITY_PROFILE_AMBIGUOUS_OWNER',
    ],
    [
      'ungoverned owner write',
      {
        transitions: [{
          op: 'setRole',
          by: ['owner'],
          target: 'other',
          from: ['member'],
          to: ['owner'],
        }],
      },
      'SNAPBACK_AUTHORITY_PROFILE_UNGOVERNED_WRITE_PATH',
    ],
    [
      'duplicate active profile',
      { duplicateProfile: true },
      'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
    ],
    [
      'legacy authority declaration',
      { legacyAuthority: true },
      'SNAPBACK_AUTHORITY_PROFILE_CONFLICT',
      (details) => details?.legacyDeclaration === 'permissionBacking',
    ],
    [
      'missing canonical unique index',
      { indexName: '_membership_pk' },
      'SNAPBACK_AUTHORITY_PROFILE_REQUIRED_INDEX_MISSING',
      (details) => details?.index === '_membership_pk',
    ],
    [
      'missing canonical reverse index',
      { indexName: '_membership_reverse' },
      'SNAPBACK_AUTHORITY_PROFILE_REQUIRED_INDEX_MISSING',
      (details) => details?.index === '_membership_reverse',
    ],
    [
      'invalid role lattice',
      { hierarchy: "{ owner: ['admin', 'member'], admin: ['owner'], member: [] }" },
      'SNAPBACK_AUTHORITY_PROFILE_ROLE_LATTICE_INVALID',
    ],
    [
      'invalid roster',
      { roster: "{ visible: ['missingField'] }" },
      'SNAPBACK_AUTHORITY_PROFILE_ROSTER_INVALID',
    ],
    [
      'search composition',
      { unsupportedComposition: 'search' },
      'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS',
      (details) => details?.compositionClass === 'membership-visible-search.v1',
    ],
    [
      'asset composition',
      { unsupportedComposition: 'asset' },
      'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS',
      (details) => details?.compositionClass === 'authority-profile-asset-sharing.v1',
    ],
  ]) {
    const { result } = await run('export {};\n', authorityProfileSchema(variant));
    authorityProfileDiagnostic(result, code, detail);
    assert.equal(result.ok, false, `${label} unexpectedly generated`);
  }

  {
    const { result } = await run(
      'export {};\n',
      authorityProfileSchema(),
      { targetProfile: 'remote-service-sqlite-ibex' },
    );
    authorityProfileDiagnostic(result, 'SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_TARGET');
  }

  // LLP 0100 §2: principalAddressedWrites — closed option, total-carrier
  // activation, lastHolder consistency, and the generated removePrincipal
  // typing (only when declared; result is always Promise<null>).
  {
    const principalAddressedSchema = ({
      option = '{ remove: true }',
      transitions = "[{ op: 'remove', by: ['host'], target: 'other' }]",
    } = {}) => `
import { defineSchema, defineTable, v } from '${defineUrl}';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  pendingRoles: ['invited'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  provenance: 'full',
  principalAddressedWrites: ${option},
  transitions: ${transitions},
});

export default defineSchema({
  events: defineTable({ title: v.string() }),
  organizations: defineTable({ name: v.string() }),
  eventNotes: defineTable({ eventId: v.id('events'), body: v.string() }),
  eventMembers,
}, { auth: { mode: 'sessions' } });
`;

    const { dir, result } = await run('export {};\n', principalAddressedSchema());
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const schemaManifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
    const members = schemaManifest.tables.find(({ name }) => name === 'eventMembers');
    assert.deepEqual(
      members.membership.principalAddressedWrites,
      { remove: true },
      'the manifest carries the closed opt-in',
    );
    const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      apiTypes.includes("removePrincipal(resource: Id<'events'>, principal: string): Promise<null>"),
      'the declared option emits the typed removePrincipal command',
    );

    // Without the option the method is not emitted at all.
    const closed = await run('export {};\n', principalAddressedSchema({ option: 'undefined' }));
    assert.equal(closed.result.ok, true, JSON.stringify(closed.result.diagnostics));
    const closedTypes = readFileSync(join(closed.dir, 'generated', 'api.d.ts'), 'utf8');
    assert(
      !closedTypes.includes('removePrincipal'),
      'no opt-in, no principal-addressed surface',
    );

    // Generation negatives: remove:false, unknown option fields, no total
    // carrier (partial from coverage), pending carrier class, and a carrier
    // class inconsistent with lastHolder.
    for (const [label, variant] of [
      ['remove: false', { option: '{ remove: false }' }],
      ['unknown option field', { option: '{ remove: true, setRole: true }' }],
      ['partial from coverage only', {
        transitions: "[{ op: 'remove', by: ['host'], target: 'other', from: ['guest'] }]",
      }],
      ['pending carrier class', {
        transitions: "[{ op: 'remove', by: ['invited'], target: 'other' }]",
      }],
      ['carrier class inconsistent with lastHolder', {
        transitions: "[{ op: 'remove', by: ['guest'], target: 'other' }]",
      }],
    ]) {
      const { result } = await run('export {};\n', principalAddressedSchema(variant));
      assert.equal(result.ok, false, `${label} unexpectedly generated`);
    }
  }

  console.log('rbac-authoring.test.mjs: all cases passed');
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
