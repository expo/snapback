import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineSchema, defineTable, v } from './define.mjs';
import {
  defineChunkedSemiJoin,
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
  defineSetKeyedAggregate,
} from './standard-patterns.mjs';
import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const patternsUrl = pathToFileURL(join(packageDir, 'standard-patterns.mjs')).href;

{
  const todos = defineTable({
    ownerId: v.string(),
    slug: v.string(),
    title: v.string(),
    createdAt: v.integer(),
    delegateId: v.principal(),
    optionalKey: v.optional(v.string()),
  })
    .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
    .index('by_owner_created_slug', ['ownerId', 'createdAt', 'slug'], { unique: true })
    .index('by_slug_only', ['slug']);
  defineSchema({ todos });
  const names = {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  };
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
    }),
    /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED/,
    'generation must fail closed when visibility is omitted',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      updateDefaults: { ownerId: 'id' },
    }),
    /SNAPBACK_TABLE_WRITE_OWNER_DEFAULT_REFUSED: trusted defaults cannot set owner visibility field ownerId/,
    'a trusted default must not bypass the transactional owner guard by transferring ownership',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      createDefaults: { delegateId: 'id' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: createDefaults.delegateId uses id but is not a plain string field/,
    'runtime ids must not manufacture authority principals',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      createDefaults: { optionalKey: 'id' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: createDefaults.optionalKey uses id but is not a plain string field/,
    'runtime ids require a non-optional continuation field',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      visiblity: { kind: 'owner', field: 'ownerId' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: defineOwnedCrud options has unknown field visiblity/,
    'top-level pattern options must be a closed vocabulary',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names: { ...names, get: names.list },
      visibility: { kind: 'owner', field: 'ownerId' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: names must name distinct operations/,
    'duplicate operation names must not overwrite generated definitions',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      idArg: 'slug',
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: idArg slug collides with a schema field/,
    'the document-id argument must not overwrite a complete-update field argument',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      immutable: ['createdAt'],
      updateDefaults: { createdAt: 'now' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: updateDefaults cannot set immutable fields/,
    'immutable fields must not be silently changed by trusted update defaults',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
    }),
    /SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED/,
    'the generated list must name an owner-leading index, never an unindexed owner scan',
  );
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      listIndex: 'by_slug_only',
    }),
    /SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED: listIndex by_slug_only must be a declared index whose leading field is ownerId/,
    'a list index whose leading field is not the owner field cannot serve the owner scan',
  );
  {
    const rated = defineTable({
      ownerId: v.string(),
      title: v.string(),
      score: v.real(),
    }).index('by_owner', ['ownerId']);
    defineSchema({ rated });
    assert.throws(
      () => defineOwnedCrud({
        table: rated,
        names,
        visibility: { kind: 'owner', field: 'ownerId' },
        listIndex: 'by_owner',
        createDefaults: { score: 'now' },
      }),
      /SNAPBACK_STANDARD_PATTERN_INVALID: createDefaults.score uses now but is not an integer millisecond field/,
      'trusted now binds only to integer millisecond fields, never floats',
    );
  }
  {
    const memberships = defineTable({
      userId: v.principal(),
      eventId: v.string(),
      role: v.string(),
    })
      .index('by_user', ['userId'])
      .membership({
        scope: 'resource',
        principal: 'userId',
        resource: 'eventId',
        role: 'role',
        roles: ['host', 'guest'],
      });
    defineSchema({ memberships });
    assert.throws(
      () => defineOwnedCrud({
        table: memberships,
        names,
        visibility: { kind: 'owner', field: 'userId' },
        listIndex: 'by_user',
      }),
      /SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE/,
      'generic CRUD must not own authority-bearing membership writes',
    );
    assert.throws(
      () => defineChunkedSemiJoin({
        name: 'membershipJoin',
        actors: {
          table: memberships, index: 'by_user', scopeField: 'userId', keyField: 'eventId', ceiling: 10,
        },
        rows: { table: todos, index: 'by_slug_only', actorField: 'slug' },
        order: { field: '_id', direction: 'asc' },
        take: 10,
      }),
      /SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE/,
      'bounded semi-joins must not turn an authority-bearing table into a generic composition operand',
    );
    assert.throws(
      () => defineSetKeyedAggregate({
        name: 'membershipCounts', table: memberships, index: 'by_user', keyField: 'userId',
        maxKeys: 10, rowCeiling: 10, aggregate: 'count',
      }),
      /SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE/,
      'set-keyed aggregates must refuse authority-bearing rows',
    );
  }
  {
    const invites = defineTable({
      ownerId: v.string(),
      email: v.string(),
      note: v.string(),
    })
      .index('by_owner', ['ownerId'])
      .index('by_email', ['email'], { unique: true });
    defineSchema({ invites });
    assert.throws(
      () => defineOwnedCrud({
        table: invites,
        names,
        visibility: { kind: 'owner', field: 'ownerId' },
        listIndex: 'by_owner',
      }),
      /SNAPBACK_STANDARD_PATTERN_DISCLOSURE_REQUIRED/,
      'a global unique index reachable by generated writes is an existence channel and must be declared',
    );
    const disclosed = defineOwnedCrud({
      table: invites,
      names,
      visibility: { kind: 'owner', field: 'ownerId' },
      listIndex: 'by_owner',
      discloseUniqueConflicts: ['by_email'],
    });
    assert.equal(typeof disclosed.listTodos, 'object', 'an explicit disclosure declaration admits the table');
  }
  assert.throws(
    () => defineOwnedUniqueLookup({
      table: todos,
      name: 'todoBySlug',
      index: 'by_owner_slug',
      visibility: { kind: 'owner', field: 'ownerId' },
      live: 'sometimes',
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID: live must be boolean/,
  );
  assert.throws(
    () => defineOwnedKeysetPages({
      table: todos,
      names: { first: 'firstTodoPage', next: 'nextTodoPage' },
      index: 'by_owner_created_slug',
      cursorField: 'createdAt',
      visibility: { kind: 'owner', field: 'ownerId' },
    }),
    /SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED: by_owner_created_slug must be unique with exact fields \[ownerId, createdAt\]/,
    'a third unique-index field does not make the cursor unique within one owner partition',
  );
}

const dir = mkdtempSync(join(tmpdir(), 'snapback-standard-patterns-'));
try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const todos = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  title: v.string(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export default defineSchema({ todos }, { auth: { mode: 'sessions' } });
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import schema from './schema.mjs';
import {
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
} from '${patternsUrl}';

export const { listTodos, getTodo, createTodo, updateTodo, deleteTodo } = defineOwnedCrud({
  table: schema.tables.todos,
  names: {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  createDefaults: { pageKey: 'id', createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'pageKey', 'createdAt'],
  listIndex: 'by_owner_created',
});

export const { todoBySlug } = defineOwnedUniqueLookup({
  table: schema.tables.todos,
  name: 'todoBySlug',
  index: 'by_owner_slug',
  visibility: { kind: 'owner', field: 'ownerId' },
});

export const { firstTodoPage, nextTodoPage } = defineOwnedKeysetPages({
  table: schema.tables.todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'ownerId' },
});

// Handwritten equivalent of the generated get, for the posture-parity witness.
import { defineLiveQuery, eq, arg, authUserId, v } from '${defineUrl}';
export const getTodoByHand = defineLiveQuery({
  table: 'todos',
  args: { id: v.id('todos') },
  filter: [eq('ownerId', authUserId()), eq('_id', arg('id'))],
  auth: 'authenticated',
  authScopeField: 'ownerId',
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
  const authorizationReview = JSON.parse(
    readFileSync(join(dir, 'generated', 'authorization-review.json'), 'utf8'),
  );
  const writeChecks = authorizationReview.writePolicyChecks;
  assert.equal(writeChecks.length, 3, 'one D9 row per generic CRUD write site');
  assert.deepEqual(
    writeChecks.map(({ operation }) => operation).sort(),
    ['createTodo', 'deleteTodo', 'updateTodo'],
  );
  assert(writeChecks.every(({ siteResolution }) => siteResolution === 'exact-plan-step'));
  assert(writeChecks.every(({ genericWriteDisposition }) => genericWriteDisposition === 'owner-policy'));
  assert.equal(
    writeChecks.find(({ operation }) => operation === 'createTodo').ownerInputDisposition,
    'sealed-auth-user-id-marker',
  );
  assert.equal(
    writeChecks.find(({ operation }) => operation === 'updateTodo').absentDisposition,
    'declared-refusal',
  );
  assert.deepEqual([...byName.keys()].sort(), [
    'createTodo', 'deleteTodo', 'firstTodoPage', 'getTodo', 'getTodoByHand',
    'listTodos', 'nextTodoPage', 'todoBySlug', 'updateTodo',
  ]);

  // @ref LLP 0065#6-acceptance — posture parity: a generated operation and a
  //   handwritten equivalent carry identical auth requirements, read
  //   summaries, effect ceilings, and plan shape; generation confers no
  //   special authority and skips no gate.
  {
    const generated = byName.get('getTodo');
    const handwritten = byName.get('getTodoByHand');
    assert.equal(generated.authRequirement, handwritten.authRequirement);
    assert.deepEqual(generated.readSetSummary, handwritten.readSetSummary);
    assert.deepEqual(generated.writeSetSummary, handwritten.writeSetSummary);
    assert.deepEqual(generated.effectCeiling, handwritten.effectCeiling);
    assert.deepEqual(generated.authorizationDependence, handwritten.authorizationDependence);
    assert.deepEqual(
      generated.runtime.HostPlan.Query.filters,
      handwritten.runtime.HostPlan.Query.filters,
      'the generated owner filter and id filter match the handwritten plan',
    );
  }

  for (const name of ['listTodos', 'getTodo', 'todoBySlug', 'firstTodoPage', 'nextTodoPage']) {
    const fn = byName.get(name);
    assert.equal(fn.authRequirement, 'authenticated', `${name} must require authenticated authority`);
    assert.equal(fn.readSetSummary.authScopeField, 'ownerId', `${name} must carry explicit row visibility`);
    assert(
      fn.runtime.HostPlan.Query.filters.some((filter) => (
        filter.field === 'ownerId' && filter.op === 'Eq' && filter.value === 'AuthUserId'
      )),
      `${name} must execute an owner filter rather than treating metadata as enforcement`,
    );
  }
  for (const name of ['createTodo', 'updateTodo', 'deleteTodo']) {
    assert.equal(byName.get(name).authRequirement, 'authenticated', `${name} must require authenticated authority`);
  }

  const createSchema = JSON.parse(readFileSync(
    join(dir, 'generated', 'operations', 'createTodo.args.schema.json'),
    'utf8',
  ));
  assert.equal(createSchema.additionalProperties, false);
  assert.deepEqual(createSchema.required, ['slug', 'title']);
  assert.equal(Object.hasOwn(createSchema.properties, 'ownerId'), false, 'owner identity must be server-derived');
  assert.equal(Object.hasOwn(createSchema.properties, 'pageKey'), false, 'trusted ids must not be client-forgeable');
  assert.equal(Object.hasOwn(createSchema.properties, 'createdAt'), false, 'trusted time must not be client-forgeable');
  assert.equal(Object.hasOwn(createSchema.properties, 'updatedAt'), false, 'trusted time must not be client-forgeable');

  // @ref LLP 0065#3-common-pattern-contracts — every generated function
  //   carries its versioned helper/profile identity.
  for (const [fnName, helper] of [
    ['listTodos', 'owned-crud.v1'], ['getTodo', 'owned-crud.v1'],
    ['createTodo', 'owned-crud.v1'], ['updateTodo', 'owned-crud.v1'],
    ['deleteTodo', 'owned-crud.v1'], ['todoBySlug', 'owned-unique-lookup.v1'],
    ['firstTodoPage', 'owned-keyset-pages.v1'], ['nextTodoPage', 'owned-keyset-pages.v1'],
  ]) {
    assert.deepEqual(
      byName.get(fnName).standardPattern,
      { helper, profile: 'owner.v1' },
      `${fnName} must carry its versioned standard-pattern identity`,
    );
  }

  // @ref LLP 0065#6-acceptance — generation asserts each constructor's exact
  //   expected EffectCeilingV1; the runtime subset check stays enforcement.
  assert.deepEqual(byName.get('listTodos').effectCeiling, {
    version: 'EffectCeilingV1',
    basis: 'static',
    reads: [{ table: 'todos', access: 'query', index: 'by_owner_created' }],
    writes: [],
    hostOperations: [],
    authorizationInputs: ['authUserId'],
  });
  assert.deepEqual(byName.get('updateTodo').effectCeiling, {
    version: 'EffectCeilingV1',
    basis: 'static',
    reads: [{ table: 'todos', access: 'point' }],
    writes: [{ table: 'todos', operations: ['patch'] }],
    hostOperations: ['runtimeNow'],
    authorizationInputs: ['authUserId'],
  });
  assert.deepEqual(byName.get('createTodo').effectCeiling, {
    version: 'EffectCeilingV1',
    basis: 'static',
    reads: [],
    writes: [{ table: 'todos', operations: ['insert'] }],
    hostOperations: ['runtimeId', 'runtimeNow'],
    authorizationInputs: ['authUserId'],
  });

  const listTodos = byName.get('listTodos');
  assert.equal(listTodos.runtime.HostPlan.Query.indexed_by, 'by_owner_created');
  assert.deepEqual(
    listTodos.runtime.HostPlan.Query.order.map((entry) => entry.field),
    ['createdAt'],
    'list order is the declared index sequence; the storage _id suffix totalizes it',
  );

  const update = byName.get('updateTodo');
  const updateSteps = update.runtime.HostPlan.Mutation.steps;
  assert.equal(updateSteps.length, 1, 'the central checked-write carrier replaces the local guard');
  assert.equal(updateSteps[0].Patch.values.updatedAt, 'RuntimeNow');
  assert.deepEqual(
    update.runtime.HostPlan.Mutation.ownerWriteChecks[0],
    {
      stepIndex: 0,
      absent: {
        kind: 'refuse',
        code: 'SNAPBACK_ROW_NOT_FOUND',
        message: 'owner-policy row is unavailable',
        details: { table: 'todos', writeForm: 'patch' },
        digest: update.runtime.HostPlan.Mutation.ownerWriteChecks[0].absent.digest,
      },
    },
  );
  assert.match(
    update.runtime.HostPlan.Mutation.ownerWriteChecks[0].absent.digest,
    /^sha256:[0-9a-f]{64}$/,
  );

  const create = byName.get('createTodo');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.ownerId, 'AuthUserId');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.pageKey, 'RuntimeId');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.createdAt, 'RuntimeNow');

  const next = byName.get('nextTodoPage');
  assert.equal(next.runtime.HostPlan.Query.filters[1].op, 'Gt');
  assert.equal(next.runtime.HostPlan.Query.limit, 50);
  const uniqueLookup = byName.get('todoBySlug').runtime.HostPlan.Query;
  assert.equal(uniqueLookup.limit, 1);
  assert.equal(uniqueLookup.filters.length, 2, 'one owner predicate plus one unique-key predicate');

  const firstTree = snapshotTree(join(dir, 'generated'));
  const regenerated = await generate(dir);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.deepEqual(snapshotTree(join(dir, 'generated')), firstTree, 'regeneration must be byte-identical');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Membership keyset pages (LLP 0100 §4): generation negatives + emission.
// ---------------------------------------------------------------------------
{
  const { defineMembershipKeysetPages } = await import(patternsUrl);
  const makeTables = () => {
    const rooms = defineTable({ name: v.string() });
    const roomMembers = defineTable({
      roomId: v.id('rooms'),
      userId: v.principal(),
      role: v.string(),
    })
      .index('by_room_user', ['roomId', 'userId'], { unique: true })
      .membership({
        resource: 'roomId',
        principal: 'userId',
        role: 'role',
        roles: ['owner', 'member'],
        pendingRoles: ['invited'],
        transitions: [
          { op: 'insert', target: 'other', by: ['owner'], to: ['member'] },
          { op: 'remove', target: 'self', by: ['self'] },
        ],
      });
    const messages = defineTable({
      roomId: v.id('rooms'),
      pageKey: v.string(),
      body: v.string(),
      optionalKey: v.optional(v.string()),
      plainRoom: v.string(),
    })
      .index('by_room_page_key', ['roomId', 'pageKey'], { unique: true })
      .index('by_room_page_loose', ['roomId', 'pageKey'])
      .index('by_room_body', ['roomId', 'body'], { unique: true });
    defineSchema({ rooms, roomMembers, messages });
    return { rooms, roomMembers, messages };
  };
  const names = { first: 'firstRoomMessagePage', next: 'nextRoomMessagePage' };
  const goodMembership = (roomMembers) => ({
    declaration: roomMembers,
    resourceArg: 'roomId',
    resourceField: 'roomId',
    roles: ['owner', 'member'],
  });
  {
    const { roomMembers, messages } = makeTables();
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        index: 'by_room_page_key',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED/,
      'generation must fail closed when the membership block is omitted',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: roomMembers,
        names,
        membership: goodMembership(roomMembers),
        index: 'by_room_user',
        cursorField: 'userId',
      }),
      /SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE/,
      'the membership table itself can never be the page table',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: { ...goodMembership(roomMembers), roles: ['owner', 'invited'] },
        index: 'by_room_page_key',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED: membership.roles names pending role invited/,
      'pending seats are not page visibility (LLP 0100 §4)',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: { ...goodMembership(roomMembers), roles: ['owner', 'moderator'] },
        index: 'by_room_page_key',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED: membership.roles names undeclared role moderator/,
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: { ...goodMembership(roomMembers), roles: [] },
        index: 'by_room_page_key',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED: membership.roles must be a non-empty array/,
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: { ...goodMembership(roomMembers), resourceField: 'plainRoom' },
        index: 'by_room_page_key',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED: membership.resourceField plainRoom must carry the declaration's exact nominal resource type/,
      'a plain string that merely looks like a room id is refused (nominal identity)',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: goodMembership(roomMembers),
        index: 'by_room_page_loose',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED: by_room_page_loose must be unique with exact fields \[roomId, pageKey\]/,
      'a non-unique index cannot carry the strict continuation boundary',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: goodMembership(roomMembers),
        index: 'by_room_page_key',
        cursorField: 'optionalKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_PAGINATION_INDEX_REQUIRED/,
      'an optional cursor field is refused',
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: goodMembership(roomMembers),
        index: 'by_room_page_key',
        cursorField: 'pageKey',
        limit: 0,
      }),
      /SNAPBACK_STANDARD_PATTERN_INVALID: limit must be an integer from 1 through 1024/,
    );
    assert.throws(
      () => defineMembershipKeysetPages({
        table: messages,
        names,
        membership: goodMembership(roomMembers),
        index: 'by_room_page_key',
        cursorField: 'pageKey',
        extra: true,
      }),
      /SNAPBACK_STANDARD_PATTERN_INVALID: defineMembershipKeysetPages options has unknown field extra/,
      'top-level pattern options are a closed vocabulary',
    );
  }
  {
    // App-scoped membership declarations are refused: §4 requires a
    // resource-scoped declaration.
    const orgSettings = defineTable({ pageKey: v.string(), body: v.string() })
      .index('by_page_key_only', ['pageKey'], { unique: true });
    const staff = defineTable({ userId: v.principal(), role: v.string() })
      .index('by_user', ['userId'], { unique: true })
      .membership({
        scope: 'app',
        principal: 'userId',
        role: 'role',
        roles: ['admin'],
        transitions: [{ op: 'insert', target: 'other', by: ['admin'], to: ['admin'] }],
      });
    defineSchema({ orgSettings, staff });
    assert.throws(
      () => defineMembershipKeysetPages({
        table: orgSettings,
        names,
        membership: {
          declaration: staff,
          resourceArg: 'orgId',
          resourceField: 'pageKey',
          roles: ['admin'],
        },
        index: 'by_page_key_only',
        cursorField: 'pageKey',
      }),
      /SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED: membership keyset pages require a resource-scoped membership declaration/,
    );
  }
  {
    // Positive emission: ordinary callable Query pair (LLP 0100 §4's
    // deliberate delta from defineLiveQuery+defaultLive:false), membership
    // predicate as executable authority, and the §5 generation-time facts on
    // the standard pattern.
    const { roomMembers, messages } = makeTables();
    const pages = defineMembershipKeysetPages({
      table: messages,
      names,
      membership: goodMembership(roomMembers),
      index: 'by_room_page_key',
      cursorField: 'pageKey',
      limit: 50,
    });
    const first = pages.firstRoomMessagePage;
    const next = pages.nextRoomMessagePage;
    assert.equal(first.__kind, 'Query', 'membership pages are callable-only Query emissions');
    assert.equal(next.__kind, 'Query');
    assert.equal(first.defaultLive, undefined, 'not a defaultLive:false live query');
    assert.deepEqual(first.standardPattern, {
      helper: 'membership-keyset-pages.v1',
      profile: 'membership.v1',
      membership: {
        declaration: 'roomMembers',
        resourceArg: 'roomId',
        resourceField: 'roomId',
        roles: ['member', 'owner'],
      },
    }, 'the §5 binding facts ride the standard pattern, roles canonicalized');
    assert.deepEqual(first.standardPattern, next.standardPattern);
    assert.equal(first.plan.membershipFilters.length, 1, 'the seat predicate is executable authority');
    assert.deepEqual(first.plan.membershipFilters[0].roles, ['member', 'owner']);
    assert.equal(first.plan.membershipFilters[0].resource.kind, 'arg');
    assert.equal(first.plan.membershipFilters[0].resource.path, 'roomId');
    assert.deepEqual(Object.keys(first.args), ['roomId'], 'first takes exactly the resource argument');
    assert.deepEqual(Object.keys(next.args), ['roomId', 'after'], 'next adds the opaque continuation');
    assert.equal(first.plan.filters.length, 1, 'first filters on the resource value only');
    assert.equal(next.plan.filters.length, 2, 'next adds exactly the strict boundary');
  }
}

