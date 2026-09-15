

































mutation send(messageId: id, conversationId: conversations, caption: text <=500, photo: image <=10485760 ?, video: video <=52428800 ?, viewOnce: bool ?):
  recipients = []
  c = conversations[conversationId] ! else NOT_MEMBER
  ttl = 1000 if true else null

  arrival = nextArrival(conversationId)
  msg = insert messages { arrival, id: messageId, conversationId, senderId: viewer, text: caption, photo: photo if viewOnce != true else null, oncePhoto: photo if viewOnce = true else null, video, kind: 'image' if photo != null else 'video', recipients, at: now, expiresAt: now + ttl if ttl != null else null }





  return { id: msg.id }
