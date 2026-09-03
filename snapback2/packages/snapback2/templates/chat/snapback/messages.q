effect notify from delivery

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50

query summary(conversationId: conversations):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return {
    conversation: conversations[conversationId],
    messageCount: messageCounts[conversationId],
  }

mutation send(conversationId: conversations, recipientId: profiles, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  recipient = profiles[recipientId] ! else RECIPIENT_UNKNOWN
  require exists memberships[conversationId, recipient.principal] else RECIPIENT_NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  emit notify { to: recipient.principal, body }
  return { id: row.id }
