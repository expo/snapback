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
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
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
    /SNAPBACK_STANDARD_PATTERN_INVALID: trusted defaults cannot set owner visibility field ownerId/,
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
  assert.equal(updateSteps[0].Get.table, 'todos');
  assert.equal(
    updateSteps[1].Guard.else_error,
    'SNAPBACK_ROW_NOT_FOUND',
    'missing and invisible collapse to one public refusal',
  );
  assert.equal(updateSteps[0].Get.else_error, 'SNAPBACK_ROW_NOT_FOUND');
  assert.equal(updateSteps[1].Guard.cond.Binary.right, 'AuthUserId');
  assert.equal(updateSteps[2].Patch.values.updatedAt, 'RuntimeNow');

  const create = byName.get('createTodo');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.ownerId, 'AuthUserId');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.pageKey, 'RuntimeId');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.createdAt, 'RuntimeNow');

  const next = byName.get('nextTodoPage');
  assert.equal(next.runtime.HostPlan.Query.filters[1].op, 'Gt');
  assert.equal(next.runtime.HostPlan.Query.limit, 50);
  assert.equal(byName.get('todoBySlug').runtime.HostPlan.Query.limit, 1);

  const firstTree = snapshotTree(join(dir, 'generated'));
  const regenerated = await generate(dir);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.deepEqual(snapshotTree(join(dir, 'generated')), firstTree, 'regeneration must be byte-identical');
} finally {
  rmSync(dir, { recursive: true, force: true });
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
