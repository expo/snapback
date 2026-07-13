// Authenticated, finite card-game operations.
//
// `myHand` is the privacy proof: ownerId comes only from the prepared server
// authority. `signalReady` supplies a harmless queued mutation with which the
// authority-descriptor replay boundary can be demonstrated.

import {
  arg,
  asc,
  authUserId,
  defineMutation,
  defineQuery,
  eq,
  insert,
  returnBinding,
  v,
} from '../../_kit/define.mjs';

export const myHand = defineQuery({
  auth: 'authenticated',
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
