import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const conversations = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  title: v.string(),
  model: v.string(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  // The maintained projection's bounded fan-out lookup (LLP 0080 §5): a
  // model rename discovers affected conversations through this index,
  // never a table scan.
  .index('by_model', ['model'])
  .sync();

export const messages = defineTable({
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
  // Read-only mirror of the HOST-derived effect certainty (LLP 0076
  // decision 2, protocol amendment v0.5): the host-owned StreamAttemptV1
  // record is the authority; this column only reflects it.
  effectMayHaveExecuted: v.optional(v.boolean()),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('by_owner_conversation', ['ownerId', 'conversationId'])
  .index('by_owner_attempt', ['ownerId', 'attemptId'], { unique: true })
  .index('by_owner_idempotency', ['ownerId', 'idempotencyKey'], { unique: true })
  .sync();

// A small public dimension table: the joined source of the maintained
// projection below (LLP 0080 §5).
// @ref LLP 0081#2-canonical-plan-and-approval — `provider` is the fixture's
// admitted v0→v1 schema change: an additive optional field whose intent is
// derivable from the schema diff, executed only through the reviewed
// migrate preview→approve→apply path (protocol amendment v0.8).
export const models = defineTable({
  slug: v.string(),
  displayName: v.string(),
  provider: v.optional(v.string()),
})
  .visibility({ kind: 'public-read' })
  .index('models_by_slug', ['slug'], { unique: true })
  .sync();

// The maintained projection's output: written only by projection
// maintenance inside each source mutation's commit — any function writing
// it directly is refused at generation and activation.
export const conversationCards = defineTable({
  ownerId: v.principal(),
  title: v.string(),
  modelName: v.optional(v.string()),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .index('cards_by_owner', ['ownerId'])
  .sync();

export default defineSchema(
  { conversations, messages, models, conversationCards },
  { auth: { mode: 'dev' } },
);
