import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineSchema, defineTable, v } from './define.mjs';
import { defineOwnedCrud } from './standard-patterns.mjs';
import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const patternsUrl = pathToFileURL(join(packageDir, 'standard-patterns.mjs')).href;

{
  const todos = defineTable({ ownerId: v.principal(), title: v.string() });
  defineSchema({ todos });
  assert.throws(
    () => defineOwnedCrud({
      table: todos,
      names: { list: 'listTodos', get: 'getTodo', create: 'createTodo', update: 'updateTodo', delete: 'deleteTodo' },
    }),
    /SNAPBACK_STANDARD_PATTERN_INVALID|SNAPBACK_STANDARD_PATTERN_VISIBILITY_REQUIRED/,
    'generation must fail closed when visibility is omitted',
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
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
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
  createDefaults: { createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'createdAt'],
});

export const todoBySlug = defineOwnedUniqueLookup({
  table: schema.tables.todos,
  name: 'todoBySlug',
  index: 'by_owner_slug',
  visibility: { kind: 'owner', field: 'ownerId' },
});

export const { firstTodoPage, nextTodoPage } = defineOwnedKeysetPages({
  table: schema.tables.todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_created',
  cursorField: 'createdAt',
  visibility: { kind: 'owner', field: 'ownerId' },
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
  assert.deepEqual([...byName.keys()].sort(), [
    'createTodo', 'deleteTodo', 'firstTodoPage', 'getTodo', 'listTodos',
    'nextTodoPage', 'todoBySlug', 'updateTodo',
  ]);

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
  assert.equal(Object.hasOwn(createSchema.properties, 'createdAt'), false, 'trusted time must not be client-forgeable');
  assert.equal(Object.hasOwn(createSchema.properties, 'updatedAt'), false, 'trusted time must not be client-forgeable');

  const update = byName.get('updateTodo');
  const updateSteps = update.runtime.HostPlan.Mutation.steps;
  assert.equal(updateSteps[0].Get.table, 'todos');
  assert.equal(updateSteps[1].Guard.else_error, 'SNAPBACK_ROW_NOT_VISIBLE');
  assert.equal(updateSteps[1].Guard.cond.Binary.right, 'AuthUserId');
  assert.equal(updateSteps[2].Patch.values.updatedAt, 'RuntimeNow');

  const create = byName.get('createTodo');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.ownerId, 'AuthUserId');
  assert.equal(create.runtime.HostPlan.Mutation.steps[0].Insert.values.createdAt, 'RuntimeNow');

  const next = byName.get('nextTodoPage');
  assert.equal(next.runtime.HostPlan.Query.filters[1].op, 'Gt');
  assert.equal(next.runtime.HostPlan.Query.limit, 50);
  assert.equal(byName.get('todoBySlug').runtime.HostPlan.Query.limit, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('standard-patterns.test.mjs: all cases passed');
