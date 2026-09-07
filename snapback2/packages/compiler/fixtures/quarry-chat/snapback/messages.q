effect notify from delivery
fn isMember from access
fn conversationMembers from access

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50

query search(term: text <=128, c: cursor ?):
  page = merge messages after c last 20 by bySearch:
    [m.conversationId, term] for m in memberships[viewer] first 50 by byPrincipalConversation
  return page

query summary(conversationId: conversations):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return {
    conversation: conversations[conversationId],
    messageCount: messageCounts[conversationId],
  }

mutation send(conversationId: conversations, recipientId: profiles, body: text <=4000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  recipient = profiles[recipientId] ! else RECIPIENT_UNKNOWN
  require isMember(conversationId, recipient.principal) else RECIPIENT_NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo: null, clip: null, at: now }
  for m in conversationMembers(conversationId):
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  emit notify { to: recipient.principal, body }
  return { id: row.id }

mutation sendPhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body: null, photo, clip: null, at: now }
  return { id: row.id, photo: row.photo }

mutation sendClip(conversationId: conversations, clip: video <=50000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body: null, photo: null, clip, at: now }
  return { id: row.id, clip: row.clip, duration: clip.duration }

mutation sendOncePhoto(conversationId: conversations, photo: image <=5000000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body: null, photo: null, clip: null, oncePhoto: photo, at: now }
  for m in conversationMembers(conversationId):
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  return { id: row.id, photo: row.oncePhoto }
