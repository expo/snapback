use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'Profiles expose explicit activity preference'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..64
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  target: posts ?
  body: text <=500
  at: time
  unique byKey: key
  by byAuthor: authorId, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: target, kind, id
  public 'Public posts and interactions power public discovery'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPostTime: postId, at, id
  public 'Likes on public posts are public social facts'
  insert <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  public 'Follow relationships are public social facts'
  insert <- .follower = viewer

table chats:
  key: text 1..64
  admin: principal
  unique byKey: key
  by byKeyAdmin: key, admin
  read <- exists members[.key, viewer]
  insert <- .admin = viewer
  after insert <- exists members[.key, .admin]

table members:
  chatKey: text 1..64
  principal: principal
  unique byChatPrincipal: chatKey, principal
  by byPrincipal: principal, chatKey, id
  cap 100 by chatKey
  public 'Chat roster directory is public; message bodies and receipts require current membership'
  insert <- created chats[key = .chatKey] or exists chats[key = .chatKey, admin = viewer]
  delete <- .principal = viewer

table messages:
  key: text 1..64
  chatKey: text 1..64
  authorId: principal
  body: text <=1000
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .authorId = viewer and exists members[.chatKey, viewer]

table acknowledgements:
  messageKey: text 1..64
  chatKey: text 1..64
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageKey, principal
  read <- exists members[.chatKey, viewer]
  insert <- .principal = viewer and exists members[.chatKey, viewer]
  update <- .principal = viewer and exists members[.chatKey, viewer]

table digestPeriods:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer

mutation profile(active: bool):
  upsert profiles[viewer] { principal: viewer, active }

mutation post(key: text 1..64, kind: enum('original', 'reply', 'repost'), targetKey: text 1..64 ?, body: text <=500, at: time):
  target = null
  if targetKey != null:
    p = posts[targetKey] ! else POST_NOT_FOUND
    require p.kind = 'original' else ORIGINAL_REQUIRED
    target = p.id
  require (kind = 'original' and target = null) or (kind != 'original' and target != null) else BAD_TARGET
  insert posts { key, authorId: viewer, kind, target, body, at }

mutation like(postKey: text 1..64, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.authorId != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  insert likes { postId: p.id, principal: viewer, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  insert follows { follower: viewer, followed: principal }

mutation createChat(chatKey: text 1..64):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer }

mutation addMember(chatKey: text 1..64, principal: principal):
  c = chats[chatKey] ! else CHAT_NOT_FOUND
  require c.admin = viewer else NOT_ADMIN
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatKey, principal }

mutation send(chatKey: text 1..64, key: text 1..64, body: text <=1000, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { chatKey, key, body, at, authorId: viewer }

mutation leave(chatKey: text 1..64):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]

mutation ack(messageKey: text 1..64, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.authorId != viewer else NOT_RECIPIENT
  old = acknowledgements[messageKey, viewer]
  if old = null:
    insert acknowledgements { messageKey, chatKey: m.chatKey, principal: viewer, state }
  else if old.state != 'read':
    update acknowledgements[old] { state }
  return null

query receipt(messageKey: text 1..64):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  delivered = true
  read = true
  for member in members[m.chatKey] first 100 by byChatPrincipal:
    if member.principal != m.authorId:
      a = acknowledgements[m.key, member.principal]
      if a = null:
        delivered = false
        read = false
      else if a.state != 'read':
        read = false
  return { state: 'read' if read else 'delivered' if delivered else 'sent' }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 1000 by byKindTime { key, at, likes: likeCounts[.id] }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query insights(at: time):
  originals = posts[viewer, 'original'] first 1000 by byAuthor
  totalLikes = 0
  replies = 0
  reposts = 0
  for p in originals:
    totalLikes = totalLikes + likeCounts[p.id]
    replies = replies + count(posts[p.id, 'reply'] first 1000 by byTarget)
    reposts = reposts + count(posts[p.id, 'repost'] first 1000 by byTarget)
  days = []
  start = at - (at % 86400000) - 6 * 86400000
  for offset in range(0, 7):
    day = start + offset * 86400000
    dayPosts = 0
    dayLikes = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        dayPosts = dayPosts + 1
      dayLikes = dayLikes + count(likes[p.id, at >= day, at < day + 86400000] first 1000 by byPostTime)
    days = days + [{ day, posts: dayPosts, likesReceived: dayLikes }]
  return { posts: count(originals), likesReceived: totalLikes, repliesReceived: replies, repostsReceived: reposts, followers: count(follows[viewer] first 1000 by byFollowed), following: count(follows[viewer] first 1000 by byPair), days }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 100 by byPrincipal:
    hits = messages[member.chatKey] matching q last 100 by byChatWords { key, body, at }
    groups = groups + [{ chatKey: member.chatKey, messages: hits }]
  return sort(groups, 'chatKey')

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipal:
        unread = 0
        for m in messages[member.chatKey] first 1000 by byChatTime:
          if m.authorId != p.principal:
            a = acknowledgements[m.key, p.principal]
            if a = null:
              unread = unread + 1
            else if a.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEveryTwoMinutes every 2m: digest
