use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'public profile directory and explicit activity preference'
  insert <- .principal = viewer
  update <- .principal = viewer

table posts:
  key: text 1..40
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  targetKey: text <=40 ?
  targetAuthor: principal ?
  body: text <=500
  at: time
  unique byKey: key
  by byAuthorKind: authorId, kind, at, id
  by byKind: kind, at, id
  by byTargetAuthorKind: targetAuthor, kind, id
  public 'posts and their engagement are public'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  authorId: principal
  kind: enum('original', 'reply', 'repost')
  at: time
  unique byPostPrincipal: postId, principal
  by byAuthorKind: authorId, kind, at, id
  public 'public engagement facts for public posts'
  insert <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  public 'public social graph'
  insert <- .followerId = viewer

table chats:
  key: text 1..40
  creatorId: principal
  unique byKey: key
  read <- exists members[.key, viewer]
  insert <- .creatorId = viewer
  after insert <- exists members[.key, .creatorId, 'admin']

table members:
  chatKey: text 1..40
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatKey, principal
  by byChatPrincipalRole: chatKey, principal, role
  by byPrincipalChat: principal, chatKey, id
  cap 50 by chatKey
  read <- exists members[.chatKey, viewer]
  insert <- exists members[.chatKey, viewer, 'admin'] or created chats[key = .chatKey]
  delete <- .principal = viewer

table chatLinks:
  chatKey: text 1..40
  principal: principal
  unique byPrincipalChat: principal, chatKey
  cap 50 by principal
  read <- .principal = viewer
  insert <- exists members[.chatKey, viewer, 'admin']
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
  by byMessagePrincipalState: messageId, principal, state
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
  upsert profiles[viewer] { active }

mutation post(key: text 1..40, kind: enum('original', 'reply', 'repost'), targetKey: text <=40 ?, at: time, body: text <=500):
  if kind = 'original':
    require targetKey = null else UNEXPECTED_TARGET
    insert posts { key, authorId: viewer, kind, targetKey, targetAuthor: null, at, body }
  else:
    require targetKey != null else TARGET_REQUIRED
    target = posts[targetKey] ! else TARGET_NOT_FOUND
    require target.kind = 'original' else ORIGINAL_REQUIRED
    insert posts { key, authorId: viewer, kind, targetKey, targetAuthor: target.authorId, at, body }
  return null

mutation like(postKey: text 1..40, at: time):
  post = posts[postKey] ! else POST_NOT_FOUND
  require post.authorId != viewer else SELF_LIKE
  require not exists likes[post.id, viewer] else DUPLICATE_LIKE
  insert likes { postId: post.id, principal: viewer, authorId: post.authorId, kind: post.kind, at }

mutation follow(principal: principal):
  require exists profiles[principal] else PROFILE_NOT_FOUND
  require principal != viewer else SELF_FOLLOW
  insert follows { followerId: viewer, followedId: principal }

mutation createChat(key: text 1..40):
  insert chats { key, creatorId: viewer }
  insert members { chatKey: key, principal: viewer, role: 'admin' }
  insert chatLinks { chatKey: key, principal: viewer }
  return null

mutation addMember(chatKey: text 1..40, principal: principal):
  require exists members[chatKey, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatKey, principal, role: 'member' }
  insert chatLinks { chatKey, principal }

mutation send(chatKey: text 1..40, key: text 1..40, body: text <=500, at: time):
  require exists members[chatKey, viewer] else NOT_MEMBER
  insert messages { key, chatKey, authorId: viewer, body, at }

mutation leave(chatKey: text 1..40):
  require exists members[chatKey, viewer] else NOT_MEMBER
  delete chatLinks[viewer, chatKey]
  delete members[chatKey, viewer]
  return null

mutation ack(messageKey: text 1..40, state: enum('delivered', 'read')):
  msg = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[msg.chatKey, viewer] else NOT_MEMBER
  require msg.authorId != viewer else NOT_RECIPIENT
  old = acknowledgements[msg.id, viewer]
  if old != null:
    if old.state != 'read':
      update acknowledgements[old] { state }
  else:
    insert acknowledgements { messageId: msg.id, chatKey: msg.chatKey, principal: viewer, state }
  return null

fn postDay(p: principal, day: time): sum(posts[p, 'original'] first 100 by byAuthorKind { n: 1 if .at >= day and .at < day + 86400000 else 0 }, .n)
fn likeDay(p: principal, day: time): sum(likes[p, 'original'] first 200 by byAuthorKind { n: 1 if .at >= day and .at < day + 86400000 else 0 }, .n)

query insights(at: time):
  (dayNumber, remainder) = divmod(at, 86400000)
  today = at - remainder
  days = [today - 518400000, today - 432000000, today - 345600000, today - 259200000, today - 172800000, today - 86400000, today]
  return { posts: count(posts[viewer, 'original'] first 100 by byAuthorKind), likesReceived: count(likes[viewer, 'original'] first 200 by byAuthorKind), repostsReceived: count(posts[viewer, 'repost'] first 100 by byTargetAuthorKind), repliesReceived: count(posts[viewer, 'reply'] first 100 by byTargetAuthorKind), followers: count(follows[viewer] first 100 by byFollowed), following: count(follows[viewer] first 100 by byPair), days: days { day: ., posts: postDay(viewer, .), likesReceived: likeDay(viewer, .) } }

query trending(at: time):
  candidates = posts['original'] first 200 by byKind { key, at, likes: likeCounts[.id], eligible: 1 if .at >= at - 86400000 and .at <= at else 0 }
  ranked = sort(candidates, '-eligible', '-likes', '-at', 'key')
  return slice(ranked, 0, min(10, sum(candidates, .eligible))) { key, likes, at }

fn readFlag(messageId: messages, p: principal): 1 if exists acknowledgements[messageId, p, 'read'] else 0
fn deliveredFlag(messageId: messages, p: principal): 1 if exists acknowledgements[messageId, p] else 0

query receipt(messageKey: text 1..40):
  msg = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[msg.chatKey, viewer] else NOT_MEMBER
  recipients = members[msg.chatKey] first 50 by byChatPrincipal { unread: 1 - readFlag(msg.id, .principal) if .principal != msg.authorId else 0, undelivered: 1 - deliveredFlag(msg.id, .principal) if .principal != msg.authorId else 0 }
  return { state: 'read' if sum(recipients, .unread) = 0 else 'delivered' if sum(recipients, .undelivered) = 0 else 'sent' }

query search(q: text <=100):
  return chatLinks[viewer] first 50 by byPrincipalChat { chatKey, messages: messages[.chatKey] matching q last 100 by byChatWords { key, body, at } }

fn unreadInChat(chatKey: text <=40, p: principal): sum(messages[chatKey] first 200 by byChatTime { n: 1 - readFlag(.id, p) if .authorId != p else 0 }, .n)

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 50 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      unread = chatLinks[p.principal] first 50 by byPrincipalChat { n: unreadInChat(.chatKey, p.principal) }
      chats = unread { n: 1 if .n > 0 else 0 }
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages: sum(unread, .n), unreadChats: sum(chats, .n) }
schedule digestEveryTwoMinutes every 2m: digest
