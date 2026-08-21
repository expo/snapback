import {
  arg,
  desc,
  defineLiveQuery,
  defineMutation,
  insert,
  lit,
  patch,
  results,
  returnBinding,
  returnChangedCount,
  runtimeNow,
  v,
} from '@expo/snapback-codegen/define';

export const listBugs = defineLiveQuery({
  auth: 'public',
  table: 'bugs',
  args: {},
  order: [desc('createdAt')],
  index: 'by_created_at',
});

export const createBug = defineMutation({
  auth: 'public',
  args: {
    title: v.string(),
    description: v.string(),
    priority: v.string(),
  },
  plan: insert('bugs', {
    title: arg('title'),
    description: arg('description'),
    priority: arg('priority'),
    status: lit('open'),
    createdAt: runtimeNow(),
  }, { bindIdAs: 'bugId' }),
  result: results.value(v.id('bugs')),
  returns: returnBinding('bugId'),
});

export const updateBugStatus = defineMutation({
  auth: 'public',
  args: { id: v.id('bugs'), status: v.string() },
  plan: patch('bugs', arg('id'), { status: arg('status') }),
  result: results.value(v.integer()),
  returns: returnChangedCount(),
});
