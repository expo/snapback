use personas alice, bob, carol
effect push

table profiles:
  principal: principal
  unique byPrincipal: principal
  public 'profiles are public'
  insert <- .principal = viewer

table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  conversationId: conversations
  principal: principal
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  cap 1000 by principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=4000
  tombstone: bool default false
  at: time
  expiresAt: time ?
  unique byConversationOrdinal: conversationId, ordinal
  by byTime: at, id
  by byConversationTime: conversationId, at, id
  by byExpiresAt: expiresAt
  immutable conversationId, senderId, ordinal, at
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  sync last 500 by byConversationOrdinal

fn unreadByOrdinal(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, ordinal > readOrdinal] first 100 by byConversationOrdinal where not .tombstone and .senderId != reader and .at >= periodStart and .at < periodEnd)

fn unreadByTime(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 100 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)

job digestByOrdinal(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    unread = 0
    chats = 0
    for m in members[p.principal] first 1000 by byPrincipalConversation:
      n = unreadByOrdinal(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }

job digestByTime(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    unread = 0
    chats = 0
    for m in members[p.principal] first 1000 by byPrincipalConversation:
      n = unreadByTime(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }
