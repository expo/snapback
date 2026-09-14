use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'Profiles are public social identities'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..80
  author: principal
  kind: enum('original', 'reply', 'repost')
  target: posts ?
  body: text <=500
  at: time
  unique byKey: key
  by byAuthor: author, kind, at, id
  by byKindTime: kind, at, id
  by byTarget: target, kind, id
  public 'Public social posts and their engagement are visible to all signed-in users'
  insert <- .author = viewer

table likes:
  post: posts
  principal: principal
  at: time
  unique byPostPerson: post, principal
  public 'Likes are public engagement facts on public posts'
  insert <- .principal = viewer

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollowed: followed, follower
  public 'Follow relationships are public social facts'
  insert <- .follower = viewer

table chats:
  key: text 1..80
  owner: principal
  unique byKey: key
  read <- exists members[.id, viewer]
  insert <- .owner = viewer
  after insert <- exists members[.id, .owner, 'admin']

table members:
  chat: chats
  principal: principal
  role: enum('admin', 'member')
  unique byChatPerson: chat, principal
  by byChatPersonRole: chat, principal, role
  by byPerson: principal, chat, id
  cap 50 by chat
  public 'Membership roster is visible; messages and receipt facts remain membership protected'
  insert <- exists members[.chat, viewer, 'admin'] or created chats[.chat]
  delete <- .principal = viewer

table messages:
  key: text 1..80
  chat: chats
  author: principal
  body: text <=500
  at: time
  unique byKey: key
  by byChatTime: chat, at, id
  by byWords: chat, words(body), at, id
  read <- exists members[.chat, viewer]
  insert <- .author = viewer and exists members[.chat, viewer]

table acknowledgements:
  message: messages
  chat: chats
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePerson: message, principal
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer and exists members[.chat, viewer]

table digestPeriods:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer
  insert <- deny

mutation profile(active: bool):
  return upsert profiles[viewer] { principal: viewer, active }

mutation post(key: text 1..80, kind: enum('original', 'reply', 'repost'), targetKey: text 1..80 ?, at: time):
  target = null
  if kind != 'original':
    require targetKey != null else TARGET_REQUIRED
    p = posts[targetKey] ! else POST_NOT_FOUND
    require p.kind = 'original' else ORIGINAL_REQUIRED
    target = p.id
  else:
    require targetKey = null else UNEXPECTED_TARGET
  return insert posts { key, author: viewer, kind, target, body: 'Post ' + key, at }

mutation like(postKey: text 1..80, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.author != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  return insert likes { post: p.id, principal: viewer, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  return insert follows { follower: viewer, followed: principal }

mutation createChat(key: text 1..80):
  c = insert chats { key, owner: viewer }
  insert members { chat: c.id, principal: viewer, role: 'admin' }
  return c

mutation addMember(chatKey: text 1..80, principal: principal):
  c = chats[chatKey] ! else CHAT_NOT_FOUND
  require exists members[c.id, viewer, 'admin'] else NOT_ADMIN
  return insert members { chat: c.id, principal, role: 'member' }

mutation send(chatKey: text 1..80, key: text 1..80, body: text <=500, at: time):
  c = chats[chatKey] ! else NOT_MEMBER
  require exists members[c.id, viewer] else NOT_MEMBER
  return insert messages { key, chat: c.id, author: viewer, body, at }

mutation leave(chatKey: text 1..80):
  c = chats[chatKey] ! else NOT_MEMBER
  delete members[c.id, viewer]
  return null

mutation ack(messageKey: text 1..80, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else NOT_MEMBER
  require exists members[m.chat, viewer] else NOT_MEMBER
  require m.author != viewer else NOT_RECIPIENT
  old = acknowledgements[m.id, viewer]
  if old != null:
    if old.state = 'read':
      return null
  upsert acknowledgements[m.id, viewer] { message: m.id, chat: m.chat, principal: viewer, state }
  return null

query insights(at: time):
  own = posts[viewer, 'original'] first 1000 by byAuthor
  likesReceived = 0
  repostsReceived = 0
  repliesReceived = 0
  for p in own:
    likesReceived = likesReceived + count(likes[p.id] first 1000 by byPostPerson)
    repostsReceived = repostsReceived + count(posts[p.id, 'repost'] first 1000 by byTarget)
    repliesReceived = repliesReceived + count(posts[p.id, 'reply'] first 1000 by byTarget)
  days = []
  today = at - at % 86400000
  for offset in range(0, 7):
    day = today - (6 - offset) * 86400000
    postCount = 0
    likeCount = 0
    for p in own:
      if p.at >= day and p.at < day + 86400000:
        postCount = postCount + 1
      for l in likes[p.id] first 1000 by byPostPerson:
        if l.at >= day and l.at < day + 86400000:
          likeCount = likeCount + 1
    days = days + [{ day, posts: postCount, likesReceived: likeCount }]
  return { posts: count(own), likesReceived, repostsReceived, repliesReceived, followers: count(follows[viewer] first 1000 by byFollowed), following: count(follows[viewer] first 1000 by byPair), days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 1000 by byKindTime { key, at, likes: count(likes[.id] first 1000 by byPostPerson) }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text 1..80):
  m = messages[messageKey] ! else NOT_MEMBER
  require exists members[m.chat, viewer] else NOT_MEMBER
  delivered = true
  read = true
  for recipient in members[m.chat] first 50 by byChatPerson:
    if recipient.principal != m.author:
      a = acknowledgements[m.id, recipient.principal]
      if a = null:
        delivered = false
        read = false
      else:
        if a.state != 'read':
          read = false
  return { state: 'read' if read else 'delivered' if delivered else 'sent' }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 1000 by byPerson:
    c = chats[member.chat] ! else NOT_MEMBER
    matches = messages[c.id] matching q last 1000 by byWords { key, body, at }
    groups = groups + [{ chatKey: c.key, messages: matches }]
  return sort(groups, 'chatKey')

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for membership in members[p.principal] first 1000 by byPerson:
        unread = 0
        for m in messages[membership.chat] first 1000 by byChatTime:
          if m.author != p.principal:
            a = acknowledgements[m.id, p.principal]
            if a = null:
              unread = unread + 1
            else:
              if a.state != 'read':
                unread = unread + 1
        unreadMessages = unreadMessages + unread
        if unread > 0:
          unreadChats = unreadChats + 1
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages, unreadChats }

schedule digestEveryTwoMinutes every 2m: digest
