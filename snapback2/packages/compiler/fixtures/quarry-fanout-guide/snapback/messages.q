-- @ref LLP 1023.001#c--choose-a-complete-form-in-this-order — group discovery
-- and message continuation have different cursors; empty groups do not end discovery.
query searchGroups(term: text <=128, membershipCursor: cursor ?):
  page = memberships[viewer] after membershipCursor first 10 by byPrincipalConversation
  return page {
    membershipId: .id,
    conversation: conversations[.conversationId],
    matches: messages[.conversationId, term] last 1 by bySearch,
  }

query searchChat(conversationId: conversations, term: text <=128, messageCursor: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId, term] after messageCursor last 20 by bySearch

query richThread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = messages[conversationId] after c last 5 by byConvTime
  return page {
    message: .,
    author: profiles[.authorId],
    quote: messages[.quoteId],
    reactions: reactions[.id] first 50 by byMessage,
    receipts: deliveriesReceipts[.id] first 50 by byRow { recipient, received },
  }

mutation edit(messageId: messages, body: text <=2000):
  update messages[messageId] { body }
  return null

mutation remove(messageId: messages):
  pending = periodUnread[messageId] first 50 by byMessageRecipient
  for contribution in pending:
    insert digestRecipientChanges { target: contribution.recipient, value: 1 }
    delete periodUnread[contribution]
  delete messages[messageId]
  return null

mutation send(conversationId: conversations, body: text <=2000, period: time ?, expiresAt: time ?, messageId: id ?):
  row = insert messages { id: messageId ?? new, conversationId, authorId: viewer, body, period, expiresAt, at: now }
  if period != null:
    for member in memberships[conversationId] first 50 by byConversationPrincipalRole:
      if member.principal != viewer:
        insert periodUnread {
          messageId: row.id,
          recipient: member.principal,
          conversationId,
          membershipId: member.id,
          period,
          expiresAt,
        }
        insert digestRecipientChanges { target: member.principal, value: 1 }
  return { id: row.id }

mutation leave(conversationId: conversations):
  seat = memberships[conversationId, viewer] ! else MEMBERSHIP_REQUIRED
  delete memberships[seat]
  insert digestRecipientChanges { target: viewer, value: 1 }
  return null

mutation expireDigestMessage(messageId: messages):
  pending = periodUnread[messageId] first 50 by byMessageRecipient
  for contribution in pending:
    insert digestRecipientChanges { target: contribution.recipient, value: 1 }
    delete periodUnread[contribution]
  delete messages[messageId]
  return null

schedule expireDigestMessage on messages at .expiresAt: expireDigestMessage(.id)
