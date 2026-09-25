effect notify
use identity password

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
  public 'Registered accounts are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public
query me():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  text: text <=500
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  immutable author, parent, at
  public 'Public posts and replies'
  insert <- .author = viewer
  update <- .author = viewer
  sync public
table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public 'Public follow graph'
  insert <- .follower = viewer
  delete <- .follower = viewer
  sync public
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'Public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public
table reposts:
  post: posts
  actor: principal
  at: time
  unique actor, post
  immutable actor, post, at
  public 'Public reposts'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public
view followerCounts: count follows by .followed
view followingCounts: count follows by .follower
view replyCounts: count posts by .parent
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
shape postCard = { *, authorProfile: profiles[principal = .author], likes: .likeCount, reposts: .repostCount, replies: replyCounts[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query globalFeed(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query homeFeed(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query postDetail(post: posts):
  return posts[post] postCard
query replies(post: posts, c: cursor ?):
  return posts where .parent = post first 20 by .at after c postCard
query followStats(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
mutation publish(id: id, text: text <=500, parent: posts ?, photo1: image <=10000000 ?, photo2: image <=10000000 ?, photo3: image <=10000000 ?, photo4: image <=10000000 ?, video: video <=50000000 ?):
  require video = null or (photo1 = null and photo2 = null and photo3 = null and photo4 = null) else MEDIA_MIX
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, parent, text, photo1, photo2, photo3, photo4, video, at: now } if absent
mutation setFollow(owner: principal, enabled: bool):
  require owner != viewer else SELF_FOLLOW
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if enabled:
    insert follows { follower: viewer, followed: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation setLike(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    insert reposts { post, actor: viewer, at: now } if absent
  else if exists reposts[viewer, post]:
    delete reposts[viewer, post]

table conversations:
  name: text 1..50
  description: text <=200
  kind: enum('dm', 'group')
  accent: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  creator: principal
  at: time
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  update <- exists members[.id, viewer] and (.kind = 'dm' or exists members[.id, viewer, role = 'admin'])
  after insert <- exists members[.id, .creator, role = 'admin']
  sync to members[.id]
table dmPairs:
  low: principal
  high: principal
  conversation: conversations
  unique low, high
  immutable low, high, conversation
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  online only
table members:
  conversation: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  readAt: time default 0
  deliveredAt: time default 0
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedAt
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer, role = 'admin']
  update <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  delete <- .principal = viewer or exists members[.conversation, viewer, role = 'admin']
  sync to members[.conversation]
table messages:
  conversation: conversations
  sender: principal
  text: text <=2000
  replyTo: messages ?
  photo: image <=10000000 ?
  video: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  search text
  expire at .expiresAt
  edited: bool default false
  tombstone: bool default false
  at: time
  immutable conversation, sender, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  update <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  sync to members[.conversation] last 500 by .at
table recipients:
  message: messages
  conversation: conversations
  principal: principal
  unique message, principal
  cap 50 by message
  immutable message, conversation, principal
  read <- exists members[.conversation, viewer]
  insert <- created messages[.message]
  sync to members[.conversation] last 25000 by .id
table typing:
  conversation: conversations
  principal: principal
  expiresAt: time
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  expire at .expiresAt
  sync to members[.conversation]
fn receipt(m: messages):
  state = 2
  for r in recipients where .message = m.id and .conversation = m.conversation:
    member = members[r.conversation, r.principal]
    if member != null:
      if member.deliveredAt < m.at:
        state = 0
      else if member.readAt < m.at and state > 0:
        state = 1
  return 'read' if state = 2 else ('delivered' if state = 1 else 'sent')
shape messageCard = { *, type: 'video' if .video != null else ('image' if .photo != null or .oncePhoto != null else 'text'), media: .video if .video != null else (.photo if .photo != null else .oncePhoto), reactions: reactionSummary(.id, .conversation), senderProfile: profiles[principal = .sender], quote: messages[.replyTo] { id, text, senderProfile: profiles[principal = .sender] }, receipt: receipt(.) }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .at after c messageCard
query conversation(id: conversations):
  return conversations[id]
query roster(conversation: conversations):
  return members where .conversation = conversation { *, profile: profiles[principal = .principal] }
query typingNow(conversation: conversations):
  return typing where .conversation = conversation first 50 by .principal { *, profile: profiles[principal = .principal] }
fn latestFor(chat: conversations):
  return first(messages where .conversation = chat last 1 by .at)
fn rosterFor(chat: conversations):
  return members where .conversation = chat { *, profile: profiles[principal = .principal] }
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { *, chat: conversations[.conversation], latest: latestFor(.conversation), roster: rosterFor(.conversation) }
query groupByName(name: text 1..50):
  return first(conversations where .name = name and .kind = 'group' first 1 by .at)
mutation createDM(id: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  low = viewer if viewer < other else other
  high = other if viewer < other else viewer
  old = dmPairs[low, high]
  if old != null:
    return old.conversation
  chat = insert conversations { id, name: 'Direct message', description: '', kind: 'dm', creator: viewer, at: now }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedAt: now }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedAt: now }
  insert dmPairs { low, high, conversation: chat.id }
  return chat.id
mutation createGroup(id: id, name: text 1..50, description: text <=200, other: principal):
  require other != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = other] else PROFILE_NOT_FOUND
  chat = insert conversations { id, name, description, kind: 'group', creator: viewer, at: now }
  insert members { conversation: chat.id, principal: viewer, role: 'admin', joinedAt: now }
  insert members { conversation: chat.id, principal: other, role: 'member', joinedAt: now }
  return chat.id
mutation memberSet(conversation: conversations, principal: principal, action: enum('add', 'remove', 'promote', 'leave')):
  if action = 'leave':
    require principal = viewer else NOT_SELF
  else:
    require exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversation].kind = 'group' else NOT_GROUP
  if action = 'add':
    insert members { conversation, principal, role: 'member', joinedAt: now } if absent
  else if action = 'promote':
    update members[conversation, principal] { role: 'admin' }
  else if exists members[conversation, principal]:
    delete members[conversation, principal]
mutation send(id: id, conversation: conversations, text: text <=2000, replyTo: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  if replyTo != null:
    require messages[replyTo].conversation = conversation else WRONG_QUOTE
  require photo = null or video = null else MEDIA_MIX
  require oncePhoto = null or (photo = null and video = null) else MEDIA_MIX
  require (photo = null and video = null and oncePhoto = null) or count(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  chat = conversations[conversation] ! else NOT_MEMBER
  ttl = disappearingTTL(chat.disappearing)
  m = insert messages { id, conversation, sender: viewer, text, replyTo, photo, video, oncePhoto, expiresAt: now + ttl if ttl > 0 else null, at: now }
  for member in members where .conversation = conversation:
    if member.principal != viewer:
      insert recipients { message: m.id, conversation, principal: member.principal }
      if not exists connected[member.principal]:
        emit notify { targetUserId: member.principal, chatId: conversation, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Video' if video != null else ('Photo' if photo != null or oncePhoto != null else slice(text, 0, 80)) }
  return m.id
mutation acknowledge(conversation: conversations, read: bool):
  member = members[conversation, viewer] ! else NOT_MEMBER
  update members[conversation, viewer] { deliveredAt: now, readAt: now if read else member.readAt }
mutation setTyping(conversation: conversations):
  upsert typing[conversation, viewer] { conversation, principal: viewer, expiresAt: now + 3s }
query heldHistory(conversation: conversations, c: cursor ?) held:
  return messages where .conversation = conversation last 20 by .at after c { *, senderProfile: profiles[principal = .sender], quote: messages[.replyTo] { id, text, senderProfile: profiles[principal = .sender] } }

table reactions:
  message: messages
  conversation: conversations
  principal: principal
  emoji: text 1..64
  unique conversation, message, principal
  immutable message, conversation, principal
  read <- exists members[.conversation, viewer]
  insert <- .principal = viewer and exists members[.conversation, viewer]
  update <- .principal = viewer and exists members[.conversation, viewer]
  delete <- .principal = viewer and exists members[.conversation, viewer]
  sync to members[.conversation]
view reactionCounts: count reactions by .conversation, .message, .emoji
fn reactionSummary(message: messages, conversation: conversations):
  return reactionCounts where .conversation = conversation and .message = message first 50 by .emoji { emoji, count: .value, mine: reactions[conversation, message, viewer].emoji = .emoji }
mutation setReaction(message: messages, emoji: text 1..64 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.tombstone else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[m.conversation, message, viewer] { message, conversation: m.conversation, principal: viewer, emoji }
  else if exists reactions[m.conversation, message, viewer]:
    delete reactions[m.conversation, message, viewer]
mutation editMessage(message: messages, text: text <=2000):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.tombstone else MESSAGE_DELETED
  require now <= m.at + editWindow() else EDIT_WINDOW_CLOSED
  require (m.photo = null and m.video = null and m.oncePhoto = null) or count(text) <= 500 else CAPTION_TOO_LONG
  update messages[message] { text, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now <= m.at + deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[message] { text: '', photo: null, video: null, oncePhoto: null, tombstone: true }

mutation configureChat(conversation: conversations, name: text 1..50 ?, description: text <=200 ?, accent: text ?, background: image <=10000000 ?, disappearing: enum('off', '24h', '7d') ?):
  chat = conversations[conversation] ! else NOT_MEMBER
  require chat.kind = 'dm' or exists members[conversation, viewer, role = 'admin'] else NOT_ADMIN
  if name != null:
    require chat.kind = 'group' else NOT_GROUP
    update conversations[conversation] { name }
  if description != null:
    require chat.kind = 'group' else NOT_GROUP
    update conversations[conversation] { description }
  if accent != null:
    require accent = '#4F46E5' or accent = '#0D9488' or accent = '#EF6351' or accent = '#D97706' or accent = '#7C3AED' or accent = '#059669' or accent = '#E11D48' or accent = '#475569' else INVALID_COLOR
    update conversations[conversation] { accent }
  if background != null:
    update conversations[conversation] { background }
  if disappearing != null:
    update conversations[conversation] { disappearing }
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  require exists members[conversation, viewer] else NOT_MEMBER
  return messages[conversation = conversation] matching q after c last 20 by .at messageCard
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .conversation where exists (messages[conversation = .conversation] by .at matching q) { conversation, chat: conversations[.conversation], hits: messages[conversation = .conversation] matching q last 20 by .at }
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 50 by .at

query messageDetail(id: messages):
  return messages[id] messageCard
query dmFor(other: principal):
  return first(members[principal = viewer] first 1 by .conversation where conversations[.conversation].kind = 'dm' and exists members[.conversation, other] { conversation })
