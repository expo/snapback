import {
  arg,
  asc,
  authUserId,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  lit,
  v,
} from '@expo/snapback-codegen/define';

export const listTodos = defineLiveQuery({
  table: 'todos',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_user',
  authScopeField: 'userId',
});

export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', {
    title: arg('title'),
    completed: lit(false),
    userId: authUserId(),
  }),
});
