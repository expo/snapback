fn isMember from access
fn conversationMembers from access
fn conversationLog from access
fn conversationPreview from access

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { *, message: messages[.messageId] }

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId] after c last 50 by byRecipientConversationAt
  return page { *, message: messages[.messageId] }

query conversationView(conversationId: conversations):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = conversationLog(conversationId, viewer)
  latest = conversationPreview(conversationId, viewer)
  return {
    messages: page { *, message: messages[.messageId] },
    count: #messageCounts[conversationId],
    preview: latest { *, message: messages[.messageId] },
  }

mutation post(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
  for m in conversationMembers(conversationId):
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  return { id: row.id }

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  for m in conversationMembers(msg.conversationId):
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'removed', at: now }
  delete messages[msg]
  return null

mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  for m in conversationMembers(msg.conversationId):
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'edit', at: now }
  return null

mutation purgeMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  for m in conversationMembers(msg.conversationId):
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'expired', at: now }
  delete messages[msg]
  return null

schedule expireMessage on messages at .expiresAt:
  purgeMessage(.id)
