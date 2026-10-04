-- Clique on Snapback 4. Windows and digest periods match fixtures/config
-- windows.shortened.json and digest.shortened.json (grading profile).
-- editWindowSeconds=60, deleteForEveryoneWindowSeconds=120,
-- disappearing 24h=180s / 7d=300s, digest every 120s.

use identity password
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
  search displayName, handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 2000 by .id

query whoAmI():
  return viewer

query myProfile():
  return profiles[principal = viewer]

query profileById(principal: principal):
  return profiles[principal = principal]

query profileByHandle(handle: text 3..20 format handle):
  return profiles[handle = handle]

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?):
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

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }

query globalFeed(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }

query trending(c: cursor ?):
  return posts where .parentId = null and .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at after c

query profilePosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null and not .removed last 20 by .at after c

query postById(post: posts):
  return posts[post]

query thread(post: posts, c: cursor ?):
  return posts where .parentId = post last 50 by .at after c

view replyCounts: count posts where .parentId != null by .parentId
  online only
view repostCounts: count reposts by .postId
  online only

query postState(postId: posts):
  return { liked: exists likes[postId, viewer], reposted: exists reposts[viewer, postId], replies: replyCounts[postId] ?? 0, reposts: repostCounts[postId] ?? 0 }

mutation createPost(id: id, body: text <=500, parentId: posts ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  return insert posts { id, authorId: viewer, parentId, body, images, video, at: now }

mutation setLike(postId: posts, liked: bool):
  if liked:
    insert likes { postId, principal: viewer, at: now } if absent
  else:
    delete likes[postId, viewer]

mutation setRepost(postId: posts, reposted: bool):
  if reposted:
    insert reposts { actorId: viewer, postId, at: now } if absent
  else:
    delete reposts[viewer, postId]

mutation setFollow(principal: principal, following: bool):
  require principal != viewer else CANNOT_FOLLOW_SELF
  if following:
    insert follows { followerId: viewer, followedId: principal, at: now } if absent
  else:
    delete follows[viewer, principal]

view postCount: count posts where .parentId = null by .authorId
  online only
view likesReceived: count likes by .postId.authorId
  online only
view repostsReceived: count reposts by .postId.authorId
  online only
view repliesReceived: count posts where .parentId != null by .parentId.authorId
  online only
view followerCount: count follows by .followedId
  online only
view followingCount: count follows by .followerId
  online only
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  online only
view dailyLikesReceived: count likes by .postId.authorId, day(.at)
  online only

query followCounts(principal: principal):
  return {
    followers: followerCount[principal] ?? 0,
    following: followingCount[principal] ?? 0,
    iFollow: exists follows[viewer, principal]
  }

query insights():
  d0 = day(now)
  d1 = day(now - 1d)
  d2 = day(now - 2d)
  d3 = day(now - 3d)
  d4 = day(now - 4d)
  d5 = day(now - 5d)
  d6 = day(now - 6d)
  return {
    posts: postCount[viewer] ?? 0,
    likesReceived: likesReceived[viewer] ?? 0,
    repostsReceived: repostsReceived[viewer] ?? 0,
    repliesReceived: repliesReceived[viewer] ?? 0,
    followers: followerCount[viewer] ?? 0,
    following: followingCount[viewer] ?? 0,
    day0: d0,
    posts0: dailyPosts[viewer, d0] ?? 0,
    likes0: dailyLikesReceived[viewer, d0] ?? 0,
    day1: d1,
    posts1: dailyPosts[viewer, d1] ?? 0,
    likes1: dailyLikesReceived[viewer, d1] ?? 0,
    day2: d2,
    posts2: dailyPosts[viewer, d2] ?? 0,
    likes2: dailyLikesReceived[viewer, d2] ?? 0,
    day3: d3,
    posts3: dailyPosts[viewer, d3] ?? 0,
    likes3: dailyLikesReceived[viewer, d3] ?? 0,
    day4: d4,
    posts4: dailyPosts[viewer, d4] ?? 0,
    likes4: dailyLikesReceived[viewer, d4] ?? 0,
    day5: d5,
    posts5: dailyPosts[viewer, d5] ?? 0,
    likes5: dailyLikesReceived[viewer, d5] ?? 0,
    day6: d6,
    posts6: dailyPosts[viewer, d6] ?? 0,
    likes6: dailyLikesReceived[viewer, d6] ?? 0
  }

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  accent: text <=20 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  background: image <=10000000 ?
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
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
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
  clip: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  edited: bool default false
  tombstone: bool default false
  at: time
  expiresAt: time ?
  search text
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, expiresAt
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer
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

table reactions:
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
  sync last 500 by .id

query conversationScreen(conversation: conversations):
  return conversations[conversation]

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, role, seenOrdinal, chat: conversations[.conversation] }

query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 100 by byConversationOrdinal after c

query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 100 by byConversationOrdinal after c { id, receipt: receipt(.) }

query messagePhoto(id: messages):
  return messages[id]

query quotedMessage(message: messages):
  return messages[messages[message].quote]

query messageReactions(message: messages):
  return reactions where .message = message first 32 by .principal

query membersOf(conversation: conversations, c: cursor ?):
  return members where .conversation = conversation first 50 by .principal after c { principal, role, profile: profiles[principal = .principal] }

query dmByHandle(handle: text 3..20 format handle):
  p = profiles[handle = handle]
  return directChats[owner = viewer, peer = p.principal] if p != null else null

query directConversation(other: principal):
  return directChats[owner = viewer, peer = other]

