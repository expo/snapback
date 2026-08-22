import {
  arg,
  defineMutation,
  insert,
  lit,
  results,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const shadowedInsert = defineMutation({
  args: { title: v.string() },
  plan: [
    insert('todos', {
      title: arg('title'),
      done: lit(false),
    }, { bindIdAs: 'shadowed' }),
    insert('otherTodos', {
      title: arg('title'),
    }, { bindIdAs: 'shadowed' }),
  ],
  returns: returnBinding('shadowed'),
  result: results.value(v.id('todos')),
});