// Membership pages ride the full generate() pipeline: Query-kind manifest
// emission with the membership facts intact.
{
  const dir2 = mkdtempSync(join(tmpdir(), 'snapback-membership-pages-'));
  try {
    writeFileSync(join(dir2, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const rooms = defineTable({ name: v.string() })
  .visibility({ kind: 'public-read' });
export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
})
  .index('by_room_user', ['roomId', 'userId'], { unique: true })
  .membership({
    resource: 'roomId',
    principal: 'userId',
    role: 'role',
    roles: ['owner', 'member'],
    transitions: [
      { op: 'insert', target: 'other', by: ['owner'], to: ['member'] },
      { op: 'remove', target: 'self', by: ['self'] },
    ],
  })
  .visibility({ kind: 'public-read' });
export const messages = defineTable({
  roomId: v.id('rooms'),
  pageKey: v.string(),
  body: v.string(),
})
  .index('by_room_page_key', ['roomId', 'pageKey'], { unique: true })
  .visibility({
    kind: 'membership',
    declaration: 'roomMembers',
    resourceField: 'roomId',
    roles: ['owner', 'member'],
  })
  .sync();
export default defineSchema(
  { rooms, roomMembers, messages },
  { auth: { mode: 'sessions' } },
);
`);
    writeFileSync(join(dir2, 'functions.mjs'), `
import { defineMembershipKeysetPages } from '${patternsUrl}';
import { messages, roomMembers } from './schema.mjs';

export const { firstRoomMessagePage, nextRoomMessagePage } =
  defineMembershipKeysetPages({
    table: messages,
    names: { first: 'firstRoomMessagePage', next: 'nextRoomMessagePage' },
    membership: {
      declaration: roomMembers,
      resourceArg: 'roomId',
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    },
    index: 'by_room_page_key',
    cursorField: 'pageKey',
    limit: 50,
  });
`);
    const result = await generate(dir2);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const manifest = JSON.parse(
      readFileSync(join(dir2, 'generated', 'functions.manifest.json'), 'utf8'),
    );
    const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
    for (const name of ['firstRoomMessagePage', 'nextRoomMessagePage']) {
      const fn = byName.get(name);
      assert.ok(fn, `${name} must be emitted`);
      assert.equal(fn.kind, 'Query', `${name} is callable-only — never a LiveQuery`);
      assert.equal(fn.authRequirement, 'authenticated');
      assert.deepEqual(fn.standardPattern, {
        helper: 'membership-keyset-pages.v1',
        profile: 'membership.v1',
        membership: {
          declaration: 'roomMembers',
          resourceArg: 'roomId',
          resourceField: 'roomId',
          roles: ['member', 'owner'],
        },
      }, `${name} carries the §5 generation-time membership facts`);
      const plan = fn.runtime.HostPlan.Query;
      assert.equal(plan.membershipFilters.length, 1, `${name} executes the seat predicate`);
      assert.ok(
        plan.filters.some((filter) => filter.field === 'roomId' && filter.op === 'Eq'),
        `${name} filters on the exact resource value`,
      );
    }
    const nextArgs = JSON.parse(readFileSync(
      join(dir2, 'generated', 'operations', 'nextRoomMessagePage.args.schema.json'),
      'utf8',
    ));
    assert.deepEqual(nextArgs.required.sort(), ['after', 'roomId']);
    assert.equal(nextArgs.additionalProperties, false);
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

// @ref LLP 0278#d3-closed-membership-semi-join — generated composition
// owns the 499-value seam and publishes a single live operation rather than
// asking an adapter to create one stream per actor/key.
{
  const dir3 = mkdtempSync(join(tmpdir(), 'snapback-bounded-composition-'));
  try {
    writeFileSync(join(dir3, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const follows = defineTable({ viewerId: v.principal(), actorId: v.principal() })
  .index('by_viewer', ['viewerId'])
  .visibility({ kind: 'public-read' });
export const events = defineTable({ actorId: v.principal(), pageKey: v.string() })
  .index('by_actor_page', ['actorId', 'pageKey'])
  .visibility({ kind: 'public-read' });
export const receipts = defineTable({ profileId: v.string(), receiptId: v.string() })
  .index('by_profile', ['profileId'])
  .visibility({ kind: 'public-read' });
export default defineSchema({ follows, events, receipts }, { auth: { mode: 'sessions' } });
`);
    writeFileSync(join(dir3, 'functions.mjs'), `
import { follows, events, receipts } from './schema.mjs';
import { defineChunkedSemiJoin, defineSetKeyedAggregate } from '${patternsUrl}';
export const { followingFeed } = defineChunkedSemiJoin({
  name: 'followingFeed',
  actors: { table: follows, index: 'by_viewer', scopeField: 'viewerId', keyField: 'actorId', ceiling: 500 },
  rows: { table: events, index: 'by_actor_page', actorField: 'actorId' },
  order: { field: 'pageKey', direction: 'desc' },
  take: 50,
});
export const { profileReceiptCounts } = defineSetKeyedAggregate({
  name: 'profileReceiptCounts', table: receipts, index: 'by_profile', keyField: 'profileId',
  maxKeys: 700, rowCeiling: 1023, aggregate: 'count',
});
`);
    const result = await generate(dir3);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const manifest = JSON.parse(readFileSync(join(dir3, 'generated', 'functions.manifest.json'), 'utf8'));
    const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
    assert.deepEqual(byName.get('followingFeed').standardPattern, {
      helper: 'chunked-semi-join.v1', profile: 'bounded-composition.v1',
    });
    assert.match(byName.get('followingFeed').runtime.IbexModule.source, /maxChunks=2; perChunkTake=50/);
    assert.match(byName.get('followingFeed').runtime.IbexModule.source, /offset \+= 499/);
    assert.match(byName.get('followingFeed').runtime.IbexModule.source, /semiJoinActorCeilingExceeded\(500\)/);
    assert.deepEqual(byName.get('profileReceiptCounts').standardPattern, {
      helper: 'set-keyed-aggregate.v1', profile: 'bounded-composition.v1',
    });
    assert.match(byName.get('profileReceiptCounts').runtime.IbexModule.source, /maxChunks=2; perChunkTake=1024/);
    assert.match(byName.get('profileReceiptCounts').runtime.IbexModule.source, /aggregateRowCeilingExceeded\(1023\)/);
    const aggregateArgs = JSON.parse(readFileSync(
      join(dir3, 'generated', 'operations', 'profileReceiptCounts.args.schema.json'),
      'utf8',
    ));
    assert.equal(aggregateArgs.properties.keys.maxItems, 700);

    const executeGenerated = async (fn, ctx, args) => {
      const prior = globalThis.__snapbackHandlers;
      try {
        globalThis.__snapbackHandlers = Object.create(null);
        Function(fn.runtime.IbexModule.source)();
        return await globalThis.__snapbackHandlers[fn.name](ctx, args);
      } finally {
        globalThis.__snapbackHandlers = prior;
      }
    };
    const rowsByTable = {
      follows: [
        { _id: 'follow-a', viewerId: 'viewer', actorId: 'actor-a' },
        { _id: 'follow-b', viewerId: 'viewer', actorId: 'actor-b' },
      ],
      events: [
        { _id: 'event-a', actorId: 'actor-a', pageKey: '2' },
        { _id: 'event-b', actorId: 'actor-b', pageKey: '3' },
      ],
      receipts: [
        { _id: 'receipt-a', profileId: 'profile-a' },
        { _id: 'receipt-b', profileId: 'profile-a' },
        { _id: 'receipt-c', profileId: 'profile-b' },
      ],
    };
    const runtimeCtx = {
      db: {
        query(table) {
          let selected = rowsByTable[table];
          return {
            withIndex() { return this; },
            eq(field, value) { selected = selected.filter((row) => row[field] === value); return this; },
            in(field, values) { selected = selected.filter((row) => values.includes(row[field])); return this; },
            order(field, direction) {
              selected = [...selected].sort((left, right) => String(left[field]).localeCompare(String(right[field])));
              if (direction === 'desc') selected.reverse();
              return this;
            },
            take(limit) { selected = selected.slice(0, limit); return this; },
            async collect() { return selected; },
          };
        },
      },
      composition: {
        semiJoinActorCeilingExceeded() { throw new Error('unexpected semi-join ceiling'); },
        aggregateRowCeilingExceeded() { throw new Error('unexpected aggregate ceiling'); },
      },
    };
    assert.deepEqual(
      (await executeGenerated(byName.get('followingFeed'), runtimeCtx, { viewerId: 'viewer' }))
        .map(({ _id }) => _id),
      ['event-b', 'event-a'],
      'the emitted semi-join executes and globally merges its runtime rows',
    );
    assert.deepEqual(
      await executeGenerated(
        byName.get('profileReceiptCounts'), runtimeCtx, { keys: ['profile-a', 'profile-b'] },
      ),
      [{ key: 'profile-a', count: 2 }, { key: 'profile-b', count: 1 }],
      'the emitted aggregate executes against one invocation snapshot',
    );
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }
}

console.log('standard-patterns.test.mjs: all cases passed');

function snapshotTree(root) {
  const files = [];
  visit(root, '');
  return files;

  function visit(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) visit(path, relative);
      else files.push([relative, readFileSync(path)]);
    }
  }
}
