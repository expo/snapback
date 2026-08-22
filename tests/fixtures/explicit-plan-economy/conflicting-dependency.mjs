import {
  arg,
  defineMutation,
  lit,
  patch,
  returnChangedCount,
  v,
} from '@expo/snapback-codegen/define';

export const markDone = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
  reads: [],
});
