use personas alice, bob, carol, dave, erin, frank, grace, heidi
effect digest

table profiles:
  principal: principal
  active: bool
  unique byPrincipal: principal
  public 'Public profile facts'
  insert <- .principal = viewer

table posts:
  key: text <=40
  author: principal
  kind: enum('original', 'reply', 'repost')
  target: posts ?
  targetAuthor: principal ?
  at: time
  body: text <=200
  unique byKey: key
  by byAuthorKind: author, kind, id
  by byKind: kind, at, id
  by byTargetAuthorKind: targetAuthor, kind, id
  public 'Public social posts'
  insert <- .author = viewer

table likes:
  postId: posts
  principal: principal
  owner: principal
  kind: enum('original', 'reply', 'repost')
  at: time
  unique byPostPrincipal: postId, principal
  by byOwnerKind: owner, kind, id
  public 'Public social likes'
  insert <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

table follows:
  source: principal
  target: principal
  unique byPair: source, target
  by byTarget: target, source
  public 'Public follow graph'
  insert <- .source = viewer

table chats:
  key: text <=40
  creator: principal
  unique byKey: key
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  after insert <- exists members[.id, .creator, 'admin']

table members:
  chatId: chats
  principal: principal
  role: enum('admin', 'member')
  unique byChatPrincipal: chatId, principal
  by byChatPrincipalRole: chatId, principal, role
  by byPrincipal: principal, chatId, id
  cap 20 by chatId
  read <- exists members[.chatId, viewer]
  insert <- exists members[.chatId, viewer, 'admin'] or created chats[.chatId]
  delete <- .principal = viewer

table userChats:
  chatId: chats
  principal: principal
  unique byPrincipalChat: principal, chatId
  read <- .principal = viewer
  insert <- exists members[.chatId, viewer, 'admin'] or created chats[.chatId]
  delete <- .principal = viewer

table messages:
  key: text <=40
  chatId: chats
  author: principal
  body: text <=500
  at: time
  unique byKey: key
  by byChatTime: chatId, at, id
  by byWords: chatId, words(body), at, id
  read <- exists members[.chatId, viewer]
  insert <- .author = viewer and exists members[.chatId, viewer]

table acknowledgments:
  messageId: messages
  chatId: chats
  principal: principal
  state: enum('delivered', 'read')
  unique byMessagePrincipal: messageId, principal
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer and exists members[.chatId, viewer]
  update <- .principal = viewer and exists members[.chatId, viewer]

table digestPeriods:
  principal: principal
  periodStart: time
  periodEnd: time
  unique byPeriod: principal, periodStart, periodEnd
  read <- .principal = viewer

mutation profile(active: bool):
  return insert profiles { principal: viewer, active }

mutation post(key: text <=40, kind: enum('original', 'reply', 'repost'), targetKey: text <=40 ?, at: time, body: text <=200):
  t = posts[targetKey]
  require kind = 'original' or t != null else TARGET_REQUIRED
  require kind != 'original' or targetKey = null else ORIGINAL_HAS_TARGET
  require t = null or t.kind = 'original' else TARGET_NOT_ORIGINAL
  return insert posts { key, kind, target: t.id if t != null else null, targetAuthor: t.author if t != null else null, author: viewer, at, body }

mutation like(postKey: text <=40, at: time):
  p = posts[postKey] ! else POST_NOT_FOUND
  require p.author != viewer else SELF_LIKE
  require not exists likes[p.id, viewer] else DUPLICATE_LIKE
  return insert likes { postId: p.id, principal: viewer, owner: p.author, kind: p.kind, at }

mutation follow(target: principal):
  require exists profiles[target] else PROFILE_NOT_FOUND
  require target != viewer else SELF_FOLLOW
  return insert follows { source: viewer, target }

mutation createChat(key: text <=40):
  c = insert chats { key, creator: viewer }
  insert members { chatId: c.id, principal: viewer, role: 'admin' }
  insert userChats { chatId: c.id, principal: viewer }
  return c

