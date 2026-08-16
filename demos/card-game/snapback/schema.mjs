// Finite hidden-card slice for the session-auth program.
//
// Hands are syncable because `myHand` is a userId-only retainable live query.
// Its rows may cross an offline boundary only beside item 8's exact authorized
// lease; ordinary session possession never makes hidden rows retainable.
//
// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client — hidden
//   hand retention is authorized by a bounded server lease, not reconnect or
//   ambient session state.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  hands: defineTable({
    gameId: v.string(),
    ownerId: v.string(),
    position: v.integer(),
    card: v.string(),
  })
    .index('by_owner_game', ['ownerId', 'gameId'])
    // @ref LLP 0231#d1--the-table-is-the-policy-locus-queries-refine — hidden
    //   hands declare their owner boundary at the table locus.
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync(),
  readySignals: defineTable({
    gameId: v.string(),
    userId: v.string(),
    ready: v.boolean(),
  })
    .visibility({ kind: 'owner', field: 'userId' })
    .index('by_game', ['gameId']),
}, { auth: { mode: 'sessions' } });
