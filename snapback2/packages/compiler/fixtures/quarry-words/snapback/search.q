mutation index(messageId: messages, body: text <=2000):
  m = messages[messageId] !
  require m.author = viewer and m.body = body else STALE_OR_NOT_AUTHOR
  for term in words(body):
    upsert searchWords[messageId, term] { conversationId: m.conversationId, at: m.at }
  return true

mutation edit(messageId: messages, body: text <=2000):
  old = messages[messageId] !
  require old.author = viewer else NOT_AUTHOR
  for term in words(old.body):
    delete searchWords[messageId, term]
  update messages[messageId] { body }
  for term in words(body):
    upsert searchWords[messageId, term] { conversationId: old.conversationId, at: old.at }
  return true

query search(conversationId: conversations, term: text <=2000):
  return searchWords[conversationId, term] last 20 by byConversationTermTime { messageId }
