import {
  arg,
  asc,
  defineLiveQuery,
  defineMutation,
  insert,
  lit,
  v,
} from '@expo/snapback-codegen/define';

export const listTodos = defineLiveQuery({
  table: 'todos',
  args: {},
  order: [asc('title')],
  index: 'by_title',
});

export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', {
    title: arg('title'),
    completed: lit(false),
  }),
});
