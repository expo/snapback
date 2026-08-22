import {
  arg,
  defineMutation,
  insert,
  lit,
  results,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', {
    title: arg('title'),
    done: lit(false),
  }, { bindIdAs: 'todoId' }),
  returns: returnBinding('todoId'),
  result: results.value(v.string()),
});
