use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'public social profiles; active is an explicit preference'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..40
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  targetKey: text <=40 ?
  body: text <=200
  at: time
  unique byKey: key
  by byAuthor: authorId, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: targetKey, kind, id
  public 'social posts are public'
  insert <- .authorId = viewer

table likes:
  postKey: text 1..40
  principal: principal
  at: time
  unique byPostPrincipal: postKey, principal
  public 'reactions on public posts are public'
  insert <- .principal = viewer

maintain likeCounts: count likes by postKey
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  public 'social follow graph is public'
  insert <- .follower = viewer

table chats:
  key: text 1..40
  admin: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .admin = viewer

table members:
  chatKey: text 1..40
  principal: principal
  unique byChatPrincipal: chatKey, principal
  by byPrincipalChat: principal, chatKey
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- created chats[key = .chatKey] or exists chats[key = .chatKey, admin = viewer]
  delete <- .principal = viewer

table messages:
  key: text 1..40
  chatKey: text 1..40
  authorId: principal
  body: text <=200
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .authorId = viewer and exists members[.chatKey, viewer]

table acknowledgments:
  messageKey: text 1..40
  chatKey: text 1..40
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

mutation profile(active: bool):
  upsert profiles[viewer] { principal: viewer, active }

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), targetKey: text <=40 ?, at: time):
  if kind = 'original':
    require targetKey = null else INVALID_TARGET
  else:
    require targetKey != null else TARGET_REQUIRED
    require exists posts[key = targetKey, kind = 'original'] else TARGET_REQUIRED
  insert posts { key, authorId: viewer, kind, targetKey, body: 'Post ' + key, at }

mutation like(postKey: text 1..40, at: time):
  p = posts[postKey] ! else POST_REQUIRED
  require p.authorId != viewer else SELF_LIKE
  require not exists likes[postKey, viewer] else DUPLICATE_LIKE
  insert likes { postKey, principal: viewer, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_REQUIRED
  require principal != viewer else SELF_FOLLOW
  insert follows { follower: viewer, followed: principal }

mutation createChat(chatKey: text 1..40):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer }
  return null

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists chats[key = chatKey, admin = viewer] else ADMIN_REQUIRED
  require exists profiles[principal] else PROFILE_REQUIRED
  insert members { chatKey, principal }

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=200, at: time):
  require exists members[chatKey, viewer] else MEMBERSHIP_REQUIRED
  insert messages { key, chatKey, authorId: viewer, body, at }

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_REQUIRED
  require exists members[m.chatKey, viewer] else MEMBERSHIP_REQUIRED
  require m.authorId != viewer else RECIPIENT_REQUIRED
  old = acknowledgments[messageKey, viewer]
  if old != null and old.state = 'read':
    return null
  upsert acknowledgments[messageKey, viewer] { messageKey, chatKey: m.chatKey, principal: viewer, state }

mutation leave(chatKey: text 1..40):
  require exists members[chatKey, viewer] else MEMBERSHIP_REQUIRED
  delete members[chatKey, viewer]
  return null

query receipt(messageKey: text 1..40):
  m = messages[messageKey] ! else MESSAGE_REQUIRED
  require exists members[m.chatKey, viewer] else MEMBERSHIP_REQUIRED
  delivered = true
  read = true
  for member in members[m.chatKey] first 200 by byChatPrincipal:
    if member.principal != m.authorId:
      a = acknowledgments[messageKey, member.principal]
      if a = null:
        delivered = false
        read = false
      else if a.state != 'read':
        read = false
  return { state: 'read' if read else 'delivered' if delivered else 'sent' }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 200 by byPrincipalChat:
    found = messages[member.chatKey] matching q last 200 by byChatWords { key, body, at }
    groups = groups + [{ chatKey: member.chatKey, messages: found }]
  return groups

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 200 by byKindTime { key, likes: likeCounts[.key], at }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query insights(at: time):
  originals = posts[viewer, 'original'] first 200 by byAuthor
  received = 0
  replies = 0
  reposts = 0
  for p in originals:
    received = received + likeCounts[p.key]
    replies = replies + count(posts[p.key, 'reply'] first 200 by byTarget)
    reposts = reposts + count(posts[p.key, 'repost'] first 200 by byTarget)
  days = []
  today = at - (at % 86400000)
  for i in range(0, 7):
    day = today - (6 - i) * 86400000
    np = 0
    nl = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        np = np + 1
      for l in likes[p.key] first 200 by byPostPrincipal:
        if l.at >= day and l.at < day + 86400000:
          nl = nl + 1
    days = days + [{ day, posts: np, likesReceived: nl }]
  return { posts: count(originals), likesReceived: received, repostsReceived: reposts, repliesReceived: replies, followers: count(follows[viewer] first 200 by byFollowed), following: count(follows[viewer] first 200 by byPair), days }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 20 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 200 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 200 by byChatTime:
          if m.authorId != p.principal:
            a = acknowledgments[m.key, p.principal]
            if a = null or a.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }
schedule digestEveryTwoMinutes every 2m: digest
