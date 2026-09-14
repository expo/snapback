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
  key: text 1..40
  author: principal
  kind: enum('original', 'reply', 'repost')
  targetKey: text <=40 ?
  targetAuthor: principal
  at: time
  day: time
  body: text <=200
  unique byKey: key
  by byAuthorKind: author, kind, at, id
  by byKind: kind, at, id
  public 'public social posts'
  insert <- .author = viewer

maintain postCounts: count posts by author, kind
  read <- .author = viewer
maintain postDays: count posts by author, kind, day
  read <- .author = viewer
maintain receivedPosts: count posts by targetAuthor, kind
  read <- .targetAuthor = viewer

table likes:
  postKey: text 1..40
  principal: principal
  author: principal
  kind: enum('original', 'reply', 'repost')
  at: time
  day: time
  unique byPostPrincipal: postKey, principal
  public 'likes on public posts are public'
  insert <- .principal = viewer

maintain postLikes: count likes by postKey
  read <- allow
maintain authorLikes: count likes by author, kind
  read <- .author = viewer
maintain likeDays: count likes by author, kind, day
  read <- .author = viewer

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  public 'public follow graph'
  insert <- .follower = viewer
maintain followers: count follows by followed
  read <- .followed = viewer
maintain following: count follows by follower
  read <- .follower = viewer

table chats:
  key: text 1..40
  creator: principal
  unique byKey: key
  read <- exists memberships[.key, viewer]
  insert <- .creator = viewer
  after insert <- exists memberships[.key, .creator, 'admin']

table memberships:
  chatKey: text 1..40
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byChatPrincipalRole: chatKey, principal, role
  by byPrincipalChat: principal, chatKey, id
  cap 16 by chatKey
  cap 16 by principal
  read <- exists memberships[.chatKey, viewer]
  insert <- exists memberships[.chatKey, viewer, 'admin'] or created chats[key = .chatKey]
  delete <- .principal = viewer

-- Per-user chat directory permits a complete private inbox scan.
table userChats:
  chatKey: text 1..40
  principal: principal
  unique byPrincipalChat: principal, chatKey
  cap 16 by principal
  read <- .principal = viewer
  insert <- exists memberships[.chatKey, viewer, 'admin']
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
  read <- exists memberships[.chatKey, viewer]
  insert <- .author = viewer and exists memberships[.chatKey, viewer]

table acknowledgments:
  messageKey: text 1..40
  chatKey: text 1..40
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageKey, principal
  by byMessagePrincipalState: messageKey, principal, state
  read <- exists memberships[.chatKey, viewer]
  insert <- .principal = viewer and exists memberships[.chatKey, viewer]
  update <- .principal = viewer and exists memberships[.chatKey, viewer]

table digestPeriods:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer
  insert <- deny

fn unreadIn(chatKey: text 1..40, user: principal): sum(messages[chatKey] first 100 by byChatTime { n: 1 if .author != user and not exists acknowledgments[.key, user, 'read'] else 0 }, .n)

query insights(at: time):
  (epochDay, remainder) = divmod(at, 86400000)
  today = at - remainder
  days = [{ day: today - 518400000 }, { day: today - 432000000 }, { day: today - 345600000 }, { day: today - 259200000 }, { day: today - 172800000 }, { day: today - 86400000 }, { day: today }]
  return { posts: postCounts[viewer, 'original'], likesReceived: authorLikes[viewer, 'original'], repostsReceived: receivedPosts[viewer, 'repost'], repliesReceived: receivedPosts[viewer, 'reply'], followers: followers[viewer], following: following[viewer], days: days { day, posts: postDays[viewer, 'original', .day], likesReceived: likeDays[viewer, 'original', .day] } }

query trending(at: time):
  candidates = posts['original'] first 100 by byKind { key, at, likes: postLikes[.key], eligible: 1 if .at >= at - 86400000 and .at <= at else 0 }
  ranked = sort(candidates, '-eligible', '-likes', '-at', 'key')
  return slice(ranked, 0, min(10, sum(candidates, .eligible))) { key, likes, at }

query receipt(messageKey: text 1..40):
  msg = messages[messageKey] ! else NOT_MEMBER
  recipients = memberships[msg.chatKey] first 16 by byChatPrincipal { n: 1 if .principal != msg.author else 0, delivered: 1 if .principal != msg.author and exists acknowledgments[messageKey, .principal] else 0, read: 1 if .principal != msg.author and exists acknowledgments[messageKey, .principal, 'read'] else 0 }
  return { state: 'read' if sum(recipients, .read) = sum(recipients, .n) else 'delivered' if sum(recipients, .delivered) = sum(recipients, .n) else 'sent' }

query search(q: text <=100):
  return userChats[viewer] first 16 by byPrincipalChat { chatKey, messages: messages[.chatKey] matching q last 100 by byChatWords { key, body, at } }

mutation profile(active: bool):
  upsert profiles[viewer] { active }

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), targetKey: text <=40 ?, at: time, body: text <=200):
  require (kind = 'original' and targetKey = null) or (kind != 'original' and targetKey != null) else BAD_TARGET
  (epochDay, remainder) = divmod(at, 86400000)
  if targetKey != null:
    target = posts[targetKey] ! else NO_POST
    require target.kind = 'original' else NOT_ORIGINAL
    insert posts { key, author: viewer, kind, targetKey, targetAuthor: target.author, at, day: at - remainder, body }
  else:
    insert posts { key, author: viewer, kind, targetKey, targetAuthor: viewer, at, day: at - remainder, body }

mutation like(postKey: text 1..40, at: time):
  post = posts[postKey] ! else NO_POST
  require post.author != viewer else SELF_LIKE
  require not exists likes[postKey, viewer] else DUPLICATE_LIKE
  (epochDay, remainder) = divmod(at, 86400000)
  insert likes { postKey, principal: viewer, author: post.author, kind: post.kind, at, day: at - remainder }

mutation follow(principal: principal):
  require exists profiles[principal] else NO_PROFILE
  require principal != viewer else SELF_FOLLOW
  insert follows { follower: viewer, followed: principal }

mutation createChat(chatKey: text 1..40):
  insert chats { key: chatKey, creator: viewer }
  insert memberships { chatKey, principal: viewer, role: 'admin' }
  insert userChats { chatKey, principal: viewer }

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists memberships[chatKey, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[principal] else NO_PROFILE
  insert memberships { chatKey, principal, role: 'member' }
  insert userChats { chatKey, principal }

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=500, at: time):
  require exists memberships[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, author: viewer, body, at }

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  msg = messages[messageKey] ! else NOT_MEMBER
  require msg.author != viewer else NOT_RECIPIENT
  if not exists acknowledgments[messageKey, viewer, 'read']:
    upsert acknowledgments[messageKey, viewer] { chatKey: msg.chatKey, state }
  return null

mutation leave(chatKey: text 1..40):
  require exists memberships[chatKey, viewer] else NOT_MEMBER
  delete userChats[viewer, chatKey]
  delete memberships[chatKey, viewer]
  return null

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 8 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      chats = userChats[p.principal] first 16 by byPrincipalChat { unread: unreadIn(.chatKey, p.principal) }
      counts = chats { unread, nonempty: 1 if .unread > 0 else 0 }
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages: sum(counts, .unread), unreadChats: sum(counts, .nonempty) }
schedule digestEveryTwoMinutes every 2m: digest
