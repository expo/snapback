import {
  arg,
  bindingRef,
  defineMutation,
  insert,
  lit,
  patch,
  results,
  returnBinding,
  returnChangedCount,
  returnDocument,
  returnExpr,
  v,
} from '@expo/snapback-codegen/define';

const createPlan = (binding) => insert('todos', {
  title: arg('title'),
  done: lit(false),
}, { bindIdAs: binding });

// @ref LLP 0275#d8-explicit-profile-classification-under-llp-0295-d03-2026-08-21
// — these closed plans author behavior and policy only; exact result and
// dependency facts are derived once and projected with provenance.
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: createPlan('todoId'),
  returns: returnBinding('todoId'),
});

export const createTodoAuthoredControl = defineMutation({
  args: { title: v.string() },
  plan: createPlan('authoredTodoId'),
  returns: returnBinding('authoredTodoId'),
  result: results.value(v.id('todos')),
});

export const markDone = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
});

// A compatible authored superset is a control, not a reason to weaken the
// exact derived nonnegative-integer contract.
export const markDoneAuthoredControl = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
  result: results.value(v.integer()),
});

export const createAndRead = defineMutation({
  args: { title: v.string() },
  plan: createPlan('readTodoId'),
  returns: returnDocument('todos', bindingRef('readTodoId')),
});

export const echoOpaqueExpression = defineMutation({
  args: {
    id: v.id('todos'),
    title: v.string(),
  },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnExpr(arg('title')),
});
