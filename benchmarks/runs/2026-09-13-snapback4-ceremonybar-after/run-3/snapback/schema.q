use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'public profile directory'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..80
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  targetId: posts ?
  targetAuthor: principal ?
  targetOriginal: bool
  body: text <=500
  at: time
  unique byKey: key
  by byAuthorKindTime: authorId, kind, at, id
  by byKindTime: kind, at, id
  public 'public social posts'
  insert <- .authorId = viewer

maintain authored: count posts by authorId, kind
  read <- .authorId = viewer
maintain targeted: count posts by targetAuthor, targetOriginal, kind
  read <- .targetAuthor = viewer

table likes:
  postId: posts
  principal: principal
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  at: time
  unique byPostPrincipal: postId, principal
  by byAuthorKindTime: authorId, kind, at, id
  public 'public reactions on public posts'
  insert <- .principal = viewer

maintain postLikes: count likes by postId
  read <- allow
maintain receivedLikes: count likes by authorId, kind
  read <- .authorId = viewer

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  public 'public social follow graph'
  insert <- .followerId = viewer
maintain followers: count follows by followedId
  read <- .followedId = viewer
maintain following: count follows by followerId
  read <- .followerId = viewer

table chats:
  key: text 1..80
  adminId: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .adminId = viewer
  after insert <- exists members[.key, .adminId, 'admin']

table members:
  chatKey: text 1..80
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byChatPrincipalRole: chatKey, principal, role
  by byPrincipalChat: principal, chatKey, id
  cap 100 by chatKey
  cap 100 by principal
  public 'membership directory; message contents remain member-only'
  insert <- exists members[.chatKey, viewer, 'admin'] or created chats[.chatKey]
  delete <- .principal = viewer

table messages:
  key: text 1..80
  chatKey: text 1..80
  authorId: principal
  body: text <=1000
  at: time
  unique byKey: key
  by byChatTime: chatKey, at, id
  by byChatWords: chatKey, words(body), at, id
  cap 500 by chatKey
  read <- exists members[.chatKey, viewer]
  insert <- .authorId = viewer and exists members[.chatKey, viewer]

table acknowledgments:
  messageId: messages
  chatKey: text 1..80
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageId, principal
  read <- exists members[.chatKey, viewer]
  insert <- .principal = viewer and exists members[.chatKey, viewer]
  update <- .principal = viewer and exists members[.chatKey, viewer]
  immutable messageId, chatKey, principal

table digestPeriods:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer
  insert <- deny

mutation profile(active: bool):
  upsert profiles[viewer] { principal: viewer, active }

mutation post(key: text 1..80, kind: enum('original', 'reply', 'repost'), targetKey: text <=80 ?, at: time):
  target = posts[targetKey]
  require kind = 'original' or target != null else TARGET_REQUIRED
  require kind != 'original' or targetKey = null else ORIGINAL_HAS_TARGET
  insert posts { key, authorId: viewer, kind, targetId: target.id if target != null else null, targetAuthor: target.authorId if target != null else null, targetOriginal: target.kind = 'original' if target != null else false, body: 'Post ' + key, at }

mutation like(postKey: text 1..80, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.authorId != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  insert likes { postId: p.id, principal: viewer, authorId: p.authorId, kind: p.kind, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  insert follows { followerId: viewer, followedId: principal }

mutation createChat(chatKey: text 1..80):
  insert chats { key: chatKey, adminId: viewer }
  insert members { chatKey, principal: viewer, role: 'admin' }

mutation addMember(chatKey: text 1..80, principal: principal):
  require exists members[chatKey, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatKey, principal, role: 'member' }

mutation send(chatKey: text 1..80, key: text 1..80, body: text <=1000, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, authorId: viewer, body, at }

mutation ack(messageKey: text 1..80, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  require m.authorId != viewer else NOT_RECIPIENT
  prior = acknowledgments[m.id, viewer]
  if prior = null:
    insert acknowledgments { messageId: m.id, chatKey: m.chatKey, principal: viewer, state }
  else if prior.state != 'read':
    update acknowledgments[prior] { state }
  return null

mutation leave(chatKey: text 1..80):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete members[chatKey, viewer]
  return null

query insights(at: time):
  today = at - at % 86400000
  days = []
  for offset in range(0, 7):
    day = today - (6 - offset) * 86400000
    ps = posts[viewer, 'original', at >= day, at < day + 86400000] first 500 by byAuthorKindTime
    ls = likes[viewer, 'original', at >= day, at < day + 86400000] first 1000 by byAuthorKindTime
    days = days + [{ day, posts: count(ps), likesReceived: count(ls) }]
  return { posts: authored[viewer, 'original'], likesReceived: receivedLikes[viewer, 'original'], repostsReceived: targeted[viewer, true, 'repost'], repliesReceived: targeted[viewer, true, 'reply'], followers: followers[viewer], following: following[viewer], days }

query trending(at: time):
  candidates = posts['original', at >= at - 86400000, at <= at] first 500 by byKindTime { key, likes: postLikes[.id], at }
  return slice(sort(candidates, '-likes', '-at', 'key'), 0, 10)

query receipt(messageKey: text 1..80):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatKey, viewer] else NOT_MEMBER
  delivered = true
  read = true
  for member in members[m.chatKey] first 100 by byChatPrincipal:
    if member.principal != m.authorId:
      a = acknowledgments[m.id, member.principal]
      if a = null:
        delivered = false
        read = false
      else if a.state != 'read':
        read = false
  return { state: 'read' if read else 'delivered' if delivered else 'sent' }

query search(q: text <=100):
  groups = []
  for member in members[viewer] first 100 by byPrincipalChat:
    found = messages[member.chatKey] matching q last 500 by byChatWords { key, body, at }
    groups = groups + [{ chatKey: member.chatKey, messages: found }]
  return sort(groups, 'chatKey')

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unreadMessages = 0
      unreadChats = 0
      for member in members[p.principal] first 100 by byPrincipalChat:
        unread = 0
        for m in messages[member.chatKey] first 500 by byChatTime:
          if m.authorId != p.principal:
            a = acknowledgments[m.id, p.principal]
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
