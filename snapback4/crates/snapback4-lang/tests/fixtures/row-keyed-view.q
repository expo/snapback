table conversations:
  title: text <=100
  read <- allow
  insert <- allow
  sync public
table members:
  conversationId: conversations
  principal: principal
  readUpTo: int default 0
  joinedAt: int default 0
  unique conversationId, principal
  cap 100 by conversationId
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public
table messages:
  conversationId: conversations
  ordinal: int
  senderId: principal
  tombstone: bool default false
  until: time ?
  expire at .until
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone and .ordinal > m.joinedAt
query unreadFor(member: members):
  return unread[member]
query unreadRows():
  return unread first 100
mutation join(id: id, conversationId: conversations, principal: principal, readUpTo: int, joinedAt: int):
  insert members { id, conversationId, principal, readUpTo, joinedAt }
mutation send(id: id, conversationId: conversations, ordinal: int, senderId: principal, until: time ?):
  insert messages { id, conversationId, ordinal, senderId, until }
mutation mark(member: members, readUpTo: int):
  update members[member] { readUpTo }
mutation tombstone(message: messages):
  update messages[message] { tombstone: true }
mutation edit(message: messages, ordinal: int, senderId: principal):
  update messages[message] { ordinal, senderId }
mutation remove(message: messages):
  delete messages[message]
mutation leave(member: members):
  delete members[member]
