-- Clique backend (Snapback 4 / Quarry). Windows and digest period match
-- fixtures/config/*shortened*.json so grading is testable in minutes.
use identity
use personas alice, bob, carol, dave
effect notify

table appSettings:
  editWindowMs: int
  deleteWindowMs: int
  ttl24hMs: int
  ttl7dMs: int
  replayMode: bool
  public 'runtime config is readable so mutations can enforce server windows'
  insert <- deny
  update <- deny
  delete <- deny

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 format url ?
  avatar: image <=10000000 ?
  unique byPrincipal: principal
  unique byHandle: handle
  by byNameWords: words(displayName, handle), id
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync last 2000 by byHandle

table userStats:
  principal: principal
  posts: int
  likesReceived: int
  repostsReceived: int
  repliesReceived: int
  unique byPrincipal: principal
  immutable principal
  public 'lifetime totals are public on profiles and insights'
  insert <- .principal = viewer
  update <- allow
  delete <- deny

table dailyActivity:
  principal: principal
  dayStart: time
  posts: int
  likesReceived: int
  unique byPrincipalDay: principal, dayStart
  immutable principal, dayStart
  read <- .principal = viewer
  insert <- allow
  update <- allow
  delete <- deny
  online only

table follows:
  followerId: principal
  followedId: principal
  bucket: int
  at: time
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  by byFollowedBucket: followedId, bucket, followerId
  by byFollower: followerId, followedId
  cap 1000 by followedId
  cap 200 by followedId, bucket
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer

maintain followerCounts: count follows by followedId
  read <- allow
  online only
maintain followingCounts: count follows by followerId
  read <- allow
  online only

table posts:
  authorId: principal
  body: text <=500 ?
  kind: enum('text', 'images', 'video')
  image1: image <=10000000 ?
  image2: image <=10000000 ?
  image3: image <=10000000 ?
  image4: image <=10000000 ?
  clip: video <=50000000 ?
  poster: image <=10000000 ?
  replyTo: posts ?
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  by byReply: replyTo, at, id
  immutable authorId
  public 'posts are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 500 by byTime

table likes:
  postId: posts
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPost: postId, principal
  by byPrincipal: principal, id
  public 'like edges are public so counts and trending can read them'
  insert <- .principal = viewer
  delete <- .principal = viewer

table reposts:
  postId: posts
  principal: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPost: postId, principal
  by byPrincipalTime: principal, at, id
  public 'reposts are public'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow
  online only
maintain repostCounts: count reposts by postId
  read <- allow
  online only
maintain replyCounts: count posts by replyTo
  read <- allow
  online only

table timeline:
  postId: posts
  actorId: principal
  authorId: principal
  kind: enum('post', 'repost')
  at: time
  by byTime: at, id
  by byActorTime: actorId, at, id
  public 'global feed is public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 500 by byTime

table feed:
  readerId: principal
  postId: posts
  actorId: principal
  authorId: principal
  kind: enum('post', 'repost')
  at: time
  unique byReaderActorPostKind: readerId, actorId, postId, kind
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .actorId = viewer
  delete <- .readerId = viewer or .actorId = viewer
  sync to .readerId last 400 by byReaderTime

table fanouts:
  postId: posts
  authorId: principal
  actorId: principal
  kind: enum('post', 'repost')
  at: time
  read <- deny
  insert <- .actorId = viewer
  delete <- deny

table intents:
  at: time
  public 'client mutation ids are visible so if-absent is null on replay, not E_RULE'
  insert <- allow
  delete <- deny

table conversations:
  kind: enum('dm', 'group')
  title: text 1..50 ?
  description: text <=200 ?
  creatorId: principal
  accent: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate')
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d')
  by byTitle: title, id
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unread: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin'] or created conversations[.conversationId]
  update (old, next) <- exists memberships[old.conversationId, viewer] and (old.role = next.role or exists memberships[old.conversationId, viewer, 'admin'])
  delete <- .principal = viewer or exists memberships[.conversationId, viewer, 'admin']
  sync to memberships[.conversationId]

table dmPairs:
  a: principal
  b: principal
  conversationId: conversations
  unique byPair: a, b
  read <- .a = viewer or .b = viewer
  insert <- .a = viewer or .b = viewer
  delete <- deny
  online only

table conversationTails:
  conversationId: conversations
  preview: text <=200
  at: time
  authorId: principal
  unique byConversation: conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  update <- exists memberships[.conversationId, viewer]
  delete <- deny
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=2000 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  poster: image <=10000000 ?
  quoteId: messages ?
  deleted: bool
  editedAt: time ?
  expiresAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  by byConvWords: conversationId, words(body), at, id
  by byWords: words(body), at, id
  by byExpiresAt: expiresAt
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history
  expire at .expiresAt
  sync to memberships[.conversationId] last 500 by byConvTime

table receipts:
  messageId: messages
  conversationId: conversations
  principal: principal
  delivered: bool
  readFlag: bool
  unique byMessagePrincipal: messageId, principal
  by byMessage: messageId, principal
  by byConversation: conversationId, messageId, id
  by byConvPrincipal: conversationId, principal, id
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to memberships[.conversationId] last 2000 by byConversation

table reactions:
  messageId: messages
  conversationId: conversations
  principal: principal
  emoji: text 1..16
  unique byMessagePrincipal: messageId, principal
  by byMessage: messageId, principal
  by byConversation: conversationId, messageId, id
  immutable messageId, conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to memberships[.conversationId] last 500 by byConversation

table typing:
  conversationId: conversations
  principal: principal
  until: time
  unique byConvUser: conversationId, principal
  by byConv: conversationId, principal
  by byExpiresAt: until
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  expire at .until
  sync to memberships[.conversationId]

table pushEvents:
  targetUserId: principal
  chatId: id ?
  senderDisplayName: text <=50 ?
  preview: text <=80
  kind: enum('message', 'digest')
  periodStart: time ?
  periodEnd: time ?
  newFollowers: int ?
  newPostsInFollowing: int ?
  unreadMessages: int ?
  unreadChats: int ?
  at: time
  by byTargetTime: targetUserId, at, id
  read <- .targetUserId = viewer
  insert <- allow
  delete <- deny
  online only

table digestEmissions:
  principal: principal
  periodStart: time
  unique byPrincipalPeriod: principal, periodStart
  read <- deny
  insert <- deny
  update <- deny
  delete <- deny

-- helpers
fn utcDay(ts: time): ts - (ts % 86400000)
fn previewOf(body: text <=2000 ?, hasPhoto: bool, hasVideo: bool, viewOnce: bool): 'Photo' if viewOnce or hasPhoto else 'Video' if hasVideo else slice(body ?? '', 0, 80)

fn bumpDailyPosts(who: principal, day: time):
  row = dailyActivity[who, day]
  if row = null:
    insert dailyActivity { principal: who, dayStart: day, posts: 1, likesReceived: 0 }
  else:
    update dailyActivity[row] { posts: row.posts + 1 }
  return

fn bumpDailyLikes(who: principal, day: time):
  row = dailyActivity[who, day]
  if row = null:
    insert dailyActivity { principal: who, dayStart: day, posts: 0, likesReceived: 1 }
  else:
    update dailyActivity[row] { likesReceived: row.likesReceived + 1 }
  return

-- queries
query me():
  return profiles[viewer] { *, followers: followerCounts[viewer], following: followingCounts[viewer], stats: userStats[viewer] }

query profileByHandle(handle: text 3..20 format handle):
  p = profiles[handle]
  if p = null:
    return null
  return p { *, followers: followerCounts[p.principal], following: followingCounts[p.principal], followedByMe: exists follows[viewer, p.principal] by byPair }

query profileByPrincipal(who: principal):
  p = profiles[who]
  if p = null:
    return null
  return p { *, followers: followerCounts[who], following: followingCounts[who], followedByMe: exists follows[viewer, who] by byPair }

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords { *, followers: followerCounts[.principal], following: followingCounts[.principal] }

query globalFeed(c: cursor ?):
  return timeline after c last 20 by byTime { *, post: posts[.postId], actor: profiles[.actorId], author: profiles[.authorId], likes: likeCounts[.postId], reposts: repostCounts[.postId], replies: replyCounts[.postId], liked: exists likes[.postId, viewer] by byPostPrincipal, reposted: exists reposts[.postId, viewer] by byPostPrincipal }

query followingFeed(c: cursor ?):
  page = merge timeline after c last 20 by byActorTime:
    [viewer]
    [f.followedId] for f in follows[viewer] first 500 by byFollower
  return page { *, post: posts[.postId], actor: profiles[.actorId], author: profiles[.authorId], likes: likeCounts[.postId], reposts: repostCounts[.postId], replies: replyCounts[.postId], liked: exists likes[.postId, viewer] by byPostPrincipal, reposted: exists reposts[.postId, viewer] by byPostPrincipal }

query profilePosts(who: principal, c: cursor ?):
  return posts[who] after c last 20 by byAuthorTime where .replyTo = null { *, author: profiles[.authorId], likes: likeCounts[.id], reposts: repostCounts[.id], replies: replyCounts[.id], liked: exists likes[.id, viewer] by byPostPrincipal, reposted: exists reposts[.id, viewer] by byPostPrincipal }

query thread(postId: posts, c: cursor ?):
  parent = posts[postId]
  replies = posts[postId] after c last 50 by byReply { *, author: profiles[.authorId], likes: likeCounts[.id], reposts: repostCounts[.id], replies: replyCounts[.id], liked: exists likes[.id, viewer] by byPostPrincipal, reposted: exists reposts[.id, viewer] by byPostPrincipal }
  return { parent: parent { *, author: profiles[.authorId], likes: likeCounts[.id], reposts: repostCounts[.id], replies: replyCounts[.id], liked: exists likes[.id, viewer] by byPostPrincipal, reposted: exists reposts[.id, viewer] by byPostPrincipal }, replies: replies }

query trending():
  since = now - 86400000
  page = posts[at >= since] last 200 by byTime where .replyTo = null
  xs = []
  for p in page:
    xs = xs + [{ id: p.id, authorId: p.authorId, author: profiles[p.authorId], body: p.body, kind: p.kind, at: p.at, likes: likeCounts[p.id], reposts: repostCounts[p.id], replies: replyCounts[p.id], liked: exists likes[p.id, viewer] by byPostPrincipal, reposted: exists reposts[p.id, viewer] by byPostPrincipal }]
  ranked = sort(xs, '-likes', '-at')
  return slice(ranked, 0, 10)

query insights():
  stats = userStats[viewer]
  day0 = utcDay(now)
  d0 = dailyActivity[viewer, day0]
  d1 = dailyActivity[viewer, day0 - 86400000]
  d2 = dailyActivity[viewer, day0 - 172800000]
  d3 = dailyActivity[viewer, day0 - 259200000]
  d4 = dailyActivity[viewer, day0 - 345600000]
  d5 = dailyActivity[viewer, day0 - 432000000]
  d6 = dailyActivity[viewer, day0 - 518400000]
  return {
    posts: stats.posts if stats != null else 0,
    likesReceived: stats.likesReceived if stats != null else 0,
    repostsReceived: stats.repostsReceived if stats != null else 0,
    repliesReceived: stats.repliesReceived if stats != null else 0,
    followers: followerCounts[viewer],
    following: followingCounts[viewer],
    days: [
      { dayStart: day0, posts: d0.posts if d0 != null else 0, likesReceived: d0.likesReceived if d0 != null else 0 },
      { dayStart: day0 - 86400000, posts: d1.posts if d1 != null else 0, likesReceived: d1.likesReceived if d1 != null else 0 },
      { dayStart: day0 - 172800000, posts: d2.posts if d2 != null else 0, likesReceived: d2.likesReceived if d2 != null else 0 },
      { dayStart: day0 - 259200000, posts: d3.posts if d3 != null else 0, likesReceived: d3.likesReceived if d3 != null else 0 },
      { dayStart: day0 - 345600000, posts: d4.posts if d4 != null else 0, likesReceived: d4.likesReceived if d4 != null else 0 },
      { dayStart: day0 - 432000000, posts: d5.posts if d5 != null else 0, likesReceived: d5.likesReceived if d5 != null else 0 },
      { dayStart: day0 - 518400000, posts: d6.posts if d6 != null else 0, likesReceived: d6.likesReceived if d6 != null else 0 }
    ]
  }

query inbox(c: cursor ?):
  return memberships[viewer] after c first 50 by byPrincipalConversation { conversationId, role: .role, unread: .unread, conversation: conversations[.conversationId], tail: conversationTails[.conversationId] }

query conversation(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return conversations[conversationId] { *, myRole: memberships[conversationId, viewer] }

query groupsNamed(title: text 1..50):
  return conversations[title] first 10 by byTitle

query membersOf(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships[conversationId] first 50 by byConversationPrincipal { *, profile: profiles[.principal] }

query threadMessages(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConvTime { *, author: profiles[.authorId], quote: messages[.quoteId] { id, body, authorId, deleted } }

query messageReactions(messageId: messages):
  return reactions[messageId] first 50 by byMessage

query receiptsOf(messageId: messages):
  return receipts[messageId] first 50 by byMessage

query typingIn(conversationId: conversations):
  return typing[conversationId] first 50 by byConv

query searchPeople(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords

query searchInChat(conversationId: conversations, q: text <=100, c: cursor ?):
  return messages[conversationId] matching q after c last 50 by byConvWords { *, author: profiles[.authorId] }

query searchMessages(q: text <=100, c: cursor ?):
  return messages matching q after c last 50 by byWords { *, author: profiles[.authorId], conversation: conversations[.conversationId] }

query dmWith(other: principal):
  x = dmPairs[viewer, other]
  if x != null:
    return x
  return dmPairs[other, viewer]

query myPushEvents(c: cursor ?):
  return pushEvents[viewer] after c last 50 by byTargetTime

query settings():
  return appSettings['settings']

-- mutations
mutation setProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?):
  existing = profiles[viewer]
  if existing = null:
    insert profiles { principal: viewer, displayName, handle, bio, location, link }
    insert userStats { principal: viewer, posts: 0, likesReceived: 0, repostsReceived: 0, repliesReceived: 0 } if absent
  else:
    update profiles[existing] { displayName, handle, bio, location, link }
  return profiles[viewer]

mutation setAvatar(avatar: image <=10000000):
  existing = profiles[viewer] ! else NOT_FOUND
  update profiles[existing] { avatar }
  return profiles[viewer]

mutation setFollow(target: principal, on: bool, mutationId: id):
  require target != viewer else SELF_FOLLOW
  require exists profiles[target] else NOT_FOUND
  applied = insert intents { id: mutationId, at: now } if absent
  if applied = null:
    return { ok: true, replayed: true }
  if on:
    n = followerCounts[target]
    bucket = n / 200
    insert follows { followerId: viewer, followedId: target, bucket, at: now } if absent
  else:
    delete follows[viewer, target]
  return { ok: true, replayed: false }

mutation createPost(postId: id, body: text <=500 ?, kind: enum('text', 'images', 'video'), image1: image <=10000000 ?, image2: image <=10000000 ?, image3: image <=10000000 ?, image4: image <=10000000 ?, clip: video <=50000000 ?, poster: image <=10000000 ?):
  if kind = 'video':
    duration = clip.duration if clip != null else null
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
  p = insert posts { id: postId, authorId: viewer, body, kind, image1, image2, image3, image4, clip, poster, at: now }
  insert timeline { postId: p.id, actorId: viewer, authorId: viewer, kind: 'post', at: now }
  insert feed { readerId: viewer, postId: p.id, actorId: viewer, authorId: viewer, kind: 'post', at: now } if absent
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feed { readerId: f.followerId, postId: p.id, actorId: viewer, authorId: viewer, kind: 'post', at: now } if absent
  insert fanouts { postId: p.id, authorId: viewer, actorId: viewer, kind: 'post', at: now }
  stats = userStats[viewer]
  if stats = null:
    insert userStats { principal: viewer, posts: 1, likesReceived: 0, repostsReceived: 0, repliesReceived: 0 }
  else:
    update userStats[stats] { posts: stats.posts + 1 }
  bumpDailyPosts(viewer, utcDay(now))
  return { id: p.id }

mutation replyPost(replyId: id, parentId: posts, body: text <=500):
  parent = posts[parentId] ! else NOT_FOUND
  require parent.replyTo = null else NOT_TOP_LEVEL
  p = insert posts { id: replyId, authorId: viewer, body, kind: 'text', replyTo: parentId, at: now }
  authorStats = userStats[parent.authorId]
  if authorStats != null:
    update userStats[authorStats] { repliesReceived: authorStats.repliesReceived + 1 }
  return { id: p.id }

mutation setLike(postId: posts, on: bool, mutationId: id):
  post = posts[postId] ! else NOT_FOUND
  applied = insert intents { id: mutationId, at: now } if absent
  if applied = null:
    return { ok: true, replayed: true }
  existing = likes[postId, viewer]
  if on:
    if existing = null:
      insert likes { postId, principal: viewer, at: now }
      stats = userStats[post.authorId]
      if stats != null:
        update userStats[stats] { likesReceived: stats.likesReceived + 1 }
      bumpDailyLikes(post.authorId, utcDay(now))
  else:
    if existing != null:
      delete likes[existing]
      stats = userStats[post.authorId]
      if stats != null and stats.likesReceived > 0:
        update userStats[stats] { likesReceived: stats.likesReceived - 1 }
  return { ok: true, replayed: false }

mutation setRepost(postId: posts, on: bool, mutationId: id):
  post = posts[postId] ! else NOT_FOUND
  require post.replyTo = null else NOT_TOP_LEVEL
  applied = insert intents { id: mutationId, at: now } if absent
  if applied = null:
    return { ok: true, replayed: true }
  existing = reposts[postId, viewer]
  if on:
    if existing = null:
      insert reposts { postId, principal: viewer, at: now }
      insert timeline { postId, actorId: viewer, authorId: post.authorId, kind: 'repost', at: now }
      insert feed { readerId: viewer, postId, actorId: viewer, authorId: post.authorId, kind: 'repost', at: now } if absent
      for f in follows[viewer, 0] first 200 by byFollowedBucket:
        insert feed { readerId: f.followerId, postId, actorId: viewer, authorId: post.authorId, kind: 'repost', at: now } if absent
      insert fanouts { postId, authorId: post.authorId, actorId: viewer, kind: 'repost', at: now }
      stats = userStats[post.authorId]
      if stats != null:
        update userStats[stats] { repostsReceived: stats.repostsReceived + 1 }
  else:
    if existing != null:
      delete reposts[existing]
  return { ok: true, replayed: false }

mutation createDm(conversationId: id, other: principal):
  require other != viewer else SELF_DM
  require exists profiles[other] else NOT_FOUND
  existing = dmPairs[viewer, other]
  if existing != null:
    return { id: existing.conversationId, existing: true }
  existing2 = dmPairs[other, viewer]
  if existing2 != null:
    return { id: existing2.conversationId, existing: true }
  conv = insert conversations { id: conversationId, kind: 'dm', creatorId: viewer, accent: 'indigo', disappearing: 'off' }
  insert memberships { conversationId: conv.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: conv.id, principal: other, role: 'member', joinedAt: now }
  insert dmPairs { a: viewer, b: other, conversationId: conv.id }
  return { id: conv.id, existing: false }

mutation createGroup(conversationId: id, second: principal, name: text 1..50, description: text <=200 ?):
  require second != viewer else NEED_OTHER_MEMBER
  require exists profiles[second] else NOT_FOUND
  conv = insert conversations { id: conversationId, kind: 'group', title: name, description, creatorId: viewer, accent: 'indigo', disappearing: 'off' }
  insert memberships { conversationId: conv.id, principal: viewer, role: 'admin', joinedAt: now }
  insert memberships { conversationId: conv.id, principal: second, role: 'member', joinedAt: now }
  return { id: conv.id }

mutation addMember(conversationId: conversations, member: principal, mutationId: id):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  require exists profiles[member] else NOT_FOUND
  applied = insert intents { id: mutationId, at: now } if absent
  if applied = null:
    return { ok: true, replayed: true }
  insert memberships { conversationId, principal: member, role: 'member', joinedAt: now } if absent
  return { ok: true, replayed: false }

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

mutation leaveConversation(conversationId: conversations):
  row = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[row]
  return null

mutation updateConversation(conversationId: conversations, title: text 1..50 ?, description: text <=200 ?, accent: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate') ?, disappearing: enum('off', '24h', '7d') ?, background: image <=10000000 ?):
  conv = conversations[conversationId] ! else NOT_FOUND
  mine = memberships[conversationId, viewer] ! else NOT_MEMBER
  if title != null or description != null:
    require conv.kind = 'group' else DM_NO_TITLE
    require mine.role = 'admin' else NOT_ADMIN
  nextTitle = title if title != null else conv.title
  nextDescription = description if description != null else conv.description
  nextAccent = accent if accent != null else conv.accent
  nextDisappearing = disappearing if disappearing != null else conv.disappearing
  update conversations[conv] { title: nextTitle, description: nextDescription, accent: nextAccent, disappearing: nextDisappearing, background }
  return conversations[conversationId]

mutation sendMessage(messageId: id, conversationId: conversations, body: text <=2000, quoteId: messages ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  if quoteId != null:
    q = messages[quoteId] ! else QUOTE_NOT_FOUND
    require q.conversationId = conversationId else QUOTE_WRONG_CHAT
  conv = conversations[conversationId] ! else NOT_FOUND
  cfg = appSettings['settings']
  ttl = null
  if conv.disappearing = '24h':
    ttl = cfg.ttl24hMs if cfg != null else 180000
  else if conv.disappearing = '7d':
    ttl = cfg.ttl7dMs if cfg != null else 300000
  expires = now + ttl if ttl != null else null
  me = profiles[viewer]
  name = me.displayName if me != null else 'Someone'
  row = insert messages { id: messageId, conversationId, authorId: viewer, body, quoteId, deleted: false, expiresAt: expires, at: now }
  upsert conversationTails[conversationId] { preview: slice(body, 0, 80), at: now, authorId: viewer }
  replay = cfg.replayMode if cfg != null else false
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      insert receipts { messageId: row.id, conversationId, principal: m.principal, delivered: false, readFlag: false } if absent
      update memberships[m] { unread: m.unread + 1 }
      if not replay and not exists connected[m.principal]:
        emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview: slice(body, 0, 80), kind: 'message' }
        insert pushEvents { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview: slice(body, 0, 80), kind: 'message', at: now }
  return { id: row.id }

mutation sendMedia(messageId: id, conversationId: conversations, kind: enum('image', 'video'), photo: image <=10000000 ?, clip: video <=50000000 ?, poster: image <=10000000 ?, caption: text <=500 ?, viewOnce: bool):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  if kind = 'video':
    require viewOnce = false else VIEW_ONCE_PHOTO_ONLY
    duration = clip.duration if clip != null else null
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
  conv = conversations[conversationId] ! else NOT_FOUND
  cfg = appSettings['settings']
  ttl = null
  if conv.disappearing = '24h':
    ttl = cfg.ttl24hMs if cfg != null else 180000
  else if conv.disappearing = '7d':
    ttl = cfg.ttl7dMs if cfg != null else 300000
  expires = now + ttl if ttl != null else null
  me = profiles[viewer]
  name = me.displayName if me != null else 'Someone'
  prev = previewOf(caption, kind = 'image', kind = 'video', viewOnce)
  row = insert messages { id: messageId, conversationId, authorId: viewer, body: caption, photo: photo if not viewOnce else null, photoOnce: photo if viewOnce else null, clip, poster, deleted: false, expiresAt: expires, at: now }
  upsert conversationTails[conversationId] { preview: prev, at: now, authorId: viewer }
  replay = cfg.replayMode if cfg != null else false
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer:
      insert receipts { messageId: row.id, conversationId, principal: m.principal, delivered: false, readFlag: false } if absent
      update memberships[m] { unread: m.unread + 1 }
      if not replay and not exists connected[m.principal]:
        emit notify { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview: prev, kind: 'message' }
        insert pushEvents { targetUserId: m.principal, chatId: conversationId, senderDisplayName: name, preview: prev, kind: 'message', at: now }
  return { id: row.id }

mutation editMessage(messageId: messages, body: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.deleted = false else DELETED
  cfg = appSettings['settings']
  window = cfg.editWindowMs if cfg != null else 60000
  require now - msg.at <= window else EDIT_WINDOW
  update messages[msg] { body, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  cfg = appSettings['settings']
  window = cfg.deleteWindowMs if cfg != null else 120000
  require now - msg.at <= window else DELETE_WINDOW
  update messages[msg] { deleted: true, body: null, photo: null, photoOnce: null, clip: null, poster: null }
  return null

mutation setReaction(messageId: messages, emoji: text 1..16, mutationId: id):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  applied = insert intents { id: mutationId, at: now } if absent
  if applied = null:
    return { ok: true, replayed: true }
  existing = reactions[messageId, viewer]
  if emoji = 'none':
    if existing != null:
      delete reactions[existing]
  else:
    if existing = null:
      insert reactions { messageId, conversationId: msg.conversationId, principal: viewer, emoji }
    else:
      update reactions[existing] { emoji }
  return { ok: true, replayed: false }

mutation markDelivered(messageId: messages):
  row = receipts[messageId, viewer]
  if row = null:
    return null
  if not row.delivered:
    update receipts[row] { delivered: true }
  return null

mutation markRead(conversationId: conversations): server
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  mine = memberships[conversationId, viewer]
  if mine != null:
    update memberships[mine] { unread: 0 }
  for r in receipts[conversationId, viewer] first 200 by byConvPrincipal:
    if not r.readFlag or not r.delivered:
      update receipts[r] { delivered: true, readFlag: true }
  return null

mutation setTyping(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { until: now + 5000 }
  return null

mutation clearTyping(conversationId: conversations):
  row = typing[conversationId, viewer]
  if row != null:
    delete typing[row]
  return null

job fanOut():
  chunk w in fanouts first 5 by byId:
    for f in follows[w.actorId] first 1000 by byFollowed:
      insert feed { readerId: f.followerId, postId: w.postId, actorId: w.actorId, authorId: w.authorId, kind: w.kind, at: w.at } if absent
    delete fanouts[w.id]
schedule fanOutEveryMinute every 1m: fanOut

job dailyDigest(periodStart: time, periodEnd: time):
  cfg = appSettings['settings']
  replay = cfg.replayMode if cfg != null else false
  if replay:
    return
  chunk p in profiles first 40 by byId:
    emitted = digestEmissions[p.principal, periodStart]
    if emitted = null:
      newFollowers = 0
      newPosts = 0
      unreadMessages = 0
      unreadChats = 0
      for f in follows[p.principal] first 1000 by byFollowed:
        if f.at >= periodStart and f.at < periodEnd:
          newFollowers = newFollowers + 1
      for edge in follows[p.principal] first 200 by byFollower:
        for post in posts[edge.followedId] last 20 by byAuthorTime:
          if post.replyTo = null and post.at >= periodStart and post.at < periodEnd:
            newPosts = newPosts + 1
      for m in memberships[p.principal] first 50 by byPrincipalConversation:
        if m.unread > 0:
          unreadMessages = unreadMessages + m.unread
          unreadChats = unreadChats + 1
      if newFollowers > 0 or newPosts > 0 or unreadMessages > 0:
        insert digestEmissions { principal: p.principal, periodStart } if absent
        emit notify { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages, unreadChats }
        insert pushEvents { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, newFollowers, newPostsInFollowing: newPosts, unreadMessages, unreadChats, preview: 'digest', at: now }
schedule digestEveryTwoMinutes every 2m: dailyDigest
