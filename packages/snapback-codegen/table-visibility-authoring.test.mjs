import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { anyOf, defineTable, owner, v } from './define.mjs';
import { formatCodegenSummary } from './codegen-summary.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function fixture(schema, functions = 'export const nothing = 0;\n') {
  const root = mkdtempSync(join(tmpdir(), 'snapback-table-visibility-'));
  roots.push(root);
  const app = join(root, 'fixture');
  const backend = join(app, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(app, 'demo.snapback.json'), JSON.stringify({ id: 'table-visibility-fixture' }));
  writeFileSync(join(backend, 'schema.mjs'), schema);
  writeFileSync(join(backend, 'functions.mjs'), functions);
  return backend;
}

async function refusal(schema, code) {
  const result = await generate(fixture(schema));
  assert.equal(result.ok, false, `expected ${code}: ${JSON.stringify(result.diagnostics)}`);
  assert(
    result.diagnostics.some((diagnostic) => diagnostic.code === code),
    `missing ${code}: ${JSON.stringify(result.diagnostics)}`,
  );
}

assert.throws(
  () => defineTable({ ownerId: v.string() }).visibility({ kind: 'private' }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID',
);
assert.throws(
  () => anyOf([owner('ownerId')]),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_ANY_OF_ARMS_INVALID',
);
assert.throws(
  () => defineTable({ ownerId: v.principal() }).visibility(anyOf([
    owner('ownerId'),
    owner('ownerId'),
  ])),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_ANY_OF_DUPLICATE_ARM',
);
assert.throws(
  () => defineTable({ ownerId: v.principal() }).visibility(anyOf([
    owner('ownerId'),
    { kind: 'public-read' },
  ])),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_ANY_OF_PUBLIC_READ_ARM',
);
assert.throws(
  () => defineTable({ ownerId: v.principal() }).visibility(anyOf([
    owner('ownerId'),
    anyOf([owner('ownerId'), owner('otherOwnerId')]),
  ])),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_ANY_OF_NESTED',
);
assert.deepEqual(
  defineTable({ ownerId: v.string() }).visibility(owner('ownerId')).visibilityDeclaration,
  { kind: 'owner', field: 'ownerId' },
  'the shipped owner(field) helper is accepted by table visibility',
);
assert.throws(
  () => defineTable({ ownerId: v.string() }).visibility({ kind: 'owner' }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_INVALID',
);
assert.throws(
  () => defineTable({ roomId: v.string() }).visibility({
    kind: 'membership',
    declaration: 'room-members',
    resourceField: 'roomId',
    roles: [],
  }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLES_INVALID',
);
assert.throws(
  () => defineTable({ roomId: v.string() }).visibility({
    kind: 'membership',
    resourceField: 'roomId',
  }),
  ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_INVALID',
);

try {
  const validSchema = `
import { anyOf, defineSchema, defineTable, owner, v } from '${defineUrl}';
const roomMembers = defineTable({
  userId: v.principal(),
  roomId: v.id('rooms'),
  role: v.string(),
})
  .membership({
    id: 'roomMembers',
    principal: 'userId',
    resource: 'roomId',
    role: 'role',
    roles: ['member', 'moderator'],
  })
  .visibility({ kind: 'public-read' });
export default defineSchema({
  announcements: defineTable({ body: v.string() })
    .visibility({ kind: 'public-read' })
    .assetSharing({ kind: 'public-read' }),
  privateNotes: defineTable({ ownerId: v.principal(), body: v.string() })
    .visibility(owner('ownerId')),
  rooms: defineTable({ title: v.string() })
    .visibility({
      kind: 'membership',
      declaration: roomMembers,
      resourceField: '_id',
      roles: ['member'],
    }),
  roomMembers,
  messages: defineTable({ roomId: v.id('rooms'), body: v.string() })
    .visibility({
      kind: 'membership',
      declaration: roomMembers,
      resourceField: 'roomId',
      roles: ['member'],
    }),
  followingFeedEntries: defineTable({
    authorPrincipalId: v.principal(),
    authorProfileId: v.id('rooms'),
    body: v.string(),
  }).visibility(anyOf([
    owner('authorPrincipalId'),
    {
      kind: 'membership',
      declaration: roomMembers,
      resourceField: 'authorProfileId',
      roles: ['member'],
    },
  ])),
});
`;
  const validFunctions = `
import { defineLiveQuery } from '${defineUrl}';
export const followingFeed = defineLiveQuery({
  table: 'followingFeedEntries',
  auth: 'optional-user',
});
export const privateNotes = defineLiveQuery({
  table: 'privateNotes',
  auth: 'optional-user',
});
`;
  const valid = await generate(fixture(validSchema, validFunctions));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));
  const manifest = JSON.parse(
    readFileSync(join(valid.outDir, 'schema.manifest.json'), 'utf8'),
  );
  const tables = Object.fromEntries(manifest.tables.map((table) => [table.name, table]));
  assert.deepEqual(tables.announcements.visibility, { kind: 'public-read' });
  assert.deepEqual(tables.announcements.assetSharing, { kind: 'public-read' });
  assert.deepEqual(tables.privateNotes.visibility, { kind: 'owner', field: 'ownerId' });
  assert.deepEqual(tables.messages.visibility, {
    kind: 'membership',
    declaration: 'roomMembers',
    resourceField: 'roomId',
    roles: ['member'],
  });
  assert.deepEqual(tables.rooms.visibility, {
    kind: 'membership',
    declaration: 'roomMembers',
    resourceField: '_id',
    roles: ['member'],
  }, 'a resource table can use its own system id as the membership resource');
  assert.deepEqual(tables.followingFeedEntries.visibility, {
    kind: 'any-of',
    arms: [
      { kind: 'owner', field: 'authorPrincipalId' },
      {
        kind: 'membership',
        declaration: 'roomMembers',
        resourceField: 'authorProfileId',
        roles: ['member'],
      },
    ],
  });
  const functionsManifest = JSON.parse(
    readFileSync(join(valid.outDir, 'functions.manifest.json'), 'utf8'),
  );
  const followingFeed = functionsManifest.functions.find(({ name }) => name === 'followingFeed');
  assert.deepEqual(
    followingFeed.runtime.HostPlan.Query.tableVisibility,
    tables.followingFeedEntries.visibility,
    'the exact schema policy is executable plan data',
  );
  assert.deepEqual(followingFeed.readSetSummary.tables, ['followingFeedEntries', 'roomMembers']);
  assert.deepEqual(followingFeed.authorizationDependence, ['userId']);
  assert.deepEqual(followingFeed.effectCeiling.authorizationInputs, [
    'authUserId',
    'membershipPredicate',
  ]);
  const privateNotes = functionsManifest.functions.find(({ name }) => name === 'privateNotes');
  assert.deepEqual(privateNotes.effectCeiling.authorizationInputs, ['authUserId']);
  assert.deepEqual(privateNotes.authorizationDependence, ['userId']);
  assert.equal(privateNotes.requiredCapabilities.includes('single_table_v1'), false);
  assert.equal(followingFeed.requiredCapabilities.includes('single_table_v1'), false);
  assert.equal(
    valid.diagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT'),
    false,
  );
  assert.deepEqual(valid.summary.tableVisibility, {
    declared: [
      { table: 'announcements', kind: 'public-read' },
      { table: 'followingFeedEntries', kind: 'any-of' },
      { table: 'messages', kind: 'membership' },
      { table: 'privateNotes', kind: 'owner' },
      { table: 'roomMembers', kind: 'public-read' },
      { table: 'rooms', kind: 'membership' },
    ],
    implicit: [],
    counts: {
      total: 6,
      declared: 6,
      implicit: 0,
      publicRead: 2,
      owner: 1,
      membership: 2,
      anyOf: 1,
    },
  });

  const indexPrefix = await generate(fixture(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ ownerId: v.principal(), body: v.string() })
    .index('by_body', ['body'])
    .index('by_owner_body', ['ownerId', 'body'])
    .visibility({ kind: 'owner', field: 'ownerId' }),
});
`, `
import { defineLiveQuery } from '${defineUrl}';
export const mismatchingIndex = defineLiveQuery({
  table: 'notes', index: 'by_body', auth: 'optional-user',
});
export const matchingIndex = defineLiveQuery({
  table: 'notes', index: 'by_owner_body', auth: 'optional-user',
});
`));
  assert.equal(indexPrefix.ok, true, JSON.stringify(indexPrefix.diagnostics));
  const prefixWarnings = indexPrefix.diagnostics.filter(
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_INDEX_PREFIX_MISMATCH',
  );
  assert.equal(prefixWarnings.length, 1, JSON.stringify(prefixWarnings));
  assert.equal(prefixWarnings[0].function, 'mismatchingIndex');
  assert.equal(prefixWarnings[0].table, 'notes');
  assert.equal(prefixWarnings[0].details.ownerField, 'ownerId');
  assert.equal(prefixWarnings[0].details.selectedIndex, 'by_body');
  assert.deepEqual(prefixWarnings[0].details.selectedIndexFields, ['body']);
  assert.match(prefixWarnings[0].message, /may degrade to a scan/u);
  assert(prefixWarnings[0].details.remediations.every((remediation) => (
    remediation.machineApplicable === false
    && remediation.requiresApproval === true
    && remediation.precondition.function === 'mismatchingIndex'
  )));
  assert.equal(
    indexPrefix.diagnostics.some(({ code, function: functionName }) => (
      code === 'SNAPBACK_TABLE_VISIBILITY_INDEX_PREFIX_MISMATCH'
      && functionName === 'matchingIndex'
    )),
    false,
    'an owner-leading selected index stays silent',
  );

  const composedSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const parents = defineTable({
  ownerId: v.principal(),
  profileSlug: v.string(),
  title: v.string(),
})
  .index('by_owner_title', ['ownerId', 'title'])
  .visibility({ kind: 'owner', field: 'ownerId' });
export const profiles = defineTable({ slug: v.string(), name: v.string() })
  .index('by_slug', ['slug'], { unique: true })
  .visibility({ kind: 'public-read' });
export const children = defineTable({
  parentId: v.id('parents'),
  parentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'parentId', parentTable: 'parents',
  }),
  position: v.integer(),
  body: v.string(),
})
  .index('by_parent_position', ['parentId', 'parentIncarnation', 'position'])
  .visibility({ kind: 'public-read' });
export default defineSchema({ parents, profiles, children });
`;
  const composedFunctions = `
import {
  asc, defineBoundedChildrenQuery, defineRelationalQuery, defineSnapshotBatchQuery, owner,
  throughParent,
} from '${defineUrl}';
import { children, parents, profiles } from './schema.mjs';

export const parentProfiles = defineRelationalQuery({
  root: parents,
  joined: profiles,
  join: [{ root: 'profileSlug', joined: 'slug' }],
  visibility: {
    root: owner('ownerId'),
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: { title: { root: 'title' }, profileName: { joined: 'name' } },
  take: 10,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
});

export const parentChildren = defineBoundedChildrenQuery({
  parent: {
    table: parents,
    idArg: 'parentId',
    visibility: owner('ownerId'),
    select: { id: '_id', title: 'title' },
  },
  children: {
    table: children,
    foreignKey: 'parentId',
    parentIncarnation: 'parentIncarnation',
    visibility: throughParent(),
    index: 'by_parent_position',
    order: [asc('position')],
    select: { id: '_id', position: 'position', body: 'body' },
  },
  take: 10,
  parentDeletion: 'hide-orphans.v1',
});

export const snapshotMixed = defineSnapshotBatchQuery({
  nodes: [parentChildren, parentProfiles],
});
`;
  const composed = await generate(fixture(composedSchema, composedFunctions));
  assert.equal(composed.ok, true, JSON.stringify(composed.diagnostics));
  const uncomposedBackstops = composed.diagnostics.filter(
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
  );
  assert.deepEqual(uncomposedBackstops, [], 'every shipped multi-table class composes');
  const composedManifest = JSON.parse(
    readFileSync(join(composed.outDir, 'functions.manifest.json'), 'utf8'),
  );
  const composedByName = new Map(
    composedManifest.functions.map((fn) => [fn.name, fn]),
  );
  const ownerPolicy = { kind: 'owner', field: 'ownerId' };
  assert.deepEqual(
    composedByName.get('parentProfiles').runtime.HostPlan.RelationalQuery.rootTableVisibility,
    ownerPolicy,
  );
  assert.equal(
    composedByName.get('parentProfiles').runtime.HostPlan.RelationalQuery.joinedTableVisibility,
    undefined,
  );
  assert.deepEqual(
    composedByName.get('parentChildren').runtime.HostPlan.BoundedChildrenQuery.parentTableVisibility,
    ownerPolicy,
  );
  assert.equal(
    composedByName.get('parentChildren').runtime.HostPlan.BoundedChildrenQuery.childTableVisibility,
    undefined,
  );
  const snapshotNodes = composedByName.get('snapshotMixed').runtime.HostPlan.SnapshotBatchV2.nodes;
  assert.deepEqual(snapshotNodes[0].plan.parentTableVisibility, ownerPolicy);
  assert.deepEqual(snapshotNodes[1].plan.rootTableVisibility, ownerPolicy);
  for (const functionName of ['parentProfiles', 'parentChildren', 'snapshotMixed']) {
    const fn = composedByName.get(functionName);
    assert.deepEqual(fn.authorizationDependence, ['userId']);
    assert(fn.effectCeiling.authorizationInputs.includes('authUserId'));
  }

  const futureSurface = await generate(fixture(composedSchema, `${composedFunctions}
snapshotMixed.snapshotBatchPlan.nodes[0].classId = 'future_read_v1';
`));
  assert.equal(futureSurface.ok, false, JSON.stringify(futureSurface.diagnostics));
  const futureRefusal = futureSurface.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE',
  );
  assert.ok(futureRefusal, JSON.stringify(futureSurface.diagnostics));
  assert.equal(futureRefusal.severity, 'error');
  assert.equal(futureRefusal.table, 'parents');
  assert.match(futureRefusal.message, /cannot generate.*future_read_v1/u);

  const authScope = await generate(fixture(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ ownerId: v.principal(), body: v.string() })
    .visibility({ kind: 'public-read' }),
});
`, `
import { authUserId, defineLiveQuery, eq } from '${defineUrl}';
export const missingGate = defineLiveQuery({
  table: 'notes', authScopeField: 'ownerId', auth: 'optional-user',
});
export const pairedGate = defineLiveQuery({
  table: 'notes', authScopeField: 'ownerId', auth: 'optional-user',
  filter: [eq('ownerId', authUserId())],
});
`));
  assert.equal(authScope.ok, true, JSON.stringify(authScope.diagnostics));
  const authScopeWarnings = authScope.diagnostics.filter(
    ({ code }) => code === 'SNAPBACK_AUTH_SCOPE_FIELD_WITHOUT_CALLER_PREDICATE',
  );
  assert.equal(authScopeWarnings.length, 1, JSON.stringify(authScopeWarnings));
  assert.equal(authScopeWarnings[0].function, 'missingGate');
  assert.equal(authScopeWarnings[0].severity, 'warning');
  assert.match(authScopeWarnings[0].message, /never|does not authorize/u);

  const omitted = await generate(fixture(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  publicPosts: defineTable({ body: v.string() }).visibility({ kind: 'public-read' }),
  drafts: defineTable({ body: v.string() }),
});
`));
  assert.equal(omitted.ok, true, JSON.stringify(omitted.diagnostics));
  const warning = omitted.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT',
  );
  assert.ok(warning, 'undeclared table emits the warn-phase diagnostic');
  assert.equal(warning.table, 'drafts');
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.subsystem, 'auth');
  assert.equal(warning.sourceSpan.file, 'schema.mjs');
  assert(warning.sourceSpan.line > 0);
  assert.match(warning.message, /drafts.*\.visibility\(\{ kind: 'public-read' \}\)/u);
  assert.match(warning.message, /guide\/auth\/protecting-data\.md#declare-who-can-read-each-table/u);
  assert.deepEqual(
    warning.details.remediations.map(({ kind, visibilityKind }) => [kind, visibilityKind]),
    [
      ['setTableVisibility', 'public-read'],
      ['setTableVisibility', 'owner'],
      ['setTableVisibility', 'membership'],
      ['guidePointer', undefined],
    ],
  );
  assert(warning.details.remediations.every((remediation) => (
    remediation.riskClass === 'policy'
    && remediation.machineApplicable === false
    && remediation.requiresApproval === true
    && remediation.precondition.table === 'drafts'
    && remediation.precondition.authoredVisibility === 'omitted'
  )));
  assert.deepEqual(omitted.summary.tableVisibility, {
    declared: [{ table: 'publicPosts', kind: 'public-read' }],
    implicit: ['drafts'],
    counts: {
      total: 2,
      declared: 1,
      implicit: 1,
      publicRead: 1,
      owner: 0,
      membership: 0,
      anyOf: 0,
    },
  });
  const artifacts = JSON.parse(readFileSync(join(omitted.outDir, 'artifacts.json'), 'utf8'));
  assert.deepEqual(artifacts.summary.tableVisibility, omitted.summary.tableVisibility);
  assert.match(formatCodegenSummary(omitted.summary), /table visibility 1 declared; 1 implicit/u);
  assert.match(formatCodegenSummary(omitted.summary), /drafts: add \.visibility/u);

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  drafts: defineTable({ ownerId: v.string() }).visibility({ kind: 'private' }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_KIND_INVALID');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  drafts: defineTable({ ownerId: v.string() }).visibility({ kind: 'owner', field: 'missing' }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_OWNER_FIELD_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  messages: defineTable({ roomId: v.string() }).visibility({
    kind: 'membership', declaration: 'missing-members', resourceField: 'roomId', roles: ['member'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_DECLARATION_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
const members = defineTable({ userId: v.principal(), roomId: v.id('rooms'), role: v.string() })
  .membership({ id: 'roomMembers', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'] });
export default defineSchema({
  rooms: defineTable({ title: v.string() }),
  members,
  messages: defineTable({ roomId: v.id('rooms') }).visibility({
    kind: 'membership', declaration: members, resourceField: 'missingRoom', roles: ['member'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN');

  await refusal(`
import { defineSchema, defineTable, v } from '${defineUrl}';
const members = defineTable({ userId: v.principal(), roomId: v.id('rooms'), role: v.string() })
  .membership({ id: 'roomMembers', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'] });
export default defineSchema({
  rooms: defineTable({ title: v.string() }),
  members,
  messages: defineTable({ roomId: v.id('rooms') }).visibility({
    kind: 'membership', declaration: members, resourceField: 'roomId', roles: ['admin'],
  }),
});
`, 'SNAPBACK_TABLE_VISIBILITY_MEMBERSHIP_ROLE_UNKNOWN');

  await refusal(`
import { anyOf, defineSchema, defineTable, owner, v } from '${defineUrl}';
const members = defineTable({ userId: v.principal(), roomId: v.id('rooms'), role: v.string() })
  .membership({ id: 'roomMembers', principal: 'userId', resource: 'roomId', role: 'role', roles: ['member'] });
export default defineSchema({
  rooms: defineTable({ title: v.string() }),
  members,
  messages: defineTable({ ownerId: v.principal(), wrongResource: v.string() }).visibility(anyOf([
    owner('ownerId'),
    { kind: 'membership', declaration: members, resourceField: 'wrongResource', roles: ['member'] },
  ])),
});
`, 'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_TYPE_MISMATCH');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('table visibility authoring: composition, strict refusals, scope warning, and summary verified');
