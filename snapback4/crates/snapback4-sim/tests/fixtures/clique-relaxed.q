effect notify
effect digest

table conversations:
  title: text <=40
  read <- allow

table profiles:
  principal: principal
  displayName: text <=40
  unique byPrincipal: principal
  read <- allow

table memberships:
  conversationId: conversations
  principal: principal
  joinedSequence: int
  readSequence: int
  deliveredSequence: int
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId, id
  cap 50 by conversationId
  read <- allow

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000
  at: time default now
  by byConvTime: conversationId, at, id
  read <- allow

table activities:
  principal: principal
  day: time
  kind: enum('post', 'like')
  by byDay: principal, day, kind, id
  by byKind: principal, kind, id
  read <- allow
maintain activityDays: count activities by principal, day, kind
  read <- allow
maintain activityTotals: count activities by principal, kind
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  read <- allow
maintain followers: count follows by followed
  read <- allow
maintain following: count follows by follower
  read <- allow

table unreadEvents:
  conversationId: conversations
  principal: principal
  periodStart: time
  bucket: int
  by byPeriod: conversationId, principal, periodStart, bucket, id
  read <- allow
maintain unreadPeriods: count unreadEvents by conversationId, principal, periodStart, bucket
  read <- allow

table posts:
  at: time
  by byTime: at, id
  read <- allow

table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  read <- allow
maintain likeCounts: count likes by postId
  read <- allow

table reactions:
  conversationId: conversations
  messageId: messages
  principal: principal
  emoji: text <=10
  by byConvMessage: conversationId, messageId, id
  unique byMessagePrincipal: messageId, principal
  read <- allow

fn receiptState(cid: conversations, sender: principal, seq: int):
  unread = 0
  undelivered = 0
  for m in memberships[cid] first 50 by byConversationPrincipal:
    if m.principal = sender or m.joinedSequence >= seq:
      continue
    if m.readSequence < seq:
      unread = unread + 1
    if m.deliveredSequence < seq:
      undelivered = undelivered + 1
  return 'read' if unread = 0 else ('delivered' if undelivered = 0 else 'sent')

query receipt(cid: conversations, sender: principal, seq: int):
  return receiptState(cid, sender, seq)

query insights():
  d = now - now % 86400000
  days = []
  for i in range(0, 7):
    day = d - i * 86400000
    days = days + [{ day, posts: activityDays[viewer, day, 'post'], likesReceived: activityDays[viewer, day, 'like'] }]
  return { posts: activityTotals[viewer, 'post'], followers: followers[viewer], following: following[viewer], days }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    unread = 0
    chats = 0
    for m in memberships[p.principal] first 1000 by byPrincipal:
      n = unreadPeriods[m.conversationId, p.principal, periodStart, 0]
      if n > 0:
        unread = unread + n
        chats = chats + 1
    if unread > 0:
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages: unread, unreadChats: chats }

mutation push(cid: conversations, body: text <=4000):
  profile = profiles[viewer] ! else NOT_FOUND
  for m in memberships[cid] first 50 by byConversationPrincipal:
    if m.principal = viewer:
      continue
    emit notify { targetUserId: m.principal, preview: profile.displayName + ': ' + slice(body, 0, 80) }
  return null

query around(conversationId: conversations, messageId: messages):
  q = messages[messageId] ! else NOT_FOUND
  before = messages[conversationId, at < q.at] last 20 by byConvTime
  after = messages[conversationId, at >= q.at] first 21 by byConvTime
  return { before, after }

query trending():
  day = posts[at > now - 86400000] first 8192 by byTime { id, at, likes: likeCounts[.id] }
  return slice(sort(day, '-likes', '-at'), 0, 10)

query reactionCounts(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  rows = reactions[m.conversationId, messageId] first 50 by byConvMessage
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: exists reactions[messageId, viewer] }
