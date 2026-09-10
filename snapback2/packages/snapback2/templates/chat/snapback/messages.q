effect notify from delivery
fn isMember from access
fn conversationMembers from access

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipient
  return page { *, message: messages[.row] }

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'delivered'] after c last 50 by byRecipientGroup
  return page { *, message: messages[.row] }

query history(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime

query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require isMember(msg.conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }

query conversationView(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = messages[conversationId] after c last 50 by byConvTime
  latest = messages[conversationId] last 1 by byConvTime
  return {
    messages: page { message: messages[.id] },
    count: messageCounts[conversationId],
    preview: latest { message: messages[.id] },
  }

query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page

mutation send(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
  for member in conversationMembers(conversationId):
    if member.principal != viewer:
      emit notify { to: member.principal, body }
  return { id: row.id }

mutation sendPhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, photo, at: now }
  return { id: row.id, photo: row.photo }

mutation sendClip(conversationId: conversations, clip: video <=50000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, clip, at: now }
  return { id: row.id, clip: row.clip, duration: clip.duration }

mutation sendOncePhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, oncePhoto: photo, at: now }
  return { id: row.id, photo: row.oncePhoto }

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  delete messages[msg]
  return null

mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  update messages[msg] { body, editedAt: now } if .body = baseBody
  return null

schedule expireMessage on messages at .expiresAt: delete .