mutation addMember(chatKey: text <=40, principal: principal):
  c = chats[chatKey] ! else CHAT_NOT_FOUND
  require exists members[c.id, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[principal] else PROFILE_NOT_FOUND
  insert members { chatId: c.id, principal, role: 'member' }
  return insert userChats { chatId: c.id, principal }

mutation send(chatKey: text <=40, key: text <=40, body: text <=500, at: time):
  c = chats[chatKey] ! else CHAT_NOT_FOUND
  require exists members[c.id, viewer] else NOT_MEMBER
  return insert messages { chatId: c.id, key, body, at, author: viewer }

mutation leave(chatKey: text <=40):
  c = chats[chatKey] ! else CHAT_NOT_FOUND
  delete userChats[viewer, c.id]
  delete members[c.id, viewer]
  return null

mutation ack(messageKey: text <=40, state: enum('delivered', 'read')):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatId, viewer] else NOT_MEMBER
  require m.author != viewer else AUTHOR_NOT_RECIPIENT
  old = acknowledgments[m.id, viewer]
  upsert acknowledgments[m.id, viewer] { chatId: m.chatId, state: 'read' if old != null and old.state = 'read' else state }
  return null

fn isRead(messageId: messages, principal: principal): (acknowledgments[messageId, principal] { state }).state = 'read'
fn unread(chatId: chats, principal: principal): sum(messages[chatId] first 200 by byChatTime { n: 1 if .author != principal and not isRead(.id, principal) else 0 }, .n)

query receipt(messageKey: text <=40):
  m = messages[messageKey] ! else MESSAGE_NOT_FOUND
  require exists members[m.chatId, viewer] else NOT_MEMBER
  recipients = members[m.chatId] first 20 by byChatPrincipal { unread: 1 if .principal != m.author and not isRead(m.id, .principal) else 0, undelivered: 1 if .principal != m.author and not exists acknowledgments[m.id, .principal] else 0 }
  return { state: 'read' if sum(recipients, .unread) = 0 else 'delivered' if sum(recipients, .undelivered) = 0 else 'sent' }

query search(q: text <=100):
  groups = userChats[viewer] first 100 by byPrincipalChat { chatKey: chats[.chatId].key, messages: messages[.chatId] matching q last 100 by byWords { key, body, at } }
  return sort(groups, 'chatKey')

query trending(at: time):
  candidates = posts['original'] first 200 by byKind { key, at, likes: likeCounts[.id], eligible: 1 if .at >= at - 86400000 and .at <= at else 0 }
  return slice(sort(candidates, '-eligible', '-likes', '-at', 'key'), 0, min(10, sum(candidates, .eligible))) { key, likes, at }

fn dayPosts(owner: principal, day: time): sum(posts[owner, 'original'] first 200 by byAuthorKind { n: 1 if .at >= day and .at < day + 86400000 else 0 }, .n)
fn dayLikes(owner: principal, day: time): sum(likes[owner, 'original'] first 200 by byOwnerKind { n: 1 if .at >= day and .at < day + 86400000 else 0 }, .n)

query insights(at: time):
  (daysSinceEpoch, remainder) = divmod(at - 0, 86400000)
  today = at - remainder
  days = [today - 518400000, today - 432000000, today - 345600000, today - 259200000, today - 172800000, today - 86400000, today] { day: ., posts: dayPosts(viewer, .), likesReceived: dayLikes(viewer, .) }
  return { posts: count(posts[viewer, 'original'] first 200 by byAuthorKind), likesReceived: count(likes[viewer, 'original'] first 200 by byOwnerKind), repostsReceived: count(posts[viewer, 'repost'] first 200 by byTargetAuthorKind), repliesReceived: count(posts[viewer, 'reply'] first 200 by byTargetAuthorKind), followers: count(follows[viewer] first 200 by byTarget), following: count(follows[viewer] first 200 by byPair), days }

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 20 by byId:
    if p.active and not exists digestPeriods[p.principal, periodStart, periodEnd]:
      groups = userChats[p.principal] first 100 by byPrincipalChat { n: unread(.chatId, p.principal) }
      counts = groups { n, chat: 1 if .n > 0 else 0 }
      insert digestPeriods { principal: p.principal, periodStart, periodEnd }
      emit digest { targetUserId: p.principal, periodStart, periodEnd, unreadMessages: sum(counts, .n), unreadChats: sum(counts, .chat) }
schedule digestEveryTwoMinutes every 2m: digest
