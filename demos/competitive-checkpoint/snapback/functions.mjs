// @ref LLP 0074#priority-3-concise-authoring-without-lost-facts — the frozen
// checkpoint uses generated owner CRUD/unique/keyset patterns while keeping
// visibility explicit and executable.
// @ref LLP 0076#surface — the explicit reply action is the non-CRUD streaming
// seam; every durable patch still crosses an ordinary mutation.

import {
  defineAction,
  defineJsLiveQuery,
  defineJsMutation,
  v,
} from '@snapback/codegen/define';
import {
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
} from '@snapback/codegen/standard-patterns';
import schema from './schema.mjs';

const visibility = { kind: 'owner', field: 'ownerId' };

export const {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
} = defineOwnedCrud({
  table: schema.tables.conversations,
  names: {
    list: 'listConversations',
    get: 'getConversation',
    create: 'createConversation',
    update: 'updateConversation',
    delete: 'deleteConversation',
  },
  visibility,
  createDefaults: { pageKey: 'id', createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'pageKey', 'createdAt'],
  listIndex: 'by_owner_created',
});

export const { conversationBySlug } = defineOwnedUniqueLookup({
  table: schema.tables.conversations,
  name: 'conversationBySlug',
  index: 'by_owner_slug',
  visibility,
});

export const { firstConversationPage, nextConversationPage } = defineOwnedKeysetPages({
  table: schema.tables.conversations,
  names: { first: 'firstConversationPage', next: 'nextConversationPage' },
  index: 'by_owner_page_key',
  cursorField: 'pageKey',
  visibility,
  limit: 10,
});

export const listMessages = defineJsLiveQuery({
  args: { conversationId: v.id('conversations') },
  source: 'queries.mjs',
  exportName: 'listMessages',
  reads: ['messages'],
  auth: 'authenticated',
  authScopeField: 'ownerId',
  result: v.object({
    ownerId: v.principal(),
    conversationId: v.id('conversations'),
    role: v.string(),
    content: v.string(),
    status: v.string(),
    attemptId: v.string(),
    idempotencyKey: v.string(),
    sequence: v.integer(),
    lastProgressAt: v.integer(),
    pageKey: v.string(),
  }),
});

export const startReply = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    content: v.string(),
    idempotencyKey: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'startReply',
  reads: ['conversations', 'messages'],
  writes: ['messages'],
  auth: 'authenticated',
});

export const applyReplyProgress = defineJsMutation({
  args: { attemptId: v.string(), sequence: v.integer(), delta: v.string() },
  source: 'handlers.mjs',
  exportName: 'applyReplyProgress',
  reads: ['messages'],
  writes: ['messages'],
  auth: 'authenticated',
});

export const completeReply = defineJsMutation({
  args: { attemptId: v.string(), sequence: v.integer(), tail: v.string() },
  source: 'handlers.mjs',
  exportName: 'completeReply',
  reads: ['messages'],
  writes: ['messages'],
  auth: 'authenticated',
});

export const settleReply = defineJsMutation({
  args: { attemptId: v.string(), status: v.string() },
  source: 'handlers.mjs',
  exportName: 'settleReply',
  reads: ['messages'],
  writes: ['messages'],
  auth: 'authenticated',
});

export const cancelReply = defineJsMutation({
  args: { attemptId: v.string() },
  source: 'handlers.mjs',
  exportName: 'cancelReply',
  reads: ['messages'],
  writes: ['messages'],
  auth: 'authenticated',
});

export const streamReply = defineAction({
  args: {
    attemptId: v.string(),
    streamUrl: v.string(),
    method: v.string(),
    upstreamIdempotent: v.boolean(),
  },
  js: { source: 'handlers.mjs', exportName: 'streamReply' },
  writes: ['messages'],
  auth: 'authenticated',
});
