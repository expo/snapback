// Authenticated, finite card-game operations.
//
// `myHand` is the privacy proof: ownerId comes only from the prepared server
// authority. `signalReady` supplies a harmless queued mutation with which the
// authority-descriptor replay boundary can be demonstrated.

import {
  arg,
  asc,
  authUserId,
  defineLiveQuery,
  defineMutation,
  eq,
  insert,
  returnBinding,
  v,
} from '../../_kit/define.mjs';

// Acceptance setup deliberately goes through the same session authority as
// the read: callers can add only rows stamped with their server-derived user.
// This is demo setup, not a claim about a complete game's dealer protocol.
export const acceptHandCard = defineMutation({
  auth: 'authenticated',
  args: {
    gameId: v.string(),
    position: v.integer(),
    card: v.string(),
  },
  plan: insert('hands', {
    gameId: arg('gameId'),
    ownerId: authUserId(),
    position: arg('position'),
    card: arg('card'),
  }),
});

export const myHand = defineLiveQuery({
  auth: 'authenticated',
  retainable: true,
  table: 'hands',
  args: { gameId: v.string() },
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
  order: [asc('position')],
  index: 'by_owner_game',
});

export const signalReady = defineMutation({
  auth: 'authenticated',
  args: { gameId: v.string(), ready: v.boolean() },
  plan: insert(
    'readySignals',
    {
      gameId: arg('gameId'),
      userId: authUserId(),
      ready: arg('ready'),
    },
    { bindIdAs: 'signalId' },
  ),
  returns: returnBinding('signalId'),
});
