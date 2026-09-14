-- Clique backend (Snapback 4 / Quarry). Windows and digest periods are
-- seeded from fixtures/config/*shortened.json so grading is testable.
use identity

effect push

table runtime:
  flag: enum('live', 'replay')
  public 'single-row replay flag'
  insert <- deny
  update <- viewer = 'service:ops'
  sync public

table windows:
  k: enum('editMs', 'deleteMs', 'ttl24h', 'ttl7d', 'digestMs', 'trendingMs')
  ms: int
  unique byK: k
  public 'server window config'
  insert <- deny
  update <- deny
  sync public

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=200 format url ?
  avatar: image <=10000000 ?
  unique byPrincipal: principal
  unique byHandle: handle
  by byNameWords: words(displayName, handle), id
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by byId

-- ---------------------------------------------------------------------------
-- Follow graph + Following feed (fan-out on write)
-- ---------------------------------------------------------------------------

table follows:
  followerId: principal
  followedId: principal
  bucket: int
  at: time
  unique byPair: followerId, followedId
  by byFollower: followerId, followedId
  by byFollowed: followedId, followerId
  by byFollowedBucket: followedId, bucket, followerId
  cap 1000 by followedId
  cap 200 by followedId, bucket
  public 'follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public last 2000 by byId

table posts:
  authorId: principal
  body: text <=500
  kind: enum('text', 'images', 'video')
  image1: image <=10000000 ?
  image2: image <=10000000 ?
  image3: image <=10000000 ?
  image4: image <=10000000 ?
  clip: video <=50000000 ?
  day: int
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  by byAuthorDay: authorId, day, id
  cap 500 by authorId
  public 'original posts are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 500 by byTime

table replies:
  parentId: posts
  parentAuthorId: principal
  authorId: principal
  body: text <=500
  at: time
  by byParentTime: parentId, at, id
  by byAuthorTime: authorId, at, id
  public 'replies are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 500 by byParentTime

table likes:
  postId: posts
  authorId: principal
  principal: principal
  day: int
  at: time
  unique byPostPrincipal: postId, principal
  by byPost: postId, principal
  by byAuthorDay: authorId, day, id
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by byId

table reposts:
  postId: posts
  authorId: principal
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPost: postId, principal
  by byPrincipalTime: principal, at, id
  cap 200 by principal
  public 'reposts are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by byId

table timeline:
  postId: posts
  authorId: principal
  actorId: principal
  kind: enum('original', 'repost')
  at: time
  unique byPostActorKind: postId, actorId, kind
  by byTime: at, id
  public 'global feed'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 200 by byTime

table feed:
  readerId: principal
  postId: posts
  authorId: principal
  actorId: principal
  kind: enum('original', 'repost')
  at: time
  unique byReaderPostKindActor: readerId, postId, kind, actorId
  by byReaderTime: readerId, at, id
  by byReaderKindAuthor: readerId, kind, authorId, id
  by byReaderKindActor: readerId, kind, actorId, id
  cap 200 by readerId, kind, authorId
  cap 200 by readerId, kind, actorId
  read <- .readerId = viewer
  insert <- .readerId = viewer or .actorId = viewer
  delete <- .readerId = viewer
  sync to .readerId last 200 by byReaderTime

table fanouts:
  postId: posts
  actorId: principal
  postAuthorId: principal
  kind: enum('original', 'repost')
  at: time
  read <- deny
  insert <- .actorId = viewer
  delete <- deny

table trending:
  postId: posts
  likes: int
  at: time
  expiresAt: time
  unique byPost: postId
  by byLikesAt: likes, at, id
  by byExpiresAt: expiresAt
  public 'trending window'
  insert <- allow
  update <- allow
  delete <- deny
  expire at .expiresAt
  sync public last 10 by byLikesAt

maintain likeCounts: count likes by postId
  read <- allow
maintain repostCounts: count reposts by postId
  read <- allow
maintain replyCounts: count replies by parentId
  read <- allow
maintain followerCount: count follows by followedId
  read <- allow
maintain followingCount: count follows by followerId
  read <- allow
maintain myPostCount: count posts by authorId
  read <- allow
maintain likesReceived: count likes by authorId
  read <- allow
maintain repostsReceived: count reposts by authorId
  read <- allow
maintain repliesReceived: count replies by parentAuthorId
  read <- allow
maintain dailyPostCount: count posts by authorId, day
  read <- allow
maintain dailyLikesReceived: count likes by authorId, day
  read <- allow

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

table conversations:
  kind: enum('dm', 'group')
  creatorId: principal
  name: text 1..50 ?
  description: text <=200 ?
  color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate')
  disappearing: enum('off', '24h', '7d')
  background: image <=10000000 ?
  createdAt: time
  by byName: name, id
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer, 'admin'] or (.kind = 'dm' and exists memberships[.id, viewer])
  delete <- deny
  after insert <- exists memberships[.id, .creatorId]
  retain delivered-history
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin'] or created conversations[.conversationId]
  update <- exists memberships[.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists memberships[.conversationId, viewer, 'admin']
  retain delivered-history
  sync to memberships[.conversationId]

table dmIndex:
  a: principal
  b: principal
  conversationId: conversations
  unique byPair: a, b
  by byConversation: conversationId, a, b
  read <- .a = viewer or .b = viewer
  insert <- .a = viewer or .b = viewer
  delete <- deny

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  quoteId: messages ?
  tombstoned: bool
  editedAt: time ?
  expiresAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  by byConvWords: conversationId, words(body, caption), at, id
  by byWords: words(body, caption), at, id
  by byExpiresAt: expiresAt
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer or exists memberships[.conversationId, viewer]
  delete <- .authorId = viewer
  retain delivered-history
  expire at .expiresAt
  sync to memberships[.conversationId] last 500 by byConvTime

table recipients:
  messageId: messages
  conversationId: conversations
  principal: principal
  unique byMessagePrincipal: messageId, principal
  by byMessage: messageId, principal
  by byConvPrincipal: conversationId, principal, id
  by byPrincipal: principal, id
  cap 50 by messageId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  delete <- deny
  retain delivered-history
  sync to memberships[.conversationId] last 500 by byConvPrincipal

table receipts:
  messageId: messages
  conversationId: conversations
  principal: principal
  state: enum('delivered', 'read')
  at: time
  unique byMessagePrincipal: messageId, principal
  by byConvPrincipal: conversationId, principal, at, id
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- deny
  retain delivered-history
  sync to memberships[.conversationId] last 500 by byConvPrincipal

table reactions:
  messageId: messages
  conversationId: conversations
  principal: principal
  emoji: text 1..16
  unique byMessagePrincipal: messageId, principal
  by byMessage: messageId, principal
  by byConv: conversationId, messageId, id
  cap 50 by messageId
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  retain delivered-history
  sync to memberships[.conversationId] last 500 by byConv

table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique byConvPrincipal: conversationId, principal
  by byConv: conversationId, principal
  by byExpiresAt: expiresAt
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  expire at .expiresAt
  sync to memberships[.conversationId]

table unreads:
  conversationId: conversations
  principal: principal
  count: int
  unique byConvPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  update <- exists memberships[.conversationId, viewer] or .principal = viewer
  delete <- .principal = viewer
  sync to memberships[.conversationId]

table viewOnceOpens:
  messageId: messages
  principal: principal
  at: time
  unique byMessagePrincipal: messageId, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- deny
  sync to .principal last 200 by byPrincipal

-- ---------------------------------------------------------------------------
-- Digest accumulators
-- ---------------------------------------------------------------------------

table digestAcc:
  principal: principal
  periodStart: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  unique byPrincipalPeriod: principal, periodStart
  by byPeriod: periodStart, principal, id
  immutable principal, periodStart
  read <- allow
  insert <- allow
  update <- allow
  delete <- deny

table digestHits:
  postId: posts
  readerId: principal
  unique byPostReader: postId, readerId
  read <- allow
  insert <- allow
  delete <- deny

table digestMsgHits:
  messageId: messages
  principal: principal
  unique byMessagePrincipal: messageId, principal
  read <- allow
  insert <- allow
  delete <- deny

table digestChatHits:
  periodStart: time
  conversationId: conversations
  principal: principal
  unique byPeriodConvPrincipal: periodStart, conversationId, principal
  immutable periodStart, conversationId, principal
  read <- allow
  insert <- allow
  delete <- deny

table digestLog:
  principal: principal
  periodStart: time
  unique byPrincipalPeriod: principal, periodStart
  immutable principal, periodStart
  read <- deny
  insert <- deny
  delete <- deny

-- ===========================================================================
-- Queries
-- ===========================================================================

query me():
  return profiles[viewer] { *, followers: followerCount[.principal], following: followingCount[.principal], posts: myPostCount[.principal], likesIn: likesReceived[.principal], repostsIn: repostsReceived[.principal], repliesIn: repliesReceived[.principal] }

query profileByHandle(handle: text 3..20 format handle):
  row = profiles[handle]
  return row { *, followers: followerCount[.principal], following: followingCount[.principal], iFollow: follows[viewer, .principal] }

query profilePosts(authorId: principal, c: cursor ?):
  return posts[authorId] after c last 20 by byAuthorTime { *, likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], liked: likes[.id, viewer], reposted: reposts[.id, viewer], author: profiles[.authorId] }

query followingFeed(c: cursor ?):
  return feed[viewer] after c last 20 by byReaderTime { *, actor: profiles[.actorId], post: posts[.postId] { *, likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], liked: likes[.id, viewer], reposted: reposts[.id, viewer], author: profiles[.authorId] } }

query globalFeed(c: cursor ?):
  return timeline after c last 20 by byTime { *, actor: profiles[.actorId], post: posts[.postId] { *, likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], liked: likes[.id, viewer], reposted: reposts[.id, viewer], author: profiles[.authorId] } }

query trendingFeed():
  return trending last 10 by byLikesAt { *, post: posts[.postId] { *, likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], liked: likes[.id, viewer], reposted: reposts[.id, viewer], author: profiles[.authorId] } }

query post(postId: posts):
  return posts[postId] { *, likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], liked: likes[.id, viewer], reposted: reposts[.id, viewer], author: profiles[.authorId] }

query thread(postId: posts, c: cursor ?):
  return replies[postId] after c first 50 by byParentTime { *, author: profiles[.authorId] }

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords { *, followers: followerCount[.principal], following: followingCount[.principal] }

query allPeople(c: cursor ?):
  return profiles after c first 50 by byId { *, followers: followerCount[.principal], following: followingCount[.principal] }

query inbox(c: cursor ?):
  return memberships[viewer] after c first 50 by byPrincipalConversation { *, conversation: conversations[.conversationId], unread: unreads[.conversationId, viewer] }

query groupByName(name: text 1..50):
  return conversations[name] first 10 by byName

query dmWith(other: principal):
  return memberships[viewer] first 50 by byPrincipalConversation { *, conversation: conversations[.conversationId] }

query dmByPair(a: principal, b: principal):
  return dmIndex[a, b]

query conversationOf(conversationId: conversations):
  return conversations[conversationId]

query myRecipientRows():
  return recipients[viewer] first 200 by byPrincipal

query threadMessages(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConvTime { *, author: profiles[.authorId], quote: messages[.quoteId], myReaction: reactions[.id, viewer] }

query messageReactions(messageId: messages):
  return reactions[messageId] first 50 by byMessage

query recipientsOf(messageId: messages):
  return recipients[messageId] first 50 by byMessage

query receiptsOf(messageId: messages):
  return receipts[messageId] first 50 by byMessagePrincipal

query convReceipts(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return receipts[conversationId] first 200 by byConvPrincipal

query convRecipients(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return recipients[conversationId] first 200 by byConvPrincipal

query convReactions(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return reactions[conversationId] first 200 by byConv

query membersOf(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships[conversationId] first 50 by byConversationPrincipal { *, profile: profiles[.principal] }

query typingIn(conversationId: conversations):
  return typing[conversationId] first 50 by byConv

query inChatSearch(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] matching q after c last 50 by byConvWords { *, author: profiles[.authorId] }

query allMessageSearch(q: text <=100, c: cursor ?):
  return messages matching q after c last 50 by byWords { *, author: profiles[.authorId], conversation: conversations[.conversationId] }

query insights():
  (today, _) = divmod(now, 86400000)
  return {
    posts: myPostCount[viewer],
    likesReceived: likesReceived[viewer],
    repostsReceived: repostsReceived[viewer],
    repliesReceived: repliesReceived[viewer],
    followers: followerCount[viewer],
    following: followingCount[viewer],
    today: today,
    p0: dailyPostCount[viewer, today],
    p1: dailyPostCount[viewer, today - 1],
    p2: dailyPostCount[viewer, today - 2],
    p3: dailyPostCount[viewer, today - 3],
    p4: dailyPostCount[viewer, today - 4],
    p5: dailyPostCount[viewer, today - 5],
    p6: dailyPostCount[viewer, today - 6],
    l0: dailyLikesReceived[viewer, today],
    l1: dailyLikesReceived[viewer, today - 1],
    l2: dailyLikesReceived[viewer, today - 2],
    l3: dailyLikesReceived[viewer, today - 3],
    l4: dailyLikesReceived[viewer, today - 4],
    l5: dailyLikesReceived[viewer, today - 5],
    l6: dailyLikesReceived[viewer, today - 6]
  }

query viewOnceOpened(messageId: messages):
  return viewOnceOpens[messageId, viewer]

query windowsConfig():
  return {
    editMs: windows['editMs'] by byK,
    deleteMs: windows['deleteMs'] by byK,
    ttl24h: windows['ttl24h'] by byK,
    ttl7d: windows['ttl7d'] by byK
  }

query runtimeFlag():
  return runtime['runtime']

-- ===========================================================================
-- Mutations
-- ===========================================================================

mutation upsertProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=200 format url ?, avatar: image <=10000000 ?):
  existing = profiles[viewer]
  if existing != null:
    update profiles[existing] { displayName, handle, bio, location, link, avatar }
    return profiles[viewer]
  return insert profiles { principal: viewer, displayName, handle, bio, location, link, avatar }

mutation setAvatar(avatar: image <=10000000):
  existing = profiles[viewer] ! else PROFILE_REQUIRED
  update profiles[existing] { avatar }
  return null

mutation follow(target: principal, on: bool):
  require target != viewer else CANNOT_FOLLOW_SELF
  existing = follows[viewer, target]
  if on:
    if existing = null:
      n = followerCount[target]
      (bucket, bucketRest) = divmod(n, 200)
      insert follows { followerId: viewer, followedId: target, bucket, at: now }
      for p in posts[target] first 500 by byAuthorTime:
        insert feed { readerId: viewer, postId: p.id, authorId: target, actorId: target, kind: 'original', at: p.at } if absent
      for r in reposts[target] first 200 by byPrincipalTime:
        insert feed { readerId: viewer, postId: r.postId, authorId: r.authorId, actorId: target, kind: 'repost', at: r.at } if absent
      dcfg = windows['digestMs'] by byK
      ms = dcfg.ms if dcfg != null else 120000
      (periodQ, rem) = divmod(now, ms)
      periodStart = now - rem
      acc = digestAcc[target, periodStart]
      if acc = null:
        insert digestAcc { principal: target, periodStart, newFollowers: 1, newPostsInFollowing: 0, unreadMessages: 0, unreadChats: 0 }
      else:
        update digestAcc[acc] { newFollowers: acc.newFollowers + 1 }
    return follows[viewer, target]
  if existing != null:
    delete follows[existing]
    for f in feed[viewer, 'original', target] first 200 by byReaderKindAuthor:
      delete feed[f]
    for f in feed[viewer, 'repost', target] first 200 by byReaderKindActor:
      delete feed[f]
  return null

mutation createPost(postId: id, body: text <=500, kind: enum('text', 'images', 'video'), image1: image <=10000000 ?, image2: image <=10000000 ?, image3: image <=10000000 ?, image4: image <=10000000 ?, clip: video <=50000000 ?):
  if kind = 'video':
    require clip != null else VIDEO_REQUIRED
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  (day, _) = divmod(now, 86400000)
  p = insert posts { id: postId, authorId: viewer, body, kind, image1, image2, image3, image4, clip, day, at: now }
  insert timeline { postId: p.id, authorId: viewer, actorId: viewer, kind: 'original', at: now } if absent
  insert feed { readerId: viewer, postId: p.id, authorId: viewer, actorId: viewer, kind: 'original', at: now } if absent
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feed { readerId: f.followerId, postId: p.id, authorId: viewer, actorId: viewer, kind: 'original', at: now } if absent
  insert fanouts { postId: p.id, actorId: viewer, postAuthorId: viewer, kind: 'original', at: now }
  return { id: p.id }

mutation setLike(postId: posts, on: bool):
  post = posts[postId] ! else NOT_FOUND
  existing = likes[postId, viewer]
  (day, _) = divmod(now, 86400000)
  if on:
    if existing = null:
      insert likes { postId, authorId: post.authorId, principal: viewer, day, at: now }
      n = likeCounts[postId]
      age = now - post.at
      tcfg = windows['trendingMs'] by byK
      window = tcfg.ms if tcfg != null else 86400000
      if age < window:
        upsert trending[postId] { postId, likes: n, at: post.at, expiresAt: post.at + window }
    return likes[postId, viewer]
  if existing != null:
    delete likes[existing]
    n = likeCounts[postId]
    tr = trending[postId]
    if tr != null:
      update trending[tr] { likes: n }
  return null

mutation setRepost(postId: posts, on: bool):
  post = posts[postId] ! else NOT_FOUND
  existing = reposts[postId, viewer]
  if on:
    if existing = null:
      insert reposts { postId, authorId: post.authorId, principal: viewer, at: now }
      insert timeline { postId, authorId: post.authorId, actorId: viewer, kind: 'repost', at: now } if absent
      insert feed { readerId: viewer, postId, authorId: post.authorId, actorId: viewer, kind: 'repost', at: now } if absent
      for f in follows[viewer, 0] first 200 by byFollowedBucket:
        insert feed { readerId: f.followerId, postId, authorId: post.authorId, actorId: viewer, kind: 'repost', at: now } if absent
      insert fanouts { postId, actorId: viewer, postAuthorId: post.authorId, kind: 'repost', at: now }
    return reposts[postId, viewer]
  if existing != null:
    delete reposts[existing]
    tl = timeline[postId, viewer, 'repost']
    if tl != null:
      delete timeline[tl]
    mine = feed[viewer, postId, 'repost', viewer]
    if mine != null:
      delete feed[mine]
    for f in follows[viewer] first 1000 by byFollowed:
      row = feed[f.followerId, postId, 'repost', viewer]
      if row != null:
        delete feed[row]
  return null

mutation reply(replyId: id, parentId: posts, body: text <=500):
  parent = posts[parentId] ! else NOT_FOUND
  row = insert replies { id: replyId, parentId, parentAuthorId: parent.authorId, authorId: viewer, body, at: now }
  return { id: row.id }

mutation createDm(conversationId: id, other: principal, a: principal, b: principal):
  require viewer = a or viewer = b else NOT_PARTICIPANT
  require other != viewer else CANNOT_DM_SELF
  existing = dmIndex[a, b]
  if existing != null:
    return { id: existing.conversationId, reused: true }
  conv = insert conversations { id: conversationId, kind: 'dm', creatorId: viewer, name: null, description: null, color: 'indigo', disappearing: 'off', createdAt: now }
  insert dmIndex { a, b, conversationId: conv.id }
  insert memberships { conversationId: conv.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: conv.id, principal: other, role: 'admin', joinedAt: now }
  return { id: conv.id, reused: false }

mutation createGroup(conversationId: id, other: principal, name: text 1..50, description: text <=200):
  require other != viewer else GROUP_NEEDS_MEMBER
  conv = insert conversations { id: conversationId, kind: 'group', creatorId: viewer, name, description, color: 'indigo', disappearing: 'off', createdAt: now }
  insert memberships { conversationId: conv.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: conv.id, principal: other, role: 'member', joinedAt: now }
  return { id: conv.id }

mutation addMember(conversationId: conversations, member: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  conv = conversations[conversationId] ! else NOT_FOUND
  require conv.kind = 'group' else NOT_GROUP
  insert memberships { conversationId, principal: member, role: 'member', joinedAt: now } if absent
  return memberships[conversationId, member]

mutation promoteMember(conversationId: conversations, member: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  row = memberships[conversationId, member] ! else NOT_MEMBER
  update memberships[row] { role: 'admin' }
  return null

mutation removeMember(conversationId: conversations, member: principal):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  require member != viewer else USE_LEAVE
  row = memberships[conversationId, member] ! else NOT_MEMBER
  delete memberships[row]
  return null

mutation leaveChat(conversationId: conversations):
  row = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[row]
  return null

mutation updateChat(conversationId: conversations, name: text 1..50 ?, description: text <=200 ?, color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate') ?, disappearing: enum('off', '24h', '7d') ?, background: image <=10000000 ?):
  conv = conversations[conversationId] ! else NOT_FOUND
  isAdmin = exists memberships[conversationId, viewer, 'admin']
  isMember = exists memberships[conversationId, viewer]
  require isMember else NOT_MEMBER
  if conv.kind = 'group':
    require isAdmin else NOT_ADMIN
  nextName = name if name != null else conv.name
  nextDesc = description if description != null else conv.description
  nextColor = color if color != null else conv.color
  nextDis = disappearing if disappearing != null else conv.disappearing
  nextBg = background if background != null else conv.background
  update conversations[conv] { name: nextName, description: nextDesc, color: nextColor, disappearing: nextDis, background: nextBg }
  return conversations[conversationId]

proc bumpUnreads(conversationId: conversations):
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      u = unreads[conversationId, m.principal]
      if u = null:
        insert unreads { conversationId, principal: m.principal, count: 1 }
      else:
        update unreads[u] { count: u.count + 1 }

proc recordDigestMessage(conversationId: conversations, messageId: messages):
  rt = runtime['runtime']
  flag = rt.flag if rt != null else 'live'
  if flag != 'replay':
    dcfg = windows['digestMs'] by byK
    ms = dcfg.ms if dcfg != null else 120000
    (digestQ, rem) = divmod(now, ms)
    periodStart = now - rem
    for m in memberships[conversationId] first 50 by byConversationPrincipal:
      if m.principal != viewer:
        hit = insert digestMsgHits { messageId, principal: m.principal } if absent
        if hit != null:
          acc = digestAcc[m.principal, periodStart]
          if acc = null:
            insert digestAcc { principal: m.principal, periodStart, newFollowers: 0, newPostsInFollowing: 0, unreadMessages: 1, unreadChats: 0 }
          else:
            update digestAcc[acc] { unreadMessages: acc.unreadMessages + 1 }
          mark = insert digestChatHits { periodStart, conversationId, principal: m.principal } if absent
          if mark != null:
            acc2 = digestAcc[m.principal, periodStart]
            if acc2 != null:
              update digestAcc[acc2] { unreadChats: acc2.unreadChats + 1 }

proc emitPush(conversationId: conversations, preview: text <=80):
  rt = runtime['runtime']
  flag = rt.flag if rt != null else 'live'
  if flag != 'replay':
    me = profiles[viewer]
    name = me.displayName if me != null else 'Someone'
    for m in memberships[conversationId] first 50 by byConversationPrincipal:
      if m.principal != viewer and not exists connected[m.principal]:
        emit push { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview, kind: 'message' }

proc stampRecipients(conversationId: conversations, messageId: messages):
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      insert recipients { messageId, conversationId, principal: m.principal } if absent

mutation send(messageId: id, conversationId: conversations, body: text <=2000, quoteId: messages ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  conv = conversations[conversationId] ! else NOT_FOUND
  w24 = windows['ttl24h'] by byK
  w7 = windows['ttl7d'] by byK
  ms24 = w24.ms if w24 != null else 180000
  ms7 = w7.ms if w7 != null else 300000
  exp = now + ms24 if conv.disappearing = '24h' else now + ms7 if conv.disappearing = '7d' else null
  row = insert messages { id: messageId, conversationId, authorId: viewer, body, caption: null, photo: null, photoOnce: null, clip: null, quoteId, tombstoned: false, editedAt: null, expiresAt: exp, at: now }
  stampRecipients(conversationId, row.id)
  bumpUnreads(conversationId)
  recordDigestMessage(conversationId, row.id)
  emitPush(conversationId, slice(body, 0, 80))
  return { id: row.id }

mutation sendMedia(messageId: id, conversationId: conversations, caption: text <=500 ?, photo: image <=10000000 ?, photoOnce: image <=10000000 ?, clip: video <=50000000 ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  require photo != null or photoOnce != null or clip != null else MEDIA_REQUIRED
  if clip != null:
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  conv = conversations[conversationId] ! else NOT_FOUND
  w24 = windows['ttl24h'] by byK
  w7 = windows['ttl7d'] by byK
  ms24 = w24.ms if w24 != null else 180000
  ms7 = w7.ms if w7 != null else 300000
  exp = now + ms24 if conv.disappearing = '24h' else now + ms7 if conv.disappearing = '7d' else null
  row = insert messages { id: messageId, conversationId, authorId: viewer, body: null, caption, photo, photoOnce, clip, quoteId: null, tombstoned: false, editedAt: null, expiresAt: exp, at: now }
  stampRecipients(conversationId, row.id)
  bumpUnreads(conversationId)
  recordDigestMessage(conversationId, row.id)
  isPhoto = photo != null or photoOnce != null
  preview = 'Photo' if isPhoto else 'Video'
  emitPush(conversationId, preview)
  return { id: row.id }

mutation editMessage(messageId: messages, body: text <=2000 ?, caption: text <=500 ?):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.tombstoned = false else DELETED
  w = windows['editMs'] by byK
  limit = w.ms if w != null else 60000
  require now - msg.at <= limit else EDIT_WINDOW_CLOSED
  nextBody = body if body != null else msg.body
  nextCap = caption if caption != null else msg.caption
  update messages[msg] { body: nextBody, caption: nextCap, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  w = windows['deleteMs'] by byK
  limit = w.ms if w != null else 120000
  require now - msg.at <= limit else DELETE_WINDOW_CLOSED
  update messages[msg] { tombstoned: true, body: null, caption: null, photo: null, photoOnce: null, clip: null }
  return null

mutation setReaction(messageId: messages, emoji: text 1..16, on: bool):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  existing = reactions[messageId, viewer]
  if on:
    if existing = null:
      insert reactions { messageId, conversationId: msg.conversationId, principal: viewer, emoji }
    else:
      update reactions[existing] { emoji }
    return reactions[messageId, viewer]
  if existing != null:
    delete reactions[existing]
  return null

mutation pingTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, expiresAt: now + 2500 }
  return null

mutation markDelivered(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists recipients[messageId, viewer] by byMessagePrincipal else NOT_RECIPIENT
  existing = receipts[messageId, viewer]
  if existing = null:
    insert receipts { messageId, conversationId: msg.conversationId, principal: viewer, state: 'delivered', at: now }
  return null

mutation markRead(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  existing = receipts[messageId, viewer]
  if existing = null:
    insert receipts { messageId, conversationId: msg.conversationId, principal: viewer, state: 'read', at: now }
  else:
    if existing.state != 'read':
      update receipts[existing] { state: 'read', at: now }
  u = unreads[msg.conversationId, viewer]
  if u != null:
    update unreads[u] { count: 0 }
  return null

mutation clearUnreads(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  u = unreads[conversationId, viewer]
  if u = null:
    insert unreads { conversationId, principal: viewer, count: 0 }
  else:
    update unreads[u] { count: 0 }
  return null

mutation openViewOnce(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  insert viewOnceOpens { messageId, principal: viewer, at: now } if absent
  return viewOnceOpens[messageId, viewer]

mutation setReplayMode(flag: enum('live', 'replay')):
  require viewer = 'service:ops' else NOT_OPS
  existing = runtime['runtime']
  if existing = null:
    return null
  update runtime[existing] { flag }
  return runtime['runtime']

-- ===========================================================================
-- Jobs
-- ===========================================================================

job fanOut():
  chunk w in fanouts first 5 by byId:
    for f in follows[w.actorId] first 1000 by byFollowed:
      insert feed { readerId: f.followerId, postId: w.postId, authorId: w.postAuthorId, actorId: w.actorId, kind: w.kind, at: w.at } if absent
      rt = runtime['runtime']
      flag = rt.flag if rt != null else 'live'
      if flag != 'replay':
        hit = insert digestHits { postId: w.postId, readerId: f.followerId } if absent
        if hit != null:
          dcfg = windows['digestMs'] by byK
          ms = dcfg.ms if dcfg != null else 120000
          (fanQ, rem) = divmod(w.at, ms)
          periodStart = w.at - rem
          acc = digestAcc[f.followerId, periodStart]
          if acc = null:
            insert digestAcc { principal: f.followerId, periodStart, newFollowers: 0, newPostsInFollowing: 1, unreadMessages: 0, unreadChats: 0 }
          else:
            update digestAcc[acc] { newPostsInFollowing: acc.newPostsInFollowing + 1 }
    delete fanouts[w.id]
schedule fanOutEveryMinute every 1m: fanOut

job dailyDigest(periodStart: time, periodEnd: time):
  chunk a in digestAcc[periodStart] first 50 by byPeriod:
    rt = runtime['runtime']
    flag = rt.flag if rt != null else 'live'
    if flag != 'replay':
      if a.newFollowers != 0 or a.newPostsInFollowing != 0 or a.unreadMessages != 0 or a.unreadChats != 0:
        logged = insert digestLog { principal: a.principal, periodStart: a.periodStart } if absent
        if logged != null:
          emit push { targetUserId: a.principal, kind: 'digest', periodStart: a.periodStart, periodEnd: periodEnd, newFollowers: a.newFollowers, newPostsInFollowing: a.newPostsInFollowing, unreadMessages: a.unreadMessages, unreadChats: a.unreadChats }
schedule digestEvery every 2m: dailyDigest
