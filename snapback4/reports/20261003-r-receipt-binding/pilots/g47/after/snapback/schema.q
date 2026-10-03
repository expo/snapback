-- Clique: accounts, profiles, follow graph, posts, messaging, search,
-- insights, digest and the push seam. Windows match config/windows.json
-- (shortened grading). Digest period matches config/digest.json (every 2m).

use identity password
use server
effect notify

-- Shortened grading windows from config/windows.json (milliseconds).
fn editWindowMs(): 60000
fn deleteWindowMs(): 120000
fn disappearTtlMs(setting: enum('off', '24h', '7d')):
  return null if setting = 'off' else 180000 if setting = '24h' else 300000

fn previewText(text: text <=2000 ?, hasPhoto: bool, hasVideo: bool):
  return 'Photo' if hasPhoto else 'Video' if hasVideo else slice(text ?? '', 0, 80)

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=2048 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by .handle

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query myProfile():
  return profiles[principal = viewer]

query profileByHandle(handle: text 3..20 format handle):
  return profiles[handle = handle]

query profileByPrincipal(owner: principal):
  return profiles[principal = owner]

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .handle

query everyone(c: cursor ?):
  return profiles first 50 by .handle after c

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=2048 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
  return null

mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }
  return null

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'public follow edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

mutation setFollow(target: principal, following: bool):
  require target != viewer else CANNOT_FOLLOW_SELF
  if following:
    insert follows { followerId: viewer, followedId: target, at: now } if absent
  else if exists follows[viewer, target]:
    delete follows[viewer, target]
  return null

query isFollowing(target: principal):
  return exists follows[viewer, target]

query myFollows(c: cursor ?):
  return follows where .followerId = viewer first 1000 by .followedId after c { followedId }

query followerCount(owner: principal):
  return followerTotals[owner]

query followingCount(owner: principal):
  return followingTotals[owner]

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500 ?
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable authorId, parentId, at
  public 'public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }

view following: activity where .actor = viewer or exists follows[viewer, .actor]

view originalPostCounts: count posts where .parentId = null and not .removed by .authorId
  read <- allow
  online only

view likesReceived: count likes by .postId.authorId
  read <- allow
  online only

view repostsReceived: count reposts by .postId.authorId
  read <- allow
  online only

view repliesReceived: count posts where .parentId != null by .parentId.authorId
  read <- allow
  online only

view followerTotals: count follows by .followedId
  read <- allow
  online only

view followingTotals: count follows by .followerId
  read <- allow
  online only

view dailyPosts: count posts where .parentId = null and not .removed by .authorId, day(.at)
  read <- allow
  online only

view dailyLikesReceived: count likes by .postId.authorId, day(.at)
  read <- allow
  online only

view replyCounts: count posts where .parentId != null by .parentId
  read <- allow
  online only

view repostCounts: count reposts by .postId
  read <- allow
  online only

query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], actorProfile: profiles[principal = .actor], replies: replyCounts[.post], repostTotal: repostCounts[.post], liked: exists likes[.post, viewer], reposted: exists reposts[viewer, .post] }

query globalFeed(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], actorProfile: profiles[principal = .actor], replies: replyCounts[.post], repostTotal: repostCounts[.post], liked: exists likes[.post, viewer], reposted: exists reposts[viewer, .post] }

query trending(c: cursor ?):
  return posts where .at > now - 1d and .at <= now and not .removed and .parentId = null last 10 by .likeCount, .at after c

query authorPosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null and not .removed last 20 by .at after c

query postById(postId: posts):
  return posts[postId]

