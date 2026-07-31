// The Campfire room screen — the rerun arm's product surface. It consumes
// ONLY the first-class React bindings: the registered generated query group
// via `useSnapbackQueries(preparedGroup)` and generated mutation references
// via `useSnapbackMutation`. It never touches the headless client; the
// acceptance suite pins that structurally (LLP 0115 §Sequencing 5's
// measurement correction: the rerun must be able to score this path, not
// only headless client calls).
//
// React is imported from the repository-root install so this module, the
// package bindings, and the test renderer share one React instance (the
// signal-desk react suite precedent).
//
// @ref LLP 0114#typed-query-groups — the prepared group is the closed typed
// consumption surface; child names are the generated route-order names.
// @ref LLP 0112#registered-boot — a registered preparation adopts every
// child from one LLP 0090 commit cut; `boot` is that provenance and this
// component renders it so the acceptance can pin registered consumption in
// the committed tree.

import React from '../../../node_modules/react/index.js';
import {
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
} from '../../../packages/snapback-react/index.mjs';

const e = React.createElement;

export function CampfireRoom({ api, group, roomId, userKey, onState }) {
  const room = useSnapbackQueries(group);
  const connection = useSnapbackConnection();
  const sendMessage = useSnapbackMutation(api.sendMessage);
  const toggleReaction = useSnapbackMutation(api.toggleReaction);
  const [draft, setDraft] = React.useState('');
  if (onState) onState({ room, connection });

  const settled = (state) => state.status === 'ready' || state.status === 'refreshing';
  const messagesState = room.queries.liveMessages;
  const reactionsState = room.queries.liveReactions;
  const messages = settled(messagesState) ? messagesState.data : [];
  const reactions = settled(reactionsState) ? reactionsState.data : [];
  // The live room summary is assembled from the two live children — the
  // client-side composition shape the paired Convex arm uses, so the rerun
  // compares like with like. The callable `roomSummary` contract stays
  // server-derived for the headless parity checks.
  const summary = settled(messagesState) && settled(reactionsState)
    ? {
      messageCount: messages.length,
      reactionCount: reactions.length,
      participants: [...new Set(messages.map((message) => message.author))].sort(),
    }
    : null;

  return e(
    'campfire-room',
    { testID: 'room' },
    e('boot-provenance', { testID: 'boot-provenance' }, room.boot ? room.boot.source : 'live'),
    e('connection-state', { testID: 'connection' }, room.connection),
    e(
      'active-subscriptions',
      { testID: 'active-subscriptions' },
      String(connection.activeSubscriptions),
    ),
    summary === null
      ? e('room-loading', { testID: 'room-loading' }, 'warming up…')
      : e(
        'room-summary',
        { testID: 'room-summary' },
        e('room-label', { testID: 'room-label' }, roomId),
        e(
          'room-counts',
          { testID: 'room-counts' },
          `${summary.messageCount} messages · ${summary.reactionCount} reactions`,
        ),
        e('room-participants', { testID: 'room-participants' }, summary.participants.join(', ')),
      ),
    e(
      'message-list',
      { testID: 'message-list' },
      messages.map((message) => e(
        'campfire-message',
        { key: message._id, testID: `message-${message.sequence}` },
        `${message.author}: ${message.body}`,
        e('button', {
          testID: `toggle-reaction-${message.sequence}`,
          onPress: () => toggleReaction({
            roomId,
            messageId: message._id,
            emoji: '🔥',
            userKey,
          }),
        }),
      )),
    ),
    e('draft-input', {
      testID: 'draft-input',
      value: draft,
      onChange: (value) => setDraft(value),
    }),
    e('button', {
      testID: 'send-message',
      onPress: () => {
        const settled = sendMessage({ roomId, author: userKey, body: draft });
        setDraft('');
        return settled;
      },
    }),
  );
}
