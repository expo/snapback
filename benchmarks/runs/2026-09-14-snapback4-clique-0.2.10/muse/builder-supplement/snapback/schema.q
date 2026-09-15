-- Clique on Snapback 4: social-messenger backend (M1-M8, single file).
-- Identity: built-in password accounts. Feed: fan-out on write (bucket 0
-- immediate in the mutation, the rest via jobs.fanOut within a minute).
-- Receipts: per-recipient rows written at send; aggregate over rows of
-- current members. Expiry: `expire at .expiresAt`. Push/digest: effects
-- claimed by snapback/worker.ts and appended to push.log.
use identity password
use personas alice, bob, carol, dave, erin, frank, grace, henry

effect notify
effect digest

-- App config seeded from config/*.json by the worker at boot (and by
-- scripts/sync-config.mjs); mutations fall back to production defaults.
table appconfig:
  key: text <=32
  data: json <=4000 ?
  unique byKey: key
  read <- allow
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- deny
  online only

table profiles:
  principal: principal
  handle: text 3..20 format handle
  displayName: text 1..50
  avatar: image <=10000000 ?
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=200 format url ?
  at: time
  unique byPrincipal: principal
  unique byHandle: handle
  by byAt: at, id
  by byNameWords: words(displayName, handle), id
  immutable principal, at
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by byAt

table follows:
  followerId: principal
  followedId: principal
  bucket: int
  at: time
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  by byFollowerAt: followerId, at, id
  by byFollowedAt: followedId, at, id
  cap 1000 by followerId
  immutable followerId, followedId, at
  public 'follow edges are public; feeds and counts are projections over them'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table posts:
  authorId: principal
  body: text <=500
  kind: enum('text', 'images', 'video')
  img1: image <=10000000 ?
  img2: image <=10000000 ?
  img3: image <=10000000 ?
  img4: image <=10000000 ?
  clip: video <=50000000 ?
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 200 by byTime

table replies:
  parentId: posts
  parentAuthorId: principal
  authorId: principal
  body: text <=500
  at: time
  by byParent: parentId, at, id
  by byAuthorTime: authorId, at, id
  immutable parentId, parentAuthorId, authorId, at
  public 'replies are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 200 by byAuthorTime

table likes:
  postId: posts
  principal: principal
  authorId: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPrincipalAt: principal, at, id
  by byAuthorAt: authorId, at, id
  by byAt: at, id
  immutable postId, principal, authorId, at
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by byAt

table reposts:
  postId: posts
  principal: principal
  authorId: principal
  at: time
  unique byPostPrincipal: postId, principal
  by byPrincipalAt: principal, at, id
  by byAuthorAt: authorId, at, id
  by byAt: at, id
  immutable postId, principal, authorId, at
  public 'reposts are public'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by byAt

-- One row per reader per post/repost. key is the post id for originals,
-- 'r:' + repost id for reposts. repostRef is '' for originals.
table feed:
  readerId: principal
  key: id
  postId: posts
  authorId: principal
  at: time
  repostBy: principal ?
  repostRef: id
  unique byReaderKey: readerId, key
  by byReaderTime: readerId, at, id
  by byReaderAuthor: readerId, authorId, id
  by byRepostRef: repostRef, readerId, id
  immutable readerId, key, postId, authorId, at
  read <- .readerId = viewer
  insert <- .authorId = viewer or .repostBy = viewer or .readerId = viewer
  delete <- .readerId = viewer or .authorId = viewer or .repostBy = viewer
  sync to .readerId last 200 by byReaderTime

table globalfeed:
  key: id
  postId: posts
  authorId: principal
  at: time
  repostBy: principal ?
  repostRef: id
  unique byKey: key
  by byTime: at, id
  immutable key, postId, authorId, at, repostRef
  public 'the global feed is public'
  insert <- .authorId = viewer or .repostBy = viewer
  delete <- .authorId = viewer or .repostBy = viewer
  sync public last 200 by byTime

-- Posts whose readers outside bucket 0 still need entries.
table fanouts:
  kind: enum('post', 'repost')
  refId: id
  postId: posts
  authorId: principal
  repostBy: principal ?
  at: time
  by byAuthor: authorId, id
  read <- deny
  insert <- .authorId = viewer or .repostBy = viewer
  delete <- deny

maintain postCounts: count posts by authorId
  read <- allow
  online only
maintain likeCounts: count likes by postId
  read <- allow
  online only
maintain likesReceived: count likes by authorId
  read <- allow
  online only
maintain repostCounts: count reposts by postId
  read <- allow
  online only
maintain repostsReceived: count reposts by authorId
  read <- allow
  online only
maintain replyCounts: count replies by parentId
  read <- allow
  online only
maintain repliesReceived: count replies by parentAuthorId
  read <- allow
  online only
maintain followerCounts: count follows by followedId
  read <- allow
  online only
maintain followingCounts: count follows by followerId
  read <- allow
  online only
maintain messageCounts: count messages by conversationId
  read <- allow
  online only

table conversations:
  creatorId: principal
  kind: enum('dm', 'group')
  dmKey: id
  name: text 1..50 ?
  description: text <=200 ?
  color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate') ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d')
  at: time
  unique byDmKey: dmKey
  by byAt: at, id
  immutable creatorId, kind, dmKey, at
  retain delivered-history
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer, 'admin']
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  lastReadAt: time ?
  unique byConvPrincipal: conversationId, principal
  by byConvPrincipalRole: conversationId, principal, role
  by byPrincipalConv: principal, conversationId, id
  cap 50 by conversationId
  cap 1000 by principal
  immutable conversationId, principal, joinedAt
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin'] or created conversations[.conversationId] by byId
  update (old, next) <- old.principal = viewer or exists memberships[next.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists memberships[.conversationId, viewer, 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  kind: enum('text', 'photo', 'video', 'viewonce')
  body: text <=2000 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  quoteId: id ?
  editedAt: time ?
  tombstone: bool
  expiresAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  by byConvWords: conversationId, words(body), at, id
  by byWords: words(body), at, id
  by byExpiresAt: expiresAt
  immutable conversationId, authorId, kind, at
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- deny
  retain delivered-history
  expire at .expiresAt
  sync to memberships[.conversationId] last 500 by byConvTime

-- One row per recipient, written at send. The aggregate reads rows of
-- current members only, so later joins never block and leavers drop out.
table receipts:
  conversationId: conversations
  messageId: messages
  principal: principal
  deliveredAt: time ?
  readAt: time ?
  at: time
  unique byMsgPrincipal: messageId, principal
  by byConvPrincipal: conversationId, principal, id
  immutable conversationId, messageId, principal, at
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]
  update (old, next) <- old.principal = viewer and next.principal = viewer and next.messageId = old.messageId and next.conversationId = old.conversationId
  delete <- deny
  online only

table msgReactions:
  conversationId: conversations
  messageId: messages
  principal: principal
  emoji: text <=16
  at: time
  unique byMsgPrincipal: messageId, principal
  by byConvAt: conversationId, at, id
  immutable conversationId, messageId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- .principal = viewer
  sync to memberships[.conversationId] last 100 by byConvAt

table views:
  conversationId: conversations
  messageId: messages
  principal: principal
  at: time
  unique byMsgPrincipal: messageId, principal
  by byConvPrincipal: conversationId, principal, id
  by byPrincipalConv: principal, conversationId, id
  immutable conversationId, messageId, principal, at
  read <- .principal = viewer
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- deny
  sync to .principal last 100 by byPrincipalConv

table typing:
  conversationId: conversations
  principal: principal
  at: time
  expiresAt: time ?
  unique byConvPrincipal: conversationId, principal
  by byExpiresAt: expiresAt
  immutable conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- .principal = viewer and exists memberships[.conversationId, viewer]
  update <- .principal = viewer and exists memberships[.conversationId, viewer]
  delete <- deny
  expire at .expiresAt
  online only

table digestSent:
  userId: principal
  periodStart: time
  periodEnd: time
  newFollowers: int
  newPostsInFollowing: int
  unreadMessages: int
  unreadChats: int
  at: time
  unique byUserPeriod: userId, periodStart
  immutable userId, periodStart, periodEnd, at
  read <- deny
  online only

table sysconfig:
  key: text <=32
  editWin: int
  deleteWin: int
  ttlA: int
  ttlB: int
  digestPeriod: int
  digestAnchorMs: int
  replayOff: bool
  unique byKey: key
  immutable key
  read <- allow
  insert <- viewer = 'service:worker'
  update <- viewer = 'service:worker'
  delete <- deny
  online only

table followBackfills:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  immutable followerId, followedId
  read <- .followerId = viewer
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

shape profileCard = { principal, handle, displayName, avatar, bio, location, link, at }
shape postCard = { *, author: profiles[.authorId] }
shape messageCard = { *, myReaction: msgReactions[.id, viewer] }

fn windows():
  w = sysconfig['v1'] by byKey
  return w

query myProfile():
  return profiles[viewer] profileCard

query profileByHandle(handle: text 3..20 format handle):
  r = profiles[handle] ! else NOT_FOUND
  return r profileCard

query profileCounts(handle: text 3..20 format handle):
  r = profiles[handle] ! else NOT_FOUND
  return { principal: r.principal, posts: postCounts[r.principal] by byGroup, followers: followerCounts[r.principal] by byGroup, following: followingCounts[r.principal] by byGroup }

query searchPeople(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords profileCard

query followState(handle: text 3..20 format handle):
  r = profiles[handle] ! else NOT_FOUND
  return exists follows[viewer, r.principal] by byPair

query followingList(handle: text 3..20 format handle, c: cursor ?):
  r = profiles[handle] ! else NOT_FOUND
  return follows[r.principal] after c first 50 by byFollowerAt { *, profile: profiles[.followedId] profileCard }

query followerList(handle: text 3..20 format handle, c: cursor ?):
  r = profiles[handle] ! else NOT_FOUND
  return follows[r.principal] after c first 50 by byFollowedAt { *, profile: profiles[.followerId] profileCard }

query globalFeed(c: cursor ?):
  return globalfeed after c last 20 by byTime { *, post: posts[.postId] postCard, rp: reposts[.repostRef] }

query followingFeed(c: cursor ?):
  return feed[viewer] after c last 20 by byReaderTime { *, post: posts[.postId] postCard, rp: reposts[.repostRef] }

query feedCounts(postIds: [id] <=20):
  out = []
  for pid in postIds:
    m = likes[pid, viewer]
    rp = reposts[pid, viewer]
    out = out + [{ postId: pid, likes: likeCounts[pid] by byGroup, reposts: repostCounts[pid] by byGroup, replies: replyCounts[pid] by byGroup, likedByMe: m != null, repostedByMe: rp != null }]
  return out

query thread(postId: posts):
  p = posts[postId] ! else NOT_FOUND
  reps = replies[postId] first 100 by byParent { *, author: profiles[.authorId] profileCard }
  return { post: p postCard, replies: reps }

query profilePosts(handle: text 3..20 format handle, c: cursor ?):
  r = profiles[handle] ! else NOT_FOUND
  return posts[r.principal] after c last 20 by byAuthorTime postCard

query trending():
  cutoff = now + -86400000
  cands = posts[at >= cutoff] last 200 by byTime
  scored = []
  for p in cands:
    scored = scored + [{ id: p.id, likes: likeCounts[p.id] by byGroup, at: p.at }]
  ranked = sort(scored, '-likes', '-at')
  top = slice(ranked, 0, 10)
  out = []
  for t in top:
    full = posts[t.id]
    if full != null:
      out = out + [{ id: full.id, likes: t.likes, at: full.at, post: full postCard }]
  return out

query myInsights():
  days = []
  for d in range(0, 7):
    dayEnd = now + -(d * 86400000)
    dayStart = now + -((d + 1) * 86400000)
    pp = posts[viewer, at >= dayStart, at < dayEnd] first 5000 by byAuthorTime
    ll = likes[viewer, at >= dayStart, at < dayEnd] first 5000 by byAuthorAt
    days = days + [{ dayStart: dayStart, dayEnd: dayEnd, posts: count(pp), likes: count(ll) }]
  return { posts: postCounts[viewer] by byGroup, likesReceived: likesReceived[viewer] by byGroup, repostsReceived: repostsReceived[viewer] by byGroup, repliesReceived: repliesReceived[viewer] by byGroup, followers: followerCounts[viewer] by byGroup, following: followingCounts[viewer] by byGroup, days: days }

query myWindows():
  w = sysconfig['v1'] by byKey
  if w != null:
    return { editWin: w.editWin, deleteWin: w.deleteWin, ttlA: w.ttlA, ttlB: w.ttlB }
  return { editWin: 900, deleteWin: 3600, ttlA: 86400, ttlB: 604800 }

query inbox(c: cursor ?):
  return memberships[viewer] after c first 100 by byPrincipalConv { conversationId, role, lastReadAt, conversation: conversations[.conversationId] }

query threadMessages(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] after c last 50 by byConvTime messageCard

query historyPage(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] after c last 100 by byConvTime { *, total: messageCounts[.conversationId] by byGroup }

query convoReactions(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return msgReactions[conversationId] after c last 100 by byConvAt

query convoAggregates(conversationId: conversations, msgIds: [id] <=50):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  out = []
  for mid in msgIds:
    m = messages[mid]
    if m != null and m.conversationId = conversationId:
      rows = receipts[mid] first 60 by byMsgPrincipal
      total = 0
      read = 0
      delivered = 0
      for r in rows:
        if exists memberships[conversationId, r.principal]:
          total = total + 1
          if r.readAt != null:
            read = read + 1
          else if r.deliveredAt != null:
            delivered = delivered + 1
      state = 'sent'
      if total > 0 and read = total:
        state = 'read'
      else if total > 0 and read + delivered = total:
        state = 'delivered'
      out = out + [{ messageId: mid, state: state, total: total, read: read, delivered: delivered }]
  return out

query typingIn(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return typing[conversationId] first 10 by byConvPrincipal where .principal != viewer and .at >= now - 6000 { principal, at }

query searchChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] matching q after c last 20 by byConvWords

query searchAll(q: text <=100, c: cursor ?):
  return messages matching q after c last 20 by byWords where memberships[conversationId = .conversationId, principal = viewer] != null

query searchAllOnline(q: text <=100, c: cursor ?):
  return messages matching q after c last 20 by byWords where memberships[conversationId = .conversationId, principal = viewer] != null { *, total: messageCounts[.conversationId] by byGroup }

query myViews(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return views[conversationId, viewer] first 100 by byConvPrincipal

query quotesFor(msgIds: [id] <=50):
  out = []
  for mid in msgIds:
    m = messages[mid]
    if m != null:
      out = out + [{ id: m.id, body: m.body, authorId: m.authorId, author: profiles[m.authorId] profileCard }]
  return out

query principalProfiles(who: [principal] <=20):
  out = []
  for w in who:
    r = profiles[w]
    if r != null:
      out = out + [r profileCard]
  return out

query convLatest():
  out = []
  mine = memberships[viewer] first 1000 by byPrincipalConv
  for m in mine:
    pg = messages[m.conversationId] last 1 by byConvTime
    for x in pg:
      out = out + [{ conversationId: m.conversationId, at: x.at }]
  return out

query myConvIds():
  mine = memberships[viewer] first 1000 by byPrincipalConv
  out = []
  for m in mine:
    out = out + [{ conversationId: m.conversationId, total: messageCounts[m.conversationId] by byGroup }]
  return out

query dmWith(handle: text 3..20 format handle):
  r = profiles[handle] ! else NOT_FOUND
  mine = memberships[viewer] first 1000 by byPrincipalConv
  for m in mine:
    c = conversations[m.conversationId] by byId
    if c != null and c.kind = 'dm' and exists memberships[m.conversationId, r.principal]:
      return { id: c.id }
  return null

query addableMembers(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  out = []
  pg = profiles first 100 by byAt
  for p in pg:
    if exists memberships[conversationId, p.principal]:
      out = out
    else:
      out = out + [p profileCard]
  return slice(out, 0, 20)

query membersOf(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return memberships[conversationId] first 50 by byConvPrincipal { *, profile: profiles[.principal] profileCard }

mutation upsertProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?, avatar: image <=10000000 ?):
  ex = profiles[viewer]
  if ex = null:
    row = insert profiles { principal: viewer, displayName, handle, bio, location, link, avatar, at: now }
    return row profileCard
  update profiles[viewer] { displayName, handle, bio, location, link, avatar }
  return profiles[viewer] profileCard

mutation followUser(targetHandle: text 3..20 format handle):
  r = profiles[targetHandle] ! else NOT_FOUND
  require r.principal != viewer else CANNOT_FOLLOW_SELF
  n = count(follows[r.principal] first 1000 by byFollowed)
  row = insert follows { followerId: viewer, followedId: r.principal, bucket: n / 200, at: now } if absent
  if row = null:
    return { followed: false }
  recent = posts[r.principal] last 100 by byAuthorTime
  for p in recent:
    insert feed { readerId: viewer, key: p.id, postId: p.id, authorId: r.principal, at: p.at, repostRef: p.id } if absent
  recentRp = reposts[r.principal] last 100 by byPrincipalAt
  for rp in recentRp:
    insert feed { readerId: viewer, key: rp.id, postId: rp.postId, authorId: rp.authorId, at: rp.at, repostBy: r.principal, repostRef: rp.id } if absent
  insert followBackfills { followerId: viewer, followedId: r.principal } if absent
  return { followed: true }

mutation unfollowUser(targetHandle: text 3..20 format handle):
  r = profiles[targetHandle] ! else NOT_FOUND
  ex = follows[viewer, r.principal] by byPair
  if ex != null:
    delete follows[ex.id]
  bf = followBackfills[viewer, r.principal]
  if bf != null:
    delete followBackfills[viewer, r.principal]
  pg = feed[viewer, r.principal] first 500 by byReaderAuthor
  for e in pg:
    delete feed[e.id]
  return { followed: false }

mutation createPost(postId: id ?, body: text <=500, kind: enum('text', 'images', 'video'), i1: image <=10000000 ?, i2: image <=10000000 ?, i3: image <=10000000 ?, i4: image <=10000000 ?, clip: video <=50000000 ?):
  if postId != null:
    dup = posts[postId]
    if dup != null:
      return { id: dup.id, duplicate: true }
  if kind = 'images':
    require i1 != null else NEED_IMAGE
    require clip = null else MIXED_MEDIA
  else if kind = 'video':
    require clip != null else NEED_VIDEO
    require i1 = null and i2 = null and i3 = null and i4 = null else MIXED_MEDIA
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
  else:
    require i1 = null and clip = null else MIXED_MEDIA
  pid = postId ?? new
  p = insert posts { id: pid, authorId: viewer, body, kind, img1: i1, img2: i2, img3: i3, img4: i4, clip, at: now }
  insert feed { readerId: viewer, key: p.id, postId: p.id, authorId: viewer, at: now, repostRef: p.id }
  insert globalfeed { key: p.id, postId: p.id, authorId: viewer, at: now, repostRef: p.id }
  for f in follows[viewer] first 200 by byFollowed:
    insert feed { readerId: f.followerId, key: p.id, postId: p.id, authorId: viewer, at: now, repostRef: p.id } if absent
  insert fanouts { kind: 'post', refId: p.id, postId: p.id, authorId: viewer, at: now }
  return { id: p.id, duplicate: false }

mutation likeSet(postId: posts, liked: bool):
  p = posts[postId] ! else NOT_FOUND
  if liked:
    insert likes { postId: postId, principal: viewer, authorId: p.authorId, at: now } if absent
  else:
    ex = likes[postId, viewer]
    if ex != null:
      delete likes[postId, viewer]
  return { liked: liked }

mutation repostSet(postId: posts, reposted: bool):
  p = posts[postId] ! else NOT_FOUND
  if reposted:
    ex = reposts[postId, viewer]
    if ex = null:
      rp = insert reposts { postId: postId, principal: viewer, authorId: p.authorId, at: now }
      insert feed { readerId: viewer, key: rp.id, postId: postId, authorId: p.authorId, at: now, repostBy: viewer, repostRef: rp.id }
      insert globalfeed { key: rp.id, postId: postId, authorId: p.authorId, at: now, repostBy: viewer, repostRef: rp.id }
      for f in follows[viewer] first 200 by byFollowed:
        insert feed { readerId: f.followerId, key: rp.id, postId: postId, authorId: p.authorId, at: now, repostBy: viewer, repostRef: rp.id } if absent
      insert fanouts { kind: 'repost', refId: rp.id, postId: postId, authorId: viewer, repostBy: viewer, at: now }
  else:
    ex = reposts[postId, viewer]
    if ex != null:
      delete reposts[postId, viewer]
      delete globalfeed[ex.id]
      mine = feed[viewer, ex.id] by byReaderKey
      if mine != null:
        delete feed[mine.id]
  return { reposted: reposted }

mutation createReply(parentId: posts, replyId: id ?, body: text <=500):
  parent = posts[parentId] ! else NOT_FOUND
  if replyId != null:
    dup = replies[replyId]
    if dup != null:
      return { id: dup.id, duplicate: true }
  r = insert replies { id: replyId ?? new, parentId: parentId, parentAuthorId: parent.authorId, authorId: viewer, body, at: now }
  return { id: r.id, duplicate: false }

mutation dmCreate(otherHandle: text 3..20 format handle, dmId: id ?):
  r = profiles[otherHandle] ! else NOT_FOUND
  require r.principal != viewer else CANNOT_DM_SELF
  if dmId != null:
    dup = conversations[dmId] by byId
    if dup != null:
      ensure = memberships[dmId, viewer]
      if ensure = null:
        insert memberships { conversationId: dmId, principal: viewer, role: 'admin', joinedAt: now } if absent
      return { id: dup.id, duplicate: true }
  mine = memberships[viewer] first 1000 by byPrincipalConv
  for m in mine:
    c = conversations[m.conversationId] by byId
    if c != null and c.kind = 'dm' and exists memberships[m.conversationId, r.principal]:
      return { id: c.id, duplicate: true }
  cid = dmId ?? new
  insert conversations { id: cid, creatorId: viewer, kind: 'dm', dmKey: cid, disappearing: 'off', at: now }
  insert memberships { conversationId: cid, principal: viewer, role: 'admin', joinedAt: now } if absent
  insert memberships { conversationId: cid, principal: r.principal, role: 'member', joinedAt: now } if absent
  return { id: cid, duplicate: false }

mutation groupCreate(groupId: id ?, secondMemberHandle: text 3..20 format handle, name: text 1..50, description: text <=200 ?):
  r = profiles[secondMemberHandle] ! else NOT_FOUND
  require r.principal != viewer else CANNOT_ADD_SELF
  if groupId != null:
    dup = conversations[groupId] by byId
    if dup != null:
      return { id: dup.id, duplicate: true }
  cid = groupId ?? new
  insert conversations { id: cid, creatorId: viewer, kind: 'group', dmKey: cid, name, description, disappearing: 'off', at: now }
  insert memberships { conversationId: cid, principal: viewer, role: 'admin', joinedAt: now } if absent
  insert memberships { conversationId: cid, principal: r.principal, role: 'member', joinedAt: now } if absent
  return { id: cid, duplicate: false }

mutation memberAdd(conversationId: conversations, handle: text 3..20 format handle):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  c = conversations[conversationId] by byId ! else NOT_FOUND
  require c.kind = 'group' else NOT_A_GROUP
  r = profiles[handle] ! else NOT_FOUND
  insert memberships { conversationId, principal: r.principal, role: 'member', joinedAt: now } if absent
  return null

mutation memberRemove(conversationId: conversations, handle: text 3..20 format handle):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  r = profiles[handle] ! else NOT_FOUND
  ex = memberships[conversationId, r.principal]
  if ex != null:
    delete memberships[conversationId, r.principal]
  return null

mutation promoteAdmin(conversationId: conversations, handle: text 3..20 format handle):
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  r = profiles[handle] ! else NOT_FOUND
  target = memberships[conversationId, r.principal] ! else NOT_MEMBER
  update memberships[target.id] { role: 'admin' }
  return null

mutation leaveChat(conversationId: conversations):
  ex = memberships[conversationId, viewer] ! else NOT_MEMBER
  delete memberships[conversationId, viewer]
  return null

mutation renameChat(conversationId: conversations, name: text 1..50):
  c = conversations[conversationId] by byId ! else NOT_FOUND
  require c.kind = 'group' else NOT_A_GROUP
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { name }
  return null

mutation setChatDescription(conversationId: conversations, description: text <=200 ?):
  c = conversations[conversationId] by byId ! else NOT_FOUND
  require c.kind = 'group' else NOT_A_GROUP
  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { description }
  return null

mutation setChatColor(conversationId: conversations, color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate')):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  c = conversations[conversationId] by byId ! else NOT_FOUND
  if c.kind = 'group':
    require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { color }
  return null

mutation setChatBackground(conversationId: conversations, background: image <=10000000 ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  c = conversations[conversationId] by byId ! else NOT_FOUND
  if c.kind = 'group':
    require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { background }
  return null

mutation setDisappearing(conversationId: conversations, value: enum('off', '24h', '7d')):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  c = conversations[conversationId] by byId ! else NOT_FOUND
  if c.kind = 'group':
    require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN
  update conversations[conversationId] { disappearing: value }
  return null

fn ttlMs(disappearing: enum('off', '24h', '7d')):
  w = sysconfig['v1'] by byKey
  a = 86400000
  b = 604800000
  if w != null:
    a = w.ttlA * 1000
    b = w.ttlB * 1000
  if disappearing = '24h':
    return a
  if disappearing = '7d':
    return b
  return 0

mutation sendText(conversationId: conversations, messageId: id ?, body: text <=2000, quoteId: id ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  require body != '' else EMPTY_BODY
  if quoteId != null:
    q = messages[quoteId] ! else BAD_QUOTE
    require q.conversationId = conversationId else BAD_QUOTE
  if messageId != null:
    dup = messages[messageId]
    if dup != null:
      return { id: dup.id, duplicate: true }
  c = conversations[conversationId] by byId ! else NOT_FOUND
  ttl = ttlMs(c.disappearing)
  mid = messageId ?? new
  m = insert messages { id: mid, conversationId, authorId: viewer, kind: 'text', body, quoteId, tombstone: false, expiresAt: now + ttl if ttl != 0 else null, at: now }
  members = memberships[conversationId] first 50 by byConvPrincipal
  me = profiles[viewer]
  senderName = 'Someone'
  if me != null and me.displayName != '':
    senderName = me.displayName
  cfg = sysconfig['v1'] by byKey
  quiet = cfg != null and cfg.replayOff
  for mb in members:
    if mb.principal != viewer:
      insert receipts { conversationId, messageId: m.id, principal: mb.principal, at: now } if absent
      if not quiet and not exists connected[mb.principal]:
        emit notify { targetUserId: mb.principal, chatId: conversationId, senderDisplayName: senderName, preview: slice(body, 0, 80) }
  return { id: m.id, duplicate: false }

mutation sendMedia(conversationId: conversations, messageId: id ?, mediaKind: enum('image', 'video'), photo: image <=10000000 ?, clip: video <=50000000 ?, caption: text <=500 ?, viewOnce: bool):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  require not viewOnce or mediaKind = 'image' else VIEWONCE_VIDEO
  if mediaKind = 'image':
    require photo != null else NEED_IMAGE
    require clip = null else MIXED_MEDIA
  else:
    require clip != null else NEED_VIDEO
    require photo = null else MIXED_MEDIA
    duration = clip.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else TOO_LONG
  cap = caption ?? ''
  require count(cap) <= 500 else CAPTION_LONG
  if messageId != null:
    dup = messages[messageId]
    if dup != null:
      return { id: dup.id, duplicate: true }
  c = conversations[conversationId] by byId ! else NOT_FOUND
  ttl = ttlMs(c.disappearing)
  mid = messageId ?? new
  kind = 'photo'
  if mediaKind = 'video':
    kind = 'video'
  if viewOnce:
    kind = 'viewonce'
  once = photo if viewOnce else null
  plain = photo if not viewOnce and mediaKind = 'image' else null
  m = insert messages { id: mid, conversationId, authorId: viewer, kind, body: caption, photo: plain, photoOnce: once, clip, quoteId: null, tombstone: false, expiresAt: now + ttl if ttl != 0 else null, at: now }
  members = memberships[conversationId] first 50 by byConvPrincipal
  me = profiles[viewer]
  senderName = 'Someone'
  if me != null and me.displayName != '':
    senderName = me.displayName
  preview = 'Photo'
  if mediaKind = 'video':
    preview = 'Video'
  cfg = sysconfig['v1'] by byKey
  quiet = cfg != null and cfg.replayOff
  for mb in members:
    if mb.principal != viewer:
      insert receipts { conversationId, messageId: m.id, principal: mb.principal, at: now } if absent
      if not quiet and not exists connected[mb.principal]:
        emit notify { targetUserId: mb.principal, chatId: conversationId, senderDisplayName: senderName, preview: preview }
  return { id: m.id, duplicate: false }

mutation editMessage(messageId: messages, text: text <=2000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else EDIT_DELETED
  w = sysconfig['v1'] by byKey
  editWin = 900
  if w != null:
    editWin = w.editWin
  require now - msg.at <= editWin * 1000 else EDIT_WINDOW
  if msg.kind = 'text':
    require text != '' else EMPTY_BODY
  else:
    require count(text) <= 500 else CAPTION_LONG
  update messages[msg] { body: text, editedAt: now }
  return null

mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require not msg.tombstone else EDIT_DELETED
  w = sysconfig['v1'] by byKey
  deleteWin = 3600
  if w != null:
    deleteWin = w.deleteWin
  require now - msg.at <= deleteWin * 1000 else DELETE_WINDOW
  update messages[msg] { tombstone: true, body: null, photo: null, photoOnce: null, clip: null }
  return null

mutation reactMessage(messageId: messages, emoji: text <=16):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  if emoji = 'none':
    ex = msgReactions[messageId, viewer]
    if ex != null:
      delete msgReactions[messageId, viewer]
  else:
    upsert msgReactions[messageId, viewer] { conversationId: msg.conversationId, messageId: messageId, principal: viewer, emoji, at: now }
  return null

mutation openViewOnce(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.kind = 'viewonce' else NOT_VIEWONCE
  require exists memberships[msg.conversationId, viewer] else NOT_MEMBER
  v = views[messageId, viewer]
  require v = null else ALREADY_VIEWED
  insert views { conversationId: msg.conversationId, messageId: messageId, principal: viewer, at: now }
  return { id: msg.id }

mutation markDelivered(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  mine = receipts[conversationId, viewer] first 200 by byConvPrincipal where .deliveredAt = null
  for r in mine:
    update receipts[r.id] { deliveredAt: now } if .deliveredAt = null
  return null

mutation markRead(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  update memberships[conversationId, viewer] { lastReadAt: now }
  mine = receipts[conversationId, viewer] first 200 by byConvPrincipal where .readAt = null
  for r in mine:
    update receipts[r.id] { deliveredAt: now, readAt: now } if .readAt = null
  return null

mutation typingPing(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  upsert typing[conversationId, viewer] { conversationId, principal: viewer, at: now, expiresAt: now + 5000 }
  return null

job fanOut():
  chunk w in fanouts first 5 by byId:
    for f in follows[w.authorId] first 1000 by byFollowed:
      if w.kind = 'post':
        insert feed { readerId: f.followerId, key: w.refId, postId: w.postId, authorId: w.authorId, at: w.at, repostRef: w.refId } if absent
      else:
        insert feed { readerId: f.followerId, key: w.refId, postId: w.postId, authorId: w.authorId, at: w.at, repostBy: w.repostBy, repostRef: w.refId } if absent
    delete fanouts[w.id]

job backfillFollows():
  chunk b in followBackfills first 5 by byId:
    older = posts[b.followedId] first 4000 by byAuthorTime
    for p in older:
      insert feed { readerId: b.followerId, key: p.id, postId: p.id, authorId: b.followedId, at: p.at, repostRef: p.id } if absent
    olderRp = reposts[b.followedId] first 4000 by byPrincipalAt
    for rp in olderRp:
      insert feed { readerId: b.followerId, key: rp.id, postId: rp.postId, authorId: rp.authorId, at: rp.at, repostBy: b.followedId, repostRef: rp.id } if absent
    delete followBackfills[b.id]

job digestTick():
  cfg = sysconfig['v1'] by byKey
  periodMs = 86400000
  anchorMs = 28800000
  quiet = false
  if cfg != null:
    periodMs = cfg.digestPeriod
    anchorMs = cfg.digestAnchorMs
    quiet = cfg.replayOff
  k = (now - anchorMs) / periodMs
  end = anchorMs + k * periodMs
  start = end - periodMs
  chunk p in profiles first 100 by byId:
    if quiet:
      return
    prev = digestSent[p.principal, start]
    if prev = null:
      nf = count(follows[p.principal, at >= start, at < end] first 5000 by byFollowedAt)
      np = count(feed[p.principal, at >= start, at < end] first 5000 by byReaderTime)
      total = 0
      chats = 0
      convs = memberships[p.principal] first 200 by byPrincipalConv
      for m in convs:
        lo = start
        if m.lastReadAt != null and m.lastReadAt > start:
          lo = m.lastReadAt
        pg = messages[m.conversationId, at >= lo, at < end] first 5000 by byConvTime where .authorId != p.principal and not .tombstone
        n = count(pg)
        if n > 0:
          total = total + n
          chats = chats + 1
      if nf + np + total > 0:
        emit digest { targetUserId: p.principal, kind: 'digest', periodStart: start, periodEnd: end, newFollowers: nf, newPostsInFollowing: np, unreadMessages: total, unreadChats: chats }
      insert digestSent { userId: p.principal, periodStart: start, periodEnd: end, newFollowers: nf, newPostsInFollowing: np, unreadMessages: total, unreadChats: chats, at: now }

schedule fanOutEveryMinute every 1m: fanOut
schedule backfillEveryMinute every 1m: backfillFollows
schedule digestEveryMinute every 1m: digestTick
