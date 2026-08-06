import {
  arg,
  asc,
  bind,
  defineLiveQuery,
  defineMutation,
  defineSurface,
  eq,
  input,
  insert,
  param,
  patch,
  record,
  results,
  returnBinding,
  returnExpr,
  v,
} from '../../_kit/define.mjs';
import { typing } from './surface-model.mjs';

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

export const conversationMessages = defineLiveQuery({
  table: 'messages',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  order: [asc('_createdAt')],
  index: 'by_conversation',
});

export const conversationDetails = defineLiveQuery({
  table: 'conversations',
  args: { conversationId: v.id('conversations') },
  filter: [eq('_id', arg('conversationId'))],
});

export const reactToMessage = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    emoji: v.string(),
  },
  plan: patch('messages', arg('messageId'), { reaction: arg('emoji') }),
  result: results.value(v.object({
    messageId: v.id('messages'),
    emoji: v.string(),
  })),
  returns: returnExpr(record({
    messageId: arg('messageId'),
    emoji: arg('emoji'),
  })),
});

// @ref LLP 0179#closed-grammar — conversationId is declared once and every
// child records its inspectable substitution. The generated react callable
// therefore accepts only messageId and emoji.
export const conversation = defineSurface({
  params: { conversationId: v.id('conversations') },
  reads: {
    messages: bind(conversationMessages, { conversationId: param('conversationId') }),
    details: bind(conversationDetails, { conversationId: param('conversationId') }),
  },
  mutations: {
    react: bind(reactToMessage, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      emoji: input('emoji'),
    }),
  },
  presence: {
    typing: bind(typing, {
      scope: { conversationId: param('conversationId') },
    }),
  },
});
