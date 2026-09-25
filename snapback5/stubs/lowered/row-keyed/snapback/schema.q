-- Exact proposed LLP 3000.015 §3 addition, with ordinary input fields.
table conversations:
  title: text
  public
table members:
  conversationId: conversations
  principal: principal
  readUpTo: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  read <- .principal = viewer
table messages:
  conversationId: conversations
  ordinal: int
  senderId: principal
  tombstone: bool default false
  read <- exists members[.conversationId, viewer]
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone
