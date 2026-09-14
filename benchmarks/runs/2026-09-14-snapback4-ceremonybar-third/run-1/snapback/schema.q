use personas alice, bob, carol, dave, erin, frank, grace, heidi

effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  read <- allow
  insert <- .principal = viewer

table posts:
  key: text <=40
  author: principal
  kind: enum('original', 'reply', 'repost')
  target: text <=40 ?
  body: text <=200
  at: time
  unique byKey: key
  by byAuthor: author, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: target, kind, id
  read <- allow
  insert <- .author = viewer

table likes:
  postKey: text <=40
  principal: principal
  at: time
  unique byPostPrincipal: postKey, principal
  by byPostTime: postKey, at, id
  read <- allow
  insert <- .principal = viewer

maintain likeCounts: count likes by postKey
  read <- allow

table follows:
  source: principal
  target: principal
  unique byPair: source, target
  by byTarget: target, source
  read <- allow
  insert <- .source = viewer

table chats:
  key: text <=40
  admin: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .admin = viewer

table members:
  chatKey: text <=40
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byPrincipalChat: principal, chatKey
  by byRole: chatKey, principal, role
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- exists members[.chatKey, viewer, 'admin'] or created chats[key = .chatKey]
  delete <- .principal = viewer

table messages:
  chatKey: text <=40
  key: text <=40
  author: principal
  body: text <=200
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .author = viewer and exists members[.chatKey, viewer]

table receipts:
  messageKey: text <=40
  chatKey: text <=40
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
  insert profiles { principal: viewer, active }

mutation post(key: text <=40, kind: enum('original', 'reply', 'repost'), target: text <=40 ?, body: text <=200, at: time):
  if kind != 'original':
    require target != null else TARGET_REQUIRED
    require exists posts[key = target, kind = 'original'] else TARGET_NOT_FOUND
  else:
    require target = null else UNEXPECTED_TARGET
  insert posts { key, kind, target, body, at, author: viewer }

mutation like(postKey: text <=40, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.author != viewer else SELF_LIKE
  require not exists likes[postKey, viewer] else DUPLICATE_LIKE
  insert likes { postKey, principal: viewer, at }

mutation follow(target: principal):
  require target != viewer else SELF_FOLLOW
  require exists profiles[target] else PROFILE_NOT_FOUND
  insert follows { source: viewer, target }

mutation createChat(chatKey: text <=40):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer, role: 'admin' }

mutation addMember(chatKey: text <=40, principal: principal):
  require exists members[chatKey, viewer, 'admin'] else ADMIN_REQUIRED
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatKey, principal, role: 'member' }

mutation send(chatKey: text <=40, key: text <=40, body: text <=200, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { chatKey, key, body, at, author: viewer }

mutation leave(chatKey: text <=40):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]

mutation ack(messageKey: text <=40, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.author != viewer else NOT_RECIPIENT
  old = receipts[messageKey, viewer]
  if old != null:
    if old.state = 'read':
      return null
  upsert receipts[messageKey, viewer] { chatKey: m.chatKey, state }

query insights(at: time):
  originals = posts[viewer, 'original'] first 100 by byAuthor
  received = 0
  reposts = 0
  replies = 0
  for p in originals:
    received = received + likeCounts[p.key]
    reposts = reposts + count(posts[p.key, 'repost'] first 100 by byTarget)
    replies = replies + count(posts[p.key, 'reply'] first 100 by byTarget)
  days = []
  today = at - at % 86400000
  for offset in range(0, 7):
    day = today - (6 - offset) * 86400000
    n = 0
    l = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        n = n + 1
      l = l + count(likes[p.key, at >= day, at < day + 86400000] first 100 by byPostTime)
    days = days + [{ day, posts: n, likesReceived: l }]
  return { posts: count(originals), likesReceived: received, repostsReceived: reposts, repliesReceived: replies, followers: count(follows[viewer] first 100 by byTarget), following: count(follows[viewer] first 100 by byPair), days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 100 by byKindTime { key, likes: likeCounts[.key], at }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text <=40):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  allDelivered = true
  allRead = true
  for member in members[m.chatKey] first 100 by byChatPrincipal:
    if member.principal != m.author:
      r = receipts[messageKey, member.principal]
      if r = null:
        allDelivered = false
        allRead = false
      else:
        if r.state != 'read':
          allRead = false
  return { state: 'read' if allRead else ('delivered' if allDelivered else 'sent') }

query search(q: text <=100):
  result = []
  for member in members[viewer] first 100 by byPrincipalChat:
    found = messages[member.chatKey] matching q last 100 by byChatWords { key, body, at }
    result = result + [{ chatKey: member.chatKey, messages: found }]
  return result

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 20 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 100 by byChatTime:
          if m.author != p.principal:
            r = receipts[m.key, p.principal]
            if r = null:
              unread = unread + 1
            else:
              if r.state != 'read':
                unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEvery every 2m: digest
