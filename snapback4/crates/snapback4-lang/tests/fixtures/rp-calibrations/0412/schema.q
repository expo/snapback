use identity password
effect notify retry 8 backoff 2s deadline 1d

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
  public 'Registered accounts are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id

query me():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query profileById(principal: principal):
  return profiles[principal = principal]
query whoAmI():
  return viewer
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  immutable authorId, parentId, at
  public 'Public posts and replies.'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'Public follow graph.'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'Public likes.'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'Public reposts.'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

view replyCounts: count posts by .parentId
  online only
view followerCounts: count follows by .followedId
  online only
view followingCounts: count follows by .followerId
  online only
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
query authorPosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null last 20 by .at after c
query postById(postId: posts):
  return posts[postId]
query replies(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 20 by .at after c
query postState(postId: posts):
  return { liked: exists likes[postId, viewer], reposted: exists reposts[viewer, postId], replies: replyCounts[postId] }
query followState(principal: principal):
  return { following: exists follows[viewer, principal], followers: followerCounts[principal], follows: followingCounts[principal] }
mutation publish(id: id, body: text <=500, images: [image <=10000000] <=4 ?, video: video <=50000000 ?, parentId: posts ?):
  require images = null or video = null else MIXED_MEDIA
  require count(body) > 0 or images != null or video != null else EMPTY_POST
  if images != null:
    require count(images) >= 1 else EMPTY_IMAGES
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else TOO_LONG
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  return insert posts { id, authorId: viewer, parentId, body, images, video, at: now }
mutation setFollow(principal: principal, active: bool):
  require principal != viewer else SELF_FOLLOW
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  if active:
    insert follows { followerId: viewer, followedId: principal, at: now } if absent
  else if exists follows[viewer, principal]:
    delete follows[viewer, principal]
mutation setLike(postId: posts, active: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if active:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, active: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  require p.parentId = null else ORIGINAL_REQUIRED
  if active:
    insert reposts { actorId: viewer, postId, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]

table conversations:
  title: text 1..50
  description: text <=200
  isGroup: bool
  creatorId: principal
  lastOrdinal: int default 0
  accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  immutable creatorId, isGroup
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
  photo: image <=10000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  expire at .expiresAt
  video: video <=50000000 ?
  edited: bool default false
  deleted: bool default false
  quote: messages ?
  at: time
  search text
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, quote, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
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
query directConversation(other: principal):
  return directChats[owner = viewer, peer = other]
query groupByTitle(title: text 1..50):
  return first(conversations where .isGroup and .title = title first 1 by .id)
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], peer: first(directChats[conversation = .conversation] where .owner = viewer first 1 by .id) }
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c
query messageById(message: messages):
  return messages[message]
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .id after c
mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, title: 'Direct message', description: '', isGroup: false, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'admin' }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, other: principal):
  require other != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  chat = insert conversations { id, title, description, isGroup: true, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'member' }
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require conversations[conversation].isGroup = true else GROUP_ONLY
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  insert members { conversation, principal, role: 'member' } if absent
mutation removeMember(conversation: conversations, principal: principal):
  require conversations[conversation].isGroup = true else GROUP_ONLY
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation promoteMember(conversation: conversations, principal: principal):
  require conversations[conversation].isGroup = true else GROUP_ONLY
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update members[conversation, principal] { role: 'admin' }
mutation leave(conversation: conversations):
  delete members[conversation, viewer]
mutation send(id: id, conversation: conversations, text: text 1..2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    require messages[quote].conversation = conversation else WRONG_QUOTE_CHAT
  ttl = config.disappearingTtl(conversations[conversation].disappearing ?? 'off')
  m = insert messages { id, conversation, sender: viewer, text, quote, at: now, expiresAt: now + ttl if ttl != null else null }
  for member in members where .conversation = conversation by .principal:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName ?? 'Someone', preview: slice(text, 0, 80) }
  return m.id

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
  return typing[conversation = conversation] where .principal != viewer by .principal { principal }

mutation sendMedia(id: id, conversation: conversations, caption: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  require (photo != null and video = null) or (photo = null and video != null) else ONE_MEDIA_REQUIRED
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else TOO_LONG
  if quote != null:
    require messages[quote].conversation = conversation else WRONG_QUOTE_CHAT
  ttl = config.disappearingTtl(conversations[conversation].disappearing ?? 'off')
  m = insert messages { id, conversation, sender: viewer, text: caption, photo, video, quote, at: now, expiresAt: now + ttl if ttl != null else null }
  for member in members where .conversation = conversation by .principal:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName ?? 'Someone', preview: 'Video' if video != null else 'Photo' }
  return m.id
