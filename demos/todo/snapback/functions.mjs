// Todo demo functions — JavaScript ctx.db handlers plus one HostPlan fixture query.
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
  defineJsLiveQuery,
  defineJsMutation,
  defineMutation,
  defineQuery,
  eq,
  patch,
  returnChangedCount,
  v,
} from '../../_kit/define.mjs';

// Syncable-live query: the current user's todos, oldest first, via by_user.
export const listTodos = defineJsLiveQuery({
  args: {},
  source: 'handlers.mjs',
  exportName: 'listTodos',
  reads: ['todos'],
  authScopeField: 'userId',
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

export const createTodo = defineJsMutation({
  args: { title: v.string() },
  source: 'handlers.mjs',
  exportName: 'createTodo',
  writes: ['todos'],
});

export const setCompleted = defineJsMutation({
  args: { id: v.string(), completed: v.boolean() },
  source: 'handlers.mjs',
  exportName: 'setCompleted',
  reads: ['todos'],
  writes: ['todos'],
});

export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});

export const deleteTodo = defineJsMutation({
  args: { id: v.string() },
  source: 'handlers.mjs',
  exportName: 'deleteTodo',
  reads: ['todos'],
  writes: ['todos'],
});
