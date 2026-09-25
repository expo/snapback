-- The target Clique membership, default-now and expiry shapes, on chat's rooms.
table clockMessages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  at: time default now
  expiresAt: time ?
  read <- exists memberships[.conversationId, viewer]
  insert <- .senderId = viewer and exists memberships[.conversationId, viewer]
  retain delivered-history
  expire at .expiresAt
  sync to memberships[.conversationId]
mutation sendClock(conversationId: conversations, body: text <=2000):
  return insert clockMessages { conversationId, senderId: viewer, body, expiresAt: null }
query latestClock(conversationId: conversations):
  return clockMessages where .conversationId = conversationId last 20 by .at
query heldClock(conversationId: conversations) held:
  return clockMessages where .conversationId = conversationId last 20 by .at
table clockTyping:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  expire at .expiresAt
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  sync to memberships[.conversationId]
mutation typeClock(conversationId: conversations, lifetime: int):
  upsert clockTyping[conversationId = conversationId, principal = viewer] { expiresAt: now + lifetime }
query heldTyping(conversationId: conversations) held:
  return clockTyping where .conversationId = conversationId first 50 by .id
query clockTime():
  return { at: now, connections: connected[viewer] }
