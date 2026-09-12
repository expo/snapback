job populate(periodStart: time):
  chunk row in hubPlan first 2 by byId:
    if row.group:
      insert conversations { id: row.conversationId, kind: 'group', title: 'Hub group', creatorId: row.hub, disappearing: 'off' }
    else:
      insert conversations { id: row.conversationId, kind: 'dm', creatorId: row.hub, disappearing: 'off' }
      insert dmPairs { lo: row.lo, hi: row.hi, conversationId: row.conversationId }
    insert memberships { id: row.membershipId, conversationId: row.conversationId, principal: row.hub, role: 'admin', joinedAt: periodStart }
    insert memberships { id: row.peerMembershipId, conversationId: row.conversationId, principal: row.author, role: 'member', joinedAt: periodStart }
    insert messages { id: row.messageId, conversationId: row.conversationId, authorId: row.author, body: 'Hub period activity', status: 'ok', at: periodStart + 1 }
    insert deliveries { recipient: row.hub, conversationId: row.conversationId, messageId: row.messageId, kind: 'message', at: periodStart + 1 }
    insert deliveries { recipient: row.author, conversationId: row.conversationId, messageId: row.messageId, kind: 'message', at: periodStart + 1 }
    insert pendingDelivered { messageId: row.messageId, recipient: row.hub, conversationId: row.conversationId }
    insert pendingRead { messageId: row.messageId, recipient: row.hub, conversationId: row.conversationId, periodStart: periodStart }
    insert periodUnread { messageId: row.messageId, author: row.author, recipient: row.hub, conversationId: row.conversationId, membershipId: row.membershipId, periodStart: periodStart }
    insert periodChats { recipient: row.hub, conversationId: row.conversationId, membershipId: row.membershipId, periodStart: periodStart, total: 1 }
    insert unreadCounts { conversationId: row.conversationId, principal: row.hub, count: 1 }
    insert unreadFlags { conversationId: row.conversationId, principal: row.hub }
