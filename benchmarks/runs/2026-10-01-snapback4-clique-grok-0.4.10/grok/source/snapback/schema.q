-- Clique on snapback4@0.4.10
-- Window durations match config/windows.json (shortened grading):
--   edit 60s, delete-for-everyone 120s, disappearing 24h=180s, 7d=300s.
-- Digest schedule matches config/digest.json: every 2m.
use identity
use personas alice, bob, carol, dave, erin, frank, grace, henry
effect notify

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'public follows'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public last 2000 by .at with own keys .followerId

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500 ?
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  poster: image <=10000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable authorId, parentId, at
  public 'public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }

view replyCounts: count posts where .parentId != null by .parentId
view repostCounts: count reposts by .postId
view followerCounts: count follows by .followedId
  online only
view followingCounts: count follows by .followerId
  online only
view authorPostCounts: count posts where .parentId = null by .authorId
  online only
view receivedLikeCounts: count likes by .postId.authorId
  online only
view receivedRepostCounts: count reposts by .postId.authorId
  online only
view receivedReplyCounts: count posts where .parentId != null by .parentId.authorId
  online only
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  online only
view dailyLikesReceived: count likes by .postId.authorId, day(.at)
  online only

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  color: text <=32 ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  lastOrdinal: int default 0
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedOrdinal: int
  deliveredOrdinal: int default 0
  seenOrdinal: int default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]

table runs:
  conversation: conversations
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique conversation, principal, fromOrdinal
  cap 64 by conversation, principal
  cap 3200 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  video: video <=50000000 ?
  poster: image <=10000000 ?
  quote: messages ?
  editedAt: time ?
  tombstone: bool default false
  expiresAt: time ?
  at: time
  search text, caption
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversation] last 500 by byConversationOrdinal

table reactions:
  message: messages
  principal: principal
  emoji: text <=16
  unique message, principal
  cap 32 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  online only

view reactionCounts: count reactions by .message, .emoji
  online only

table directChats:
  owner: principal
  peer: principal
  conversation: conversations
  unique owner, peer
  immutable owner, peer, conversation
  read <- .owner = viewer
  insert <- created conversations[.conversation] and (.owner = viewer or .peer = viewer)
  sync to .owner

table typing:
  conversation: conversations
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  ephemeral 4s

fn receipt(m: messages):
  state = 'read'
  remaining = 0
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedOrdinal < m.ordinal:
      remaining = remaining + 1
      if m.ordinal > member.deliveredOrdinal:
        run = first(runs[conversation = m.conversation, principal = member.principal, fromOrdinal <= m.ordinal] last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.ordinal:
          return 'sent'
      if member.seenOrdinal < m.ordinal:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'

fn disappearingTtl(setting: text <=3):
  return 180000 if setting = '24h' else 300000 if setting = '7d' else null

fn previewText(text: text <=2000 ?, photo: image <=10000000 ?, oncePhoto: image <=10000000 ?, video: video <=50000000 ?):
  return slice(text, 0, 80) if text != null and text != '' else 'Photo' if photo != null or oncePhoto != null else 'Video' if video != null else ''

query whoAmI():
  return viewer

query myProfile():
  return profiles[principal = viewer]

query profileByPrincipal(principal: principal):
  return profiles[principal = principal]

query profileByHandle(handle: text 3..20 format handle):
  return profiles[handle = handle]

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query followCounts(principal: principal):
  return {
    followers: followerCounts[principal] ?? 0,
    following: followingCounts[principal] ?? 0,
    followingThem: exists follows[viewer, principal]
  }

query followingThem(principal: principal):
  return exists follows[viewer, principal]

query home(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 40 by .at after c { *, card: posts[.post] }

query globalFeed(c: cursor ?):
  return activity last 40 by .at after c { *, card: posts[.post] }

query trending(c: cursor ?):
  return posts where .at > now - 1d and .at <= now and .parentId = null and not .removed last 10 by .likeCount, .at after c

query postById(postId: posts):
  return posts[postId]

query postState(postId: posts):
  p = posts[postId] ! else POST_NOT_FOUND
  return {
    liked: exists likes[postId, viewer],
    reposted: exists reposts[viewer, postId],
    likeCount: p.likeCount,
    replyCount: replyCounts[postId] ?? 0,
    repostCount: repostCounts[postId] ?? 0
  }

query replies(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 50 by .at after c

query userPosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null and not .removed last 100 by .at after c

query insights():
  likesReceived = 0
  for p in posts where .authorId = viewer and .parentId = null:
    likesReceived = likesReceived + p.likeCount
  return {
    posts: authorPostCounts[viewer] ?? 0,
    likesReceived,
    repostsReceived: receivedRepostCounts[viewer] ?? 0,
    repliesReceived: receivedReplyCounts[viewer] ?? 0,
    followers: followerCounts[viewer] ?? 0,
    following: followingCounts[viewer] ?? 0,
    today: day(now),
    now: now
  }

query insightDay(dayKey: time):
  return {
    day: day(dayKey),
    posts: dailyPosts[viewer, day(dayKey)] ?? 0,
    likesReceived: dailyLikesReceived[viewer, day(dayKey)] ?? 0
  }

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation], role, seenOrdinal, deliveredOrdinal }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 80 by byConversationOrdinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }

