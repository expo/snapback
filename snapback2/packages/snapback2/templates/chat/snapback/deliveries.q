query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { *, message: messages[.messageId] }

-- @ref LLP 1018.003#5-the-certified-thread-projection — one event per live message: a deleted or evicted body is a null nested read the screen drops.
query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'message'] after c last 50 by byRecipientConversationKindAt
  return page { *, message: messages[.messageId] }

mutation post(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  return { id: row.id }

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  -- @ref LLP 1012#5-retention-revocation-and-the-fence — departed recipients evict the deleted body through the next held-page point absence.
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'removed', at: now }
  delete messages[msg]
  return null

mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'edit', at: now }
  return null

-- @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — expiry is the owner's timer, never a client action; the expired log rows are the tombstone every recipient drains.
mutation purgeMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'expired', at: now }
  delete messages[msg]
  return null

schedule expireMessage on messages at .expiresAt:
  purgeMessage(.id)
