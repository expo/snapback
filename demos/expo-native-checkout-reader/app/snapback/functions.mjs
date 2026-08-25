import {
  arg,
  authUserId,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  results,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const seedWitnessRow = defineMutation({
  auth: 'authenticated',
  args: { note: v.string() },
  plan: insert('witnessRows', {
    ownerId: authUserId(),
    note: arg('note'),
  }, { bindIdAs: 'rowId' }),
  result: results.value(v.id('witnessRows')),
  returns: returnBinding('rowId'),
});

export const listWitnessRows = defineLiveQuery({
  auth: 'authenticated',
  table: 'witnessRows',
  args: {},
  filter: [eq('ownerId', authUserId())],
  index: 'by_owner',
  authScopeField: 'ownerId',
});
