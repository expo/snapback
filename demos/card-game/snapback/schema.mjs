// Finite hidden-card slice for the session-auth program.
//
// Hands are ordinary authenticated reads, deliberately not live queries: item
// 7 proves server-derived principal isolation and the client-store axes, while
// revocation-safe live delivery and authorized retained reads belong to items
// 6 and 8 respectively.
//
// @ref LLP 0016#authorized-sync-is-required-by-the-card-game-slice-but-not-yet-sequenced — this
//   finite query proof must not be inflated into an auth-scoped live claim.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  hands: defineTable({
    gameId: v.string(),
    ownerId: v.string(),
    position: v.integer(),
    card: v.string(),
  }).index('by_owner_game', ['ownerId', 'gameId']),
  readySignals: defineTable({
    gameId: v.string(),
    userId: v.string(),
    ready: v.boolean(),
  }).index('by_game', ['gameId']),
}, { auth: { mode: 'sessions' } });
