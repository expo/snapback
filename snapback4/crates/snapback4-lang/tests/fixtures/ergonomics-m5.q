table conversations:
  disappearing: enum('off', '24h', '7d')
  lastOrdinal: int
  lastMessageId: messages ?
  public 'conversations'
  update <- public
table messages:
  conversationId: conversations
  authorId: principal
  body: text <=2000
  replyToId: messages ?
  recipients: [principal] <=50
  ordinal: int
  at: time
  expiresAt: time ?
  kind: enum('text', 'image', 'video') default 'text'
  photo: image <=10485760 ?
  clip: video <=52428800 ?
  oncePhoto: image <=10485760 once ?
  public 'messages'
  insert <- public
shape messageCard = { id, body }
fn disappearance(setting: text <=10):
  return 86400000 if setting = '24h' else 604800000 if setting = '7d' else null













































































































































mutation send(messageId: id, conversationId: conversations, body: text <=2000, replyToId: messages ?):
  c = conversations[conversationId] ! else NOT_MEMBER
  recipients = []

  msg = insert messages { id: messageId, conversationId, authorId: viewer, body, replyToId, recipients, ordinal: c.lastOrdinal + 1, at: now, expiresAt: now + disappearance(c.disappearing) if disappearance(c.disappearing) != null else null }
  update conversations[c] { lastOrdinal: c.lastOrdinal + 1, lastMessageId: msg.id }
  return { id: msg.id }




































mutation sendMedia(messageId: id, conversationId: conversations, body: text <=500, photo: image <=10485760 ?, clip: video <=52428800 ?, oncePhoto: image <=10485760 ?):
  c = conversations[conversationId] ! else NOT_MEMBER
  recipients = []

  msg = insert messages { id: messageId, conversationId, authorId: viewer, body, kind: 'video' if clip != null else 'image', photo, clip, oncePhoto, recipients, ordinal: c.lastOrdinal + 1, at: now, expiresAt: now + disappearance(c.disappearing) if disappearance(c.disappearing) != null else null }
  update conversations[c] { lastOrdinal: c.lastOrdinal + 1, lastMessageId: msg.id }
  return { id: msg.id }
