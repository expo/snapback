use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Registered profiles are discoverable by all accounts.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id
query myProfile():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2048 format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  authorId: principal
  parentId: posts ?
  text: text <=500
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  immutable authorId, parentId, at
  public 'Public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'Public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table reposts:
  postId: posts
  actorId: principal
  at: time
  unique actorId, postId
  immutable postId, actorId, at
  public 'Public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'Public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public last 2000 by .at with own keys .followerId

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
view followerCounts: count follows by .followedId
  online only
view followingCounts: count follows by .followerId
  online only
view replyCounts: count posts by .parentId
  online only
shape postCard = { *, author: profiles[principal = .authorId], replies: replyCounts[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query profilePosts(owner: principal, c: cursor ?):
  return posts where .authorId = owner and .parentId = null last 20 by .at after c postCard
query post(id: posts):
  return posts[id] postCard
query replies(parent: posts, c: cursor ?):
  return posts where .parentId = parent first 20 by .at after c postCard
query socialCounts(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
mutation publish(id: id, text: text <=500, parentId: posts ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require video = null or images = null else MIXED_MEDIA
  require text != '' or images != null or video != null else EMPTY_POST
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if images != null:
    require count(images) >= 1 else EMPTY_IMAGES
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  return insert posts { id, authorId: viewer, parentId, text, images, video, at: now }
mutation setLike(postId: posts, set: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if set:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, set: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if set:
    insert reposts { postId, actorId: viewer, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
mutation setFollow(owner: principal, set: bool):
  require owner != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if set:
    insert follows { followerId: viewer, followedId: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50
  description: text <=200
  creatorId: principal
  low: principal ?
  high: principal ?
  color: text <=7 default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  lastOrdinal: int default 0
  unique low, high
  immutable creatorId, kind, low, high
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  role: enum('admin', 'member')
  joinedOrdinal: int
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]
table messages:
  receipts chat by .conversation, .ordinal from .sender to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
    watermarks .deliveredOrdinal, .seenOrdinal
    runs runs
    operations receipt, delivered, seen, receiptMember, progress, compactReceipts
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
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  search text
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversation] last 500 by byConversationOrdinal
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
query direct(other: principal):
  (low, high) = sorted(viewer, other)
  return conversations[low, high]
query conversationScreen(conversation: conversations):
  return conversations[conversation]
view unreadCounts: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal
    and .sender != m.principal and not .tombstone
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], unread: unreadCounts[.id], peers: members[conversation = .conversation] { principal, profile: profiles[principal = .principal] } }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }
query messageAuthor(sender: principal):
  return profiles[principal = sender]
query quotedMessage(id: messages):
  return messages[id]
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal { principal }
query typingInMyRooms(c: cursor ?):
  return members where .principal = viewer first 100 by .conversation after c { conversation, typing: typing[conversation = .conversation] where .principal != viewer { principal } }
mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}
mutation stopTyping(conversation: conversations):
  if exists typing[conversation, viewer]:
    delete typing[conversation, viewer]
mutation createDM(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  (low, high) = sorted(viewer, other)
  existing = conversations[low, high]
  if existing != null:
    return existing.id
  chat = insert conversations { id, kind: 'dm', title: 'Direct message', description: '', creatorId: viewer, low, high }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'admin' }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, others: [principal] <=49):
  require count(others) >= 1 else TOO_FEW_MEMBERS
  chat = insert conversations { id, kind: 'group', title, description, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  for p in others:
    require p != viewer else DUPLICATE_MEMBER
    require exists profiles[principal = p] else PROFILE_NOT_FOUND
    insert members { conversation: chat.id, principal: p, role: 'member' } if absent
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require conversations[conversation].kind = 'group' else NOT_GROUP
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  insert members { conversation, principal, role: 'member' } if absent
mutation removeMember(conversation: conversations, principal: principal):
  require conversations[conversation].kind = 'group' else NOT_GROUP
  require principal = viewer or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation promoteMember(conversation: conversations, principal: principal):
  require conversations[conversation].kind = 'group' else NOT_GROUP
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
mutation send(id: id, conversation: conversations, text: text 1..2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    require messages[quote].conversation = conversation else WRONG_QUOTE
  m = insert messages { id, conversation, sender: viewer, text, quote, at: now, expiresAt: expiry(conversation) }
  notifyMessage(conversation, slice(text, 0, 80))
  return m.id

table reactions:
  message: messages
  principal: principal
  emoji: text 1..64
  unique message, principal
  cap 50 by message
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.message.conversation]
query messageReactions(message: messages):
  return reactions where .message = message { principal, emoji }
mutation react(message: messages, emoji: text 1..64 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  require exists members[m.conversation, viewer] else NOT_MEMBER
  if emoji != null:
    upsert reactions[message, viewer] { emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]
mutation sendMedia(id: id, conversation: conversations, text: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?, once: bool ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require (photo != null and video = null) or (photo = null and video != null) else ONE_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  require not (once ?? false) or photo != null else PHOTO_REQUIRED
  m = insert messages { id, conversation, sender: viewer, text, photo: photo if not (once ?? false) else null, oncePhoto: photo if (once ?? false) else null, video, at: now, expiresAt: expiry(conversation) }
  notifyMessage(conversation, 'Video' if video != null else 'Photo')
  return m.id
mutation editMessage(message: messages, text: text <=2000): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now <= m.at + windows.editWindow() else EDIT_WINDOW_EXPIRED
  require (m.photo = null and m.oncePhoto = null and m.video = null) or count(text) <= 500 else CAPTION_TOO_LONG
  update messages[message] { text, edited: true }
mutation deleteMessage(message: messages): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now <= m.at + windows.deleteWindow() else DELETE_WINDOW_EXPIRED
  update messages[message] { text: '', photo: null, oncePhoto: null, video: null, quote: null, tombstone: true }
fn expiry(conversation: conversations):
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = windows.disappearingTtl(chat.disappearing)
  return now + ttl if ttl != null else null
mutation configureChat(conversation: conversations, title: text 1..50 ?, description: text <=200 ?, color: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') ?, disappearing: enum('off', '24h', '7d') ?):
  chat = conversations[conversation] ! else NOT_FOUND
  require exists members[conversation, viewer] else NOT_MEMBER
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  if title != null or description != null:
    require chat.kind = 'group' else GROUP_ONLY
    update conversations[conversation] { title: title ?? chat.title, description: description ?? chat.description }
  if color != null:
    update conversations[conversation] { color }
  if disappearing != null:
    update conversations[conversation] { disappearing }
mutation chatBackground(conversation: conversations, background: image <=10000000):
  chat = conversations[conversation] ! else NOT_FOUND
  require exists members[conversation, viewer] else NOT_MEMBER
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[conversation] { background }
query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages where .conversation = conversation matching q where not .tombstone last 20 by .at after c


effect notify retry 8 backoff 2s deadline 1d cancellation allow
fn notifyMessage(conversation: conversations, preview: text):
  author = profiles[principal = viewer] ! else PROFILE_NOT_FOUND
  for m in members where .conversation = conversation by .principal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversation, senderDisplayName: author.displayName, preview }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 50 by .ordinal after c { *, receipt: receipt(.) if .sender = viewer else null, reactions: reactionRows(.id) }

fn reactionRows(message: messages):
  return reactions where .message = message { emoji, principal }

view insightPosts: count posts where .parentId = null and not .removed by .authorId
  online only
view insightLikes: count likes by .postId.authorId
  online only
view insightReposts: count reposts by .postId.authorId
  online only
view insightReplies: count posts where .parentId != null by .parentId.authorId
  online only
view dailyPosts: count posts where .parentId = null and not .removed by .authorId, day(.at)
  online only
view dailyLikes: count likes by .postId.authorId, day(.at)
  online only
query insights():
  days = []
  for offset in range(0, 7):
    d = day(now) - 6 + offset
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { at: now, posts: insightPosts[viewer], likesReceived: insightLikes[viewer], repostsReceived: insightReposts[viewer], repliesReceived: insightReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending():
  return posts where .parentId = null and not .removed and .at >= now - 1d and .at <= now last 10 by .likeCount, .at postCard
fn unreadIn(conversation: conversations, reader: principal, seenOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and .ordinal > seenOrdinal and .sender != reader and not .tombstone)
query unreadPreview(periodStart: time, periodEnd: time, c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, unread: unreadIn(.conversation, viewer, .seenOrdinal, periodStart, periodEnd) }
query digestFollowing(periodStart: time, periodEnd: time, c: cursor ?):
  return follows where .followerId = viewer first 100 by .followedId after c { followedId, posts: followingPeriodPosts(.followedId, periodStart, periodEnd) }
job dailyDigest(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadMessages = 0
    unreadChats = 0
    newPostsInFollowing = 0
    newFollowers = 0
    as p.principal:
      newFollowers = count(follows where .followedId = viewer and .at >= periodStart and .at < periodEnd)
      for chat in all(unreadPreview(periodStart, periodEnd, null)):
        if chat.unread > 0:
          unreadChats = unreadChats + 1
          unreadMessages = unreadMessages + chat.unread
      for author in all(digestFollowing(periodStart, periodEnd, null)):
        newPostsInFollowing = newPostsInFollowing + author.posts
    if unreadMessages > 0 or newFollowers > 0 or newPostsInFollowing > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
schedule daily every 120s: dailyDigest

fn followingPeriodPosts(author: principal, periodStart: time, periodEnd: time):
  return count(posts where .authorId = author and .parentId = null and not .removed and .at >= periodStart and .at < periodEnd)
