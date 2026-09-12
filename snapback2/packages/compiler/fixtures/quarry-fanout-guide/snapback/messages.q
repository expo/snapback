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
  for contribution in periodUnread[messageId, viewer] first 50 by byMessageSender:
    insert digestRecipientPeriodChanges { target: contribution.recipient, period: contribution.period }
    delete periodUnread[contribution]
  delete messages[messageId]
  return null

mutation send(conversationId: conversations, body: text <=2000, expiresAt: time ?, messageId: id ?):
  (_period, rem) = divmod(now, 60000)
  period = now - rem
  row = insert messages { id: messageId ?? new, conversationId, authorId: viewer, body, period, expiresAt, at: now }
  for member in memberships[conversationId] first 50 by byConversationPrincipalRole:
    if member.principal != viewer:
      target = digestPeriodTargets[member.principal, period] by byTargetPeriod
      if target = null:
        insert digestPeriodTargets { target: member.principal, period }
      insert periodUnread {
        messageId: row.id,
        sender: viewer,
        recipient: member.principal,
        conversationId,
        membershipId: member.id,
        period,
        sentAt: row.at,
        expiresAt,
      }
      insert digestRecipientPeriodChanges { target: member.principal, period }
  return { id: row.id }

mutation leave(conversationId: conversations):
  seat = memberships[conversationId, viewer] ! else MEMBERSHIP_REQUIRED
  delete memberships[seat]
  insert digestRecipientChanges { target: viewer }
  return null

mutation markRead(conversationId: conversations):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  mark = readMarks[conversationId, viewer] by byConversationActor
  if mark = null:
    insert readMarks { conversationId, actor: viewer, readAt: now }
  else:
    update readMarks[mark] { readAt: now }
  insert digestRecipientChanges { target: viewer }
  return null

mutation expireDigestMessage(messageId: messages):
  message = messages[messageId] ! else NOT_FOUND
  deadline = message.expiresAt ! else MESSAGE_NOT_EXPIRING
  require deadline <= now else MESSAGE_NOT_EXPIRED
  delete messages[message]
  return null

schedule expireDigestMessage on messages at .expiresAt: expireDigestMessage(.id)
