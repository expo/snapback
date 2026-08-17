// @ref LLP 0043#milestone-1-retained-reads — public-exact list queries
// participate in cold retained display from owner proof; the default witness
// carries no retention declaration.
// @ref LLP 0053#the-authorization-event-universe-closed — authUserId() makes myTodos
// authority-scoped; this JS arm must refuse durable retention without leases.

import {
  arg,
  asc,
  authUserId,
  defineJsLiveQuery,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  lit,
  patch,
  returnBinding,
  returnChangedCount,
  results,
  v,
} from '../../_kit/define.mjs';

export const todosByList = defineLiveQuery({
  table: 'todos',
  args: { listId: v.string() },
  filter: [eq('listId', arg('listId'))],
  order: [asc('title')],
  index: 'by_list_title',
  auth: 'public',
  authorityIndependent: true,
});

export const myTodos = defineLiveQuery({
  table: 'todos',
  args: {},
  filter: [eq('listId', authUserId())],
  order: [asc('title')],
  index: 'by_list_title',
  auth: 'public',
});

// Default public-exact retention witness: no authorityIndependent or
// retainable declaration. Codegen/the host derive the exact class.
export const todosFeed = defineLiveQuery({
  table: 'todos',
  args: { listId: v.string() },
  filter: [eq('listId', arg('listId'))],
  order: [asc('title')],
  index: 'by_list_title',
  auth: 'public',
});

// Protected-retention refusal probe. Opaque JavaScript remains auth-scoped
// under the new derivation but is still anonymous-callable, so both custody
// phases can observe the retention boundary instead of failing earlier on a
// missing authUserId().
export const protectedTodosFeed = defineJsLiveQuery({
  args: { listId: v.string() },
  result: results.documents('todos'),
  reads: ['todos'],
  auth: 'public',
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('todos').take(1024).collect();
    return rows.filter((row) => row.listId === args.listId);
  },
});

export const addTodo = defineMutation({
  auth: 'public',
  args: {
    listId: v.string(),
    title: v.string(),
  },
  plan: insert(
    'todos',
    {
      listId: arg('listId'),
      title: arg('title'),
      done: lit(false),
    },
    { bindIdAs: 'todoId' },
  ),
  result: results.value(v.id('todos')),
  returns: returnBinding('todoId'),
});

// The witness queues true -> false -> true against one row. The last write is
// mechanically order-sensitive, and redelivering the middle settlement would
// visibly change the final value if the server dispatched it twice.
export const toggleTodo = defineMutation({
  auth: 'public',
  args: { id: v.id('todos'), done: v.boolean() },
  plan: patch('todos', arg('id'), { done: arg('done') }),
  result: results.value(v.integer()),
  returns: returnChangedCount(),
});
