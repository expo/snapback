query page(conversationId: conversations, c: cursor ?):
  return messages[conversationId=conversationId] after c first 200 by byConversation

query latest(conversationId: conversations):
  return messages[conversationId=conversationId] last 1 by byConversation

query reactions(conversationId: conversations, messageId: messages):
  return reactions[conversationId=conversationId, messageId=messageId] first 100 by byScope

query receipts(conversationId: conversations):
  return reads[conversationId=conversationId] first 100 by byConversation

mutation send(id: messages, conversationId: conversations, text: text 1..1000, replyTo: messages ?):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  if replyTo != null:
    require messages[id=replyTo].conversationId = conversationId else BAD_QUOTE
  insert messages { id: id, conversationId: conversationId, senderId: viewer, text: text, serverTimestamp: now, replyTo: replyTo, edited: false, tombstone: false }
  return messages[id=id]

mutation fetched(conversationId: conversations, through: time):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  old = reads[conversationId=conversationId, userId=viewer]
  upsert reads[conversationId=conversationId, userId=viewer] { conversationId: conversationId, userId: viewer, fetchedThrough: max(old.fetchedThrough ?? through, through), viewedThrough: old.viewedThrough }
  return true

mutation viewed(conversationId: conversations, through: time):
  require exists members[conversationId=conversationId, userId=viewer] else NOT_MEMBER
  old = reads[conversationId=conversationId, userId=viewer]
  upsert reads[conversationId=conversationId, userId=viewer] { conversationId: conversationId, userId: viewer, fetchedThrough: max(old.fetchedThrough ?? through, through), viewedThrough: max(old.viewedThrough ?? through, through) }
  return true

mutation react(messageId: messages, emoji: text 1..16, active: bool):
  message = messages[id=messageId] ! else NOT_FOUND
  require exists members[conversationId=message.conversationId, userId=viewer] else NOT_MEMBER
  if active:
    upsert reactions[messageId=messageId, userId=viewer, emoji=emoji] { messageId: messageId, conversationId: message.conversationId, userId: viewer, emoji: emoji }
  else:
    delete reactions[messageId=messageId, userId=viewer, emoji=emoji]
  return true

mutation setReaction(messageId: messages, emoji: text 1..16 ?):
  message = messages[id=messageId] ! else NOT_FOUND
  require exists members[conversationId=message.conversationId, userId=viewer] else NOT_MEMBER
  if emoji != null:
    upsert reactions[messageId=messageId, userId=viewer]  { messageId: messageId, conversationId: message.conversationId, userId: viewer, emoji: emoji }
  else:
    delete reactions[messageId=messageId, userId=viewer] 
  return true
