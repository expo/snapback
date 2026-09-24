effect push
table profiles:
  principal: principal
  unique byPrincipal: principal
  public 'test profiles'
  online only
table conversations:
  title: text <=80
  public 'test conversations'
  online only
table members:
  conversationId: conversations
  principal: principal
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId, id
  public 'test memberships'
  online only
table messages:
  conversationId: conversations
  senderId: principal
  body: text <=2000
  recipients: [principal] <=50
  ordinal: int
  tombstone: bool default false
  at: time
  expiresAt: time ?
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  video: video <=50000000 ?
  edited: bool default false
  replyTo: messages ?
  by byConversationTime: conversationId, at, id
  by byExpires: expiresAt
  expire at .expiresAt
  public 'test messages'
  online only
job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadChats = 0
    unreadMessages = 0
    for m in members[p.principal] by byPrincipal:
      n = count(messages[m.conversationId, at >= periodStart, at < periodEnd] by byConversationTime where .senderId != p.principal and .ordinal > m.readOrdinal and not .tombstone)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    if unreadMessages > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unreadMessages, unreadChats } once [p.principal, periodEnd]
schedule dailyDigest every 2m: daily
query total(c: conversations):
  return count(messages[c] by byConversationTime where not .tombstone)
query amount(c: conversations):
  return sum(messages[c] by byConversationTime, .ordinal)
query any(c: conversations):
  return exists messages[c] by byConversationTime where not .tombstone
