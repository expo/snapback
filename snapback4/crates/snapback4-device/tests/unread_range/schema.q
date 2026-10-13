table conversations:
  title: text <=100
  read <- allow
  sync public
table members:
  conversationId: conversations
  principal: principal
  readUpTo: int default 0
  joinedAt: int default 0
  immutable conversationId, principal
  unique conversationId, principal
  cap 100 by conversationId
  read <- .principal = viewer
  update <- .principal = viewer
  sync to .principal
table messages:
  conversationId: conversations
  ordinal: int
  at: int
  senderId: principal
  tombstone: bool default false
  until: time ?
  expire at .until
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  sync to members[.conversationId] last 3 by .ordinal
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone
query badge(member: members):
  return unread[member]
query badgeRows():
  return unread where .principal = viewer first 100
mutation mark(member: members, readUpTo: int):
  update members[member] { readUpTo }
  return unread[member]
mutation depend(member: members):
  return unread[member]
mutation send(conversationId: conversations):
  return insert messages { conversationId, ordinal: 10, at: 10, senderId: viewer }

mutation countThenRefuse(member: members):
  n = unread[member]
  require n != null else NO_UNREAD
  require n < 0 else NO_UNREAD
  return n
