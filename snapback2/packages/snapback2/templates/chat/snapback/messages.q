effect notify from notifications

query thread(conversationId: conversations):
  require exists memberships[conversationId, viewer] by byConversationIdPrincipal else MEMBERSHIP_REQUIRED
  return messages[conversationId] last 50 by byConvTime

query summary(conversationId: conversations):
  require exists memberships[conversationId, viewer] by byConversationIdPrincipal else MEMBERSHIP_REQUIRED
  return {
    conversation: conversations[conversationId],
    messageCount: messageCounts[conversationId] by byConversationId,
  }

mutation send(conversationId: conversations, recipientId: profiles, body: text <=4000):
  require exists memberships[conversationId, viewer] by byConversationIdPrincipal else NOT_MEMBER
  recipient = profiles[recipientId] ! else RECIPIENT_UNKNOWN
  require exists memberships[conversationId, recipient.principal] by byConversationIdPrincipal else RECIPIENT_NOT_MEMBER
  row = +messages { conversationId, authorId: viewer, body, at: now }
  emit notify { to: recipient.principal, body }
  return { id: row.id }
