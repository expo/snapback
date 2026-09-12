-- @ref LLP 1025.000#1-the-invariant — every source transition maintains recipient totals and distinct chats in the same transaction.
proc queuePeriodUnread(messageId: messages, recipient: principal, conversationId: conversations, membershipId: memberships, periodStart: time):
  prior = periodUnread[messageId, recipient]
  if prior = null:
    message = messages[messageId] ! else MESSAGE_REQUIRED
    insert periodUnread { messageId, author: message.author, recipient, conversationId, membershipId, periodStart }
    chat = periodChats[recipient, conversationId, membershipId, periodStart]
    if chat = null:
      insert periodChats { recipient, conversationId, membershipId, periodStart, total: 1 }
    else:
      update periodChats[chat] { total: chat.total + 1 }

proc clearPeriodUnread(pending: periodUnread):
  row = periodUnread[pending] ! else PERIOD_CUSTODY
  chat = periodChats[row.recipient, row.conversationId, row.membershipId, row.periodStart] ! else PERIOD_CHAT_CUSTODY
  require chat.total > 0 else PERIOD_CHAT_CUSTODY
  delete periodUnread[row]
  if chat.total = 1:
    delete periodChats[chat]
  else:
    update periodChats[chat] { total: chat.total - 1 }

proc clearMessagePeriodUnread(messageId: messages):
  pending = periodUnread[messageId] first 50 by byMessageRecipient
  for row in pending:
    clearPeriodUnread(row.id)

proc clearMembershipPeriodUnread(conversationId: conversations, recipient: principal, membershipId: memberships):
  for row in periodUnread[recipient, conversationId, membershipId] first 50 by byRecipientConversationMembership:
    clearPeriodUnread(row.id)

mutation leaveRecipeConversation(conversationId: conversations):
  membership = memberships[conversationId, viewer] ! else MEMBERSHIP_REQUIRED
  clearMembershipPeriodUnread(conversationId, viewer, membership.id)
  delete memberships[membership]
  return null

mutation removeRecipeMember(conversationId: conversations, recipient: principal):
  membership = memberships[conversationId, recipient] ! else MEMBERSHIP_REQUIRED
  clearMembershipPeriodUnread(conversationId, recipient, membership.id)
  delete memberships[membership]
  return null

mutation joinRecipeConversation(conversationId: conversations):
  require memberships[conversationId, viewer] = null else ALREADY_MEMBER
  return insert memberships { conversationId, principal: viewer }
