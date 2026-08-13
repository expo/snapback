import {
  defineAction,
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '../../../packages/snapback-codegen/define.mjs';

const listImpl = defineJsLiveQuery({
  args: { completed: v.boolean() },
  result: results.documents('todos'),
  auth: 'public',
  reads: ['todos'],
  handler: async (ctx, args) => ctx.db
    .query('todos')
    .withIndex('by_completed')
    .eq('completed', args.completed)
    .collect(),
});

const createImpl = defineJsMutation({
  args: { title: v.string() },
  result: results.value(v.id('todos')),
  auth: 'public',
  reads: [],
  writes: ['todos'],
  handler: async (ctx, args) => ctx.db.insert('todos', {
    title: args.title,
    completed: false,
  }),
});

const createFromActionImpl = defineAction({
  args: { title: v.string() },
  result: results.value(v.id('todos')),
  auth: 'public',
  handler: async (ctx, args) => ctx.runMutation('todos.create', args),
});

// @ref LLP 0253#s52-operation-names-and-normalizedapplicationdefinitionv1
// — explicit authoring uses ES2022 string export names to spell the same
// canonical dotted operations as the familiar module/export discovery rule.
export {
  createImpl as "todos.create",
  createFromActionImpl as "todos.createFromAction",
  listImpl as "todos.list",
};
