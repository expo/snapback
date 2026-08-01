import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A5 collaborative AI research room (contract
// a5-research-room.v1). Sessions mode. The room is seeded literally
// (versioned seed); owner/member seats are claimed through seeded invite
// rows via the documented app-data-invitation self-insert pattern.
// Membership rows cannot be seeded and are not reset targets
// (known: finding 0137-a3-f1) — cleanup retires seats by self-removal.
export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'roomMembers',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'member'],
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['owner', 'member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['owner', 'member'] },
  ],
});

const schema = defineSchema({
  rooms: defineTable({
    name: v.string(),
    topic: v.string(),
    // Transactional question sequence counter: ask allocates seq inside the
    // serialized commit, so concurrent asks cannot collide.
    questionSeq: v.integer(),
  }).sync(),

  invites: defineTable({
    roomId: v.id('rooms'),
    code: v.string(),
    role: v.string(), // 'owner' | 'member'
    consumed: v.boolean(),
    createdAt: v.integer(),
  })
    .index('by_code', ['code'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  // Research sources. The extracted text lives in the row (the retrieval
  // corpus members read and search); the raw file bytes live in the asset
  // store, referenced by a PLAIN STRING id — a v.assetRef field would make
  // this table unqueryable on 0.1.7 (known: finding 0137-a1-f1).
  sources: defineTable({
    roomId: v.id('rooms'),
    title: v.string(),
    kind: v.string(), // 'pdf' | 'md' | 'csv' | 'txt'
    content: v.string(), // extracted text (retrieval corpus)
    uploaderId: v.principal(),
    uploaderName: v.string(),
    assetId: v.string(), // canonical asset id; '' when text-only
    contentSha256: v.string(),
    byteLength: v.integer(),
    clientKey: v.string(),
    createdAt: v.integer(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_client_key', ['roomId', 'clientKey'], { unique: true })
    .sync(),

  // Embeddings FIXTURE (deterministic 32-dim vectors derived from source
  // text). Stored per the contract's seed fact; NOT claimed as vector
  // retrieval — no ordinary vector path ships on 0.1.7 (capability index
  // backend.vector-search: design-only; LLP 0132 Accepted, unimplemented).
  sourceEmbeddings: defineTable({
    sourceId: v.id('sources'),
    roomId: v.id('rooms'),
    model: v.string(), // 'fixture-32'
    dim: v.integer(),
    // number[32]. Table fields refuse v.array() (SCHEMA_INVALID_VALIDATOR
    // naming the Json primitive) while RESULT schemas accept it; v.json()
    // is the documented column type for structured values (arm observation:
    // the refusal diagnostic does not point to v.json()).
    vector: v.json(),
  })
    .index('by_source', ['sourceId'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  // Question state machine:
  // 'running' -> 'complete' | 'failed' | 'cancelled' | 'timed-out' | 'ambiguous'
  // ('failed'/'timed-out'/'ambiguous' may return to 'running' via retryQuestion;
  // 'complete' and 'cancelled' are hard-terminal.)
  questions: defineTable({
    roomId: v.id('rooms'),
    seq: v.integer(),
    dedupeKey: v.string(),
    askerId: v.principal(),
    askerName: v.string(),
    text: v.string(),
    status: v.string(),
    stage: v.string(), // pipeline stage: accepted|retrieved|ranked|drafted|answered
    attemptCount: v.integer(),
    deadlineAt: v.integer(),
    createdAt: v.integer(),
    settledAt: v.integer(), // 0 until terminal
    terminalDetail: v.string(),
  })
    .index('by_room_dedupe', ['roomId', 'dedupeKey'], { unique: true })
    .index('by_room_seq', ['roomId', 'seq'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  // Durable ordered progress: the authoritative stream the second member
  // observes live. Append is fenced in-transaction on question.status.
  progressEvents: defineTable({
    questionId: v.id('questions'),
    roomId: v.id('rooms'),
    seq: v.integer(),
    stage: v.string(),
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_question_seq', ['questionId', 'seq'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  answers: defineTable({
    questionId: v.id('questions'),
    roomId: v.id('rooms'),
    text: v.string(),
    // {sourceId,title}[] — v.json(), same v.array-field refusal as above.
    citations: v.json(),
    createdAt: v.integer(),
  })
    .index('by_question', ['questionId'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  // Append-only attempt ledger: worker starts, settlements, and FENCED late
  // attempts (the authoritative log A5-08 injects against).
  questionAttempts: defineTable({
    questionId: v.id('questions'),
    roomId: v.id('rooms'),
    seq: v.integer(),
    attemptSeq: v.integer(),
    event: v.string(), // 'started' | 'settled' | 'fenced'
    outcome: v.string(), // '' | terminal status | attempted-op for fences
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_question_seq', ['questionId', 'seq'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  // Scheduled external refresh: settings row + append-only run receipts.
  refreshSettings: defineTable({
    roomId: v.id('rooms'),
    url: v.string(), // suite-owned local content endpoint; '' = disabled
    updatedAt: v.integer(),
  })
    .index('by_room', ['roomId'], { unique: true })
    .sync(),

  refreshRuns: defineTable({
    roomId: v.id('rooms'),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    outcome: v.string(), // 'fetched' | 'unreachable' | 'skipped-disabled'
    detail: v.string(), // value-free diagnostic summary; never secret bytes
    fetchedBytes: v.integer(),
    at: v.integer(),
  })
    .index('by_dedupe', ['dedupeKey'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),

  roomMembers,
}, {
  auth: { mode: 'sessions' },
});

export default schema;
