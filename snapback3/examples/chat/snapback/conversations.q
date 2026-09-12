query list(c: cursor ?):
  return memberships[viewer] after c first 50 by byPrincipal {
    conversation: conversations[.conversationId],
    membershipId: .id,
  }

query members(conversationId: conversations):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  return memberships[conversationId] first 50 by byConversation {
    principal, displayName, role,
  }

query unread(conversationId: conversations):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  total = messageTotals[conversationId]
  cursor = readCursors[conversationId, viewer] by byConversationPrincipal
  if cursor != null:
    return { unread: max(0, total - cursor.seen), total, seen: cursor.seen }
  else:
    return { unread: total, total, seen: 0 }

-- The marker advances only through a message the caller actually displayed.
mutation markRead(conversationId: conversations, through: messages):
  require exists memberships[conversationId, viewer] by byConversationPrincipal else NOT_A_MEMBER
  message = messages[through] ! else MESSAGE_NOT_FOUND
  require message.conversationId = conversationId else WRONG_CONVERSATION
  previous = readCursors[conversationId, viewer] by byConversationPrincipal
  if previous != null:
    if previous.seen >= message.ordinal:
      return null
  upsert readCursors[conversationId, viewer] { seen: message.ordinal }
  return null
