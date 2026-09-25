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
  cap 1 by principal
  search displayName, handle
  public 'Registered profiles are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

query myProfile():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query whoAmI():
  return viewer
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=2000 format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  replyCount: count posts by parentId
  immutable authorId, parentId, at
  public 'Posts and replies are public.'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'The follow graph is public.'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'Likes are public.'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table reposts:
  postId: posts
  actorId: principal
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'Reposts are public.'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

view followerCounts: count follows by .followedId
view followingCounts: count follows by .followerId
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query post(postId: posts):
  return posts[postId] postCard
query replies(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 20 by .at after c postCard
query userPosts(owner: principal, c: cursor ?):
  return posts where .authorId = owner and .parentId = null last 20 by .at after c postCard
query followStats(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], followed: exists follows[viewer, owner] }
mutation setFollow(owner: principal, active: bool):
  require owner != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = owner] else NOT_FOUND
  if active:
    insert follows { followerId: viewer, followedId: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation createPost(postId: id, body: text <=500, parentId: posts ?, photo1: image <=10000000 ?, photo2: image <=10000000 ?, photo3: image <=10000000 ?, photo4: image <=10000000 ?, video: video <=50000000 ?):
  if parentId != null:
    require exists posts[parentId] else NOT_FOUND
    require photo1 = null and photo2 = null and photo3 = null and photo4 = null and video = null else REPLY_TEXT_ONLY
  require video = null or (photo1 = null and photo2 = null and photo3 = null and photo4 = null) else MIXED_MEDIA
  require count(body) > 0 or photo1 != null or video != null else EMPTY_POST
  if video != null:
    duration = video.duration
    require duration != null and duration <= 60000 else VIDEO_TOO_LONG
  return insert posts { id: postId, authorId: viewer, parentId, body, photo1, photo2, photo3, photo4, video, at: now }
mutation setLike(postId: posts, active: bool):
  require exists posts[postId] else NOT_FOUND
  if active:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, active: bool):
  p = posts[postId] ! else NOT_FOUND
  require p.parentId = null else ORIGINAL_REQUIRED
  if active:
    insert reposts { postId, actorId: viewer, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
query followingAccounts(owner: principal, c: cursor ?):
  return follows where .followerId = owner first 50 by .followedId after c { *, profile: profiles[principal = .followedId] }
query followers(owner: principal, c: cursor ?):
  return follows where .followedId = owner first 50 by .followerId after c { *, profile: profiles[principal = .followerId] }

table conversations:
  name: text 1..50
  description: text <=200
  kind: enum('dm', 'group')
  accent: text <=7 default '#4F46E5'
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  creator: principal
  lastOrdinal: int default 0
  at: time
  immutable creator, kind
  read <- exists memberships[.id, viewer]
  insert <- .creator = viewer
  update <- exists memberships[.id, viewer]
  after insert <- exists memberships[conversationId = .id, principal = .creator, role = 'admin']
  retain delivered-history
  sync to memberships[.id]

table dmPairs:
  owner: principal
  other: principal
  conversationId: conversations
  unique owner, other
  immutable owner, other, conversationId
  read <- .owner = viewer
  insert <- created conversations[id = .conversationId, creator = viewer]
  sync to .owner

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  joinedOrdinal: int default 0
  deliveredOrdinal: int default 0
  readOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt, joinedOrdinal
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or created conversations[.conversationId]
  update <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  text: text <=2000
  photo: image <=10000000 ?
  video: video <=50000000 ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  editedAt: time ?
  deleted: bool default false
  replyTo: messages ?
  recipients: [principal] <=50
  ordinal: int
  at: time
  immutable conversationId, senderId, ordinal, at, recipients, replyTo
  search text
  read <- exists memberships[.conversationId, viewer]
  insert <- .senderId = viewer and exists memberships[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  retain delivered-history
  sync to memberships[.conversationId] last 500 by .ordinal

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  immutable conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  expire at .expiresAt
  sync to memberships[.conversationId]

query dm(other: principal):
  return dmPairs[viewer, other]
query conversation(conversationId: conversations):
  return conversations[conversationId]
query groupByName(name: text 1..50, c: cursor ?):
  return conversations where .name = name and .kind = 'group' first 20 by .id after c
query roster(conversationId: conversations):
  return memberships where .conversationId = conversationId { *, profile: profiles[principal = .principal] }
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
query allPeople(c: cursor ?):
  return profiles first 20 by .handle after c
query inbox(c: cursor ?):
  return memberships where .principal = viewer first 50 by .conversationId after c { *, unread: unreadCount(.conversationId, .readOrdinal), room: conversations[.conversationId], latest: messages[conversationId = .conversationId] last 1 by .ordinal { text, deleted, photo, video, oncePhoto }, peers: memberships[conversationId = .conversationId] { principal, profile: profiles[principal = .principal] } }
query typingNow(conversationId: conversations):
  return typing where .conversationId = conversationId and .principal != viewer first 50 by .principal { *, profile: profiles[principal = .principal] }
fn receipt(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  state = 2
  for p in msg.recipients:
    member = memberships[msg.conversationId, p]
    if member != null and member.joinedOrdinal <= msg.ordinal:
      if member.deliveredOrdinal < msg.ordinal:
        state = 0
      else if member.readOrdinal < msg.ordinal:
        state = min(state, 1)
  return 'read' if state = 2 else ('delivered' if state = 1 else 'sent')
shape messageCard = { *, sender: profiles[principal = .senderId], quote: messages[.replyTo] { text, sender: profiles[principal = .senderId] } }
query history(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 50 by .ordinal after c messageCard
query message(messageId: messages):
  return messages[messageId] messageCard
mutation createDM(conversationId: id, other: principal):
  require other != viewer else CANNOT_DM_SELF
  require exists profiles[principal = other] else NOT_FOUND
  existing = dmPairs[viewer, other]
  if existing != null:
    return existing.conversationId
  room = insert conversations { id: conversationId, name: 'Direct message', description: '', kind: 'dm', creator: viewer, at: now }
  insert memberships { conversationId: room.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: room.id, principal: other, role: 'member', joinedAt: now }
  insert dmPairs { owner: viewer, other, conversationId: room.id }
  insert dmPairs { owner: other, other: viewer, conversationId: room.id }
  return room.id
mutation createGroup(conversationId: id, name: text 1..50, description: text <=200, second: principal):
  require second != viewer else SECOND_MEMBER_REQUIRED
  require exists profiles[principal = second] else NOT_FOUND
  room = insert conversations { id: conversationId, name, description, kind: 'group', creator: viewer, at: now }
  insert memberships { conversationId: room.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: room.id, principal: second, role: 'member', joinedAt: now }
  return room.id
mutation addMember(conversationId: conversations, principal: principal):
  room = conversations[conversationId] ! else NOT_FOUND
  require room.kind = 'group' else GROUP_REQUIRED
  require exists profiles[principal = principal] else NOT_FOUND
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  insert memberships { conversationId, principal, role: 'member', joinedAt: now, joinedOrdinal: room.lastOrdinal + 1 } if absent
mutation removeMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversationId].kind = 'group' else GROUP_REQUIRED
  delete memberships[conversationId, principal]
mutation promoteMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  require conversations[conversationId].kind = 'group' else GROUP_REQUIRED
  update memberships[conversationId, principal] { role: 'admin' }
mutation leaveGroup(conversationId: conversations):
  require conversations[conversationId].kind = 'group' else GROUP_REQUIRED
  delete memberships[conversationId, viewer]
mutation send(messageId: id, conversationId: conversations, text: text <=2000, replyTo: messages ?, photo: image <=10000000 ?, video: video <=50000000 ?, oncePhoto: image <=10000000 ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  room = conversations[conversationId] ! else NOT_FOUND
  if replyTo != null:
    require messages[replyTo].conversationId = conversationId else INVALID_QUOTE
  require not (photo != null and video != null) else MEDIA_MIX
  require oncePhoto = null or (photo = null and video = null) else MEDIA_MIX
  require text != '' or photo != null or video != null or oncePhoto != null else EMPTY_MESSAGE
  if photo != null or video != null or oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  recipients = []
  for m in memberships where .conversationId = conversationId:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  ordinal = room.lastOrdinal + 1
  update conversations[conversationId] { lastOrdinal: ordinal, at: now }
  msg = insert messages { id: messageId, conversationId, senderId: viewer, text, photo, video, oncePhoto, expiresAt: now + dayMs() if room.disappearing = '24h' else (now + weekMs() if room.disappearing = '7d' else null), replyTo, recipients, ordinal, at: now }
  for recipient in recipients:
    if not exists connected[recipient]:
      emit notify { targetUserId: recipient, chatId: conversationId, senderDisplayName: profiles[principal = viewer].displayName, preview: 'Photo' if photo != null or oncePhoto != null else ('Video' if video != null else slice(text, 0, 80)), messageId }
  return msg
mutation markReceipt(conversationId: conversations, ordinal: int, read: bool):
  member = memberships[conversationId, viewer] ! else NOT_MEMBER
  room = conversations[conversationId] ! else NOT_FOUND
  require ordinal >= 0 and ordinal <= room.lastOrdinal else INVALID_ORDINAL
  update memberships[conversationId, viewer] { deliveredOrdinal: max(member.deliveredOrdinal, ordinal), readOrdinal: max(member.readOrdinal, ordinal) if read else member.readOrdinal }
mutation setTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { expiresAt: now + 3s }

query receiptFor(messageId: messages):
  return receipt(messageId)

query rawHistory(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 50 by .ordinal after c


table reactions:
  messageId: messages
  conversationId: conversations
  principal: principal
  emoji: text 1..64
  unique messageId, principal
  cap 50 by messageId
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- .principal = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId]
query messageReactions(messageId: messages):
  return reactions where .messageId = messageId
mutation setReaction(messageId: messages, emoji: text 1..64 ?):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  require not msg.deleted else MESSAGE_DELETED
  if emoji != null:
    upsert reactions[messageId, viewer] { conversationId: msg.conversationId, emoji }
  else if exists reactions[messageId, viewer]:
    delete reactions[messageId, viewer]
mutation editMessage(messageId: messages, text: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.senderId = viewer else NOT_AUTHOR
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  require not msg.deleted else MESSAGE_DELETED
  require now <= msg.at + editMs() else EDIT_WINDOW_CLOSED
  if msg.photo != null or msg.video != null or msg.oncePhoto != null:
    require count(text) <= 500 else CAPTION_TOO_LONG
  else:
    require text != '' else EMPTY_MESSAGE
  update messages[messageId] { text, editedAt: now }
mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.senderId = viewer else NOT_AUTHOR
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  require now <= msg.at + deleteMs() else DELETE_WINDOW_CLOSED
  update messages[messageId] { text: '', photo: null, video: null, oncePhoto: null, deleted: true }

mutation customize(conversationId: conversations, accent: text <=7 ?, background: image <=10000000 ?, name: text 1..50 ?, description: text <=200 ?, disappearing: enum('off', '24h', '7d') ?):
  room = conversations[conversationId] ! else NOT_FOUND
  member = memberships[conversationId, viewer] ! else NOT_MEMBER
  require room.kind = 'dm' or member.role = 'admin' else NOT_ADMIN
  if accent != null:
    require accent in ['#4F46E5', '#0D9488', '#EF6351', '#D97706', '#7C3AED', '#059669', '#E11D48', '#475569'] else INVALID_ACCENT
    update conversations[conversationId] { accent }
  if background != null:
    update conversations[conversationId] { background }
  if name != null:
    require room.kind = 'group' else GROUP_REQUIRED
    update conversations[conversationId] { name }
  if description != null:
    require room.kind = 'group' else GROUP_REQUIRED
    update conversations[conversationId] { description }
  if disappearing != null:
    update conversations[conversationId] { disappearing }
query searchChat(conversationId: conversations, q: text <=100, c: cursor ?):
  if q = '':
    return []
  return messages[conversationId = conversationId] matching q last 20 by .at after c messageCard
query searchMessages(q: text <=100, c: cursor ?):
  if q = '':
    return []
  return messages matching q where exists memberships[.conversationId, viewer] last 20 by .at after c { ...messageCard, room: conversations[.conversationId] }

fn unreadCount(conversationId: conversations, ordinal: int):
  return count(messages where .conversationId = conversationId and .ordinal > ordinal and not .deleted and .senderId != viewer)

view reactionTotals: count reactions by .conversationId, .messageId, .emoji
fn reactionSummary(messageId: messages, conversationId: conversations):
  return reactionTotals where .conversationId = conversationId and .messageId = messageId first 50 by .emoji { emoji, count: .value, mine: reactions[messageId, viewer].emoji = .emoji }
shape apiMessage = { ...messageCard, type: 'view-once' if .oncePhoto != null else ('photo' if .photo != null else ('video' if .video != null else 'text')), mediaReference: .oncePhoto if .oncePhoto != null else (.photo if .photo != null else .video), edited: .editedAt != null, tombstone: .deleted, reactions: reactionSummary(.id, .conversationId), receipt: receipt(.id) if .senderId = viewer else null }
query apiHistory(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId last 50 by .ordinal after c apiMessage
query apiMessageById(messageId: messages):
  return messages[messageId] apiMessage
query apiConversations(c: cursor ?):
  return memberships where .principal = viewer first 50 by .conversationId after c { *, room: conversations[.conversationId], peers: memberships[conversationId = .conversationId] { principal, profile: profiles[principal = .principal] } }
