-- Witness-only caller-invoked expiry. The template has no scheduler or TTL column.
mutation expire(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'expired', at: now }
  delete messages[msg]
  return null
