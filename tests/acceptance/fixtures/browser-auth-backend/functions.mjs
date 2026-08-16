import {
  arg,
  asc,
  authUserId,
  defineMutation,
  defineQuery,
  eq,
  insert,
  results,
  returnBinding,
  v,
} from '../../../../demos/_kit/define.mjs';

export const seedProtectedNote = defineMutation({
  auth: 'authenticated',
  args: { label: v.string() },
  plan: insert('notes', {
    ownerId: authUserId(),
    label: arg('label'),
  }, { bindIdAs: 'noteId' }),
  result: results.value(v.id('notes')),
  returns: returnBinding('noteId'),
});

export const listProtectedNotes = defineQuery({
  auth: 'authenticated',
  table: 'notes',
  args: { label: v.string() },
  filter: [
    eq('ownerId', authUserId()),
    eq('label', arg('label')),
  ],
  order: [asc('_createdAt')],
});
