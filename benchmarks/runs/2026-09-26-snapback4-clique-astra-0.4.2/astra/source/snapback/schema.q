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
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Clique profiles are discoverable by registered users'
  insert <- .principal = viewer
  update <- .principal = viewer
  cap 1 by principal
  sync public

query myProfile():
  return profiles[principal = viewer]
query profile(handle: text):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(handle: text 3..20 format handle, displayName: text 1..50, bio: text <=200, location: text <=50, link: text format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, handle, displayName, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  body: text <=500
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  likes: count likes
  reposts: count reposts
  immutable author, parent, at
  public 'public posts'
  insert <- .author = viewer
  sync public last 1000 by .at

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table reposts:
  post: posts
  actor: principal
  at: time
  unique actor, post
  immutable actor, post, at
  public 'public reposts'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at

table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public 'public follows'
  insert <- .follower = viewer
  delete <- .follower = viewer
  sync public

view followers: count follows by .followed
view followingCounts: count follows by .follower
view replyCounts: count posts by .parent
view activity:
  posts where .parent = null { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
shape postCard = { *, authorProfile: profiles[principal = .author], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id], replies: replyCounts[.id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query post(id: posts):
  return posts[id] postCard
query replies(parent: posts, c: cursor ?):
  return posts where .parent = parent first 20 by .at after c postCard
query social(owner: principal):
  return { followers: followers[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
mutation publish(id: id, body: text <=500, parent: posts ?, photo1: image <=10000000 ?, photo2: image <=10000000 ?, photo3: image <=10000000 ?, photo4: image <=10000000 ?, video: video <=50000000 ?):
  require video = null or (photo1 = null and photo2 = null and photo3 = null and photo4 = null) else MIXED_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, body, parent, photo1, photo2, photo3, photo4, video, at: now }
mutation setFollow(owner: principal, set: bool):
  require owner != viewer else SELF_FOLLOW
  if set:
    insert follows { follower: viewer, followed: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation setLike(post: posts, set: bool):
  require exists posts[post] else POST_NOT_FOUND
  if set:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, set: bool):
  p = posts[post] ! else POST_NOT_FOUND
  require p.parent = null else ORIGINAL_REQUIRED
  if set:
    insert reposts { post, actor: viewer, at: now } if absent
  else if exists reposts[viewer, post]:
    delete reposts[viewer, post]

table chats:
  lastOrdinal: int default 0
  color: text default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  kind: enum('dm', 'group')
  name: text 1..50
  description: text <=200
  creator: principal
  at: time
  immutable kind, creator, at
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  update (old, next) <- exists members[old.id, viewer] and (old.kind = 'dm' or exists members[chat = old.id, principal = viewer, role = 'admin'] or (old.name = next.name and old.description = next.description and old.color = next.color and old.background = next.background and old.disappearing = next.disappearing))
  after insert <- exists members[chat = .id, principal = .creator, role = 'admin']
  sync to members[.id]
table pairs:
  first: principal
  second: principal
  chat: chats
  unique first, second
  immutable first, second, chat
  read <- .first = viewer or .second = viewer
  insert <- .first = viewer
  online only
table members:
  joinedOrdinal: int default 0
  deliveredAt: time default 0
  readAt: time default 0
  deliveredOrdinal: int default 0
  readOrdinal: int default 0
  chat: chats
  principal: principal
  role: enum('member', 'admin')
  joined: time
  unique chat, principal
  cap 50 by chat
  immutable chat, principal, joined, joinedOrdinal
  read <- exists members[.chat, viewer]
  insert <- created chats[.chat] or exists members[chat = .chat, principal = viewer, role = 'admin']
  update (old, next) <- exists members[chat = old.chat, principal = viewer, role = 'admin'] or (old.principal = viewer and old.role = next.role)
  delete <- .principal = viewer or exists members[chat = .chat, principal = viewer, role = 'admin']
  sync to members[.chat]
table messages:
  block: int default 0
  ordinal: int default 0
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  expire at .expiresAt
  photo: image <=10000000 ?
  video: video <=50000000 ?
  edited: bool default false
  deleted: bool default false
  chat: chats
  sender: principal
  body: text <=2000
  quote: messages ?
  at: time
  immutable chat, sender, at, quote
  search body
  read <- exists members[.chat, viewer]
  insert <- .sender = viewer and exists members[.chat, viewer]
  update <- .sender = viewer
  retain delivered-history
  sync to members[.chat] last 10000 by .ordinal
table deliveries:
  expiresAt: time ?
  expire at .expiresAt
  visible: bool default true
  message: messages
  chat: chats
  principal: principal
  state: int
  unique message, principal
  cap 50 by message
  immutable message, chat, principal
  read <- exists members[.chat, viewer]
  insert <- created messages[.message]
  update <- .principal = viewer or exists messages[id = .message, sender = viewer]
  sync to members[.chat] last 10000 by .id
table typing:
  cap 50 by chat
  chat: chats
  principal: principal
  until: time
  unique chat, principal
  immutable chat, principal
  expire at .until
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer and exists members[.chat, viewer]
  sync to members[.chat]
view unread: count deliveries where .state < 2 and .visible by .chat, .principal
fn receipt(m: messages):
  value = 2
  for member in members where .chat = m.chat:
    if member.principal != m.sender and member.joined <= m.at and member.joinedOrdinal <= m.ordinal:
      state = 2 if member.readAt >= m.at and member.readOrdinal >= m.ordinal else 1 if member.deliveredAt >= m.at and member.deliveredOrdinal >= m.ordinal else 0
      value = min(value, state)
  return value
shape messageCard = { *, authorProfile: profiles[principal = .sender], quoted: messages[.quote], receipt: receipt(.) if exists members[.chat, viewer] else 0, reactions: chips(.id, .chat) if exists members[.chat, viewer] else [] }
query thread(chat: chats, c: cursor ?):
  return messages where .chat = chat last 50 by .ordinal after c messageCard
query inboxLocal(c: cursor ?):
  return members where .principal = viewer first 100 by .chat after c { *, room: chats[.chat], roster: members[chat = .chat] { *, profile: profiles[principal = .principal] }, typing: typingFor(.chat) }
query inbox(c: cursor ?):
  return members where .principal = viewer first 100 by .chat after c { *, room: chats[.chat], roster: members[chat = .chat] { *, profile: profiles[principal = .principal] }, unread: unreadFor(.), typing: typingFor(.chat) }
query room(chat: chats):
  return chats[chat]
query roster(chat: chats):
  return members where .chat = chat { *, profile: profiles[principal = .principal] }
query whoTypes(chat: chats):
  return typing where .chat = chat first 50 by .principal { *, profile: profiles[principal = .principal] }
query resolveDM(other: principal):
  return pairs[first = viewer, second = other] ?? pairs[first = other, second = viewer]
mutation createDM(id: id, other: principal):
  require exists profiles[principal = other] else USER_NOT_FOUND
  require other != viewer else SELF_DM
  existing = pairs[first = viewer, second = other] ?? pairs[first = other, second = viewer]
  if existing != null:
    return existing.chat
  room = insert chats { id, kind: 'dm', name: 'Direct message', description: '', creator: viewer, at: now }
  insert members { chat: room.id, principal: viewer, role: 'admin', joined: now }
  insert members { chat: room.id, principal: other, role: 'member', joined: now }
  insert pairs { first: viewer, second: other, chat: room.id }
  return room.id
mutation createGroup(id: id, name: text 1..50, description: text <=200, other: principal):
  require exists profiles[principal = other] else USER_NOT_FOUND
  require other != viewer else OTHER_MEMBER_REQUIRED
  room = insert chats { id, kind: 'group', name, description, creator: viewer, at: now }
  insert members { chat: room.id, principal: viewer, role: 'admin', joined: now }
  insert members { chat: room.id, principal: other, role: 'member', joined: now }
  return room.id
mutation addMember(chat: chats, principal: principal):
  require exists profiles[principal = principal] else USER_NOT_FOUND
  require (chats[chat] ! else NOT_FOUND).kind = 'group' else GROUP_REQUIRED
  require exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  insert members { chat, principal, role: 'member', joined: now, joinedOrdinal: (chats[chat] ! else CHAT_NOT_FOUND).lastOrdinal + 1 } if absent
mutation promote(chat: chats, principal: principal):
  require exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  require (chats[chat] ! else NOT_FOUND).kind = 'group' else GROUP_REQUIRED
  update members[chat, principal] { role: 'admin' }
mutation removeMember(chat: chats, principal: principal):
  require (chats[chat] ! else NOT_FOUND).kind = 'group' else GROUP_REQUIRED
  delete members[chat, principal]
mutation send(id: id, chat: chats, body: text 1..2000, quote: messages ?):
  require exists members[chat, viewer] else NOT_MEMBER
  if quote != null:
    require (messages[quote] ! else QUOTE_NOT_FOUND).chat = chat else WRONG_CHAT
  room = chats[chat] ! else CHAT_NOT_FOUND
  ordinal = room.lastOrdinal + 1
  update chats[room] { lastOrdinal: ordinal }
  m = insert messages { id, chat, ordinal, block: ordinal / 128, sender: viewer, body, quote, at: now, expiresAt: expiry(chat) }
  for member in members where .chat = chat:
    if member.principal != viewer:
      insert deliveries { message: m.id, chat, principal: member.principal, state: 0, expiresAt: m.expiresAt }
      if not exists connected[member.principal]:
        emit notify { targetUserId: member.principal, chatId: chat, senderDisplayName: profiles[principal = viewer].displayName, preview: slice(body, 0, 80) }
  return m.id
mutation acknowledge(ids: [messages] <=100, state: int):
  require state = 1 or state = 2 else BAD_RECEIPT
  for id in ids:
    d = deliveries[message = id, principal = viewer]
    if d != null and d.state < state:
      update deliveries[d] { state }
    msg = messages[id]
    if msg != null:
      member = members[msg.chat, viewer]
      if member != null:
        if msg.at > member.deliveredAt or msg.ordinal > member.deliveredOrdinal:
          update members[member] { deliveredAt: max(member.deliveredAt, msg.at), deliveredOrdinal: max(member.deliveredOrdinal, msg.ordinal) }
        if state = 2 and (msg.at > member.readAt or msg.ordinal > member.readOrdinal):
          update members[member] { readAt: max(member.readAt, msg.at), readOrdinal: max(member.readOrdinal, msg.ordinal) }
mutation type(chat: chats):
  upsert typing[chat, viewer] { chat, principal: viewer, until: now + 3s }

fn typingFor(chat: chats):
  return typing where .chat = chat first 50 by .principal

table reactions:
  message: messages
  chat: chats
  principal: principal
  emoji: text 1..32
  unique message, principal
  immutable message, chat, principal
  read <- exists members[.chat, viewer]
  insert <- .principal = viewer and exists members[.chat, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.chat]
view reactionTotals: count reactions by .chat, .message, .emoji
fn chips(message: messages, chat: chats):
  return reactionTotals where .chat = chat and .message = message first 50 by .emoji { emoji, count: .value, mine: reactions[message, viewer].emoji = .emoji }
mutation sendMedia(id: id, chat: chats, body: text <=500, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists members[chat, viewer] else NOT_MEMBER
  require (photo != null and video = null and oncePhoto = null) or (photo = null and video != null and oncePhoto = null) or (photo = null and video = null and oncePhoto != null) else ONE_MEDIA_REQUIRED
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  room = chats[chat] ! else CHAT_NOT_FOUND
  ordinal = room.lastOrdinal + 1
  update chats[room] { lastOrdinal: ordinal }
  m = insert messages { id, chat, ordinal, block: ordinal / 128, sender: viewer, body, photo, video, oncePhoto, at: now, expiresAt: expiry(chat) }
  for member in members where .chat = chat:
    if member.principal != viewer:
      insert deliveries { message: m.id, chat, principal: member.principal, state: 0, expiresAt: m.expiresAt }
      if not exists connected[member.principal]:
        emit notify { targetUserId: member.principal, chatId: chat, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Video' if video != null else 'Photo' }
  return m.id
mutation react(message: messages, emoji: text <=32 ?):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require not m.deleted else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[message, viewer] { message, chat: m.chat, principal: viewer, emoji }
  else if exists reactions[message, viewer]:
    delete reactions[message, viewer]
mutation editMessage(message: messages, body: text <=2000):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require not m.deleted and now - m.at <= config.editWindow() else EDIT_WINDOW_CLOSED
  require (m.photo = null and m.video = null and m.oncePhoto = null) or count(body) <= 500 else CAPTION_TOO_LONG
  update messages[m] { body, edited: true }
mutation deleteMessage(message: messages):
  m = messages[message] ! else MESSAGE_NOT_FOUND
  require m.sender = viewer else NOT_AUTHOR
  require now - m.at <= config.deleteWindow() else DELETE_WINDOW_CLOSED
  update messages[m] { body: '', photo: null, video: null, oncePhoto: null, deleted: true }
  for member in members where .chat = m.chat:
    d = deliveries[message, member.principal]
    if d != null:
      update deliveries[d] { visible: false }

fn expiry(chat: chats):
  room = chats[chat] ! else CHAT_NOT_FOUND
  return now + config.shortTTL() if room.disappearing = '24h' else now + config.longTTL() if room.disappearing = '7d' else null
mutation configureChat(chat: chats, name: text 1..50 ?, description: text <=200 ?, color: text ?, background: image <=10000000 ?, disappearing: enum('off', '24h', '7d') ?):
  r = chats[chat] ! else CHAT_NOT_FOUND
  require exists members[chat, viewer] else NOT_MEMBER
  if r.kind = 'group':
    require exists members[chat = chat, principal = viewer, role = 'admin'] else NOT_ADMIN
  else:
    require name = null and description = null else GROUP_REQUIRED
  if color != null:
    require color = '#4F46E5' or color = '#0D9488' or color = '#EF6351' or color = '#D97706' or color = '#7C3AED' or color = '#059669' or color = '#E11D48' or color = '#475569' else BAD_COLOR
  update chats[r] { name: name ?? r.name, description: description ?? r.description, color: color ?? r.color, background: background ?? r.background, disappearing: disappearing ?? r.disappearing }
query searchChat(chat: chats, q: text <=100, c: cursor ?):
  return messages where .chat = chat and not .deleted matching q last 50 by .at after c
query searchMessages(q: text <=100, c: cursor ?):
  return members where .principal = viewer and exists (messages[chat = .chat] matching q where not .deleted) first 20 by .chat after c { chat, room: chats[.chat], hits: messages[chat = .chat] matching q where not .deleted last 50 by .at }

query apiHistory(conversationId: chats, c: cursor ?):
  return messages where .chat = conversationId last 50 by .ordinal after c { id, conversationId: .chat, senderId: .sender, serverTimestamp: .at, type: 'view-once' if .oncePhoto != null else 'video' if .video != null else 'photo' if .photo != null else 'text', text: .body, mediaRef: .oncePhoto ?? .video ?? .photo, edited: .edited, tombstone: .deleted, replyTo: .quote, reactions: chips(.id, .chat) if exists members[.chat, viewer] else [], receipt: receipt(.) if .sender = viewer and exists members[.chat, viewer] else null }

job backfillArrivals():
  for room in chats:
    n = 0
    for m in messages where .chat = room.id by .at:
      n = n + 1
      update messages[m] { ordinal: n }
    update chats[room] { lastOrdinal: n }
query message(id: messages):
  return messages[id] messageCard

view messageBlockCounts: count messages where not .deleted by .chat, .block
view ownMessageBlockCounts: count messages where not .deleted by .chat, .block, .sender
fn unreadFor(member: members):
  boundary = member.readOrdinal / 128
  whole = sum(messageBlockCounts where .chat = member.chat and .block > boundary, .value)
  own = sum(ownMessageBlockCounts where .chat = member.chat and .sender = member.principal and .block > boundary, .value)
  edge = count(messages where .chat = member.chat and .block = boundary and .ordinal > member.readOrdinal and .sender != member.principal and not .deleted)
  return whole - own + edge
job backfillMessageBlocks():
  for m in messages:
    update messages[m] { block: m.ordinal / 128 }
