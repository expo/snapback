use identity password
effect notify

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Registered profiles are discoverable by all accounts'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 1200 by .id
query myProfile():
  return profiles[principal = viewer]
query profile(handle: text):
  return profiles[handle = handle]
query profileByPrincipal(principal: principal):
  return profiles[principal = principal]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  text: text <=500
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  replyCount: count posts by parent
  immutable author, parent, at
  public 'Posts are discoverable'
  insert <- .author = viewer
  update <- .author = viewer
  sync public last 1000 by .at

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'Public post likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at

table reposts:
  post: posts
  actor: principal
  at: time
  unique actor, post
  immutable actor, post, at
  public 'Public reposts'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at

table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public 'Public follows'
  insert <- .follower = viewer
  delete <- .follower = viewer
  online only

view followerCounts: count follows by .followed
  online only
view followingCounts: count follows by .follower
  online only
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post: .post, actor: .actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

view ownLikes: count likes by .principal, .post
view ownReposts: count reposts by .actor, .post

shape postCard = { *, authorProfile: profiles[principal = .author], liked: ownLikes[viewer, .id] > 0, reposted: ownReposts[viewer, .id] > 0 }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query post(id: posts):
  return posts[id] postCard
query replies(parent: posts, c: cursor ?):
  return posts where .parent = parent first 20 by .at after c postCard
query social(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
query postState(post: posts):
  return { liked: ownLikes[viewer, post] > 0, reposted: ownReposts[viewer, post] > 0 }
mutation publish(id: id, text: text <=500, parent: posts ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require images = null or video = null else MIXED_MEDIA
  if video != null:
    require video.duration != null else VIDEO_DURATION
    require video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, text, parent, images, video, at: now } if absent
mutation setFollow(owner: principal, active: bool):
  require owner != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if active:
    insert follows { follower: viewer, followed: owner, at: now } if absent
  else:
    delete follows[viewer, owner]
mutation setLike(post: posts, active: bool):
  require exists posts[post] else POST_NOT_FOUND
  if active:
    insert likes { post, principal: viewer, at: now } if absent
  else:
    delete likes[post, viewer]
mutation setRepost(post: posts, active: bool):
  require exists posts[post] else POST_NOT_FOUND
  if active:
    insert reposts { post, actor: viewer, at: now } if absent
  else:
    delete reposts[viewer, post]

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50
  description: text <=200
  color: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  lastOrdinal: int default 0
  creator: principal
  immutable creator, kind
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
table dms:
  low: principal
  high: principal
  conversation: conversations
  unique low, high
  immutable low, high, conversation
  read <- exists members[.conversation, viewer]
  insert <- (.low = viewer or .high = viewer) and created conversations[.conversation]
  sync to members[.conversation]
table messages:
  conversation: conversations
  sender: principal
  ordinal: int
  recipients: int
  text: text <=2000
  quote: messages ?
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  video: video <=50000000 ?
  edited: bool default false
  tombstone: bool default false
  at: time
  unique byOrdinal: conversation, ordinal
  by byHistory: conversation, ordinal, id
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  search text
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  expire at .expiresAt
  retain delivered-history
  sync to members[.conversation] last 500 by byHistory
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
table typing:
  conversation: conversations
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  ephemeral 3s
view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .sender != m.principal and not .tombstone

mutation createDM(id: id, other: principal):
  require other != viewer else CANNOT_MESSAGE_SELF
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  (low, high) = sorted(viewer, other)
  prior = dms[low, high]
  if prior != null:
    return prior.conversation
  chat = insert conversations { id, kind: 'dm', title: 'Direct message', description: '', creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  insert dms { low, high, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, other: principal, title: text 1..50, description: text <=200):
  require other != viewer else NEED_SECOND_MEMBER
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  chat = insert conversations { id, kind: 'group', title, description, creator: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedOrdinal: 0 }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedOrdinal: 0 }
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  require chat.kind = 'group' else NOT_GROUP
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  insert members { conversation, principal, role: 'member', joinedOrdinal: chat.lastOrdinal } if absent
mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
mutation removeMember(conversation: conversations, principal: principal):
  require principal = viewer or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  for run in runs where .conversation = conversation and .principal = principal:
    delete runs[run]
  delete members[conversation, principal]
mutation send(id: id, conversation: conversations, text: text 1..2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    q = messages[quote] ! else QUOTE_NOT_FOUND
    require q.conversation = conversation else WRONG_CHAT
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = count(members[conversation = conversation] where .principal != viewer)
  update conversations[conversation] { lastOrdinal: ordinal }
  m = insert messages { id, conversation, ordinal, sender: viewer, recipients, text, quote, at: now, expiresAt: expiry(chat) }
  notifyRecipients(m, slice(text, 0, 80))
  return m.id
mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}
mutation stopTyping(conversation: conversations):
  delete typing[conversation, viewer]
query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation] }
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query groupNamed(title: text):
  return conversations where .kind = 'group' and .title = title first 1 by .id
