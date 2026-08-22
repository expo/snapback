import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
import {
  defineChunkedSemiJoin,
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
  defineSetKeyedAggregate,
} from '@expo/snapback-codegen/standard-patterns';

const todos = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  pageKey: v.string(),
  title: v.string(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner', ['ownerId']);
defineSchema({ todos });

const composition = defineChunkedSemiJoin({
  name: 'relatedTodos',
  actors: { table: todos, index: 'by_owner', scopeField: 'ownerId', keyField: 'ownerId', ceiling: 10 },
  rows: { table: todos, index: 'by_owner_page_key', actorField: 'ownerId' },
  order: { field: 'pageKey' },
  take: 10,
});
composition.relatedTodos;

const aggregate = defineSetKeyedAggregate({
  name: 'todoCounts', table: todos, index: 'by_owner', keyField: 'ownerId',
  maxKeys: 10, rowCeiling: 100, aggregate: 'count',
});
aggregate.todoCounts;

const crud = defineOwnedCrud({
  table: todos,
  names: {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  createDefaults: { pageKey: 'id' },
  immutable: ['slug', 'pageKey'],
  listIndex: 'by_owner',
});
crud.listTodos;
crud.updateTodo;
// @ts-expect-error generated definition maps expose only explicitly named operations
crud.listTodso;

const lookup = defineOwnedUniqueLookup({
  table: todos,
  name: 'todoBySlug',
  index: 'by_owner_slug',
  visibility: { kind: 'owner', field: 'ownerId' },
});
lookup.todoBySlug;
// @ts-expect-error lookup names remain literal in the returned definition map
lookup.todosBySlug;

const pages = defineOwnedKeysetPages({
  table: todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'ownerId' },
});
pages.firstTodoPage;
pages.nextTodoPage;
// @ts-expect-error keyset maps expose only their two declared names
pages.previousTodoPage;

defineOwnedCrud({
  table: todos,
  names: {
    list: 'badList',
    get: 'badGet',
    create: 'badCreate',
    update: 'badUpdate',
    delete: 'badDelete',
  },
  // @ts-expect-error owner visibility fields must exist on the table
  visibility: { kind: 'owner', field: 'tenantId' },
  listIndex: 'by_owner',
});

defineOwnedCrud({
  table: todos,
  names: {
    list: 'badOwnerDefaultList',
    get: 'badOwnerDefaultGet',
    create: 'badOwnerDefaultCreate',
    update: 'badOwnerDefaultUpdate',
    delete: 'badOwnerDefaultDelete',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  listIndex: 'by_owner',
  createDefaults: {
    // @ts-expect-error runtime ids cannot manufacture authority principals
    ownerId: 'id',
  },
});

defineOwnedCrud({
  table: todos,
  names: {
    list: 'badDefaultsList',
    get: 'badDefaultsGet',
    create: 'badDefaultsCreate',
    update: 'badDefaultsUpdate',
    delete: 'badDefaultsDelete',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  listIndex: 'by_owner',
  createDefaults: {
    // @ts-expect-error trusted defaults must name a table field
    generatedAt: 'now',
  },
});
