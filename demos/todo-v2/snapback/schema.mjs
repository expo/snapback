// Todo v2 demo schema — the source of truth for the `todos` table.
//
// @ref LLP 0015#todo-demo-requirements — the floor app: source-authored schema,
//   user-scoped data, server-owned system fields, one indexed/syncable table.

import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    priority: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  })
    .visibility({ kind: 'owner', field: 'userId' })
    // by_user backs the user-scoped live query's index-first lookup.
    .index('by_user', ['userId'])
    // by_user_priority backs the deep-link slice (LLP 0090 D4 rollout
    // step 7): listTodosByPriority filters on (userId, priority).
    .index('by_user_priority', ['userId', 'priority'])
    // Declared syncable so it can back the restricted syncable-live subset.
    .sync(),
}, {
  // Presence for the Exact provider-conformance gate (ENG-22479; Exact LLP
  // 0284 §2.5): who is looking at a list right now. Connection-keyed,
  // allow-all (the LLP 0011 permission story is exercised by the todo v1
  // boardCursors fixture), using the local paved-path TTL ceiling.
  ephemeral: defineEphemeral({
    todoPresence: ephemeral.collection({
      scope: { listId: v.string() },
      routing: ['listId'],
      key: 'connection',
      ttlMs: 20_000,
      maxTtlMs: 30_000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        name: v.string(),
        editing: v.optional(v.boolean()),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
      targets: ['local-dev-sqlite-ibex', 'remote-service-sqlite-ibex'],
    }),
  }),
});