query dmFor(other: principal):
  (low, high) = sorted(viewer, other)
  return dms[low, high]
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query unreadFor(conversation: conversations):
  member = members[conversation, viewer] ! else NOT_MEMBER
  return unread[member.id]
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byHistory after c
query message(id: messages):
  return messages[id]
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
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] last 20 by byHistory after c { id, receipt: receipt(.) }
query progress(conversation: conversations, c: cursor ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  prefix = max(me.deliveredOrdinal, me.joinedOrdinal)
  return { member: me, runs: runs where .conversation = conversation and .principal = viewer, ahead: messages[conversation = conversation] where .ordinal > prefix first 100 by byOrdinal after c }
mutation delivered(conversation: conversations, from: int, through: int): server
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
    blocker = first(messages[conversation = conversation] where .ordinal > prefix and .ordinal < low first 1 by byOrdinal)
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
mutation seen(conversation: conversations, through: int):
  me = members[conversation, viewer] ! else NOT_MEMBER
  anchor = messages[conversation = conversation, ordinal = through] ! else NOT_FOUND
  if through > me.seenOrdinal:
    update members[me] { seenOrdinal: through }

table reactions:
  message: messages
  conversation: conversations
  principal: principal
  emoji: text 1..32
  unique message, principal
  cap 50 by message
  immutable message, conversation, principal
  read through .message
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer
  sync
query messageReactions(message: messages):
  return reactions[message = message] by .principal
mutation react(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  require exists members[m.conversation, viewer] else NOT_MEMBER
  if emoji = null:
    delete reactions[message, viewer]
  else:
    prior = reactions[message, viewer]
    if prior != null:
      update reactions[prior] { emoji }
    else:
      insert reactions { message, principal: viewer, conversation: m.conversation, emoji }
mutation sendMedia(id: id, conversation: conversations, text: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require (photo != null and video = null and oncePhoto = null) or (photo = null and video != null and oncePhoto = null) or (photo = null and video = null and oncePhoto != null) else MEDIA_REQUIRED
  if video != null:
    require video.duration != null else VIDEO_DURATION
    require video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  recipients = count(members[conversation = conversation] where .principal != viewer)
  update conversations[conversation] { lastOrdinal: ordinal }
  m = insert messages { id, conversation, ordinal, sender: viewer, recipients, text, photo, video, oncePhoto, at: now, expiresAt: expiry(chat) }
  notifyRecipients(m, 'Video' if video != null else 'Photo')
  return m
mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now <= m.at + 60000 else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  update messages[m] { text, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now <= m.at + 120000 else DELETE_WINDOW_CLOSED
  update messages[m] { text: '', photo: null, video: null, oncePhoto: null, quote: null, tombstone: true }



fn expiry(chat: conversations):
  if chat.disappearing = '24h':
    return now + 180000
  if chat.disappearing = '7d':
    return now + 300000
  return null
mutation configureChat(conversation: conversations, title: text 1..50 ?, description: text <=200 ?, color: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') ?, disappearing: enum('off', '24h', '7d') ?):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  require chat.kind = 'dm' or me.role = 'admin' else NOT_ADMIN
  if title != null:
    require chat.kind = 'group' else GROUP_ONLY
    update conversations[chat] { title }
  if description != null:
    require chat.kind = 'group' else GROUP_ONLY
    update conversations[chat] { description }
  if color != null:
    update conversations[chat] { color }
  if disappearing != null:
    update conversations[chat] { disappearing }
mutation placeBackground(conversation: conversations, background: image <=10000000):
  me = members[conversation, viewer] ! else NOT_MEMBER
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  require chat.kind = 'dm' or me.role = 'admin' else NOT_ADMIN
  update conversations[chat] { background }
query searchIn(conversation: conversations, q: text <=100, c: cursor ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  return messages[conversation = conversation] matching q where not .tombstone last 20 by .at after c
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q where not .tombstone last 20 by .at after c
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.conversation, viewer] and not .tombstone last 20 by .at after c
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] first 20 by .conversation after c where exists (messages[conversation = .conversation] matching q where not .tombstone by .at) { conversation, hits: messages[conversation = .conversation] matching q where not .tombstone last 3 by .at }
query searchInHeld(conversation: conversations, q: text <=100, c: cursor ?) held:
  return messages[conversation = conversation] matching q where not .tombstone last 20 by .at after c

fn notifyRecipients(message: messages, preview: text):
  for member in members[conversation = message.conversation] by .principal:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: message.conversation, senderDisplayName: profiles[principal = viewer].displayName, preview } once [message.id, member.principal]
  return
fn apiReaction(m: messages):
  rows = reactions[message = m.id] by .principal
  own = reactions[m.id, viewer].emoji
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: own = .key }
shape messageObject = { *, type: 'video' if .video != null else 'view-once' if .oncePhoto != null else 'image' if .photo != null else 'text', media: .video ?? .oncePhoto ?? .photo, reactions: apiReaction(.), receipt: receipt(.) if .sender = viewer else null }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] last 20 by byHistory after c messageObject
query auditMessages(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] first 200 by byHistory after c { *, reactions: reactions[message = .id] by .principal }
query auditPosts(c: cursor ?):
  return posts first 200 by .id after c
query auditLikes(c: cursor ?):
  return likes first 200 by .id after c
query auditReposts(c: cursor ?):
  return reposts first 200 by .id after c
query auditFollows(c: cursor ?):
  return follows first 200 by .id after c
query auditProfiles(c: cursor ?):
  return profiles first 200 by .id after c
query postBase(id: posts):
  return posts[id]

view insightPosts: count posts where .parent = null and not .removed by .author
  online only
view insightLikes: count likes by .post.author
  online only
view insightReposts: count reposts by .post.author
  online only
view insightReplies: count posts where .parent != null and not .removed by .parent.author
  online only
view insightDays: count posts where .parent = null and not .removed by .author, day(.at)
  online only
view insightLikeDays: count likes by .post.author, day(.at)
  online only
query insights():
  days = []
  today = day(now)
  for offset in range(0, 7):
    d = today - 6 + offset
    days = days + [{ day: d, posts: insightDays[viewer, d], likesReceived: insightLikeDays[viewer, d] }]
  return { at: now, posts: insightPosts[viewer], likesReceived: insightLikes[viewer], repostsReceived: insightReposts[viewer], repliesReceived: insightReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending():
  return posts where .parent = null and not .removed and .at >= now - 1d and .at <= now last 10 by .likeCount, .at postCard
query serverTime():
  return now

view digestPosts: count posts where .parent = null and not .removed by .author, bucket(.at, 120s)
  online only
view digestFollowers: count follows by .followed, bucket(.at, 120s)
  online only
fn unreadDuring(conversation: conversations, reader: principal, seen: int, periodStart: time, periodEnd: time):
  return count(messages[conversation = conversation] where .at >= periodStart and .at < periodEnd and .sender != reader and .ordinal > seen and not .tombstone)
fn digestCounts(reader: principal, periodStart: time, periodEnd: time):
  period = bucket(periodStart, 120s)
  newPostsInFollowing = digestPosts[reader, period]
  for edge in follows[follower = reader]:
    newPostsInFollowing = newPostsInFollowing + digestPosts[edge.followed, period]
  unreadMessages = 0
  unreadChats = 0
  for member in members[principal = reader]:
    unread = unreadDuring(member.conversation, reader, member.seenOrdinal, periodStart, periodEnd)
    if unread > 0:
      unreadMessages = unreadMessages + unread
      unreadChats = unreadChats + 1
  return { newFollowers: digestFollowers[reader, period], newPostsInFollowing, unreadMessages, unreadChats }
job digest(periodStart: time, periodEnd: time):
  for profile in profiles:
    totals = digestCounts(profile.principal, periodStart, periodEnd)
    if totals.newFollowers > 0 or totals.newPostsInFollowing > 0 or totals.unreadMessages > 0:
      emit notify { targetUserId: profile.principal, kind: 'digest', periodStart, periodEnd, ...totals } once [profile.principal, periodEnd]
schedule dailyDigest every 120s: digest
query liveMessage(id: messages):
  message = messages[id] ! else MESSAGE_NOT_FOUND
  require exists members[message.conversation, viewer] else NOT_MEMBER
  return message
