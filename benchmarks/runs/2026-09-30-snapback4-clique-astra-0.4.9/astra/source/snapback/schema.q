use identity password

table profiles:
  principal: principal
  handle: text 3..20 format handle
  displayName: text 1..50
  bio: text <=200
  location: text <=50
  link: text format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Registered profiles are discoverable'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id

query me():
  return profiles[principal = viewer]
query profile(handle: text):
  return profiles[handle = handle]
query people(q: text, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(handle: text 3..20 format handle, displayName: text 1..50, bio: text <=200, location: text <=50, link: text format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, handle, displayName, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  body: text <=500
  photos: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable author, parent, at
  public 'Public posts and replies'
  insert <- .author = viewer
  update <- .author = viewer
  sync public last 1000 by .at

table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public 'Public follow graph'
  insert <- .follower = viewer and .followed != viewer
  delete <- .follower = viewer
  online only

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'Post likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table reposts:
  post: posts
  actor: principal
  at: time
  unique actor, post
  immutable actor, post, at
  public 'Public reposts'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at with own keys .actor

view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post: .post, actor: .actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
view followerCounts: count follows by .followed
  online only
view followingCounts: count follows by .follower
  online only
view replyCounts: count posts by .parent
  online only
view repostCounts: count reposts by .post
  online only
shape card = { *, authorProfile: profiles[principal = .author], replyCount: replyCounts[.id], repostCount: repostCounts[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] card, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] card, actorProfile: profiles[principal = .actor] }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c card
query post(id: posts):
  return posts[id] card
query replies(parent: posts, c: cursor ?):
  return posts where .parent = parent first 20 by .at after c card
query followState(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], mine: exists follows[viewer, owner] }
mutation publish(id: id, body: text <=500, parent: posts ?, photos: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require video = null or photos = null else MIXED_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, parent, body, photos, video, at: now }
mutation setFollow(owner: principal, value: bool):
  require owner != viewer else SELF_FOLLOW
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if value:
    insert follows { follower: viewer, followed: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation setLike(post: posts, value: bool):
  require exists posts[post] else POST_NOT_FOUND
  if value:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, value: bool):
  p = posts[post] ! else POST_NOT_FOUND
  require p.parent = null else REPLY_REPOST
  if value:
    insert reposts { post, actor: viewer, at: now } if absent
  else if exists reposts[viewer, post]:
    delete reposts[viewer, post]

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50
  description: text <=200
  creator: principal
  lastOrdinal: int default 0
  accent: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  immutable kind, creator
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creator]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedOrdinal: int
  deliveredOrdinal: int default 0 written by .principal readable by audience
  seenOrdinal: int default 0 written by .principal readable by audience
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- exists members[.conversation, viewer, role = 'admin']
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
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]

table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  deleted: bool default false
  quote: messages ?
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  search text
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  expire at .expiresAt
  retain delivered-history
  sync to members[.conversation] last 500 by byConversationOrdinal

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
mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}
mutation stopTyping(conversation: conversations):
  if exists typing[conversation, viewer]:
    delete typing[conversation, viewer]
query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal { principal }
query inboxTyping(c: cursor ?):
  return members where .principal = viewer first 100 by .conversation after c { conversation, typing: typing[conversation = .conversation] where .principal != viewer { principal } }

fn receipt(m: messages):
  state = 'read'
  remaining = 0
  for member in members where .conversation = m.conversation:
    if member.principal != m.sender and member.joinedOrdinal < m.ordinal:
      remaining = remaining + 1
      if m.ordinal > member.deliveredOrdinal:
        run = first(runs where .conversation = m.conversation and .principal = member.principal and .fromOrdinal <= m.ordinal last 1 by .fromOrdinal)
        if run = null or run.throughOrdinal < m.ordinal:
          return 'sent'
      if member.seenOrdinal < m.ordinal:
        state = 'delivered'
  return state if remaining > 0 or m.recipients > 0 else 'sent'
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], peer: first(members[conversation = .conversation] where .principal != viewer first 1 by .principal) }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c
query message(id: messages):
  return messages[id]
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }
query receiptMember(conversation: conversations):
  return members[conversation, viewer]
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query profileByPrincipal(principal: principal):
  return profiles[principal = principal]
query resolveDm(handle: text):
  p = profiles[handle = handle] ! else PROFILE_NOT_FOUND
  return directChats[viewer, p.principal]
query groupByTitle(title: text):
  return first(conversations where .kind = 'group' and .title = title first 1 by .id)

mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, kind: 'dm', title: 'Direct message', description: '', creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'admin', joinedOrdinal: 0 }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, other: principal):
  require other != viewer else SECOND_MEMBER_REQUIRED
  chat = insert conversations { id, kind: 'group', title, description, creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
mutation removeMember(conversation: conversations, principal: principal):
  require principal = viewer or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[conversation, principal]
mutation send(id: id, conversation: conversations, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require (photo = null or video = null) and (oncePhoto = null or (photo = null and video = null)) else MIXED_MEDIA
  require (photo = null and video = null and oncePhoto = null) or length(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  if quote != null:
    q = messages[quote] ! else QUOTE_NOT_FOUND
    require q.conversation = conversation else WRONG_CHAT
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  message = insert messages { id, conversation, sender: viewer, ordinal, recipients, text, quote, photo, video, oncePhoto, at: now, expiresAt: now + messageTtl(chat.disappearing) if messageTtl(chat.disappearing) != null else null }
  author = profiles[principal = viewer] ! else PROFILE_NOT_FOUND
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: author.displayName, preview: 'Video' if video != null else 'Photo' if photo != null or oncePhoto != null else slice(text, 0, 80), messageId: id }
  return message
mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal: server
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  if through <= prefix:
    return null
  low = from
  high = through
  held = runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from
  for run in held:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
  if prefix + 1 < low:
    blocker = first(messages where .conversation = conversation and .ordinal > prefix and .ordinal < low first 1 by byConversationOrdinal)
    prefix = blocker.ordinal - 1 if blocker != null else low - 1
  for run in held:
    delete runs[run]
  if low <= prefix + 1:
    prefix = max(prefix, high)
  else:
    require count(runs where .conversation = conversation and .principal = viewer) < 64 else RUNS_FULL
    insert runs { conversation, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return null
mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }


table reactions:
  message: messages
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
query messageReactions(message: messages):
  return reactions where .message = message by .principal
mutation setReaction(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else NOT_FOUND
  require not m.deleted else DELETED
  require exists members[m.conversation, viewer] else NOT_MEMBER
  if emoji = null:
    if exists reactions[message, viewer]:
      delete reactions[message, viewer]
  else if exists reactions[message, viewer]:
    update reactions[message, viewer] { emoji }
  else:
    insert reactions { message, principal: viewer, emoji }
  return null
mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.deleted else DELETED
  require now - m.at <= editWindow() else EDIT_WINDOW_CLOSED
  require (m.photo = null and m.video = null and m.oncePhoto = null) or length(text) <= 500 else CAPTION_TOO_LONG
  update messages[m] { text, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, video: null, oncePhoto: null, quote: null, deleted: true }


mutation setChatIdentity(conversation: conversations, title: text 1..50, description: text <=200):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else GROUP_ONLY
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { title, description }
mutation setChatAccent(conversation: conversations, accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569')):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { accent }
mutation setChatBackground(conversation: conversations, background: image <=10000000 ?):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { background }
mutation setDisappearing(conversation: conversations, disappearing: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { disappearing }
query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q where not .deleted last 20 by .at after c
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages where .conversation = conversation and not .deleted matching q last 20 by .at after c
query searchGrouped(q: text <=100, c: cursor ?):
  return members where .principal = viewer and exists (messages[conversation = .conversation] matching q where not .deleted) first 20 by .conversation after c { conversation, hits: messages[conversation = .conversation] matching q where not .deleted last 3 by .at }


effect notify retry 8 backoff 2s deadline 1d cancellation allow
fn reactionSummary(message: messages):
  mine = reactions[message, viewer]
  rows = reactions where .message = message by .principal
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: mine != null and mine.emoji = .key }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { *, conversationId: .conversation, senderId: .sender, serverTimestamp: .at, type: 'video' if .video != null else 'image' if .photo != null or .oncePhoto != null else 'text', mediaId: .photo.id if .photo != null else .video.id if .video != null else .oncePhoto.id if .oncePhoto != null else null, viewOnce: .oncePhoto != null, tombstone: .deleted, replyToId: .quote, reactions: reactionSummary(.id), receipt: receipt(.) if .sender = viewer else null }
query followingList(owner: principal, c: cursor ?):
  return follows where .follower = owner first 100 by .followed after c { followed, profile: profiles[principal = .followed] }

view postTotals: count posts where .parent = null and not .removed by .author
  online only
view receivedLikes: count likes by .post.author
  online only
view receivedReposts: count reposts by .post.author
  online only
view receivedReplies: count posts where .parent != null by .parent.author
  online only
view dailyPosts: count posts where .parent = null and not .removed by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
query insights():
  days = []
  for i in range(0, 7):
    d = day(now) - 6 + i
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { at: now, posts: postTotals[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending(c: cursor ?):
  return posts where .parent = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at after c card
view unreadCounts: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal and .sender != m.principal and not .deleted
query unreadFor(member: members):
  return unreadCounts[member]
fn unreadIn(conversation: conversations, reader: principal, ordinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and .ordinal > ordinal and .sender != reader and not .deleted)
fn digestTotals(p: profiles, periodStart: time, periodEnd: time):
  period = digestBucket(periodStart)
  newFollowers = digestFollowers[p.principal, period]
  newPostsInFollowing = digestPosts[p.principal, period] + digestReposts[p.principal, period]
  for edge in follows where .follower = p.principal:
    newPostsInFollowing = newPostsInFollowing + digestPosts[edge.followed, period] + digestReposts[edge.followed, period]
  unreadMessages = 0
  unreadChats = 0
  for member in members where .principal = p.principal:
    n = unreadIn(member.conversation, p.principal, max(member.seenOrdinal, member.joinedOrdinal), periodStart, periodEnd)
    if n > 0:
      unreadMessages = unreadMessages + n
      unreadChats = unreadChats + 1
  return { newFollowers, newPostsInFollowing, unreadMessages, unreadChats }
job dailyDigest(periodStart: time, periodEnd: time):
  for p in profiles:
    totals = digestTotals(p, periodStart, periodEnd)
    if totals.newFollowers + totals.newPostsInFollowing + totals.unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers: totals.newFollowers, newPostsInFollowing: totals.newPostsInFollowing, unreadMessages: totals.unreadMessages, unreadChats: totals.unreadChats } once [p.principal, periodEnd]
