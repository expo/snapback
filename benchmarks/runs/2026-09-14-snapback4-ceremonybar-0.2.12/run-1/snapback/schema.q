use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..40
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  target: text <=40 ?
  body: text <=200
  at: time
  unique byKey: key
  by byAuthorKind: authorId, kind, at, id
  by byKindTime: kind, at, id
  by byTargetKind: target, kind, id
  public 'Social posts and their engagement are public.'
  insert <- .authorId = viewer

table likes:
  postKey: text 1..40
  principal: principal
  at: time
  unique byPostPrincipal: postKey, principal
  by byPostTime: postKey, at, id
  public 'Likes are public engagement on public posts.'
  insert <- .principal = viewer

maintain likeCounts: count likes by postKey
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  public 'The social follow graph is public.'
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
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byPrincipalChat: principal, chatKey, id
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- exists members[chatKey = .chatKey, principal = viewer, role = 'admin'] or created chats[key = .chatKey]
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

table acknowledgements:
  messageKey: text 1..40
  chatKey: text 1..40
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageKey, principal
  read <- exists members[.chatKey, viewer]
  insert <- .principal = viewer and exists members[.chatKey, viewer]
  update (old, next) <- old.principal = viewer and next.principal = viewer and old.messageKey = next.messageKey and old.chatKey = next.chatKey and exists members[old.chatKey, viewer]

table digestEmissions:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer

mutation profile(active: bool):
  upsert profiles[viewer] { active }

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), target: text <=40 ?, at: time):
  if kind = 'original':
    require target = null else INVALID_TARGET
  else:
    require target != null else TARGET_REQUIRED
    p = posts[target] ! else NOT_FOUND
    require p.kind = 'original' else ORIGINAL_REQUIRED
  insert posts { key, authorId: viewer, kind, target, at, body: 'Post ' + key }

mutation like(postKey: text 1..40, at: time):
  p = posts[postKey] ! else NOT_FOUND
  require p.authorId != viewer else SELF_LIKE
  require not exists likes[postKey, viewer] else DUPLICATE_LIKE
  insert likes { postKey, principal: viewer, at }

mutation follow(principal: principal):
  require principal != viewer else SELF_FOLLOW
  insert follows { follower: viewer, followed: principal }

mutation createChat(chatKey: text 1..40):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer, role: 'admin' }

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists members[chatKey = chatKey, principal = viewer, role = 'admin'] else NOT_ADMIN
  insert members { chatKey, principal, role: 'member' }

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=200, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, authorId: viewer, body, at }

mutation leave(chatKey: text 1..40):
  delete members[chatKey, viewer]
  return null

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.authorId != viewer else NOT_RECIPIENT
  old = acknowledgements[messageKey, viewer]
  if old != null and old.state = 'read':
    return null
  upsert acknowledgements[messageKey, viewer] { chatKey: m.chatKey, state }

query insights(at: time):
  originals = posts[viewer, 'original'] first 1000 by byAuthorKind
  postTotal = count(originals)
  likeTotal = 0
  replyTotal = 0
  repostTotal = 0
  for p in originals:
    likeTotal = likeTotal + likeCounts[p.key]
    replyTotal = replyTotal + count(posts[p.key, 'reply'] first 1000 by byTargetKind)
    repostTotal = repostTotal + count(posts[p.key, 'repost'] first 1000 by byTargetKind)
  dayStart = at - (at % 86400000)
  days = []
  for i in range(0, 7):
    day = dayStart - (6 - i) * 86400000
    dayPosts = 0
    dayLikes = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        dayPosts = dayPosts + 1
      dayLikes = dayLikes + count(likes[p.key, at >= day, at < day + 86400000] first 1000 by byPostTime)
    days = days + [{ day, posts: dayPosts, likesReceived: dayLikes }]
  return { posts: postTotal, likesReceived: likeTotal, repostsReceived: repostTotal, repliesReceived: replyTotal, followers: count(follows[viewer] first 1000 by byFollowed), following: count(follows[viewer] first 1000 by byPair), days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 1000 by byKindTime { key, likes: likeCounts[.key], at }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text 1..40):
  m = messages[messageKey] ! else NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  delivered = true
  read = true
  for member in members[m.chatKey] first 1000 by byChatPrincipal:
    if member.principal != m.authorId:
      a = acknowledgements[messageKey, member.principal]
      if a = null:
        delivered = false
        read = false
      else if a.state != 'read':
        read = false
  return { state: 'read' if read else ('delivered' if delivered else 'sent') }

query search(q: text <=100):
  return members[viewer] first 1000 by byPrincipalChat { chatKey, messages: messages[.chatKey] matching q last 1000 by byChatWords { key, body, at } }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 20 by byId:
    if p.active and not exists digestEmissions[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 1000 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 1000 by byChatTime:
          if m.authorId != p.principal:
            a = acknowledgements[m.key, p.principal]
            if a = null or a.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestEmissions { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }
schedule digestEveryTwoMinutes every 2m: digest
