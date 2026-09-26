use identity password
effect notify

table profiles:
  principal: principal
  handle: text 3..20 format handle
  displayName: text 1..50
  bio: text <=200
  location: text <=50
  link: text format url ?
  avatar: image <=10000000 ?
  unique principal
  search displayName, handle
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  public 'Registered profiles are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public
query myProfile():
  return profiles[principal = viewer]
query profile(handle: text):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(handle: text 3..20 format handle, displayName: text 1..50, bio: text <=200, location: text <=50, link: text format url ?):
  upsert profiles[principal = viewer] { principal: viewer, handle, displayName, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  body: text <=500
  images: [image <=10000000] <=4 ?
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable author, parent, at
  public 'Public posts and replies'
  insert <- .author = viewer
  update <- .author = viewer
  sync public last 1000 by .at
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public
table reposts:
  post: posts
  actor: principal
  at: time
  unique actor, post
  immutable actor, post, at
  public
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at
table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public
  insert <- .follower = viewer
  delete <- .follower = viewer
  sync public
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
view followerCounts: count follows by .followed
view followingCounts: count follows by .follower
view repostCounts: count reposts by .post
view replyCounts: count posts by .parent
fn postImages(p: posts):
  photos = []
  if p.photo1 != null:
    photos = photos + [p.photo1]
  if p.photo2 != null:
    photos = photos + [p.photo2]
  if p.photo3 != null:
    photos = photos + [p.photo3]
  if p.photo4 != null:
    photos = photos + [p.photo4]
  return photos
shape postCard = { *, images: postImages(.), authorProfile: profiles[principal = .author], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id], repostCount: repostCounts[.id], replyCount: replyCounts[.id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query post(postId: posts):
  return posts[postId] postCard
query replies(postId: posts, c: cursor ?):
  return posts where .parent = postId first 20 by .at after c postCard
query socialProfile(handle: text):
  p = profiles[handle = handle] ! else NOT_FOUND
  return { profile: p, followers: followerCounts[p.principal], following: followingCounts[p.principal], followed: exists follows[viewer, p.principal] }
mutation createPost(postId: id, body: text <=500, images: [image <=10000000] <=4 ?, video: video <=50000000 ?, parent: posts ?):
  require images = null or video = null else MIXED_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id: postId, author: viewer, body, photo1: at(images ?? [], 0), photo2: at(images ?? [], 1), photo3: at(images ?? [], 2), photo4: at(images ?? [], 3), video, parent, at: now }
mutation setFollow(target: principal, active: bool):
  require target != viewer else SELF_FOLLOW
  require exists profiles[principal = target] else PROFILE_NOT_FOUND
  if active:
    insert follows { follower: viewer, followed: target, at: now } if absent
  else if exists follows[viewer, target]:
    delete follows[viewer, target]
mutation setLike(postId: posts, active: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if active:
    insert likes { post: postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, active: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if active:
    insert reposts { post: postId, actor: viewer, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]

mutation repairPostImages(postId: posts, images: [image <=10000000] <=4):
  update posts[postId] { photo1: at(images, 0), photo2: at(images, 1), photo3: at(images, 2), photo4: at(images, 3) }

table chats:
  kind: enum('dm', 'group')
  title: text 1..50
  description: text <=200
  creator: principal
  color: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  lastOrdinal: int default 0
  at: time
  immutable kind, creator, at
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[chat = .id, principal = .creator]
  sync to members[.id]
table dmPairs:
  low: principal
  high: principal
  chat: chats
  unique low, high
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  online only
table members:
  chat: chats
  principal: principal
  role: enum('admin', 'member')
  readUpTo: int default 0
  unique chat, principal
  cap 50 by chat
  immutable chat, principal
  read <- exists members[.chat, viewer]
  insert <- created chats[.chat] or exists members[.chat, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.chat, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.chat, viewer, role = 'admin']
  sync to members[.chat]
table messages:
  chat: chats
  sender: principal
  ordinal: int
  body: text <=2000
  photo: image <=10000000 ?
  video: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  search body
  expire at .expiresAt
  edited: bool default false
  deleted: bool default false
  quote: messages ?
  at: time
  immutable chat, sender, ordinal, at, expiresAt
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  update <- .sender = viewer
  retain delivered-history
  sync to members[.chat] last 500 by .ordinal
table deliveries:
  message: messages
  principal: principal
  memberId: id ?
  delivered: bool default false
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- created messages[.message]
  update <- .principal = viewer
  sync
table typing:
  chat: chats
  principal: principal
  unique chat, principal
  cap 50 by chat
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer and exists members[.chat, viewer]
  ephemeral 4s
view unread: count messages by members m where .chat = m.chat and .ordinal > m.readUpTo and .sender != m.principal and not .deleted
fn receipt(m: messages):
  state = 'read'
  for d in deliveries where .message = m.id:
    member = members[d.memberId]
    if member != null:
      if not d.delivered:
        return 'sent'
      if member.readUpTo < m.ordinal:
        state = 'delivered'
  return state
shape messageCard = { *, type: 'video' if .video != null else 'image' if .photo != null or .oncePhoto != null else 'text', senderProfile: profiles[principal = .sender], quoted: messages[.quote], reactions: reactionSummary(.), receipt: receipt(.), myDelivered: deliveries[.id, viewer].delivered }
query inbox(c: cursor ?):
  return members where .principal = viewer first 100 by .chat after c { *, room: chats[.chat], roster: members[chat = .chat] { *, profile: profiles[principal = .principal] }, unread: unread[.id] }
query room(chat: chats):
  return { room: chats[chat], roster: members where .chat = chat { *, profile: profiles[principal = .principal] } }
query findGroup(title: text):
  return first(chats where .kind = 'group' and .title = title first 1 by .at)
query history(chat: chats, c: cursor ?):
  return messages where .chat = chat last 20 by .ordinal after c messageCard
query typingIn(chat: chats):
  return typing where .chat = chat and .principal != viewer { principal }
query typingAll(c: cursor ?):
  return members where .principal = viewer first 100 by .chat after c { chat, typing: typing[chat = .chat] where .principal != viewer }
mutation setTyping(chat: chats):
  upsert typing[chat, viewer] {}
mutation createDM(chatId: id, target: principal):
  require target != viewer else SELF_DM
  require exists profiles[principal = target] else PROFILE_NOT_FOUND
  (low, high) = sorted(viewer, target)
  existing = dmPairs[low, high]
  if existing != null:
    return existing.chat
  c = insert chats { id: chatId, kind: 'dm', title: 'Direct message', description: '', creator: viewer, at: now }
  insert members { chat: c.id, principal: viewer, role: 'admin' }
  insert members { chat: c.id, principal: target, role: 'member' }
  insert dmPairs { low, high, chat: c.id }
  return c.id
mutation createGroup(chatId: id, target: principal, title: text 1..50, description: text <=200):
  require target != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = target] else PROFILE_NOT_FOUND
  c = insert chats { id: chatId, kind: 'group', title, description, creator: viewer, at: now }
  insert members { chat: c.id, principal: viewer, role: 'admin' }
  insert members { chat: c.id, principal: target, role: 'member' }
  return c.id
mutation addMember(chat: chats, target: principal):
  require exists members[chat, viewer, role = 'admin'] else NOT_ADMIN
  require (chats[chat] ! else NOT_FOUND).kind = 'group' else NOT_GROUP
  require exists profiles[principal = target] else PROFILE_NOT_FOUND
  insert members { chat, principal: target, role: 'member' } if absent
mutation changeMember(chat: chats, target: principal, promote: bool):
  require exists members[chat, viewer, role = 'admin'] else NOT_ADMIN
  require (chats[chat] ! else NOT_FOUND).kind = 'group' else NOT_GROUP
  if promote:
    update members[chat, target] { role: 'admin' }
  else:
    delete members[chat, target]
mutation leaveChat(chat: chats):
  delete members[chat, viewer]
mutation send(messageId: id, chat: chats, body: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  c = chats[chat] ! else NOT_MEMBER
  if quote != null:
    require (messages[quote] ! else QUOTE_NOT_FOUND).chat = chat else WRONG_CHAT
  require oncePhoto = null or (photo = null and video = null) else MIXED_MEDIA
  require photo = null or video = null else MIXED_MEDIA
  if photo != null or video != null or oncePhoto != null:
    require count(body) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  ordinal = c.lastOrdinal + 1
  update chats[chat] { lastOrdinal: ordinal }
  ttl = windows.ttl(c.disappearing)
  m = insert messages { id: messageId, chat, sender: viewer, ordinal, body, quote, photo, video, oncePhoto, expiresAt: now + ttl if ttl != null else null, at: now }
  for member in members where .chat = chat:
    if member.principal != viewer:
      insert deliveries { message: m.id, principal: member.principal, memberId: member.id }
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: chat, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Video' if video != null else 'Photo' if photo != null or oncePhoto != null else slice(body, 0, 80) }
  return m.id
mutation acknowledge(ids: [messages] <=100):
  for id in ids:
    d = deliveries[id, viewer]
    if d != null and not d.delivered:
      update deliveries[id, viewer] { delivered: true }
mutation markRead(chat: chats, through: int):
  c = chats[chat] ! else NOT_MEMBER
  require through <= c.lastOrdinal else PAST_LAST_MESSAGE
  m = members[chat, viewer] ! else NOT_MEMBER
  if through > m.readUpTo:
    update members[m] { readUpTo: through }
query dmFor(target: principal):
  (low, high) = sorted(viewer, target)
  return dmPairs[low, high]
query localHistory(chat: chats, c: cursor ?):
  return messages where .chat = chat last 20 by .ordinal after c { *, senderProfile: profiles[principal = .sender], quoted: messages[.quote] }

job backfillRecipientMembers():
  for d in deliveries:
    if d.memberId = null:
      message = messages[d.message]
      m = members[chat = message.chat, principal = d.principal]
      if m != null:
        update deliveries[d] { memberId: m.id }

table messageReactions:
  message: messages
  principal: principal
  emoji: text <=32
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync
fn reactionSummary(m: messages):
  rows = messageReactions where .message = m.id
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: exists messageReactions[message = m.id, principal = viewer, emoji = .key] }
mutation react(message: messages, emoji: text <=32 ?):
  m = messages[message] ! else NOT_FOUND
  require not m.deleted else DELETED
  if emoji != null:
    upsert messageReactions[message, viewer] { emoji }
  else if exists messageReactions[message, viewer]:
    delete messageReactions[message, viewer]
mutation editMessage(message: messages, body: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.deleted and now - m.at <= windows.editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.video != null or m.oncePhoto != null:
    require count(body) <= 500 else CAPTION_TOO_LONG
  update messages[message] { body, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= windows.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[message] { body: '', photo: null, video: null, oncePhoto: null, deleted: true }

mutation configureChat(chat: chats, title: text 1..50 ?, description: text <=200 ?, color: text ?, disappearing: enum('off', '24h', '7d') ?):
  c = chats[chat] ! else NOT_MEMBER
  require exists members[chat, viewer] else NOT_MEMBER
  if title != null or description != null or disappearing != null:
    require c.kind = 'dm' or exists members[chat, viewer, role = 'admin'] else NOT_ADMIN
  if title != null:
    require c.kind = 'group' else NOT_GROUP
    update chats[chat] { title }
  if description != null:
    require c.kind = 'group' else NOT_GROUP
    update chats[chat] { description }
  if color != null:
    require color in ['#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569'] else BAD_COLOR
    update chats[chat] { color }
  if disappearing != null:
    update chats[chat] { disappearing }
mutation placeBackground(chat: chats, background: image <=10000000 ?):
  require exists members[chat, viewer] else NOT_MEMBER
  update chats[chat] { background }
query searchChat(chat: chats, q: text <=100, c: cursor ?):
  require exists members[chat, viewer] else NOT_MEMBER
  return messages[chat = chat] matching q last 20 by .at after c
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] first 20 by .chat after c where exists (messages[chat = .chat] by .at matching q) { chat, title: chats[.chat].title, hits: messages[chat = .chat] matching q last 20 by .at }
query message(message: messages):
  return messages[message]

view originalTotals: count posts where .parent = null by .author
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
  for d in [day(now) - 6, day(now) - 5, day(now) - 4, day(now) - 3, day(now) - 2, day(now) - 1, day(now)]:
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { posts: originalTotals[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending():
  return posts where .parent = null and not .removed and .at > now - 1d and .at <= now last 10 by .likeCount, .at postCard
fn unreadIn(chat: chats, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .chat = chat and .at >= periodStart and .at < periodEnd and not .deleted and .sender != reader and .ordinal > readOrdinal)
job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadMessages = 0
    unreadChats = 0
    newPostsInFollowing = 0
    for m in members where .principal = p.principal:
      n = unreadIn(m.chat, p.principal, m.readUpTo, periodStart, periodEnd)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    for f in follows where .follower = p.principal:
      newPostsInFollowing = newPostsInFollowing + count(posts where .author = f.followed and .parent = null and not .removed and .at >= periodStart and .at < periodEnd)
    newFollowers = count(follows where .followed = p.principal and .at >= periodStart and .at < periodEnd)
    if newFollowers + newPostsInFollowing + unreadMessages > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
