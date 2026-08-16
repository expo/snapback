// Campfire: the Diary 0025/0034 chat contract (rooms, monotonic per-room
// message sequences, per-user emoji reactions) as an in-repo rerun arm. The
// app is deliberately public — no room membership model — matching the paired
// matrix arms so a successor rerun compares like with like.

import {
  defineSchema,
  defineTable,
  v,
} from '../../_kit/define.mjs';

export default defineSchema(
  {
    rooms: defineTable({
      name: v.string(),
    }).visibility({ kind: 'public-read' }),
    messages: defineTable({
      roomId: v.id('rooms'),
      sequence: v.integer(),
      author: v.string(),
      body: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_room_sequence', ['roomId', 'sequence'], { unique: true })
      .sync(),
    reactions: defineTable({
      roomId: v.id('rooms'),
      messageId: v.id('messages'),
      emoji: v.string(),
      userKey: v.string(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_room', ['roomId'])
      .index('by_message', ['messageId'])
      .index('by_message_emoji_user', ['messageId', 'emoji', 'userKey'], { unique: true })
      .sync(),
  },
  {
    // Sessions-mode artifacts: the registered LLP 0112 group rides the
    // LLP 0053 protocol-1 auth-invalidation lane the paired suites prove,
    // even though every Campfire function stays public (the arm has no
    // membership model, matching the Diary 0025/0034 apps).
    auth: { mode: 'sessions' },
  },
);
