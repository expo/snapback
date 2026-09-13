query page(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  return messages[conversationId] after c first 40 by byConversation { * }

mutation send(conversationId: conversations, body: text 1..2000, clientTag: text 1..120):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  ordinal = messageTotals[conversationId] + 1
  message = insert messages { conversationId, author: viewer, body, clientTag, ordinal, at: now }
  update conversations[conversationId] { updatedAt: now }
  return { id: message.id, ordinal, clientTag }