mutation editMessage(message: messages, text: text <=2000): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.deleted else DELETED
  require now - m.at <= config.editWindow() else EDIT_WINDOW_CLOSED
  if m.photo != null or m.oncePhoto != null or m.video != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  update messages[message] { text, edited: true }
mutation deleteMessage(message: messages): server
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= config.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[message] { text: '', photo: null, oncePhoto: null, video: null, deleted: true }
table reactions:
  message: messages
  principal: principal
  emoji: text 1..64
  unique message, principal
  immutable message, principal
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.message.conversation]
view reactionCounts: count reactions by .message, .emoji
query reactionSummary(message: messages, c: cursor ?):
  return reactionCounts where .message = message first 50 by .emoji after c { emoji, count: .value }
query ownReaction(message: messages):
  return reactions[message, viewer]
mutation setReaction(message: messages, emoji: text 1..64 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.deleted else DELETED
  require exists members[m.conversation, viewer] else NOT_MEMBER
  if emoji != null:
    upsert reactions[message, viewer] { emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]

mutation sendOnce(id: id, conversation: conversations, caption: text <=500, photo: image <=10000000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    require messages[quote].conversation = conversation else WRONG_QUOTE_CHAT
  ttl = config.disappearingTtl(conversations[conversation].disappearing ?? 'off')
  m = insert messages { id, conversation, sender: viewer, text: caption, oncePhoto: photo, quote, at: now, expiresAt: now + ttl if ttl != null else null }
  for member in members where .conversation = conversation by .principal:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName ?? 'Someone', preview: 'Photo' }
  return m.id
mutation renameChat(conversation: conversations, title: text 1..50, description: text <=200):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversation].isGroup = true else GROUP_ONLY
  update conversations[conversation] { title, description }
mutation setAccent(conversation: conversations, accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569')):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { accent }
mutation setBackground(conversation: conversations, background: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { background }
mutation setDisappearing(conversation: conversations, setting: enum('off', '24h', '7d')):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  update conversations[conversation] { disappearing: setting }
query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .at after c

query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, conversationId: .conversation, senderId: .sender, serverTimestamp: .at, ordinal, type: 'view-once' if .oncePhoto != null else 'image' if .photo != null else 'video' if .video != null else 'text', text, media: .oncePhoto ?? .photo ?? .video, edited, tombstone: .deleted, replyToId: .quote, expiresAt, reactions: reactionCounts[message = .id] first 50 by .emoji { emoji, count: .value }, ownReaction: reactions[.id, viewer].emoji, receipt: receipt(.) }
query followingPeople(principal: principal, c: cursor ?):
  return follows[followerId = principal] first 50 by .followedId after c { followedId }

view originalPostCounts: count posts where .parentId = null by .authorId
  online only
view receivedLikes: count likes by .postId.authorId
  online only
view receivedReposts: count reposts by .postId.authorId
  online only
view receivedReplies: count posts where .parentId != null by .parentId.authorId
  online only
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  online only
view dailyLikes: count likes by .postId.authorId, day(.at)
  online only
query insights():
  today = day(now)
  days = []
  for offset in [6, 5, 4, 3, 2, 1, 0]:
    d = today - offset
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }]
  return { at: now, posts: originalPostCounts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days }
query trending(c: cursor ?):
  return posts where .parentId = null and .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at after c
view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .ordinal > m.joinedOrdinal and .sender != m.principal and not .deleted
query unreadCount(member: members):
  return unread[member]
query digestMemberships(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, seenOrdinal, joinedOrdinal }
query digestUnread(conversation: conversations, seen: int, joined: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and .ordinal > seen and .ordinal > joined and .sender != viewer and not .deleted)
query digestFollowers(periodStart: time, periodEnd: time):
  return count(follows where .followedId = viewer and .at >= periodStart and .at < periodEnd)
query digestFollowing(periodStart: time, periodEnd: time):
  return count(posts where .parentId = null and not .removed and .at >= periodStart and .at < periodEnd and (.authorId = viewer or exists follows[viewer, .authorId]))
job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadMessages = 0
    unreadChats = 0
    newFollowers = 0
    newPostsInFollowing = 0
    as p.principal:
      newFollowers = digestFollowers(periodStart, periodEnd).data
      newPostsInFollowing = digestFollowing(periodStart, periodEnd).data
      for chat in all(digestMemberships(null)):
        total = digestUnread(chat.conversation, chat.seenOrdinal, chat.joinedOrdinal, periodStart, periodEnd).data
        if total > 0:
          unreadMessages = unreadMessages + total
          unreadChats = unreadChats + 1
    if newFollowers > 0 or newPostsInFollowing > 0 or unreadMessages > 0 or unreadChats > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats } once [p.principal, periodEnd]
