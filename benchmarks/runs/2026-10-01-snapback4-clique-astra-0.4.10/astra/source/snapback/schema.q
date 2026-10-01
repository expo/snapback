use identity password

effect push retry 8 backoff 2s deadline 1d cancellation allow

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2000 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Clique profiles are discoverable by registered accounts'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id

query me():
  return profiles[principal = viewer]
query profile(handle: text):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  text: text <=500
  images: [image <=10000000] <=4
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  immutable author, parent, at
  public 'Public posts and direct replies'
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
  insert <- .follower = viewer
  delete <- .follower = viewer
  online only

table reposts:
  actor: principal
  post: posts
  at: time
  unique actor, post
  immutable actor, post, at
  public 'Public repost attribution'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at with own keys .actor

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'Public post likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

view replyCounts: count posts by .parent
  online only
view followerCounts: count follows by .followed
  online only
view followingCounts: count follows by .follower
  online only
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
shape postCard = { *, authorProfile: profiles[principal = .author], replyCount: replyCounts[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(principal: principal, c: cursor ?):
  return posts where .author = principal and .parent = null last 20 by .at after c postCard
query post(post: posts):
  return posts[post] postCard
query replies(post: posts, c: cursor ?):
  return posts where .parent = post first 20 by .at after c postCard
query followState(principal: principal):
  return { following: exists follows[viewer, principal], followers: followerCounts[principal], follows: followingCounts[principal] }
mutation publish(id: id, text: text <=500, parent: posts ?, images: [image <=10000000] <=4, video: video <=50000000 ?):
  require count(images) = 0 or video = null else MIXED_MEDIA
  require count(text) > 0 or count(images) > 0 or video != null else EMPTY_POST
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, parent, text, images, video, at: now }
mutation setFollow(principal: principal, enabled: bool):
  require principal != viewer else SELF_FOLLOW
  require exists profiles[principal = principal] else USER_NOT_FOUND
  if enabled:
    insert follows { follower: viewer, followed: principal, at: now } if absent
  else if exists follows[viewer, principal]:
    delete follows[viewer, principal]
mutation setLike(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    insert reposts { actor: viewer, post, at: now } if absent
  else if exists reposts[viewer, post]:
    delete reposts[viewer, post]

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50
  description: text <=200
  creator: principal
  lastOrdinal: int default 0
  color: text default '#4F46E5'
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
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]
table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  quote: messages ?
  photo: image <=10000000 ?
  video: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  editedAt: time ?
  tombstone: bool default false
  at: time
  expire at .expiresAt
  search text
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, quote, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer
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
view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .sender != m.principal and not .tombstone
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
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], unread: unread[.id] }
query directPeer(conversation: conversations):
  return first(directChats where .owner = viewer and .conversation = conversation first 1 by .id) { *, profile: profiles[principal = .peer] }
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query groupByTitle(title: text):
  return first(conversations where .title = title and .kind = 'group' first 1 by .id)
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query receiptMember(conversation: conversations):
  return members[conversation, viewer]
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c
query decorations(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.), author: profiles[principal = .sender], quoted: messages[.quote], reactions: reactionRows(.) }
mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else USER_NOT_FOUND
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, title: 'Direct message', description: '', kind: 'dm', creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'member', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, other: principal):
  require other != viewer else NEED_SECOND_MEMBER
  require exists profiles[principal = other] else USER_NOT_FOUND
  chat = insert conversations { id, title, description, kind: 'group', creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else USER_NOT_FOUND
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
mutation removeMember(conversation: conversations, principal: principal):
  require principal = viewer or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[conversation, principal]
mutation send(id: id, conversation: conversations, text: text 1..2000, quote: messages ?): server
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  if quote != null:
    original = messages[quote] ! else NOT_FOUND
    require original.conversation = conversation else WRONG_CONVERSATION
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  insert messages { id, conversation, sender: viewer, ordinal, recipients, text, quote, at: now, expiresAt: now + config.ttl(chat.disappearing) if config.ttl(chat.disappearing) != null else null }
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit push { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: slice(text, 0, 80) }
  return id
mutation delivered(conversation: conversations, from: int, through: int)
  reports delivery of messages by .conversation, .ordinal: server
  me = members[conversation, viewer] ! else NOT_MEMBER
  anchor = messages[conversation = conversation, ordinal = through] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  if through <= prefix:
    return prefix
  low = from
  high = through
  held = runs where .conversation = conversation and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from
  for run in held:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
  if prefix + 1 < low:
    blocker = first(messages where .conversation = conversation and .ordinal > prefix and .ordinal < low first 1 by .ordinal)
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
  return prefix
mutation seen(conversation: conversations, through: int): server
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  require through <= chat.lastOrdinal else PAST_LAST_MESSAGE
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }
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
  delete typing[conversation, viewer]
