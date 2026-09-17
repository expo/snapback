use personas alice, bob

table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  delete <- .principal = viewer
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=4000
  edited: bool default false
  unique byConversationOrdinal: conversationId, ordinal
  immutable conversationId, senderId, ordinal
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  sync last 5 by byConversationOrdinal

mutation edit(messageId: messages, body: text <=4000):
  m = messages[messageId] ! else NOT_FOUND
  update messages[m.id] { body, edited: true }

query thread(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 3 by byConversationOrdinal { id, edited }
