table conversations:
  title: text <=40
  public 'sequence test conversations'
  insert <- allow
  sync public

table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  body: text <=40
  unique conversationId, body
  immutable ordinal
  public 'sequence test messages'
  insert <- allow
  update <- allow
  delete <- allow
  sync public

table members:
  conversationId: conversations
  principal: principal
  joinedAt: sequence by conversationId
  unique conversationId, principal
  public 'sequence test members'
  insert <- allow
  sync public

mutation send(conversationId: conversations, body: text <=40):
  row = insert messages { conversationId, body }
  return row
mutation join(conversationId: conversations, who: principal):
  row = insert members { conversationId, principal: who } if absent
  return row
mutation fail(conversationId: conversations):
  insert messages { conversationId, body: 'rolled back' }
  require false else ABORTED
mutation pair(conversationId: conversations):
  insert members { conversationId, principal: 'paired' }
  row = insert messages { conversationId, body: 'paired' }
  return row
mutation move(messageId: messages, conversationId: conversations):
  update messages[messageId] {}
mutation remove(messageId: messages):
  delete messages[messageId]
mutation put(conversationId: conversations, body: text <=40):
  return upsert messages[conversationId = conversationId, body = body] {}
query history(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId after c last 2 by .ordinal
query oldest(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId after c first 2 by .ordinal
query one(messageId: messages):
  return messages[messageId]
