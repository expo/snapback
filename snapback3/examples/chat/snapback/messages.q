query page(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  return messages[conversationId] after c last 40 by byConversation {
    *,
    sender: memberships[.conversationId, .author] by byConversationPrincipal { displayName },
  }

query get(conversationId: conversations, messageId: messages):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  message = messages[messageId] ! else MESSAGE_NOT_FOUND
  require message.conversationId = conversationId else WRONG_CONVERSATION
  return message

mutation send(conversationId: conversations, body: text 1..2000):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  ordinal = messageTotals[conversationId] + 1
  message = insert messages { conversationId, author: viewer, body, ordinal, at: now }
  update conversations[conversationId] { updatedAt: now }
  return { id: message.id, ordinal }

mutation edit(conversationId: conversations, messageId: messages, body: text 1..2000, baseBody: text 1..2000):
  message = messages[messageId] ! else MESSAGE_NOT_FOUND
  require message.conversationId = conversationId else WRONG_CONVERSATION
  require message.author = viewer else NOT_YOUR_MESSAGE
  require exists memberships[message.conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  update messages[messageId] { body, editedAt: now } if .body = baseBody
  return { id: messageId }
