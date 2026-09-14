use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'Profile activity is public application metadata'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..40
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  target: posts ?
  body: text <=200
  at: time
  unique byKey: key
  by byAuthorKind: authorId, kind, at, id
  by byKindTime: kind, at, id
  by byTargetKind: target, kind, id
  public 'Posts and engagement are public'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPostTime: postId, at, id
  public 'Likes are public engagement facts'
  insert <- .principal = viewer

maintain postLikes: count likes by postId
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  public 'The follow graph is public'
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
  cap 100 by chatKey
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- exists members[chatKey = .chatKey, principal = viewer, role = 'admin'] or created chats[key = .chatKey]
  delete <- .principal = viewer

table messages:
  key: text 1..40
  chatKey: text 1..40
  authorId: principal
  body: text <=500
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .authorId = viewer and exists members[.chatKey, viewer]

table acknowledgements:
  messageId: messages
  chatKey: text 1..40
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageId, principal
  read <- exists members[.chatKey, viewer]
  insert <- .principal = viewer and exists members[.chatKey, viewer]
  update <- .principal = viewer and exists members[.chatKey, viewer]

table digestDeliveries:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer
  insert <- deny

mutation profile(active: bool):
  upsert profiles[viewer] { active }
  return null

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), targetKey: text 1..40 ?, at: time):
  targetId = null
  if kind != 'original':
    require targetKey != null else TARGET_REQUIRED
    targetPost = posts[key = targetKey] ! else NOT_FOUND
    require targetPost.kind = 'original' else ORIGINAL_REQUIRED
    targetId = targetPost.id
  else:
    require targetKey = null else NO_TARGET
  insert posts { key, authorId: viewer, kind, target: targetId, body: 'Post ' + key, at }
  return null

mutation like(postKey: text 1..40, at: time):
  p = posts[key = postKey] ! else NOT_FOUND
  require p.authorId != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  insert likes { postId: p.id, principal: viewer, at }
  return null

mutation follow(principal: principal):
  require exists profiles[principal] else NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  insert follows { follower: viewer, followed: principal }
  return null

mutation createChat(chatKey: text 1..40):
  insert chats { key: chatKey, admin: viewer }
  insert members { chatKey, principal: viewer, role: 'admin' }
  return null

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists members[chatKey = chatKey, principal = viewer, role = 'admin'] else NOT_ADMIN
  require exists profiles[principal] else NOT_FOUND
  insert members { chatKey, principal, role: 'member' }
  return null

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=500, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, authorId: viewer, body, at }
  return null

mutation leave(chatKey: text 1..40):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]
  return null

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  m = messages[key = messageKey] ! else NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.authorId != viewer else NOT_RECIPIENT
  previous = acknowledgements[m.id, viewer]
  if previous != null and previous.state = 'read':
    return null
  upsert acknowledgements[m.id, viewer] { chatKey: m.chatKey, state }
  return null

query insights(at: time):
  originals = posts[viewer, 'original'] first 200 by byAuthorKind
  likesReceived = 0
  repliesReceived = 0
  repostsReceived = 0
  for p in originals:
    likesReceived = likesReceived + postLikes[p.id]
    repliesReceived = repliesReceived + count(posts[p.id, 'reply'] first 200 by byTargetKind)
    repostsReceived = repostsReceived + count(posts[p.id, 'repost'] first 200 by byTargetKind)
  dayStart = at - (at % 86400000)
  days = []
  for offset in range(0, 7):
    day = dayStart - (6 - offset) * 86400000
    postCount = 0
    likeCount = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        postCount = postCount + 1
      likeCount = likeCount + count(likes[p.id, at >= day, at < day + 86400000] first 200 by byPostTime)
    days = days + [{ day, posts: postCount, likesReceived: likeCount }]
  return { posts: count(originals), likesReceived, repostsReceived, repliesReceived, followers: count(follows[viewer] first 200 by byFollowed), following: count(follows[viewer] first 200 by byPair), days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 200 by byKindTime { key, likes: postLikes[.id], at }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text 1..40):
  m = messages[key = messageKey] ! else NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  pendingDelivery = 0
  pendingRead = 0
  for member in members[m.chatKey] first 100 by byChatPrincipal:
    if member.principal != m.authorId:
      a = acknowledgements[m.id, member.principal]
      if a = null:
        pendingDelivery = pendingDelivery + 1
        pendingRead = pendingRead + 1
      else if a.state != 'read':
        pendingRead = pendingRead + 1
  return { state: 'sent' if pendingDelivery > 0 else ('delivered' if pendingRead > 0 else 'read') }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 100 by byPrincipalChat:
    matches = messages[member.chatKey] matching q last 100 by byChatWords { key, body, at }
    groups = groups + [{ chatKey: member.chatKey, messages: matches }]
  return groups

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    if p.active and not exists digestDeliveries[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 200 by byChatTime:
          if m.authorId != p.principal:
            a = acknowledgements[m.id, p.principal]
            if a = null or a.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestDeliveries { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEveryTwoMinutes every 2m: digest
