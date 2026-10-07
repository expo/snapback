use identity password
effect notify

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
  search displayName, handle
  immutable principal
  public 'Registered profiles are discoverable'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

query myProfile():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query profileById(principal: principal):
  return profiles[principal = principal]
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'Public follow graph'
  insert <- .followerId = viewer and .followedId != viewer
  delete <- .followerId = viewer
  sync public

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  photos: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes by postId
  repostCount: count reposts by postId
  replyCount: count posts by parentId
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
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'Public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

view followerCounts: count follows by .followedId
view followingCounts: count follows by .followerId
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] }
query authorPosts(owner: principal, c: cursor ?):
  return posts where .authorId = owner and .parentId = null last 20 by .at after c
query postDetail(postId: posts):
  return posts[postId]
query replies(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 20 by .at after c
query postState(postId: posts):
  return { liked: exists likes[postId, viewer], reposted: exists reposts[viewer, postId] }
query profileStats(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
mutation setFollow(owner: principal, set: bool):
  require owner != viewer else SELF_FOLLOW
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if set:
    insert follows { followerId: viewer, followedId: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation publish(id: id, body: text <=500, parentId: posts ?, photos: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require photos = null or video = null else MIXED_MEDIA
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  insert posts { id, authorId: viewer, body, parentId, photos, video, at: now }
  return id
mutation setLike(postId: posts, set: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if set:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, set: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  require p.parentId = null else REPLY_REPOST
  if set:
    insert reposts { postId, actorId: viewer, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]

-- Complete historical path beyond the materialized per-author acquisition window.
query allFollowing(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c { *, card: posts[.post] }

table conversations:
  title: text 1..50
  description: text <=200 default ''
  accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569') default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  kind: enum('dm', 'group')
  slug: text <=80 ?
  creatorId: principal
  lastOrdinal: int default 0
  immutable kind, creatorId, slug
  read <- exists members[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists members[.id, viewer]
  after insert <- exists members[conversation = .id, principal = .creatorId]
  retain delivered-history
  sync to members[.id]

table members:
  conversation: conversations
  principal: principal
  admin: bool default false
  joinedOrdinal: int
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  update <- .principal = viewer or exists members[.conversation, viewer]
  delete <- .principal = viewer or exists members[.conversation, viewer]
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
  video: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  kind: enum('text', 'image', 'video', 'once') default 'text'
  search text
  expire at .expiresAt
  edited: bool default false
  deleted: bool default false
  quote: messages ?
  at: time
  unique byConversationOrdinal: conversation, ordinal
  immutable conversation, sender, ordinal, recipients, at, quote, kind, expiresAt
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

query conversationScreen(conversation: conversations):
  return conversations[conversation]
query groupBySlug(slug: text <=80):
  return first(conversations where .slug = slug first 1 by .id)
query directConversation(other: principal):
  return directChats[viewer, other]
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], peers: members[conversation = .conversation] { principal, profile: profiles[principal = .principal] } }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, receipt: receipt(.) }
query messageById(id: messages):
  return messages[id]
query chatMembers(conversation: conversations):
  return members where .conversation = conversation first 50 by .principal { *, profile: profiles[principal = .principal] }
query allProfiles(c: cursor ?):
  return profiles first 50 by .handle after c

mutation openDirect(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  pair = directChats[viewer, other]
  if pair != null:
    return pair.conversation
  chat = insert conversations { id, title: 'Direct message', kind: 'dm', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, admin: true }
  insert members { conversation: chat.id, principal: other, admin: true }
  insert directChats { owner: viewer, peer: other, conversation: chat.id }
  insert directChats { owner: other, peer: viewer, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, title: text 1..50, description: text <=200, slug: text <=80, peers: [principal] <=49):
  require count(peers) >= 1 else MEMBERS_REQUIRED
  chat = insert conversations { id, title, description, slug, kind: 'group', creatorId: viewer }
  insert members { conversation: chat.id, principal: viewer, admin: true }
  for p in peers:
    require p != viewer else SELF_MEMBER
    require exists profiles[principal = p] else PROFILE_NOT_FOUND
    insert members { conversation: chat.id, principal: p } if absent
  return chat.id
mutation addMember(conversation: conversations, principal: principal):
  require members[conversation, viewer].admin = true else ADMIN_REQUIRED
  require conversations[conversation].kind = 'group' else GROUP_REQUIRED
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  insert members { conversation, principal } if absent
mutation removeMember(conversation: conversations, principal: principal):
  require members[conversation, viewer].admin = true else ADMIN_REQUIRED
  require conversations[conversation].kind = 'group' else GROUP_REQUIRED
  if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation promoteMember(conversation: conversations, principal: principal):
  require members[conversation, viewer].admin = true else ADMIN_REQUIRED
  update members[conversation, principal] { admin: true }
mutation leave(conversation: conversations):
  delete members[conversation, viewer]
mutation send(id: id, conversation: conversations, text: text <=2000, quote: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if quote != null:
    require messages[quote].conversation = conversation else INVALID_QUOTE
  require oncePhoto = null or photo = null and video = null else MIXED_MEDIA
  require photo = null or video = null else MIXED_MEDIA
  require photo = null and video = null and oncePhoto = null or count(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  ttl = disappearingTtl(chat.disappearing)
  insert messages { id, conversation, sender: viewer, text, quote, photo, video, oncePhoto, kind: 'once' if oncePhoto != null else ('image' if photo != null else ('video' if video != null else 'text')), expiresAt: now + ttl if ttl != null else null, at: now }
  for recipient in members where .conversation = conversation by .principal:
    if recipient.principal != viewer and not exists connected[recipient.principal]:
      emit notify { targetUserId: recipient.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Video' if video != null else ('Photo' if photo != null or oncePhoto != null else slice(text, 0, 80)) }
  return id

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
query typingInMyRooms(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, typing: typing[conversation = .conversation] where .principal != viewer { principal } }

mutation editMessage(id: messages, text: text <=2000):
  m = messages[id] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.deleted else MESSAGE_DELETED
  require now <= m.at + editWindow() else EDIT_WINDOW_CLOSED
  require m.kind = 'text' or count(text) <= 500 else CAPTION_TOO_LONG
  update messages[id] { text, edited: true }
mutation deleteMessage(id: messages):
  m = messages[id] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now <= m.at + deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[id] { text: '', photo: null, video: null, oncePhoto: null, deleted: true }

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
  return reactions where .message = message first 50 by .principal
mutation setReaction(message: messages, emoji: text 1..32 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.deleted else MESSAGE_DELETED
  require exists members[m.conversation, viewer] else NOT_MEMBER
  if emoji != null:
    upsert reactions[message, viewer] { emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]

-- BEGIN WINDOW CONFIG: instrument/fixtures/config/windows.shortened.json
fn editWindow(): 60000
fn deleteWindow(): 120000
fn disappearingTtl(setting: text): 180000 if setting = '24h' else (300000 if setting = '7d' else null)
-- END WINDOW CONFIG

mutation renameChat(conversation: conversations, title: text 1..50, description: text <=200):
  require members[conversation, viewer].admin = true else ADMIN_REQUIRED
  require conversations[conversation].kind = 'group' else GROUP_REQUIRED
  update conversations[conversation] { title, description }
mutation setChatColor(conversation: conversations, accent: enum('#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569')):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { accent }
mutation setChatBackground(conversation: conversations, background: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  update conversations[conversation] { background }
mutation setDisappearing(conversation: conversations, setting: enum('off', '24h', '7d')):
  chat = conversations[conversation] ! else CHAT_NOT_FOUND
  require exists members[conversation, viewer] else NOT_MEMBER
  require chat.kind = 'dm' or members[conversation, viewer].admin = true else ADMIN_REQUIRED
  update conversations[conversation] { disappearing: setting }
query people(q: text <=100, c: cursor ?):
  return profiles matching q last 20 by .id after c
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by byConversationOrdinal after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }
query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }

query whoAmI():
  return viewer
fn reactionSummary(message: messages):
  rows = reactions where .message = message first 50 by .principal
  return group(rows, 'emoji') { emoji: .key, count: count(.items), mine: exists reactions[message = message, principal = viewer, emoji = .key] }
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by byConversationOrdinal after c { id, conversationId: .conversation, senderId: .sender, serverTimestamp: .at, type: .kind, text, media: { image: .photo, video: .video, viewOnce: .oncePhoto }, edited, tombstone: .deleted, replyToId: .quote, reactions: reactionSummary(.id), receipt: receipt(.) if .sender = viewer else null }

view originalPostCounts: count posts where .parentId = null and not .removed by .authorId
  online only
view receivedLikeCounts: count likes by .postId.authorId
  online only
view receivedRepostCounts: count reposts by .postId.authorId
  online only
view receivedReplyCounts: count posts where .parentId != null by .parentId.authorId
  online only
view dailyPostCounts: count posts where .parentId = null and not .removed by .authorId, day(.at)
  online only
view dailyReceivedLikes: count likes by .postId.authorId, day(.at)
  online only
fn insightDay(at: time):
  return { at: day(at), posts: dailyPostCounts[viewer, day(at)], likesReceived: dailyReceivedLikes[viewer, day(at)] }
query insights():
  return { asOf: now, posts: originalPostCounts[viewer], likesReceived: receivedLikeCounts[viewer], repostsReceived: receivedRepostCounts[viewer], repliesReceived: receivedReplyCounts[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days: [insightDay(now - 6d), insightDay(now - 5d), insightDay(now - 4d), insightDay(now - 3d), insightDay(now - 2d), insightDay(now - 1d), insightDay(now)] }
query trending():
  return posts where .parentId = null and not .removed and .at >= now - 1d and .at <= now last 10 by .likeCount, .at

query unreadTotal(conversation: conversations):
  member = members[conversation, viewer] ! else NOT_MEMBER
  return count(messages where .conversation = conversation and not .deleted and .sender != viewer and .ordinal > member.seenOrdinal and .ordinal > member.joinedOrdinal)
query digestUnread(conversation: conversations, periodStart: time, periodEnd: time):
  member = members[conversation, viewer] ! else NOT_MEMBER
  return count(messages where .conversation = conversation and .at >= periodStart and .at < periodEnd and not .deleted and .sender != viewer and .ordinal > member.seenOrdinal and .ordinal > member.joinedOrdinal)
query digestFollowers(periodStart: time, periodEnd: time):
  return count(follows where .followedId = viewer and .at >= periodStart and .at < periodEnd)
query digestPosts(periodStart: time, periodEnd: time):
  return count(posts where .parentId = null and not .removed and .at >= periodStart and .at < periodEnd and (.authorId = viewer or exists follows[viewer, .authorId]))

table digestProgress:
  principal: principal
  through: time
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- deny
  update <- deny
  delete <- deny
  online only
job dailyDigest(periodStart: time, periodEnd: time):
  for p in profiles:
    previous = digestProgress[principal = p.principal]
    if previous = null or previous.through < periodEnd:
      start = previous.through if previous != null else periodStart
      followers = 0
      posts = 0
      unread = 0
      chats = 0
      as p.principal:
        followers = digestFollowers(start, periodEnd).data
        posts = digestPosts(start, periodEnd).data
        for chat in all(inbox(null)):
          total = digestUnread(chat.conversation, start, periodEnd).data
          if total > 0:
            unread = unread + total
            chats = chats + 1
      if followers > 0 or posts > 0 or unread > 0:
        emit notify { targetUserId: p.principal, kind: 'digest', periodStart: start, periodEnd, newFollowers: followers, newPostsInFollowing: posts, unreadMessages: unread, unreadChats: chats } once [p.principal, periodEnd]
      upsert digestProgress[principal = p.principal] { principal: p.principal, through: periodEnd }
-- BEGIN DIGEST CONFIG: instrument/fixtures/config/digest.shortened.json
schedule digestEveryPeriod every 120s: dailyDigest
-- END DIGEST CONFIG
