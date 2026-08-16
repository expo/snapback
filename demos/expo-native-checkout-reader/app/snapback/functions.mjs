import {
  authUserId,
  defineLiveQuery,
  eq,
} from '@expo/snapback-codegen/define';

export const listWitnessRows = defineLiveQuery({
  table: 'witnessRows',
  args: {},
  filter: [eq('ownerId', authUserId())],
  index: 'by_owner',
  authScopeField: 'ownerId',
});
