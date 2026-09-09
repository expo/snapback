effect notify from delivery
fn isMember from access
fn conversationMembers from access
proc deliver from access
fn conversationLog from access
fn conversationPreview from access

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { *, message: messages[.messageId] }

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId, 'message'] after c last 50 by byRecipientConversationKindAt
  return page { *, message: messages[.messageId] }

query conversationView(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  page = conversationLog(conversationId, viewer, c)
  latest = conversationPreview(conversationId, viewer)
  return {
    messages: page { *, message: messages[.messageId] },
    count: messageCounts[conversationId],
    preview: latest { *, message: messages[.messageId] },
  }

query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page

mutation send(conversationId: conversations, body: text <=4000, expiresAt: time ?):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, expiresAt, at: now }
  deliver(conversationId, row.id, 'message')
  for member in conversationMembers(conversationId):
    if member.principal != viewer:
      emit notify { to: member.principal, body }
  return { id: row.id }

mutation sendPhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, photo, at: now }
  deliver(conversationId, row.id, 'message')
  return { id: row.id, photo: row.photo }

mutation sendClip(conversationId: conversations, clip: video <=50000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, clip, at: now }
  deliver(conversationId, row.id, 'message')
  return { id: row.id, clip: row.clip, duration: clip.duration }

mutation sendOncePhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, oncePhoto: photo, at: now }
  deliver(conversationId, row.id, 'message')
  return { id: row.id, photo: row.oncePhoto }

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  deliver(msg.conversationId, messageId, 'removed')
  delete messages[msg]
  return null

mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = update messages[messageId] { body } if .body = baseBody
  require msg != null else NOT_FOUND
  deliver(msg.conversationId, messageId, 'edit')
  return null

mutation purgeMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  deliver(msg.conversationId, messageId, 'expired')
  delete messages[msg]
  return null

schedule expireMessage on messages at .expiresAt: purgeMessage(.id)