query receiptMember(conversation: conversations):
  return members[conversation, viewer]

query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delivered = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages where .conversation = conversation and .ordinal > delivered and .ordinal <= delivered + 100 last 100 by .ordinal after c }

query membersOf(conversation: conversations):
  return members where .conversation = conversation first 50 by .principal

query conversationRuns(conversation: conversations):
  return runs where .conversation = conversation first 200 by .fromOrdinal

query directConversation(other: principal):
  return directChats[owner = viewer, peer = other]

query directPeer(conversation: id):
  return first(directChats where .owner = viewer and .conversation = conversation first 1 by .id)

query messagePhoto(id: messages):
  return messages[id]

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query messageReactions(message: messages):
  return reactions where .message = message first 32 by .principal

query reactionChips(message: messages):
  return reactionCounts where .message = message first 32 by .emoji { emoji, count: .value }

query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .at after c

query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c

query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .conversation where exists (messages[conversation = .conversation] by .at matching q) { conversation, hits: messages[conversation = .conversation] matching q last 3 by .at }

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .handle

query directory(c: cursor ?):
  return profiles first 50 by .handle after c

query namedGroup(title: text 1..50):
  return first(conversations where .kind = 'group' and .title = title and exists members[.id, viewer] first 1 by .id)

query inboxSnippets(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c {
    conversation,
    hits: messages[conversation = .conversation] last 40 by byConversationOrdinal
  }

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }

mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

mutation setFollow(principal: principal, following: bool):
  require principal != viewer else CANNOT_FOLLOW_SELF
  if following:
    insert follows { followerId: viewer, followedId: principal, at: now } if absent
  else:
    delete follows[viewer, principal]
  return null

