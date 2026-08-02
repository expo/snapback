// App-CLI served-journey fixture functions: one mutation with required args
// and one query, so the envelope carries distinguishable operation schemas
// and kind-specific binding declarations.
import {
  arg,
  asc,
  authUserId,
  defineMutation,
  defineQuery,
  eq,
  insert,
  returnBinding,
  v,
} from '@expo/snapback-codegen/define';

export const createNote = defineMutation({
  auth: 'authenticated',
  args: { title: v.string(), body: v.string() },
  plan: insert('notes', {
    authorId: authUserId(),
    title: arg('title'),
    body: arg('body'),
  }, { bindIdAs: 'id' }),
  returns: returnBinding('id'),
});

export const listNotes = defineQuery({
  auth: 'authenticated',
  table: 'notes',
  args: {},
  filter: [eq('authorId', authUserId())],
  order: [asc('_createdAt')],
});
