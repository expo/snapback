import {
  arg,
  asc,
  defineLiveQuery,
  defineMutation,
  insert,
  results,
  returnBinding,
  v,
} from '../../_kit/define.mjs';

export const listReceiptNotes = defineLiveQuery({
  table: 'receiptNotes',
  args: {},
  order: [asc('_createdAt')],
});

export const addReceiptNote = defineMutation({
  args: {
    text: v.string(),
    source: v.string(),
  },
  plan: insert('receiptNotes', {
    text: arg('text'),
    source: arg('source'),
  }, { bindIdAs: 'receiptNoteId' }),
  result: results.value(v.id('receiptNotes')),
  returns: returnBinding('receiptNoteId'),
});