query threadReplies(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 50 by .at after c

query likedByMe(postId: posts):
  return exists likes[postId, viewer]

query repostedByMe(postId: posts):
  return exists reposts[viewer, postId]

mutation createPost(postId: id, body: text <=500):
  return insert posts { id: postId, authorId: viewer, body, at: now }

mutation createImagePost(postId: id, body: text <=500 ?, images: [image <=10000000] <=4):
  require count(images) >= 1 else NEED_IMAGES
  return insert posts { id: postId, authorId: viewer, body, images, at: now }

mutation createVideoPost(postId: id, body: text <=500 ?, video: video <=50000000):
  duration = video.duration
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else VIDEO_TOO_LONG
  return insert posts { id: postId, authorId: viewer, body, video, at: now }

mutation replyToPost(replyId: id, parentId: posts, body: text <=500):
  parent = posts[parentId] ! else POST_NOT_FOUND
  require parent.parentId = null else REPLY_TO_REPLY
  return insert posts { id: replyId, authorId: viewer, parentId, body, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if liked:
    require not p.removed else POST_REMOVED
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
  return null

mutation setRepost(postId: posts, reposted: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if reposted:
    require not p.removed else POST_REMOVED
    require p.parentId = null else CANNOT_REPOST_REPLY
    insert reposts { actorId: viewer, postId, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
  return null

query insights():
  return {
    posts: originalPostCounts[viewer],
    likesReceived: likesReceived[viewer],
    repostsReceived: repostsReceived[viewer],
    repliesReceived: repliesReceived[viewer],
    followers: followerTotals[viewer],
    following: followingTotals[viewer],
    d0Posts: dailyPosts[viewer, day(now)],
    d1Posts: dailyPosts[viewer, day(now - 1d)],
    d2Posts: dailyPosts[viewer, day(now - 2d)],
    d3Posts: dailyPosts[viewer, day(now - 3d)],
    d4Posts: dailyPosts[viewer, day(now - 4d)],
    d5Posts: dailyPosts[viewer, day(now - 5d)],
    d6Posts: dailyPosts[viewer, day(now - 6d)],
    d0Likes: dailyLikesReceived[viewer, day(now)],
    d1Likes: dailyLikesReceived[viewer, day(now - 1d)],
    d2Likes: dailyLikesReceived[viewer, day(now - 2d)],
    d3Likes: dailyLikesReceived[viewer, day(now - 3d)],
    d4Likes: dailyLikesReceived[viewer, day(now - 4d)],
    d5Likes: dailyLikesReceived[viewer, day(now - 5d)],
    d6Likes: dailyLikesReceived[viewer, day(now - 6d)]
  }

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  lastOrdinal: int default 0
  disappearing: enum('off', '24h', '7d') default 'off'
  accent: text <=16 ?
  background: image <=10000000 ?
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
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]

table dmIndex:
  owner: principal
  peer: principal
  conversation: conversations
  unique owner, peer
  unique conversation, owner
  immutable owner, peer, conversation
  read <- .owner = viewer
  insert <- created conversations[.conversation] or .owner = viewer
  delete <- .owner = viewer
  online only

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
  text: text <=2000 ?
  photo: image <=10000000 ?
  viewOncePhoto: image <=10000000 once ?
  video: video <=50000000 ?
  quote: messages ?
  editedAt: time ?
  tombstone: bool default false
  expiresAt: time ?
  at: time
  search text
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

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }

query groupNamed(title: text 1..50, c: cursor ?):
  return conversations where .kind = 'group' and .title = title first 5 by .id after c

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 50 by .ordinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 50 by .ordinal after c { id, receipt: receipt(.) }

query membersOf(conversation: conversations):
  return members where .conversation = conversation first 50 by .principal { *, profile: profiles[principal = .principal] }

query dmWith(peer: principal):
  return dmIndex[owner = viewer, peer = peer]

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query messageReactions(message: messages):
  return reactions where .message = message first 32 by .principal

query myReaction(message: messages):
  return reactions[message, viewer]

query searchInChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages where .conversation = conversation and not .tombstone matching q last 20 by .at after c

query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .conversation where exists (messages[conversation = .conversation] where not .tombstone matching q) { conversation, chat: conversations[.conversation], hits: messages[conversation = .conversation] where not .tombstone matching q last 3 by .at }

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages where not .tombstone matching q last 20 by .at after c

query typingIn(conversation: conversations):
  return typing where .conversation = conversation and .principal != viewer by .principal { principal }

query typingInMyRooms(c: cursor ?):
  return members where .principal = viewer first 100 by .conversation after c { conversation, typing: typing[conversation = .conversation] where .principal != viewer { principal } }

mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] {}

mutation stopTyping(conversation: conversations):
  delete typing[conversation, viewer]

mutation createDm(conversationId: id, other: principal):
  require other != viewer else CANNOT_DM_SELF
  existing = dmIndex[owner = viewer, peer = other]
  if existing != null:
    return existing.conversation
  chat = insert conversations { id: conversationId, kind: 'dm', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'member' }
  insert dmIndex { owner: viewer, peer: other, conversation: chat.id }
  insert dmIndex { owner: other, peer: viewer, conversation: chat.id }
  return chat.id

mutation createGroup(conversationId: id, other: principal, name: text 1..50, description: text <=200 ?):
  require other != viewer else NEED_SECOND_MEMBER
  chat = insert conversations { id: conversationId, kind: 'group', title: name, description, creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'member' }
  return chat.id

mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  insert members { conversation, principal, role: 'member' } if absent
  return null

mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  row = members[conversation, principal] ! else NOT_MEMBER
  update members[row] { role: 'admin' }
  return null

mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  row = members[conversation, principal] ! else NOT_MEMBER
  delete members[row]
  return null

mutation leaveConversation(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  pair = dmIndex[conversation = conversation, owner = viewer]
  if pair != null:
    delete dmIndex[pair]
  delete members[me]
  return null

mutation renameGroup(conversation: conversations, name: text 1..50, description: text <=200 ?):
  require exists members[conversation = conversation, principal = viewer, role = 'admin'] else NOT_ADMIN
  chat = conversations[conversation] ! else NOT_FOUND
  require chat.kind = 'group' else NOT_A_GROUP
  update conversations[chat] { title: name, description }
  return null

mutation setChatStyle(conversation: conversations, accent: text <=16 ?, background: image <=10000000 ?):
  chat = conversations[conversation] ! else NOT_FOUND
  me = members[conversation, viewer] ! else NOT_MEMBER
  if chat.kind = 'group':
    require me.role = 'admin' else NOT_ADMIN
  update conversations[chat] { accent, background }
  return null

mutation setDisappearing(conversation: conversations, setting: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else NOT_FOUND
  me = members[conversation, viewer] ! else NOT_MEMBER
  if chat.kind = 'group':
    require me.role = 'admin' else NOT_ADMIN
  update conversations[chat] { disappearing: setting }
  return null

mutation send(conversation: conversations, messageId: id, text: text <=2000, quote: messages ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = disappearTtlMs(chat.disappearing)
  expiresAt = now + ttl if ttl != null else null
  m = insert messages { id: messageId, conversation, sender: viewer, text, quote, at: now, expiresAt }
  me = profiles[principal = viewer]
  preview = previewText(text, false, false)
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: me.displayName, preview }
  return m.id

mutation sendPhoto(conversation: conversations, messageId: id, photo: image <=10000000, caption: text <=500 ?, viewOnce: bool):
  require exists members[conversation, viewer] else NOT_MEMBER
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = disappearTtlMs(chat.disappearing)
  expiresAt = now + ttl if ttl != null else null
  m = insert messages { id: messageId, conversation, sender: viewer, text: caption, photo: photo if not viewOnce else null, viewOncePhoto: photo if viewOnce else null, at: now, expiresAt }
  me = profiles[principal = viewer]
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: me.displayName, preview: 'Photo' }
  return m.id

mutation sendVideo(conversation: conversations, messageId: id, video: video <=50000000, caption: text <=500 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  duration = video.duration
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = disappearTtlMs(chat.disappearing)
  expiresAt = now + ttl if ttl != null else null
  m = insert messages { id: messageId, conversation, sender: viewer, text: caption, video, at: now, expiresAt }
  me = profiles[principal = viewer]
  for member in members where .conversation = conversation:
    if member.principal != viewer and not exists connected[member.principal]:
      emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: me.displayName, preview: 'Video' }
  return m.id

mutation editMessage(messageId: messages, text: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.sender = viewer else NOT_AUTHOR
  require not msg.tombstone else DELETED
  require now - msg.at <= editWindowMs() else EDIT_WINDOW_CLOSED
  update messages[msg] { text, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.sender = viewer else NOT_AUTHOR
  require not msg.tombstone else DELETED
  require now - msg.at <= deleteWindowMs() else DELETE_WINDOW_CLOSED
  update messages[msg] { tombstone: true, text: null, photo: null, viewOncePhoto: null, video: null, quote: null }
  return null

mutation setReaction(messageId: messages, emoji: text <=16 ?):
  msg = messages[messageId] ! else NOT_FOUND
  require exists members[msg.conversation, viewer] else NOT_MEMBER
  require not msg.tombstone else DELETED
  if emoji = null:
    if exists reactions[messageId, viewer]:
      delete reactions[messageId, viewer]
  else:
    upsert reactions[messageId, viewer] { emoji }
  return null

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversationId and .at >= periodStart and .at < periodEnd and not .tombstone and .sender != reader and .ordinal > readOrdinal)

fn digestTotals(p: profiles, periodStart: time, periodEnd: time):
  unread = 0
  chats = 0
  for m in members where .principal = p.principal:
    n = unreadIn(m.conversation, p.principal, m.seenOrdinal, periodStart, periodEnd)
    if n > 0:
      chats = chats + 1
      unread = unread + n
  newFollowers = count(follows where .followedId = p.principal and .at >= periodStart and .at < periodEnd)
  newPosts = count(posts where .parentId = null and not .removed and .at >= periodStart and .at < periodEnd and exists follows[p.principal, .authorId])
  return { unread, chats, newFollowers, newPosts }

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    totals = digestTotals(p, periodStart, periodEnd)
    if totals.unread > 0 or totals.newFollowers > 0 or totals.newPosts > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers: totals.newFollowers, newPostsInFollowing: totals.newPosts, unreadMessages: totals.unread, unreadChats: totals.chats } once [p.principal, periodEnd]

schedule dailyDigest every 2m: digest