query directPeer(conversation: id):
  return first(directChats where .owner = viewer and .conversation = conversation first 1 by .id)

query groupByTitle(title: text 1..50):
  return first(conversations where .kind = 'group' and .title = title first 1 by .id)

query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }

query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }

mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  pair = directChats[owner = viewer, peer = other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, kind: 'dm', creatorId: viewer, disappearing: 'off' }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'member' }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id

mutation createGroup(id: id, other: principal, title: text 1..50, description: text <=200 ?):
  require other != viewer else SELF_GROUP
  chat = insert conversations { id, kind: 'group', title, description, creatorId: viewer, disappearing: 'off' }
  insert members { conversation: chat.id, principal: viewer, role: 'admin' }
  insert members { conversation: chat.id, principal: other, role: 'member' }
  return chat.id

mutation addMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  insert members { conversation, principal, role: 'member' } if absent
  return null

mutation removeMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  row = members[conversation, principal] ! else NOT_MEMBER
  delete members[row]
  return null

mutation promoteMember(conversation: conversations, principal: principal):
  require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  row = members[conversation, principal] ! else NOT_MEMBER
  update members[row] { role: 'admin' }
  return null

mutation leaveChat(conversation: conversations):
  me = members[conversation, viewer] ! else NOT_MEMBER
  delete members[me]
  return null

mutation updateChat(conversation: conversations, title: text 1..50 ?, description: text <=200 ?, accent: text <=20 ?, disappearing: enum('off', '24h', '7d') ?):
  chat = conversations[conversation] ! else NOT_FOUND
  me = members[conversation, viewer] ! else NOT_MEMBER
  if chat.kind = 'group':
    require me.role = 'admin' else NOT_ADMIN
  nextTitle = title if title != null else chat.title
  nextDescription = description if description != null else chat.description
  nextAccent = accent if accent != null else chat.accent
  nextDisappearing = disappearing if disappearing != null else chat.disappearing
  update conversations[chat] { title: nextTitle, description: nextDescription, accent: nextAccent, disappearing: nextDisappearing }
  return null

mutation placeBackground(conversation: conversations, background: image <=10000000):
  chat = conversations[conversation] ! else NOT_FOUND
  me = members[conversation, viewer] ! else NOT_MEMBER
  if chat.kind = 'group':
    require me.role = 'admin' else NOT_ADMIN
  update conversations[chat] { background }
  return null

fn disappearingTtl(setting: enum('off', '24h', '7d')):
  return 180000 if setting = '24h' else 300000 if setting = '7d' else null

fn messagePreview(text: text <=2000, photo: image <=10000000 ?, clip: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  return 'Photo' if oncePhoto != null or photo != null else 'Video' if clip != null else slice(text, 0, 80)

mutation send(id: id, conversation: conversations, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, clip: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if clip != null:
    require clip.duration != null else DURATION_UNKNOWN
    require clip.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_FOUND
  ttl = disappearingTtl(chat.disappearing)
  expires = now + ttl if ttl != null else null
  profile = profiles[principal = viewer]
  senderName = profile.displayName if profile != null else 'Someone'
  preview = messagePreview(text, photo, clip, oncePhoto)
  m = insert messages { id, conversation, sender: viewer, text, quote, photo, clip, oncePhoto, at: now, expiresAt: expires }
  for mem in members where .conversation = conversation by .principal:
    if mem.principal != viewer and not exists connected[mem.principal]:
      emit notify { targetUserId: mem.principal, chatId: conversation, senderDisplayName: senderName, preview, kind: 'message' }
  return m.id

mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else ALREADY_DELETED
  require now - m.at <= 60000 else EDIT_WINDOW
  update messages[m] { text, edited: true }
  return null

mutation deleteMessage(message: messages):
  m = messages[message] ! else NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= 120000 else DELETE_WINDOW
  update messages[m] { tombstone: true, text: '', photo: null, clip: null, oncePhoto: null, edited: false }
  return null

mutation setReaction(message: messages, emoji: text <=32):
  require exists members[messages[message].conversation, viewer] else NOT_MEMBER
  current = reactions[message, viewer]
  if emoji = 'none' or (current != null and current.emoji = emoji):
    delete reactions[message, viewer]
  else:
    upsert reactions[message, viewer] { emoji }
  return null

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

query newFollowersIn(periodStart: time, periodEnd: time):
  return count(follows where .followedId = viewer and .at >= periodStart and .at < periodEnd)

query newFollowingPostsIn(periodStart: time, periodEnd: time):
  return count(posts where .parentId = null and not .removed and .at >= periodStart and .at < periodEnd and (.authorId = viewer or exists follows[viewer, .authorId]))

query inboxForDigest(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, seenOrdinal }

query unreadInPeriod(conversation: conversations, seenOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and not .tombstone and .sender != viewer and .ordinal > seenOrdinal)

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    newFollowers = 0
    newPosts = 0
    unread = 0
    chats = 0
    as p.principal:
      newFollowers = newFollowersIn(periodStart, periodEnd).data
      newPosts = newFollowingPostsIn(periodStart, periodEnd).data
      for chat in all(inboxForDigest(null)):
        total = unreadInPeriod(chat.conversation, chat.seenOrdinal, periodStart, periodEnd).data
        if total > 0:
          chats = chats + 1
          unread = unread + total
    if newFollowers + newPosts + unread > 0:
      emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages: unread, unreadChats: chats } once [p.principal, periodEnd]

schedule digestEvery every 2m: digest