mutation createPost(id: id, body: text <=500 ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?, poster: image <=10000000 ?, parentId: posts ?):
  require body != null or images != null or video != null else EMPTY_POST
  if video != null:
    require images = null else MIXED_MEDIA
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  if images != null:
    require video = null else MIXED_MEDIA
  if parentId != null:
    require exists posts[parentId] else PARENT_NOT_FOUND
  return insert posts { id, authorId: viewer, parentId, body, images, video, poster, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if liked:
    require not p.removed else POST_REMOVED
    insert likes { postId, principal: viewer, at: now } if absent
  else:
    delete likes[postId, viewer]
  return null

mutation setRepost(postId: posts, reposted: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if reposted:
    require not p.removed else POST_REMOVED
    require p.parentId = null else REPOST_REPLY
    insert reposts { actorId: viewer, postId, at: now } if absent
  else:
    delete reposts[viewer, postId]
  return null

mutation createGroup(id: id, title: text 1..50, description: text <=200 ?, other: principal):
  require other != viewer else NEED_OTHER
  chat = insert conversations { id, kind: 'group', title, description, creatorId: viewer, disappearing: 'off' }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return chat.id

mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, kind: 'dm', title: null, creatorId: viewer, disappearing: 'off' }
  insert members { conversation: chat.id, principal: viewer, role: 'member', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id

mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
  return null

mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  me = members[conversation, principal] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[me]
  return null

mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
  return null

mutation leave(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  for run in runs where .conversation = conversation and .principal = viewer:
    delete runs[run]
  delete members[me]
  return null

mutation setChatColor(conversation: conversations, color: text <=32):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { color }
  return null

mutation setChatBackground(conversation: conversations, background: image <=10000000):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { background }
  return null

mutation setDisappearing(conversation: conversations, disappearing: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  if chat.kind = 'group':
    require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  else:
    require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { disappearing }
  return null

mutation setGroupInfo(conversation: conversations, title: text 1..50, description: text <=200 ?):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[conversation] { title, description }
  return null

mutation send(id: id, conversation: conversations, text: text <=2000 ?, caption: text <=500 ?, photo: image <=10000000 ?, oncePhoto: image <=10000000 ?, video: video <=50000000 ?, poster: image <=10000000 ?, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require text != null or photo != null or oncePhoto != null or video != null else EMPTY_MESSAGE
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  if quote != null:
    q = messages[quote] ! else QUOTE_NOT_FOUND
    require q.conversation = conversation else QUOTE_WRONG_CHAT
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  ttl = disappearingTtl(chat.disappearing)
  expiresAt = now + ttl if ttl != null else null
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  m = insert messages { id, conversation, sender: viewer, ordinal, recipients, text, caption, photo, oncePhoto, video, poster, quote, expiresAt, at: now }
  senderName = profiles[principal = viewer].displayName ?? 'Someone'
  preview = previewText(text, photo, oncePhoto, video)
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: senderName, preview }
  return m.id

mutation editMessage(message: messages, text: text <=2000 ?, caption: text <=500 ?):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else DELETED
  require now - m.at <= 60000 else EDIT_WINDOW
  update messages[m] { text, caption, editedAt: now }
  return null

mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else DELETED
  require now - m.at <= 120000 else DELETE_WINDOW
  update messages[m] { tombstone: true, text: null, caption: null, photo: null, oncePhoto: null, video: null, poster: null, quote: null }
  return null

mutation setReaction(message: messages, emoji: text <=16):
  require exists messages[message] else NOT_FOUND
  upsert reactions[message, viewer] { emoji }
  return null

mutation clearReaction(message: messages):
  delete reactions[message, viewer]
  return null

mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal:
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  held = first(runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= from last 1 by .fromOrdinal)
  if through <= prefix or (held != null and held.throughOrdinal >= through):
    return null
  low = from
  high = through
  for run in runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
    delete runs[run]
  if low <= prefix + 1:
    update members[me] { deliveredOrdinal: high }
  else:
    require count(runs where .conversation = conversation and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  return null

mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
  return null

mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}

mutation stopTyping(conversation: conversations):
  delete typing[conversation, viewer]

query typingIn(conversation: conversations):
  return typing[conversation = conversation] where .principal != viewer by .principal { principal }

fn unreadIn(conversationId: conversations, reader: principal, seenOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversationId and .at >= periodStart and .at < periodEnd and not .tombstone and .sender != reader and .ordinal > seenOrdinal)

fn digestTotals(p: profiles, periodStart: time, periodEnd: time):
  unread = 0
  chats = 0
  for m in members where .principal = p.principal:
    n = unreadIn(m.conversation, p.principal, m.seenOrdinal, periodStart, periodEnd)
    if n > 0:
      chats = chats + 1
      unread = unread + n
  newFollowers = count(follows where .followedId = p.principal and .at >= periodStart and .at < periodEnd)
  newPosts = count(posts where .authorId = p.principal and .parentId = null and .at >= periodStart and .at < periodEnd)
  for f in follows where .followerId = p.principal:
    newPosts = newPosts + count(posts where .authorId = f.followedId and .parentId = null and .at >= periodStart and .at < periodEnd)
  return { unread, chats, newFollowers, newPosts }

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    totals = digestTotals(p, periodStart, periodEnd)
    if totals.unread > 0 or totals.newFollowers > 0 or totals.newPosts > 0 or totals.chats > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers: totals.newFollowers, newPostsInFollowing: totals.newPosts, unreadMessages: totals.unread, unreadChats: totals.chats } once [p.principal, periodEnd]
schedule dailyDigest every 2m: digest
