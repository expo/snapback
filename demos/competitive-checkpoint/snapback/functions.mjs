// @ref LLP 0074#priority-3-concise-authoring-without-lost-facts — the frozen
// checkpoint uses generated owner CRUD/unique/keyset patterns while keeping
// visibility explicit and executable.
// @ref LLP 0076#surface — the explicit reply action is the non-CRUD streaming
// seam; every durable patch still crosses an ordinary mutation.

import {
  arg,
  authUserId,
  defineAction,
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  defineMaintainedProjection,
  defineMutation,
  defineRelationalQuery,
  eq,
  field,
  argsRoot,
  insert,
  v,
} from '@expo/snapback-codegen/define';
import {
  defineOwnedCrud,
  defineOwnedKeysetPages,
  defineOwnedUniqueLookup,
} from '@expo/snapback-codegen/standard-patterns';
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
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
  auth: 'authenticated',
});

export const applyReplyProgress = defineJsMutation({
  args: { attemptId: v.string(), sequence: v.integer(), delta: v.string() },
  source: 'handlers.mjs',
  exportName: 'applyReplyProgress',
  reads: ['messages'],
  writes: ['messages'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
  auth: 'authenticated',
});

export const completeReply = defineJsMutation({
  args: { attemptId: v.string(), sequence: v.integer(), tail: v.string() },
  source: 'handlers.mjs',
  exportName: 'completeReply',
  reads: ['messages'],
  writes: ['messages'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
  auth: 'authenticated',
});

export const settleReply = defineJsMutation({
  args: { attemptId: v.string(), status: v.string() },
  source: 'handlers.mjs',
  exportName: 'settleReply',
  reads: ['messages'],
  writes: ['messages'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
  auth: 'authenticated',
});

export const cancelReply = defineJsMutation({
  args: { attemptId: v.string() },
  source: 'handlers.mjs',
  exportName: 'cancelReply',
  reads: ['messages'],
  writes: ['messages'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['messages'],
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

// --------------------------------------------------------------------------
// Maintained projection (LLP 0080 §5): conversation cards join each owner's
// conversations to the public model dimension inside every source
// mutation's own commit. The output table is read through an ordinary
// owner-filtered live query and can never be written directly.
// --------------------------------------------------------------------------

export const conversationCardsProjection = defineMaintainedProjection({
  id: 'conversation-cards',
  root: schema.tables.conversations,
  joined: schema.tables.models,
  output: schema.tables.conversationCards,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still projects a
  // card with a null modelName; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: { kind: 'owner', field: 'ownerId' },
  },
  projection: {
    ownerId: { root: 'ownerId' },
    title: { root: 'title' },
    modelName: { joined: 'displayName' },
  },
  rootReverseIndex: 'by_model',
  fanOutLimit: 64,
  sharedFanOutDisclosure: true,
});

export const registerModel = defineMutation({
  args: {
    slug: v.string(),
    displayName: v.string(),
    provider: v.optional(v.string()),
  },
  auth: 'authenticated',
  plan: insert('models', {
    slug: arg('slug'),
    displayName: arg('displayName'),
    // Null-safe optional-arg access: an unset provider inserts null (the
    // committed optional-field read-back shape), never SNAPBACK_ARG_MISSING.
    provider: field(argsRoot(), 'provider'),
  }),
});

// --------------------------------------------------------------------------
// Callable relational query (LLP 0080 §1-§4): the on-demand analogue of the
// maintained projection above — each owner conversation joined to the public
// model dimension, index-served, pageable through the opaque versioned
// cursor. Together with conversationCardsProjection this is the fixture's
// production-shape demonstration of both LLP 0080 §7 generated helpers.
// --------------------------------------------------------------------------

export const conversationsWithModel = defineRelationalQuery({
  root: schema.tables.conversations,
  joined: schema.tables.models,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still returns, with
  // null model leaves; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: {
    slug: { root: 'slug' },
    title: { root: 'title' },
    model: { root: 'model' },
    modelName: { joined: 'displayName' },
    modelProvider: { joined: 'provider' },
  },
  take: 8,
  rootIndex: 'by_owner_created',
  joinedIndex: 'models_by_slug',
});

export const listConversationCards = defineLiveQuery({
  table: 'conversationCards',
  index: 'cards_by_owner',
  auth: 'authenticated',
  authScopeField: 'ownerId',
  // The output visibility predicate, composed executably — a read without
  // it is refused at generation and activation.
  filter: [eq('ownerId', authUserId())],
});
