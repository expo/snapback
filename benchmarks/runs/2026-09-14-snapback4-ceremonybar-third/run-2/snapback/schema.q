use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  read <- allow
  insert <- .principal = viewer

table posts:
  key: text 1..40
  author: principal
  kind: enum('original', 'reply', 'repost')
  target: posts ?
  body: text <=200
  at: time
  unique byKey: key
  by byAuthor: author, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: target, kind, id
  read <- allow
  insert <- .author = viewer

table likes:
  postId: posts
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPostTime: postId, at, id
  read <- allow
  insert <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  read <- allow
  insert <- .follower = viewer

table chats:
  key: text 1..40
  creator: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .creator = viewer
  after insert <- exists members[.key, .creator]

table members:
  chatKey: text 1..40
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byPrincipal: principal, chatKey, id
  by byRole: chatKey, principal, role
  cap 50 by chatKey
  read <- .principal = viewer or exists members[.chatKey, viewer]
  insert <- created chats[key = .chatKey] or exists members[.chatKey, viewer, 'admin']
  delete <- .principal = viewer

table messages:
  key: text 1..40
  chatKey: text 1..40
  author: principal
  body: text <=500
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  read <- exists members[.chatKey, viewer]
  insert <- .author = viewer and exists members[.chatKey, viewer]

table acknowledgements:
  messageId: messages
  chatKey: text 1..40
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageId, principal
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
  return insert profiles { principal: viewer, active }

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), targetKey: text 1..40 ?, at: time):
  target = null
  if targetKey != null:
    p = posts[key = targetKey] ! else POST_NOT_FOUND
    require p.kind = 'original' else ORIGINAL_REQUIRED
    target = p.id
  require (kind = 'original' and target = null) or (kind != 'original' and target != null) else INVALID_TARGET
  return insert posts { key, author: viewer, kind, target, body: 'Post ' + key, at }

mutation like(postKey: text 1..40, at: time):
  p = posts[key = postKey] ! else POST_NOT_FOUND
  require p.author != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  return insert likes { postId: p.id, principal: viewer, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  return insert follows { follower: viewer, followed: principal }

mutation createChat(chatKey: text 1..40):
  row = insert chats { key: chatKey, creator: viewer }
  insert members { chatKey, principal: viewer, role: 'admin' }
  return row

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists members[chatKey, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[principal] else PROFILE_NOT_FOUND
  return insert members { chatKey, principal, role: 'member' }

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=500, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  return insert messages { chatKey, key, body, at, author: viewer }

mutation leave(chatKey: text 1..40):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]
  return null

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  m = messages[key = messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.author != viewer else AUTHOR_NOT_RECIPIENT
  old = acknowledgements[m.id, viewer]
  if old != null and old.state = 'read':
    return null
  upsert acknowledgements[m.id, viewer] { chatKey: m.chatKey, state }
  return null

query receipt(messageKey: text 1..40):
  m = messages[key = messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  delivered = true
  read = true
  for member in members[m.chatKey] first 50 by byChatPrincipal:
    if member.principal != m.author:
      r = acknowledgements[m.id, member.principal]
      if r = null:
        delivered = false
        read = false
      else if r.state != 'read':
        read = false
  return { state: 'read' if read else ('delivered' if delivered else 'sent') }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 100 by byPrincipal:
    hits = messages[member.chatKey] matching q last 100 by byChatWords { key, body, at }
    groups = groups + [{ chatKey: member.chatKey, messages: hits }]
  return sort(groups, 'chatKey')

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 100 by byKindTime { key, at, likes: likeCounts[.id] }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query insights(at: time):
  originals = posts[viewer, 'original'] first 100 by byAuthor
  likesReceived = 0
  repostsReceived = 0
  repliesReceived = 0
  for p in originals:
    likesReceived = likesReceived + likeCounts[p.id]
    repostsReceived = repostsReceived + count(posts[p.id, 'repost'] first 100 by byTarget)
    repliesReceived = repliesReceived + count(posts[p.id, 'reply'] first 100 by byTarget)
  days = []
  today = at - (at % 86400000)
  for offset in range(0, 7):
    day = today - (6 - offset) * 86400000
    nposts = 0
    nlikes = 0
    for p in originals:
      if p.at >= day and p.at < day + 86400000:
        nposts = nposts + 1
      nlikes = nlikes + count(likes[p.id, at >= day, at < day + 86400000] first 100 by byPostTime)
    days = days + [{ day, posts: nposts, likesReceived: nlikes }]
  return { posts: count(originals), likesReceived, repostsReceived, repliesReceived, followers: count(follows[viewer] first 100 by byFollowed), following: count(follows[viewer] first 100 by byPair), days }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipal:
        unread = 0
        for m in messages[member.chatKey] first 100 by byChatTime:
          if m.author != p.principal:
            r = acknowledgements[m.id, p.principal]
            if r = null or r.state != 'read':
              unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEveryTwoMinutes every 2m: digest
