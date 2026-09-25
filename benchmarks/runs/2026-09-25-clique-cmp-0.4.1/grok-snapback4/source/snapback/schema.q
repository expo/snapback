use identity password
effect notify
effect digestPush

table appConfig:
  key: text <=40
  intValue: int ?
  unique key
  public 'window and digest config'
  insert <- deny
  update <- deny
  sync public last 20 by .id

table aliases:
  name: text <=80
  target: id
  unique name
  public 'stable fixture aliases'
  insert <- allow
  update <- deny
  sync public

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
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'public follow edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500 ?
  image1: image <=10000000 ?
  image2: image <=10000000 ?
  image3: image <=10000000 ?
  image4: image <=10000000 ?
  clip: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable authorId, parentId, at
  public 'public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

view followerTotals: count follows by .followedId
  read <- allow
view followingTotals: count follows by .followerId
  read <- allow
view originalPostCounts: count posts where .parentId = null by .authorId
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
view replyCounts: count posts where .parentId != null by .parentId
  read <- allow
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  read <- allow
  online only
view dailyLikesReceived: count likes by .postId.authorId, day(.at)
  read <- allow
  online only

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  lastOrdinal: int default 0
  accent: text <=20 ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') default 'off'
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[conversationId = .id, principal = .creatorId]
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  deliveredOrdinal: int default 0
  readOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or created conversations[.conversationId]
  update <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  delete <- .principal = viewer or exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin']
  sync to memberships[.conversationId]

table dmPairs:
  conversationId: conversations
  userA: principal
  userB: principal
  unique userA, userB
  unique conversationId
  immutable conversationId, userA, userB
  read <- exists memberships[.conversationId, viewer]
  insert <- created conversations[.conversationId] or exists memberships[.conversationId, viewer]
  delete <- deny
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  ordinal: int
  body: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  clip: video <=50000000 ?
  viewOncePhoto: image <=10000000 once ?
  quoteId: messages ?
  editedAt: time ?
  tombstone: bool default false
  at: time
  expiresAt: time ?
  unique conversationId, ordinal
  search body, caption
  immutable conversationId, authorId, ordinal, at
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  expire at .expiresAt
  sync to memberships[.conversationId] last 500 by .ordinal

table messageRecipients:
  messageId: messages
  conversationId: conversations
  principal: principal
  unique messageId, principal
  cap 50 by messageId
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- exists messages[id = .messageId, authorId = viewer]
  delete <- deny
  sync to memberships[.conversationId] last 500 by .id

table reactions:
  conversationId: conversations
  messageId: messages
  principal: principal
  emoji: text <=16
  unique conversationId, messageId, principal
  cap 50 by conversationId, messageId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to memberships[.conversationId]

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- .principal = viewer
  expire at .expiresAt
  sync to memberships[.conversationId]

table chatFocus:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  expire at .expiresAt
  sync to memberships[.conversationId]

table pushLog:
  targetUserId: principal
  chatId: id ?
  senderDisplayName: text <=80
  preview: text <=80
  kind: enum('message', 'digest')
  periodStart: time ?
  periodEnd: time ?
  newFollowers: int ?
  newPostsInFollowing: int ?
  unreadMessages: int ?
  unreadChats: int ?
  at: time
  public 'push seam log'
  insert <- viewer = 'service:worker'
  update <- deny
  delete <- deny
  sync public last 200 by .at

query whoAmI():
  return viewer

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query myProfile():
  return profiles[principal = viewer]

query profileByHandle(handle: text 3..20 format handle):
  p = profiles[handle = handle]
  if p = null:
    return null
  return { profile: p, followers: followerTotals[p.principal], following: followingTotals[p.principal] }

query profileFor(owner: principal):
  return profiles[principal = owner]

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .handle

query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], actorProfile: profiles[principal = .actor], liked: exists likes[.post, viewer], reposted: exists reposts[viewer, .post], replies: replyCounts[.post] }

query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], actorProfile: profiles[principal = .actor], liked: exists likes[.post, viewer], reposted: exists reposts[viewer, .post], replies: replyCounts[.post] }

