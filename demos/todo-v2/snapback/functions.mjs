// Todo v2 demo functions — queries + mutations as HostPlans.
//
// @ref LLP 0004#handler-api — queries are read-oriented, mutations write-oriented;
//   server-owned _createdAt/_updatedAt mean handlers never set timestamps.
// @ref LLP 0010#first-acceptance-app — proves one live query, one ordinary
//   (non-syncable) callable query, and a ctx.db mutation path with create/toggle/
//   edit/delete.

import {
  arg,
  asc,
  authUserId,
  defineLiveQuery,
  defineMutation,
  defineQuery,
  del,
  eq,
  insert,
  lit,
  patch,
  returnBinding,
  returnChangedCount,
  v,
} from '../../_kit/define.mjs';

// Syncable-live query: the current user's todos, oldest first, via by_user.
export const listTodos = defineLiveQuery({
  table: 'todos',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_user',
});

// Ordinary callable query (NOT live). Exists to prove the capability distinction:
// subscribing to it must fail with SNAPBACK_FUNCTION_NOT_LIVE rather than silently
// behaving like a local-first query.
// @ref LLP 0004#relationship-to-sync-and-realtime — callable != syncable-live.
export const listTodosOnce = defineQuery({
  table: 'todos',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_user',
});

// Deep-link slice (LLP 0090 D4 rollout step 7): the same user's todos
// narrowed to one priority — the second query a /priority/:priority
// register-mode bundle cold start needs, so one bundle request replaces two
// per-query subscribe round trips. Auth-scoped like listTodos: bundle
// entries for it carry `resume: null` in both modes (no RQS resume state
// for auth-scoped queries in v1).
export const listTodosByPriority = defineLiveQuery({
  table: 'todos',
  args: { priority: v.string() },
  filter: [eq('userId', authUserId()), eq('priority', arg('priority'))],
  order: [asc('_createdAt')],
  index: 'by_user_priority',
});

export const createTodo = defineMutation({
  args: { title: v.string(), priority: v.string() },
  plan: insert(
    'todos',
    {
      title: arg('title'),
      priority: arg('priority'),
      completed: lit(false),
      userId: authUserId(),
    },
    { bindIdAs: 'todoId' },
  ),
  returns: returnBinding('todoId'),
});

export const setCompleted = defineMutation({
  args: { id: v.string(), completed: v.boolean() },
  plan: patch('todos', arg('id'), { completed: arg('completed') }),
  returns: returnChangedCount(),
});

export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});

export const setPriority = defineMutation({
  args: { id: v.string(), priority: v.string() },
  plan: patch('todos', arg('id'), { priority: arg('priority') }),
  returns: returnChangedCount(),
});

export const deleteTodo = defineMutation({
  args: { id: v.string() },
  plan: del('todos', arg('id')),
  returns: returnChangedCount(),
});