query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal { principal }
query directConversation(other: principal):
  return directChats[owner = viewer, peer = other]

table reactions:
  message: messages
  principal: principal
  emoji: text 1..100
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync last 1000 by .id
query message(message: messages):
  return messages[message]
query messageReactions(message: messages):
  return reactions where .message = message
mutation sendMedia(id: id, conversation: conversations, text: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require (photo != null and video = null) or (video != null and photo = null) else ONE_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = 0
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      recipients = recipients + 1
  update conversations[chat] { lastOrdinal: ordinal }
  insert messages { id, conversation, sender: viewer, ordinal, recipients, text, photo, video, at: now, expiresAt: now + config.ttl(chat.disappearing) if config.ttl(chat.disappearing) != null else null }
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit push { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Video' if video != null else 'Photo' }
  return id
mutation setReaction(message: messages, emoji: text 1..100 ?):
  m = messages[message] ! else NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[message, viewer] { emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]
  return null
mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now - m.at <= config.editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  update messages[m] { text, editedAt: now }
mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= config.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, video: null, oncePhoto: null, tombstone: true }

mutation chatIdentity(conversation: conversations, title: text 1..50, description: text <=200):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[conversation] { title, description }
mutation chatColor(conversation: conversations, color: text):
  require exists members[conversation, viewer] else NOT_MEMBER
  require color in ['#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569'] else INVALID_COLOR
  update conversations[conversation] { color }
mutation chatBackground(conversation: conversations, background: image <=10000000):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { background }
mutation chatExpiry(conversation: conversations, setting: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[chat] { disappearing: setting }
mutation sendOnce(id: id, conversation: conversations, text: text <=500, photo: image <=10000000):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = count(members where .conversation = conversation) - 1
  update conversations[chat] { lastOrdinal: ordinal }
  insert messages { id, conversation, sender: viewer, ordinal, recipients, text, oncePhoto: photo, at: now, expiresAt: now + config.ttl(chat.disappearing) if config.ttl(chat.disappearing) != null else null }
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit push { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Photo' }
  return id
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages where .conversation = conversation and not .tombstone matching q last 20 by .at after c
query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c

view reactionCounts: count reactions by .message, .emoji
fn reactionSummary(message: messages):
  return reactionCounts where .message = message.id by .emoji { emoji, count: .value, mine: exists reactions[message.id, viewer, emoji = .emoji] }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, conversationId: .conversation, senderId: .sender, timestamp: .at, type: 'video' if .video != null else 'photo' if .photo != null or .oncePhoto != null else 'text', text, media: .video if .video != null else .photo if .photo != null else .oncePhoto, viewOnce: .oncePhoto != null, edited: .editedAt != null, tombstone, replyToId: .quote, reactions: reactionSummary(.), receipt: receipt(.) if .sender = viewer else null, ordinal, expiresAt }

view originalPostCounts: count posts where .parent = null by .author
  online only
view receivedLikes: count likes by .post.author
  online only
view receivedReposts: count reposts by .post.author
  online only
view receivedReplies: count posts where .parent != null by .parent.author
  online only
view dailyPosts: count posts where .parent = null by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
query insights():
  days = []
  for i in range(0, 7):
    key = day(now) - (6 - i)
    days = days + [{ at: key * 1d, posts: dailyPosts[viewer, key], likesReceived: dailyLikes[viewer, key] }]
  return { posts: originalPostCounts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days, asOf: now }
query trending(c: cursor ?):
  return posts where .parent = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at after c postCard
fn digestUnread(conversation: conversations, principal: principal, seen: int, start: time, end: time):
  return count(messages where .conversation = conversation and .at >= start and .at < end and not .tombstone and .sender != principal and .ordinal > seen)
job dailyDigest(periodStart: time, periodEnd: time):
  for p in profiles:
    newFollowers = count(follows where .followed = p.principal and .at >= periodStart and .at < periodEnd)
    newPosts = count(posts where .author = p.principal and .parent = null and not .removed and .at >= periodStart and .at < periodEnd)
    for edge in follows where .follower = p.principal:
      newPosts = newPosts + count(posts where .author = edge.followed and .parent = null and not .removed and .at >= periodStart and .at < periodEnd)
    unreadMessages = 0
    unreadChats = 0
    for member in members where .principal = p.principal:
      n = digestUnread(member.conversation, p.principal, member.seenOrdinal, periodStart, periodEnd)
      if n > 0:
        unreadMessages = unreadMessages + n
        unreadChats = unreadChats + 1
    if newFollowers > 0 or newPosts > 0 or unreadMessages > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages, unreadChats } once [p.principal, periodEnd]

fn reactionRows(message: messages):
  return reactions where .message = message.id
