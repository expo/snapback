// Pointing Room schema.
//
// @ref LLP 0013#authorization-and-privacy — roomPresence is scoped awareness,
//   never the durable vote or an authorization source.

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
    rooms: defineTable({
      name: v.string(),
      ownerId: v.principal(),
    }).visibility({ kind: 'public-read' }).sync(),
    rounds: defineTable({
      roomId: v.id('rooms'),
      topic: v.string(),
      sequence: v.integer(),
      revealed: v.boolean(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_room_sequence', ['roomId', 'sequence'])
      .sync(),
    votes: defineTable({
      roundId: v.id('rounds'),
      roomId: v.id('rooms'),
      userId: v.principal(),
      value: v.union([
        v.literal('1'),
        v.literal('2'),
        v.literal('3'),
        v.literal('5'),
        v.literal('8'),
        v.literal('13'),
        v.literal('?'),
      ]),
    })
      .visibility({ kind: 'public-read' })
      // Deliberately NOT .sync(): votes carry the pre-reveal secret, and only
      // the masking JS live query may publish them. Leaving the table
      // syncable-eligible would let a future defineLiveQuery({table:'votes'})
      // ship raw values with no disclosure check.
      .index('by_room_round', ['roomId', 'roundId'])
      .index('by_round_user', ['roundId', 'userId']),
  },
  {
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({
      roomPresence: ephemeral.collection({
        // Presence follows the same room key as the durable query scope, but
        // remains awareness only: it is never consulted for authorization.
        scope: { roomId: v.id('rooms') },
        routing: ['roomId'],
        key: 'connection',
        ttlMs: 15_000,
        maxTtlMs: 30_000,
        maxValueBytes: 512,
        publishRate: { sustainedHz: 4, burst: 12 },
        delivery: { mode: 'latest', dispatchMs: 100 },
        value: v.object({
          name: v.string(),
          picking: v.boolean(),
        }),
        publish: allow.all(),
        subscribe: allow.all(),
      }),
    }),
  },
);
