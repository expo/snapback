import {
  arg,
  asc,
  defineLiveQuery,
  defineMutation,
  insert,
  lit,
  results,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const listTodos = defineLiveQuery({
  auth: 'public',
  table: 'todos',
  args: {},
  order: [asc('title')],
  index: 'by_title',
});

export const createTodo = defineMutation({
  auth: 'public',
  args: { title: v.string() },
  plan: insert('todos', {
    title: arg('title'),
    completed: lit(false),
  }, { bindIdAs: 'todoId' }),
  result: results.value(v.id('todos')),
  returns: returnBinding('todoId'),
});
