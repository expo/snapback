// @ref LLP 0043#milestone-1-retained-reads — only the explicitly public,
// authority-independent list query participates in cold retained display.
// @ref LLP 0053#the-authorization-event-universe-closed — authUserId() makes myTodos
// authority-scoped; this JS arm must refuse durable retention without leases.

import {
  arg,
  asc,
  authUserId,
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

// The protected-retention probe. Deliberately NOT authorityIndependent, and
// anonymous-admissible (no authUserId(): an anonymous sessions caller can
// subscribe it, unlike myTodos which refuses SNAPBACK_AUTH_USER_MISSING
// before any retention classification). The SAME declaration classifies
// SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE under dev custody (no authorization
// scope is ever minted there) and SNAPBACK_RETENTION_NOT_RETAINABLE under
// sessions mode, where every non-authorityIndependent subscription is
// auth-scoped (LLP 0053's protected class).
export const todosFeed = defineLiveQuery({
  table: 'todos',
  args: { listId: v.string() },
  filter: [eq('listId', arg('listId'))],
  order: [asc('title')],
  index: 'by_list_title',
  auth: 'public',
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
