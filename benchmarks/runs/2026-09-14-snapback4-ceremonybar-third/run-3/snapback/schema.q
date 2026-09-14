use personas alice, bob, carol, dave, erin, frank, grace, heidi

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  read <- allow
  insert <- .principal = viewer

table posts:
  key: text <=32
  author: principal
  kind: enum('original', 'reply', 'repost')
  target: text <=32 ?
  body: text <=100
  at: time
  unique byKey: key
  by byAuthor: author, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: target, kind, id
  read <- allow
  insert <- .author = viewer

table likes:
  postKey: text <=32
  principal: principal
  at: time
  unique byPostPrincipal: postKey, principal
  read <- allow
  insert <- .principal = viewer

table follows:
  source: principal
  target: principal
  unique byPair: source, target
  by byTarget: target, source
  read <- allow
  insert <- .source = viewer

table chats:
  key: text <=32
  admin: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .admin = viewer

table members:
  chatKey: text <=32
  principal: principal
  unique byChatPrincipal: chatKey, principal
  by byPrincipalChat: principal, chatKey
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- exists chats[key = .chatKey, admin = viewer] or created chats[.chatKey]
  delete <- .principal = viewer

table messages:
  key: text <=32
  chatKey: text <=32
  author: principal
  body: text <=200
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .author = viewer and exists members[.chatKey, viewer]

table acknowledgements:
  messageKey: text <=32
  chatKey: text <=32
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
  insert <- deny

effect digest

mutation profile(active: bool):
  insert profiles { principal: viewer, active }

mutation post(key: text <=32, kind: enum('original', 'reply', 'repost'), target: text <=32 ?, at: time):
  if kind != 'original':
    require target != null else TARGET_REQUIRED
    require exists posts[target] else POST_NOT_FOUND
  else:
    require target = null else INVALID_TARGET
  insert posts { key, author: viewer, kind, target, body: 'Post ' + key, at }

mutation like(postKey: text <=32, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.author != viewer else SELF_LIKE
  require not exists likes[postKey, viewer] else DUPLICATE_LIKE
  insert likes { postKey, principal: viewer, at }

mutation follow(target: principal):
  require exists profiles[target] else PROFILE_NOT_FOUND
  require target != viewer else SELF_FOLLOW
  insert follows { source: viewer, target }

mutation createChat(chatKey: text <=32):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer }

mutation addMember(chatKey: text <=32, principal: principal):
  require exists chats[key = chatKey, admin = viewer] else ADMIN_REQUIRED
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatKey, principal }

mutation send(chatKey: text <=32, key: text <=32, body: text <=200, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, author: viewer, body, at }

mutation ack(messageKey: text <=32, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.author != viewer else NOT_RECIPIENT
  old = acknowledgements[messageKey, viewer]
  if old != null:
    if old.state = 'read':
      return null
  upsert acknowledgements[messageKey, viewer] { messageKey, chatKey: m.chatKey, principal: viewer, state }

mutation leave(chatKey: text <=32):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]

query insights(at: time):
  authored = posts[viewer, 'original'] first 100 by byAuthor
  postCount = count(authored)
  likesReceived = 0
  repostsReceived = 0
  repliesReceived = 0
  for p in authored:
    likesReceived = likesReceived + count(likes[p.key] first 100 by byPostPrincipal)
    repostsReceived = repostsReceived + count(posts[p.key, 'repost'] first 100 by byTarget)
    repliesReceived = repliesReceived + count(posts[p.key, 'reply'] first 100 by byTarget)
  days = []
  today = at - at % 86400000
  for offset in range(0, 7):
    day = today - (6 - offset) * 86400000
    dailyPosts = 0
    dailyLikes = 0
    for p in authored:
      if p.at >= day and p.at < day + 86400000:
        dailyPosts = dailyPosts + 1
      for l in likes[p.key] first 100 by byPostPrincipal:
        if l.at >= day and l.at < day + 86400000:
          dailyLikes = dailyLikes + 1
    days = days + [{ day, posts: dailyPosts, likesReceived: dailyLikes }]
  return { posts: postCount, likesReceived, repostsReceived, repliesReceived, followers: count(follows[viewer] first 100 by byTarget), following: count(follows[viewer] first 100 by byPair), days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 100 by byKindTime
    { key, at, likes: count(likes[.key] first 100 by byPostPrincipal) }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text <=32):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  allDelivered = true
  allRead = true
  for member in members[m.chatKey] first 100 by byChatPrincipal:
    if member.principal != m.author:
      a = acknowledgements[messageKey, member.principal]
      if a = null:
        allDelivered = false
        allRead = false
      else:
        if a.state != 'read':
          allRead = false
  return { state: 'read' if allRead else 'delivered' if allDelivered else 'sent' }

query search(q: text <=100):
  return members[viewer] first 100 by byPrincipalChat
    { chatKey, messages: messages[.chatKey] matching q last 100 by byWords { key, body, at } }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 20 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 100 by byChatTime:
          if m.author != p.principal:
            a = acknowledgements[m.key, p.principal]
            if a = null or a.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEvery every 2m: digest