query trending(c: cursor ?):
  return posts where .at > now - 1d and .at <= now and not .removed and .parentId = null last 10 by .likeCount, .at after c

query postById(postId: posts):
  return posts[postId]

query threadReplies(postId: posts, c: cursor ?):
  return posts where .parentId = postId last 50 by .at after c

query likedByMe(postId: posts):
  return exists likes[postId, viewer]

query repostedByMe(postId: posts):
  return exists reposts[viewer, postId]

query replyCount(postId: posts):
  return replyCounts[postId]

query followingEdge(target: principal):
  return exists follows[viewer, target]

query insights():
  return {
    posts: originalPostCounts[viewer],
    likesReceived: likesReceived[viewer],
    repostsReceived: repostsReceived[viewer],
    repliesReceived: repliesReceived[viewer],
    followers: followerTotals[viewer],
    following: followingTotals[viewer]
  }

query insightsDay(day: time):
  return {
    posts: dailyPosts[viewer, day(day)],
    likesReceived: dailyLikesReceived[viewer, day(day)]
  }

query inbox(c: cursor ?):
  return memberships where .principal = viewer first 50 by .conversationId after c { conversationId, conversation: conversations[.conversationId], role, deliveredOrdinal, readOrdinal }

query conversation(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return { conversation: conversations[conversationId], membership: memberships[conversationId, viewer] }

query dmWith(other: principal):
  pair = dmPairs[userA = viewer, userB = other]
  if pair = null:
    pair = dmPairs[userA = other, userB = viewer]
  return pair

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages where .conversationId = conversationId last 50 by .ordinal after c

query membersOf(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships where .conversationId = conversationId

query chatRecipients(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messageRecipients where .conversationId = conversationId first 50 by .id after c

query recipientsOf(conversationId: conversations, messageId: messages):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messageRecipients where .conversationId = conversationId and .messageId = messageId

query reactionsOf(conversationId: conversations, messageId: messages):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return reactions where .conversationId = conversationId and .messageId = messageId

query typingNow(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return typing where .conversationId = conversationId { principal, expiresAt }

query focusingNow(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return chatFocus where .conversationId = conversationId { principal, expiresAt }

query directory(c: cursor ?):
  return profiles first 50 by .handle after c

query memberPresence(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships where .conversationId = conversationId { principal, role, deliveredOrdinal, readOrdinal, online: exists connected[.principal] }

query latestForMe(c: cursor ?):
  return messages last 30 by .at after c { conversationId, ordinal, authorId }

query connections(p: principal):
  return connected[p]

query inChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId = conversationId] matching q after c last 50 by .at

query searchGrouped(q: text <=100, c: cursor ?):
  return memberships[principal = viewer] after c first 20 by .conversationId where exists (messages[conversationId = .conversationId] by .at matching q) { conversationId, hits: messages[conversationId = .conversationId] matching q last 3 by .at }

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at

query recentPush(c: cursor ?):
  return pushLog last 50 by .at after c

query configValue(key: text <=40):
  return appConfig[key = key]

query aliasOf(name: text <=80):
  return aliases[name = name]

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=2048 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
  return null

mutation placeAvatar(avatar: image <=10000000):
  p = profiles[principal = viewer] ! else PROFILE_REQUIRED
  update profiles[p] { avatar }
  return null

mutation setFollow(target: principal, on: bool):
  require target != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = target] else USER_NOT_FOUND
  if on:
    insert follows { followerId: viewer, followedId: target, at: now } if absent
  else if exists follows[viewer, target]:
    delete follows[viewer, target]
  return null

mutation createPost(body: text <=500 ?, image1: image <=10000000 ?, image2: image <=10000000 ?, image3: image <=10000000 ?, image4: image <=10000000 ?, clip: video <=50000000 ?):
  if clip != null:
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
  row = insert posts { authorId: viewer, body, image1, image2, image3, image4, clip, at: now }
  return { id: row.id }

mutation replyTo(parentId: posts, body: text <=500):
  parent = posts[parentId] ! else POST_NOT_FOUND
  require parent.parentId = null else NOT_TOP_LEVEL
  row = insert posts { authorId: viewer, parentId, body, at: now }
  return { id: row.id }

mutation setLike(postId: posts, on: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if on:
    require not p.removed else POST_REMOVED
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
  return null

mutation setRepost(postId: posts, on: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  require p.parentId = null else NOT_TOP_LEVEL
  if on:
    require not p.removed else POST_REMOVED
    insert reposts { actorId: viewer, postId, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
  return null

mutation openDM(other: principal, userA: principal, userB: principal):
  require other != viewer else BAD_PAIR
  require viewer = userA or viewer = userB else NOT_PARTICIPANT
  require other = userA or other = userB else NOT_PARTICIPANT
  existing = dmPairs[userA, userB]
  if existing != null:
    return { id: existing.conversationId }
  c = insert conversations { kind: 'dm', creatorId: viewer }
  insert memberships { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: c.id, principal: other, role: 'member', joinedAt: now }
  insert dmPairs { conversationId: c.id, userA, userB }
  return { id: c.id }

mutation createGroup(name: text 1..50, description: text <=200 ?, other: principal):
  require other != viewer else BAD_MEMBER
  c = insert conversations { kind: 'group', title: name, description, creatorId: viewer }
  insert memberships { conversationId: c.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: c.id, principal: other, role: 'member', joinedAt: now }
  return { id: c.id }

mutation addMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  insert memberships { conversationId, principal, role: 'member', joinedAt: now } if absent
  return null

mutation removeMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  require principal != viewer else USE_LEAVE
  membership = memberships[conversationId, principal] ! else NOT_MEMBER
  delete memberships[membership]
  return null

mutation promoteMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  membership = memberships[conversationId, principal] ! else NOT_MEMBER
  update memberships[membership] { role: 'admin' }
  return null

mutation leaveConversation(conversationId: conversations):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[membership]
  return null

mutation renameGroup(conversationId: conversations, name: text 1..50, description: text <=200 ?):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  conv = conversations[conversationId] ! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  update conversations[conv] { title: name, description }
  return null

mutation setChatStyle(conversationId: conversations, accent: text <=20 ?, disappearing: enum('off', '24h', '7d') ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conv = conversations[conversationId] ! else NOT_FOUND
  if conv.kind = 'group':
    require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  if accent != null:
    update conversations[conv] { accent }
  if disappearing != null:
    update conversations[conv] { disappearing }
  return null

mutation placeChatBackground(conversationId: conversations, background: image <=10000000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conv = conversations[conversationId] ! else NOT_FOUND
  if conv.kind = 'group':
    require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  update conversations[conv] { background }
  return null

mutation send(conversationId: conversations, body: text <=2000, quoteId: messages ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conversation = conversations[conversationId] ! else NOT_FOUND
  if quoteId != null:
    quoted = messages[quoteId] ! else QUOTE_NOT_FOUND
    require quoted.conversationId = conversationId else QUOTE_WRONG_CHAT
  ttl = 90000 if conversation.disappearing = '24h' else 120000 if conversation.disappearing = '7d' else null
  expiresAt = now + ttl if ttl != null else null
  ordinal = conversation.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  row = insert messages { conversationId, authorId: viewer, ordinal, body, quoteId, at: now, expiresAt }
  me = profiles[principal = viewer]
  preview = slice(body, 0, 80)
  sender = me.displayName if me != null else 'Someone'
  for m in memberships where .conversationId = conversationId:
    if m.principal != viewer:
      insert messageRecipients { messageId: row.id, conversationId, principal: m.principal }
      if not exists connected[m.principal]:
        emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: sender, preview }
  return { id: row.id }

mutation sendMedia(conversationId: conversations, caption: text <=500 ?, photo: image <=10000000 ?, clip: video <=50000000 ?, viewOnce: bool):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conversation = conversations[conversationId] ! else NOT_FOUND
  if clip != null:
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
    require not viewOnce else VIEW_ONCE_PHOTO_ONLY
  ttl = 90000 if conversation.disappearing = '24h' else 120000 if conversation.disappearing = '7d' else null
  expiresAt = now + ttl if ttl != null else null
  ordinal = conversation.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  photoNormal = photo if not viewOnce else null
  photoOnce = photo if viewOnce else null
  row = insert messages { conversationId, authorId: viewer, ordinal, caption, photo: photoNormal, clip, viewOncePhoto: photoOnce, at: now, expiresAt }
  me = profiles[principal = viewer]
  sender = me.displayName if me != null else 'Someone'
  preview = 'Video' if clip != null else 'Photo'
  for m in memberships where .conversationId = conversationId:
    if m.principal != viewer:
      insert messageRecipients { messageId: row.id, conversationId, principal: m.principal }
      if not exists connected[m.principal]:
        emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: sender, preview }
  return { id: row.id }

mutation editMessage(messageId: messages, body: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else DELETED
  require now - msg.at <= 60000 else EDIT_WINDOW
  update messages[msg] { body, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require now - msg.at <= 120000 else DELETE_WINDOW
  update messages[msg] { tombstone: true, body: null, caption: null, photo: null, clip: null, viewOncePhoto: null }
  return null

mutation setReaction(messageId: messages, emoji: text <=16 ?):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  require not msg.tombstone else DELETED
  if emoji = null:
    if exists reactions[msg.conversationId, messageId, viewer]:
      delete reactions[msg.conversationId, messageId, viewer]
  else:
    upsert reactions[msg.conversationId, messageId, viewer] { conversationId: msg.conversationId, messageId, principal: viewer, emoji }
  return null

mutation setTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 4500 }
  return null

mutation heartbeatFocus(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert chatFocus[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 20000 }
  return null

mutation markDelivered(conversationId: conversations, ordinal: int):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  if ordinal > membership.deliveredOrdinal:
    update memberships[membership] { deliveredOrdinal: ordinal }
  return null

mutation markRead(conversationId: conversations, ordinal: int):
  membership = memberships[conversationId, viewer] ! else NOT_MEMBER
  nextDelivered = ordinal if ordinal > membership.deliveredOrdinal else membership.deliveredOrdinal
  nextRead = ordinal if ordinal > membership.readOrdinal else membership.readOrdinal
  update memberships[membership] { deliveredOrdinal: nextDelivered, readOrdinal: nextRead }
  return null

mutation putAlias(name: text <=80, target: id):
  insert aliases { name, target } if absent
  return null

mutation logPush(targetUserId: principal, chatId: id ?, senderDisplayName: text <=80, preview: text <=80, kind: enum('message', 'digest'), periodStart: time ?, periodEnd: time ?, newFollowers: int ?, newPostsInFollowing: int ?, unreadMessages: int ?, unreadChats: int ?):
  require viewer = 'service:worker' else NOT_SERVICE
  insert pushLog { targetUserId, chatId, senderDisplayName, preview, kind, periodStart, periodEnd, newFollowers, newPostsInFollowing, unreadMessages, unreadChats, at: now }
  return null

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages where .conversationId = conversationId and .at >= periodStart and .at < periodEnd and not .tombstone and .authorId != reader and .ordinal > readOrdinal)

job digest(periodStart: time, periodEnd: time):
  for p in profiles:
    unread = 0
    chats = 0
    newFollowers = count(follows where .followedId = p.principal and .at >= periodStart and .at < periodEnd)
    newPosts = 0
    for e in follows where .followerId = p.principal:
      n = count(posts where .authorId = e.followedId and .parentId = null and .at >= periodStart and .at < periodEnd)
      newPosts = newPosts + n
    for m in memberships where .principal = p.principal:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0 or newFollowers > 0 or newPosts > 0:
      emit digestPush { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages: unread, unreadChats: chats } once [p.principal, periodEnd]

schedule digestEvery every 2m: digest
