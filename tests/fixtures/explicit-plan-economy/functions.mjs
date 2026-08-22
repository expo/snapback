import {
  arg,
  bindingRef,
  defineMutation,
  get,
  insert,
  letBind,
  lit,
  patch,
  results,
  returnBinding,
  returnChangedCount,
  returnDocument,
  returnExpr,
  runtimeId,
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

export const createAndReadAuthoredControl = defineMutation({
  args: { title: v.string() },
  plan: createPlan('authoredReadTodoId'),
  returns: returnDocument('todos', bindingRef('authoredReadTodoId')),
  result: results.value(v.union([v.null(), v.doc('todos')])),
});

export const patchAndReadMissingOther = defineMutation({
  args: { id: v.id('todos'), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnDocument('otherTodos', runtimeId()),
});

export const shadowedInsert = defineMutation({
  args: { title: v.string() },
  plan: [
    createPlan('shadowed'),
    insert('otherTodos', { title: arg('title') }, { bindIdAs: 'shadowed' }),
  ],
  returns: returnBinding('shadowed'),
});

export const shadowedInsertAuthoredControl = defineMutation({
  args: { title: v.string() },
  plan: [
    createPlan('authoredShadowed'),
    insert('otherTodos', { title: arg('title') }, { bindIdAs: 'authoredShadowed' }),
  ],
  returns: returnBinding('authoredShadowed'),
  result: results.value(v.id('otherTodos')),
});

export const shadowedGet = defineMutation({
  args: { title: v.string(), id: v.id('todos') },
  plan: [
    createPlan('readShadowed'),
    get('todos', arg('id'), 'readShadowed'),
  ],
  returns: returnBinding('readShadowed'),
});

export const shadowedLet = defineMutation({
  args: { title: v.string() },
  plan: [
    createPlan('letShadowed'),
    letBind('letShadowed', lit('replacement')),
  ],
  returns: returnBinding('letShadowed'),
});

export const echoOpaqueExpression = defineMutation({
  args: {
    id: v.id('todos'),
    title: v.string(),
  },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnExpr(arg('title')),
});
