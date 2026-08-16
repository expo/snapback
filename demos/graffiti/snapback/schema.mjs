// Collaborative graffiti wall — the source of truth for the demo backend.
//
// The wall has two lanes that must stay separate:
//   - DURABLE: `cells` is the persisted pixel art. Every paint appends a mark;
//     the wall is rendered last-writer-wins per (x, y). One indexed, syncable
//     table backs the live query, exactly like the todo demos' single table.
//   - EPHEMERAL: `boardCursors` is live presence — where each connected painter
//     is working right now. It is a TTL-bounded latest-state map, never written
//     into SQLite.
//
// @ref LLP 0015#todo-demo-requirements — source-authored schema, server-owned
//   system fields, one indexed/syncable table backing the live query.
// @ref LLP 0013#proposal — presence is a typed, scoped, TTL-bounded ephemeral
//   collection, not pointer motion smuggled into a durable table.
// @ref LLP 0015#demo-ladder — the graffiti wall is the collaborative whiteboard
//   reference app cursors-web deliberately did not replace: the first demo to
//   carry the durable and ephemeral lanes in one product surface.

import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '../../_kit/define.mjs';

export default defineSchema(
  {
    cells: defineTable({
      boardId: v.string(),
      x: v.integer(),
      y: v.integer(),
      color: v.string(),
      authorId: v.string(),
    })
      .visibility({ kind: 'public-read' })
      // by_board backs the wall's index-first live query (everyone shares a board).
      .index('by_board', ['boardId'])
      // Declared syncable so it can back the restricted syncable-live subset.
      .sync(),
  },
  {
    ephemeral: defineEphemeral({
      // One cursor per connection, scoped to a board, expiring 5s after the last
      // move so idle painters fade out. Coalesced to the latest position so a
      // flurry of moves never floods the durable lane.
      boardCursors: ephemeral.collection({
        scope: { boardId: v.string() },
        routing: ['boardId'],
        key: 'connection',
        ttlMs: 5_000,
        maxTtlMs: 30_000,
        maxValueBytes: 1_024,
        publishRate: { sustainedHz: 20, burst: 12 },
        delivery: { mode: 'latest', dispatchMs: 33 },
        value: v.object({
          x: v.number(),
          y: v.number(),
          color: v.string(),
          name: v.optional(v.string()),
        }),
        // Painters must hold the board's room permission to see or move cursors.
        publish: allow.roomPermission('boardMember'),
        subscribe: allow.roomPermission('boardMember'),
      }),
    }),
  },
);
