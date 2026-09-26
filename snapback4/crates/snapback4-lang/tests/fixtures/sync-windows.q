table conversations:
  public 'conversation labels'
  online only

table members:
  conversationId: conversations
  principal: principal
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists members[.conversationId, viewer]
  sync

table messages:
  conversationId: conversations
  at: time
  ordinal: int
  immutable conversationId
  read <- exists members[.conversationId, viewer]
  sync last 10000 by .at, .ordinal

query thread(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 2 by .at, .ordinal after c
