-- Clique on Snapback 4: social messaging backend.
-- Covers M1 (accounts/profiles), M2 (posts/follow graph/feeds),
-- M3 (DMs/groups/messaging), M4 (media/reactions/edit/delete),
-- M5 (disappearing/view-once/chat config/search),
-- M6 (offline queue is the platform outbox; push seam; custom-client API),
-- M8 (insights/trending/scheduled digest/multi-device read state).
-- Auth is the built-in password identity (argon2, sessions, revocation).

use identity password
use personas alice, bob, carol, dave

-- Tunables applied by scripts/seed.mjs from config files:
-- production defaults live in config/*.production.json; grading runs apply
-- the fixture pack's shortened configs. Absent rows fall back to production.
table appConfig:
  key: text <=64
  num: int
  public 'app config is readable by every client'
  insert <- deny
  update <- deny
  delete <- deny
  sync public last 50 by byId

-- M1: profiles. One row per account, keyed by principal.
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
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public last 2000 by byId

-- M2: follow graph. Public, online-only; the Following feed is served
-- from fan-out entries (feedEntries) so reads never merge 500 lanes.
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
  sync public

-- M2: posts. Original top-level posts only; replies live in replies.
table posts:
  authorId: principal
  body: text <=500 ?
  kind: enum('text', 'images', 'video')
  poster: image <=10000000 ?
  at: time
  day: int
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  cap 500 by authorId
  public 'posts are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- deny
  sync public last 200 by byTime

-- M2: one row per attached asset. Public; served under the row's rule.
table postMedia:
  postId: posts
  authorId: principal
  slot: int
  image: image <=10000000 ?
  video: video <=50000000 ?
  unique byPostSlot: postId, slot
  by byPost: postId, slot
  public 'post media is public'
  insert <- .authorId = viewer
  update <- deny
  delete <- deny
  sync public last 500 by byId

-- M2: likes as idempotent set-state rows (upsert/clear, never flip).
table likes:
  postId: posts
  likerId: principal
  postAuthorId: principal
  at: time
  day: int
  unique byPostLiker: postId, likerId
  by byLiker: likerId, postId
  by byAuthor: postAuthorId, id
  public 'likes are public'
  insert <- .likerId = viewer
  update <- .likerId = viewer
  delete <- .likerId = viewer
  sync public

-- M2: reposts, same set-state shape.
table reposts:
  postId: posts
  reposterId: principal
  postAuthorId: principal
  at: time
  unique byPostReposter: postId, reposterId
  by byReposter: reposterId, at, id
  by byAuthor: postAuthorId, id
  cap 2000 by reposterId
  public 'reposts are public'
  insert <- .reposterId = viewer
  update <- .reposterId = viewer
  delete <- .reposterId = viewer
  sync public

-- M2: replies are posts referencing a parent; they never enter feeds.
table replies:
  parentId: posts
  authorId: principal
  parentAuthorId: principal
  body: text <=500
  at: time
  by byParent: parentId, at, id
  by byAuthor: authorId, at, id
  public 'replies are public'
  insert <- .authorId = viewer
  update <- deny
  delete <- deny
  sync public

-- M2/M8: Following-feed fan-out entries, one row per reader per post
-- (plus one per reader per repost of a post). Originals carry
-- repostedBy = authorId and repostId = postId so every row has a
-- non-null repost link; readers filter unfollowed authors and removed
-- reposts client-side from the joined follows/reposts rows.
table feedEntries:
  readerId: principal
  postId: posts
  authorId: principal
  repostedBy: principal
  repostId: id
  body: text <=500 ?
  kind: enum('text', 'images', 'video')
  posterId: id ?
  at: time
  unique byReaderEntry: readerId, postId, repostedBy, repostId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .authorId = viewer or .repostedBy = viewer or .readerId = viewer
  delete <- .readerId = viewer or .repostedBy = viewer
  sync to .readerId last 200 by byReaderTime

-- M2/M8: remaining fan-out work for followers outside bucket 0.
table fanouts:
  postId: posts
  authorId: principal
  repostedBy: principal
  repostId: id
  body: text <=500 ?
  kind: enum('text', 'images', 'video')
  posterId: id ?
  at: time
  read <- deny
  insert <- .authorId = viewer or .repostedBy = viewer
  delete <- deny

-- Aggregates. Online-only (grouped away from every sync audience);
-- feed/threads/profile/insights queries join them server-side.
maintain likeCounts: count likes by postId
  read <- allow
maintain repostCounts: count reposts by postId
  read <- allow
maintain replyCounts: count replies by parentId
  read <- allow
maintain postsByAuthor: count posts by authorId
  read <- allow
maintain likesByAuthor: count likes by postAuthorId
  read <- allow
maintain repostsByAuthor: count reposts by postAuthorId
  read <- allow
maintain repliesByAuthor: count replies by parentAuthorId
  read <- allow
maintain followerCounts: count follows by followedId
  read <- allow
maintain followingCounts: count follows by followerId
  read <- allow
maintain postsByAuthorDay: count posts by authorId, day
  read <- allow
maintain likesByAuthorDay: count likes by postAuthorId, day
  read <- allow
maintain messageCounts: count messages by chatId
  read <- exists members[.chatId, viewer]

-- M3: chats. DMs (kind dm, exactly two members, no name) and groups
-- (kind group, 2-50 members, admin-managed name/description).
table chats:
  kind: enum('dm', 'group')
  name: text 1..50 ?
  description: text <=200 ?
  color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate') ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d')
  createdBy: principal
  at: time
  read <- exists members[.id, viewer]
  insert <- .createdBy = viewer
  update <- exists members[.id, viewer]
  delete <- deny
  retain delivered-history
  sync to members[.id]

-- M3: membership. The audience table for every chat-scoped sync.
table members:
  chatId: chats
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byChatPrincipal: chatId, principal
  by byChatPrincipalRole: chatId, principal, role
  by byPrincipalChat: principal, chatId, id
  cap 50 by chatId
  immutable chatId, principal, joinedAt
  read <- exists members[.chatId, viewer]
  insert <- exists members[.chatId, viewer, 'admin'] or created chats[.chatId]
  update <- exists members[.chatId, viewer, 'admin']
  delete <- .principal = viewer or exists members[.chatId, viewer, 'admin']
  retain delivered-history
  sync to members[.chatId]

-- M3/M4/M5: messages. Text, photo (normal or view-once via photoOnce),
-- and video with a still poster. Tombstoned rows keep their place with
-- cleared content; expired rows vanish everywhere at once.
table messages:
  chatId: chats
  authorId: principal
  kind: enum('text', 'image', 'video')
  body: text <=2000 ?
  caption: text <=500 ?
  photo: image <=10000000 ?
  photoOnce: image <=10000000 once ?
  clip: video <=50000000 ?
  poster: image <=10000000 ?
  quoteId: id ?
  editedAt: time ?
  tombstoned: bool
  viewOnce: bool
  expiresAt: time ?
  at: time
  by byChatTime: chatId, at, id
  by byChatWords: chatId, words(body, caption), at, id
  by byAllWords: words(body, caption), at, id
  by byExpiresAt: expiresAt
  immutable chatId, authorId, kind, quoteId, viewOnce, at
  read <- exists members[.chatId, viewer]
  insert <- .authorId = viewer and exists members[.chatId, viewer]
  update <- .authorId = viewer
  delete <- deny
  retain delivered-history
  expire at .expiresAt
  sync to members[.chatId] last 500 by byChatTime

-- M3: per-recipient receipt rows, created lazily as each member fetches
-- (delivered) and views (read). The recipient set is exactly the rows
-- present; leavers' rows are dropped client-side against membership.
table receipts:
  chatId: chats
  messageId: messages
  principal: principal
  state: int
  at: time
  unique byMessagePrincipal: messageId, principal
  by byChatPrincipal: chatId, principal, messageId
  by byChatAt: chatId, at, id
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  retain delivered-history
  sync to members[.chatId] last 500 by byChatAt

-- M4: one reaction per user per message; set/replace/clear.
table msgReactions:
  chatId: chats
  messageId: messages
  principal: principal
  emoji: text <=32
  mutationId: id ?
  at: time
  unique byMessagePrincipal: messageId, principal
  by byChatMsg: chatId, messageId, principal
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  retain delivered-history
  sync to members[.chatId] last 500 by byChatMsg

-- M3: typing presence as durable rows with a 5 s expiry (the ephemeral
-- idiom: a table plus expire, observed as a live query).
table typing:
  chatId: chats
  principal: principal
  expiresAt: time ?
  unique byChatPrincipal: chatId, principal
  by byExpiresAt: expiresAt
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer and exists members[.chatId, viewer]
  update <- .principal = viewer
  delete <- .principal = viewer
  expire at .expiresAt
  sync to members[.chatId]

-- M8: per-device-shared read watermarks; opening a conversation on one
-- device clears the unread mark on the account's other devices.
table chatReads:
  chatId: chats
  principal: principal
  lastReadAt: time
  unique byChatPrincipal: chatId, principal
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  retain delivered-history
  sync to members[.chatId]

-- M8: digest accumulators, incremented at write time and consumed by
-- the scheduled digest job. Written by other principals' mutations, so
-- the rules admit any writer; only the owning user may read them.
table digestTotals:
  userId: principal
  periodStart: time
  followers: int
  posts: int
  unread: int
  unreadChats: int
  unique byUserPeriod: userId, periodStart
  public 'digest counters are readable so cross-principal upserts collide readably; only the job consumes them'
  insert <- allow
  update <- allow
  delete <- deny
  sync public

table digestUnread:
  userId: principal
  periodStart: time
  chatId: id
  unique byFull: userId, periodStart, chatId
  by byUserPeriod: userId, periodStart, chatId
  cap 500 by userId, periodStart
  public 'digest presence rows are readable so cross-principal writes collide readably; only the job consumes them'
  insert <- allow
  update <- allow
  delete <- deny
  sync public

-- M8: emitted-digest ledger; exactly one digest per user per period
-- across retries and backend restarts.
table digests:
  userId: principal
  periodStart: time
  emittedAt: time
  unique byUserPeriod: userId, periodStart
  read <- .userId = viewer
  insert <- deny
  delete <- deny

effect notify

-- Shared read shapes.
shape postCard = { *, author: profiles[.authorId], likeCount: likeCounts[.id], repostCount: repostCounts[.id], replyCount: replyCounts[.id], mine: likes[.id, viewer], myRepost: reposts[.id, viewer] }
shape entryCard = { *, post: posts[.postId], author: profiles[.authorId], likeCount: likeCounts[.postId], repostCount: repostCounts[.postId], replyCount: replyCounts[.postId], mine: likes[.postId, viewer], myRepost: reposts[.postId, viewer], ff: follows[.readerId, .repostedBy], rp: reposts[.repostId] }
shape msgCard = { *, author: profiles[.authorId] }

query clock():
  return { now }

query appconfig():
  return appConfig last 50 by byId { * }

query me():
  return profiles[viewer] { *, followers: followerCounts[.principal], following: followingCounts[.principal], posts: postsByAuthor[.principal] }

query profileByHandle(handle: text <=20):
  return profiles[handle] { *, followers: followerCounts[.principal], following: followingCounts[.principal], posts: postsByAuthor[.principal] }

query profileOf(who: principal):
  return profiles[who] { *, followers: followerCounts[.principal], following: followingCounts[.principal], posts: postsByAuthor[.principal] }

query followEdge(target: principal):
  return follows[viewer, target] { * }

query recentUsers():
  return profiles first 20 by byId { *, followers: followerCounts[.principal], following: followingCounts[.principal] }

query globalFeed(c: cursor ?):
  return posts after c last 20 by byTime postCard

query followingFeed(c: cursor ?):
  return feedEntries[viewer] after c last 20 by byReaderTime entryCard

query profilePosts(author: principal, c: cursor ?):
  return posts[author] after c last 20 by byAuthorTime postCard

query thread(postId: posts, c: cursor ?):
  return { post: posts[postId] postCard, replies: replies[postId] after c last 20 by byParent { *, author: profiles[.authorId] } }

query mediaOf(postId: posts):
  return postMedia[postId] first 4 by byPost { * }

query postById(postId: posts):
  return posts[postId] postCard

query trendingPool():
  return posts last 200 by byTime { id, authorId, at, kind, likeCount: likeCounts[.id] }

query insights():
  (d, r) = divmod(now, 86400000)
  return { posts: postsByAuthor[viewer], likes: likesByAuthor[viewer], reposts: repostsByAuthor[viewer], replies: repliesByAuthor[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], now, postsD0: postsByAuthorDay[viewer, d - 6], postsD1: postsByAuthorDay[viewer, d - 5], postsD2: postsByAuthorDay[viewer, d - 4], postsD3: postsByAuthorDay[viewer, d - 3], postsD4: postsByAuthorDay[viewer, d - 2], postsD5: postsByAuthorDay[viewer, d - 1], postsD6: postsByAuthorDay[viewer, d], likesD0: likesByAuthorDay[viewer, d - 6], likesD1: likesByAuthorDay[viewer, d - 5], likesD2: likesByAuthorDay[viewer, d - 4], likesD3: likesByAuthorDay[viewer, d - 3], likesD4: likesByAuthorDay[viewer, d - 2], likesD5: likesByAuthorDay[viewer, d - 1], likesD6: likesByAuthorDay[viewer, d] }

query inbox(c: cursor ?):
  return members[viewer] after c first 100 by byPrincipalChat { *, chat: chats[.chatId], reads: chatReads[.chatId, viewer], count: messageCounts[.chatId] - tombstoneCounts[.chatId] }

query chatDetail(chatId: chats):
  total = messageCounts[chatId]
  gone = tombstoneCounts[chatId]
  return { chat: chats[chatId], members: members[chatId] first 50 by byChatPrincipal { *, profile: profiles[.principal] }, count: total - gone }

query threadMessages(chatId: chats, c: cursor ?):
  require exists members[chatId, viewer] else NOT_MEMBER
  return messages[chatId] after c last 50 by byChatTime msgCard

query lastMessage(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  page = messages[chatId] last 1 by byChatTime
  return page msgCard

query quotedMessage(messageId: messages):
  return messages[messageId] msgCard

query threadReactions(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  return msgReactions[chatId] last 200 by byChatMsg { * }

query threadReceipts(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  return receipts[chatId] last 500 by byChatAt { * }

query typingFor(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  return typing[chatId] first 10 by byChatPrincipal { *, profile: profiles[.principal] }

query typingMine(c: cursor ?):
  return merge typing after c first 50 by byChatPrincipal:
    [m.chatId] for m in members[viewer] first 200 by byPrincipalChat

query searchPeople(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords { *, followers: followerCounts[.principal], following: followingCounts[.principal] }

query searchChat(chatId: chats, q: text <=100, c: cursor ?):
  require exists members[chatId, viewer] else NOT_MEMBER
  return messages[chatId] matching q after c last 50 by byChatWords msgCard

query searchAll(q: text <=100, c: cursor ?):
  return messages matching q after c last 50 by byAllWords msgCard

-- M1: own-profile create-or-replace (the profile-set replay verb).
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200 ?, location: text <=50 ?, link: text <=200 format url ?, avatar: image <=10000000 ?):
  upsert profiles[viewer] { displayName, handle, bio, location, link, avatar }
  return profiles[viewer] { *, followers: followerCounts[.principal], following: followingCounts[.principal], posts: postsByAuthor[.principal] }

-- M2: follow/unfollow as set-state intents. Following backfills the
-- author's capped post history so the Following feed is correct at once.
mutation setFollow(target: principal, state: bool):
  require target != viewer else CANNOT_FOLLOW_SELF
  if state:
    old = follows[viewer, target]
    if old != null:
      return old
    group = follows[target] first 1000 by byFollowed
    (b, rem) = divmod(count(group), 200)
    for rp in posts[target] first 500 by byAuthorTime:
      insert feedEntries { readerId: viewer, postId: rp.id, authorId: target, repostedBy: target, repostId: rp.id, body: rp.body, kind: rp.kind, at: rp.at } if absent
    rm = appConfig['replayMode']
    quiet = rm.num = 1 if rm != null else false
    if not quiet:
      pc = appConfig['digestProfile']
      prf = pc.num if pc != null else 0
      dur = 120000 if prf = 1 else 86400000
      base = now if prf = 1 else now - 28800000
      (pq, pr) = divmod(base, dur)
      pstart = pq * dur if prf = 1 else pq * dur + 28800000
      old = digestTotals[target, pstart]
      upsert digestTotals[target, pstart] { followers: (old.followers if old != null else 0) + 1, posts: old.posts if old != null else 0, unread: old.unread if old != null else 0, unreadChats: old.unreadChats if old != null else 0 }
    return insert follows { followerId: viewer, followedId: target, bucket: b, at: now }
  else:
    old = follows[viewer, target]
    if old = null:
      return null
    delete follows[viewer, target]
    -- Withdraw this reader's follow-projection hits via the unfollowed
    -- account: their originals, plus their reposts of others (which
    -- arrived via the reposter edge). Own reposts (repostedBy = viewer)
    -- and third-party reposts stay: they arrive via other edges.
    for rp in posts[target] first 500 by byAuthorTime:
      if exists feedEntries[viewer, rp.id, target, rp.id]:
        delete feedEntries[viewer, rp.id, target, rp.id]
    for rr in reposts[target] first 2000 by byReposter:
      if exists feedEntries[viewer, rr.postId, target, rr.id]:
        delete feedEntries[viewer, rr.postId, target, rr.id]
    return null

mutation createTextPost(postId: id, body: text <=500 ?):
  (d, dr) = divmod(now, 86400000)
  p = insert posts { id: postId, authorId: viewer, body, kind: 'text', at: now, day: d } if absent
  if p = null:
    return posts[postId]
  insert feedEntries { readerId: viewer, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'text', at: now }
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feedEntries { readerId: f.followerId, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'text', at: now }
  insert fanouts { postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'text', at: now }
  rm = appConfig['replayMode']
  quiet = rm.num = 1 if rm != null else false
  if not quiet:
    pc = appConfig['digestProfile']
    prf = pc.num if pc != null else 0
    dur = 120000 if prf = 1 else 86400000
    base = now if prf = 1 else now - 28800000
    (pq, pr) = divmod(base, dur)
    pstart = pq * dur if prf = 1 else pq * dur + 28800000
    bumpPostDigest(viewer, pstart)
    for g in follows[viewer, 0] first 200 by byFollowedBucket:
      bumpPostDigest(g.followerId, pstart)
  return p

-- One reader's new-post digest bump (called for bucket-0 readers inline;
-- the fanout job calls it for the rest).
proc bumpPostDigest(reader: principal, pstart: time):
  old = digestTotals[reader, pstart]
  upsert digestTotals[reader, pstart] { followers: old.followers if old != null else 0, posts: (old.posts if old != null else 0) + 1, unread: old.unread if old != null else 0, unreadChats: old.unreadChats if old != null else 0 }

mutation createImagePost(postId: id, body: text <=500 ?, img1: image <=10000000, img2: image <=10000000 ?, img3: image <=10000000 ?, img4: image <=10000000 ?):
  (d, dr) = divmod(now, 86400000)
  p = insert posts { id: postId, authorId: viewer, body, kind: 'images', at: now, day: d } if absent
  if p = null:
    return posts[postId]
  insert postMedia { postId: p.id, authorId: viewer, slot: 0, image: img1 }
  if img2 != null:
    insert postMedia { postId: p.id, authorId: viewer, slot: 1, image: img2 }
  if img3 != null:
    insert postMedia { postId: p.id, authorId: viewer, slot: 2, image: img3 }
  if img4 != null:
    insert postMedia { postId: p.id, authorId: viewer, slot: 3, image: img4 }
  insert feedEntries { readerId: viewer, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'images', at: now }
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feedEntries { readerId: f.followerId, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'images', at: now }
  insert fanouts { postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'images', at: now }
  rm = appConfig['replayMode']
  quiet = rm.num = 1 if rm != null else false
  if not quiet:
    pc = appConfig['digestProfile']
    prf = pc.num if pc != null else 0
    dur = 120000 if prf = 1 else 86400000
    base = now if prf = 1 else now - 28800000
    (pq, pr) = divmod(base, dur)
    pstart = pq * dur if prf = 1 else pq * dur + 28800000
    bumpPostDigest(viewer, pstart)
    for g in follows[viewer, 0] first 200 by byFollowedBucket:
      bumpPostDigest(g.followerId, pstart)
  return p

mutation createVideoPost(postId: id, body: text <=500 ?, clip: video <=50000000, poster: image <=10000000 ?):
  clipDur = clip.duration
  require clipDur != null else DURATION_UNKNOWN
  require clipDur <= 60000 else VIDEO_TOO_LONG
  (d, dr) = divmod(now, 86400000)
  p = insert posts { id: postId, authorId: viewer, body, kind: 'video', poster: poster, at: now, day: d } if absent
  if p = null:
    return posts[postId]
  insert postMedia { postId: p.id, authorId: viewer, slot: 0, video: clip }
  insert feedEntries { readerId: viewer, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'video', at: now }
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feedEntries { readerId: f.followerId, postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'video', at: now }
  insert fanouts { postId: p.id, authorId: viewer, repostedBy: viewer, repostId: p.id, body: body, kind: 'video', at: now }
  rm = appConfig['replayMode']
  quiet = rm.num = 1 if rm != null else false
  if not quiet:
    pc = appConfig['digestProfile']
    prf = pc.num if pc != null else 0
    dur = 120000 if prf = 1 else 86400000
    base = now if prf = 1 else now - 28800000
    (pq, pr) = divmod(base, dur)
    pstart = pq * dur if prf = 1 else pq * dur + 28800000
    bumpPostDigest(viewer, pstart)
    for g in follows[viewer, 0] first 200 by byFollowedBucket:
      bumpPostDigest(g.followerId, pstart)
  return p

mutation setLike(postId: posts, state: bool):
  p = posts[postId] ! else NOT_FOUND
  (d, dr) = divmod(now, 86400000)
  if state:
    upsert likes[postId, viewer] { postAuthorId: p.authorId, at: now, day: d }
  else:
    if exists likes[postId, viewer]:
      delete likes[postId, viewer]
  return likeCounts[postId]

mutation setRepost(postId: posts, state: bool, entryId: id ?):
  p = posts[postId] ! else NOT_FOUND
  if state:
    rid = new
    r = insert reposts { id: rid, postId: postId, reposterId: viewer, postAuthorId: p.authorId, at: now } if absent
    if r = null:
      return reposts[postId, viewer]
    e = insert feedEntries { readerId: viewer, postId: postId, authorId: p.authorId, repostedBy: viewer, repostId: rid, body: p.body, kind: p.kind, at: now } if absent
    for f in follows[viewer, 0] first 200 by byFollowedBucket:
      insert feedEntries { readerId: f.followerId, postId: postId, authorId: p.authorId, repostedBy: viewer, repostId: rid, body: p.body, kind: p.kind, at: now } if absent
    insert fanouts { postId: postId, authorId: p.authorId, repostedBy: viewer, repostId: rid, body: p.body, kind: p.kind, at: now }
    return r
  else:
    old = reposts[postId, viewer]
    if old = null:
      if entryId != null:
        delete feedEntries[entryId]
      return null
    rid = old.id
    delete reposts[postId, viewer]
    -- Retract bucket-0 followers' copies plus our own by unique key;
    -- followers outside bucket 0 drain via the retracts sweep below.
    for f in follows[viewer, 0] first 200 by byFollowedBucket:
      if exists feedEntries[f.followerId, postId, viewer, rid]:
        delete feedEntries[f.followerId, postId, viewer, rid]
    if exists feedEntries[viewer, postId, viewer, rid]:
      delete feedEntries[viewer, postId, viewer, rid]
    insert retracts { repostId: rid, postId: postId, reposterId: viewer, at: now }
    if entryId != null:
      if exists feedEntries[entryId]:
        delete feedEntries[entryId]
    return null

mutation createReply(replyId: id, parentId: posts, body: text <=500):
  parent = posts[parentId] ! else NOT_FOUND
  r = insert replies { id: replyId, parentId: parentId, authorId: viewer, parentAuthorId: parent.authorId, body, at: now } if absent
  if r = null:
    return replies[replyId]
  return r

-- M3: the DM pair index. One DM per user pair, enforced server-side:
-- resolve-or-create consults this before minting, so a fresh chatId for
-- an existing pair (race, retry, custom client) still opens the channel.
table dmPairs:
  lo: principal
  hi: principal
  chatId: chats
  unique byPair: lo, hi
  read <- .lo = viewer or .hi = viewer
  insert <- .lo = viewer or .hi = viewer
  update <- deny
  delete <- deny

-- M3: resolve-or-create a DM. Clients resolve first via the inbox and
-- pass the known id; a replayed id for the same pair resolves to the row.
mutation dmResolveOrCreate(other: principal, chatId: id):
  (lo, hi) = sorted(viewer, other)
  pair = dmPairs[lo, hi]
  if pair != null:
    return chats[pair.chatId]
  ch = chats[chatId]
  if ch != null:
    return ch
  dp = insert dmPairs { lo: lo, hi: hi, chatId: chatId } if absent
  if dp = null:
    existing = dmPairs[lo, hi]
    return chats[existing.chatId]
  nc = insert chats { id: chatId, kind: 'dm', disappearing: 'off', createdBy: viewer, at: now } if absent
  if nc = null:
    return chats[chatId]
  insert members { chatId: nc.id, principal: viewer, role: 'admin', joinedAt: now }
  insert members { chatId: nc.id, principal: other, role: 'admin', joinedAt: now }
  return nc

-- M3: groups. The creator is admin; the named second member joins at once.
mutation groupCreate(chatId: id, title: text 1..50, description: text <=200 ?, second: principal):
  ch = chats[chatId]
  if ch != null:
    return ch
  nc = insert chats { id: chatId, kind: 'group', name: title, description, disappearing: 'off', createdBy: viewer, at: now } if absent
  if nc = null:
    return chats[chatId]
  insert members { chatId: nc.id, principal: viewer, role: 'admin', joinedAt: now }
  insert members { chatId: nc.id, principal: second, role: 'member', joinedAt: now }
  return nc

mutation memberAdd(chatId: chats, member: principal):
  require exists members[chatId, viewer, 'admin'] else NOT_ADMIN
  return insert members { chatId: chatId, principal: member, role: 'member', joinedAt: now } if absent

mutation memberRemove(chatId: chats, member: principal):
  require exists members[chatId, viewer, 'admin'] else NOT_ADMIN
  if exists members[chatId, member]:
    delete members[chatId, member]
  return null

mutation memberPromote(chatId: chats, member: principal):
  require exists members[chatId, viewer, 'admin'] else NOT_ADMIN
  target = members[chatId, member] ! else NOT_FOUND
  update members[target] { role: 'admin' }
  return null

mutation chatLeave(chatId: chats):
  if exists members[chatId, viewer]:
    delete members[chatId, viewer]
  return null

-- M5: group name/description are admin-only; DMs have no profile.
mutation setChatProfile(chatId: chats, name: text 1..50 ?, description: text <=200 ?):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  require ch.kind != 'dm' else DM_HAS_NO_PROFILE
  require exists members[chatId, viewer, 'admin'] else NOT_ADMIN
  update chats[ch] { name, description }
  return chats[chatId]

-- M5: accent color and background image; any member, DMs and groups.
mutation setChatTheme(chatId: chats, color: enum('indigo', 'teal', 'coral', 'amber', 'violet', 'emerald', 'rose', 'slate'), background: image <=10000000 ?, clearBackground: bool):
  require exists members[chatId, viewer] else NOT_MEMBER
  if clearBackground:
    update chats[chatId] { color, background: null }
  else:
    if background != null:
      update chats[chatId] { color, background: background }
    else:
      update chats[chatId] { color }
  return chats[chatId]

-- M5: disappearing-message setting. Any member in DMs, admins in groups.
mutation setDisappearing(chatId: chats, value: enum('off', '24h', '7d')):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  if ch.kind = 'group':
    require exists members[chatId, viewer, 'admin'] else NOT_ADMIN
  update chats[ch] { disappearing: value }
  return chats[chatId]

-- Shared send tail: push emits plus digest unread bumps for every other
-- member, skipped while the replay-mode flag is pinned.
proc sendTail(chatId: chats, preview: text <=80, senderName: text <=50):
  rm = appConfig['replayMode']
  quiet = rm.num = 1 if rm != null else false
  if not quiet:
    pc = appConfig['digestProfile']
    prf = pc.num if pc != null else 0
    dur = 120000 if prf = 1 else 86400000
    base = now if prf = 1 else now - 28800000
    (pq, pr) = divmod(base, dur)
    pstart = pq * dur if prf = 1 else pq * dur + 28800000
    for mb in members[chatId] first 50 by byChatPrincipal:
      if mb.principal != viewer:
        if not exists connected[mb.principal]:
          emit notify { targetUserId: mb.principal, chatId: chatId, senderDisplayName: senderName, preview: preview }
        mark = digestUnread[mb.principal, pstart, chatId]
        old = digestTotals[mb.principal, pstart]
        oldUnread = old.unread if old != null else 0
        oldChats = old.unreadChats if old != null else 0
        oldFollowers = old.followers if old != null else 0
        oldPosts = old.posts if old != null else 0
        if mark = null:
          insert digestUnread { userId: mb.principal, periodStart: pstart, chatId: chatId }
          upsert digestTotals[mb.principal, pstart] { followers: oldFollowers, posts: oldPosts, unread: oldUnread + 1, unreadChats: oldChats + 1 }
        else:
          upsert digestTotals[mb.principal, pstart] { followers: oldFollowers, posts: oldPosts, unread: oldUnread + 1, unreadChats: oldChats }

-- M3/M4/M5: text send with quoted replies, disappearing TTL from the
-- chat's current setting, idempotent on the client-generated id.
mutation sendText(chatId: chats, msgId: id, body: text <=2000, quoteId: id ?):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  if quoteId != null:
    q = messages[quoteId] ! else QUOTE_NOT_FOUND
    require q.chatId = chatId else QUOTE_WRONG_CHAT
  c24 = appConfig['ttl24h']
  c7 = appConfig['ttl7d']
  s24 = c24.num if c24 != null else 86400
  s7 = c7.num if c7 != null else 604800
  ttl = s24 if ch.disappearing = '24h' else (s7 if ch.disappearing = '7d' else null)
  m = insert messages { id: msgId, chatId: chatId, authorId: viewer, kind: 'text', body: body, quoteId: quoteId, tombstoned: false, viewOnce: false, expiresAt: now + ttl if ttl != null else null, at: now } if absent
  if m = null:
    return messages[msgId]
  prof = profiles[viewer]
  nm = prof.displayName if prof != null else 'Someone'
  sendTail(chatId, slice(body, 0, 80), nm)
  return m

mutation sendImage(chatId: chats, msgId: id, caption: text <=500 ?, photo: image <=10000000 ?, photoOnce: image <=10000000 ?, viewOnce: bool, quoteId: id ?):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  require photo != null or photoOnce != null else MEDIA_REQUIRED
  if quoteId != null:
    q = messages[quoteId] ! else QUOTE_NOT_FOUND
    require q.chatId = chatId else QUOTE_WRONG_CHAT
  c24 = appConfig['ttl24h']
  c7 = appConfig['ttl7d']
  s24 = c24.num if c24 != null else 86400
  s7 = c7.num if c7 != null else 604800
  ttl = s24 if ch.disappearing = '24h' else (s7 if ch.disappearing = '7d' else null)
  if viewOnce:
    require photoOnce != null else MEDIA_REQUIRED
    mOnce = insert messages { id: msgId, chatId: chatId, authorId: viewer, kind: 'image', caption: caption, photoOnce: photoOnce, quoteId: quoteId, tombstoned: false, viewOnce: true, expiresAt: now + ttl if ttl != null else null, at: now } if absent
    if mOnce = null:
      return messages[msgId]
    profOnce = profiles[viewer]
    nmOnce = profOnce.displayName if profOnce != null else 'Someone'
    sendTail(chatId, 'Photo', nmOnce)
    return mOnce
  else:
    require photo != null else MEDIA_REQUIRED
    mPlain = insert messages { id: msgId, chatId: chatId, authorId: viewer, kind: 'image', caption: caption, photo: photo, quoteId: quoteId, tombstoned: false, viewOnce: false, expiresAt: now + ttl if ttl != null else null, at: now } if absent
    if mPlain = null:
      return messages[msgId]
    profPlain = profiles[viewer]
    nmPlain = profPlain.displayName if profPlain != null else 'Someone'
    sendTail(chatId, 'Photo', nmPlain)
    return mPlain

mutation sendVideo(chatId: chats, msgId: id, caption: text <=500 ?, clip: video <=50000000, poster: image <=10000000 ?, quoteId: id ?):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  if quoteId != null:
    q = messages[quoteId] ! else QUOTE_NOT_FOUND
    require q.chatId = chatId else QUOTE_WRONG_CHAT
  clipDur = clip.duration
  require clipDur != null else DURATION_UNKNOWN
  require clipDur <= 60000 else VIDEO_TOO_LONG
  c24 = appConfig['ttl24h']
  c7 = appConfig['ttl7d']
  s24 = c24.num if c24 != null else 86400
  s7 = c7.num if c7 != null else 604800
  ttl = s24 if ch.disappearing = '24h' else (s7 if ch.disappearing = '7d' else null)
  m = insert messages { id: msgId, chatId: chatId, authorId: viewer, kind: 'video', caption: caption, clip: clip, poster: poster, quoteId: quoteId, tombstoned: false, viewOnce: false, expiresAt: now + ttl if ttl != null else null, at: now } if absent
  if m = null:
    return messages[msgId]
  prof = profiles[viewer]
  nm = prof.displayName if prof != null else 'Someone'
  sendTail(chatId, 'Video', nm)
  return m

-- M3: keystroke ping; the row expires 5 s after the last one.
mutation setTyping(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  upsert typing[chatId, viewer] { expiresAt: now + 5000 }
  return null

-- M3: lazily advance my receipt row for one message (1 delivered, 2 read).
mutation reportReceipt(messageId: messages, state: int):
  require state = 1 or state = 2 else BAD_STATE
  r = receipts[messageId, viewer]
  if r = null:
    msg = messages[messageId] ! else NOT_FOUND
    require exists members[msg.chatId, viewer] else NOT_MEMBER
    insert receipts { chatId: msg.chatId, messageId: messageId, principal: viewer, state: state, at: msg.at }
  else:
    if state > r.state:
      update receipts[r] { state: state }
  return null

-- M8: conversation-viewed watermark, shared across my devices.
mutation markRead(chatId: chats, at: time):
  require exists members[chatId, viewer] else NOT_MEMBER
  upsert chatReads[chatId, viewer] { lastReadAt: at }
  return null

-- M4: one reaction per user per message; replace or clear.
mutation setReaction(messageId: messages, emoji: text <=32, clear: bool, mutId: id ?):
  msg = messages[messageId] ! else NOT_FOUND
  require exists members[msg.chatId, viewer] else NOT_MEMBER
  if clear:
    if exists msgReactions[messageId, viewer]:
      delete msgReactions[messageId, viewer]
  else:
    upsert msgReactions[messageId, viewer] { chatId: msg.chatId, emoji: emoji, mutationId: mutId, at: now }
  return null

-- M4: edit own text/caption inside the server-side window.
mutation editMessage(messageId: messages, body: text <=2000 ?, caption: text <=500 ?):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.tombstoned = false else MESSAGE_DELETED
  require polls[messageId] = null else POLL_IMMUTABLE
  e = appConfig['editWindow']
  secs = e.num if e != null else 900
  require now - msg.at <= secs * 1000 else EDIT_WINDOW_EXPIRED
  update messages[msg] { body: body, caption: caption, editedAt: now }
  return messages[messageId]

-- M4: delete-for-everyone inside the server-side window. Content and
-- assets are cleared; the row stays as a tombstone for all members.
mutation deleteMessage(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.tombstoned = false else MESSAGE_DELETED
  w = appConfig['deleteWindow']
  secs = w.num if w != null else 3600
  require now - msg.at <= secs * 1000 else DELETE_WINDOW_EXPIRED
  update messages[msg] { body: null, caption: null, photo: null, photoOnce: null, clip: null, poster: null, tombstoned: true }
  insert tombstones { messageId: msg.id, chatId: msg.chatId, principal: viewer, expiresAt: msg.expiresAt } if absent
  return messages[messageId]

-- M2: repost retractions for followers outside bucket 0 (the sync path
-- in setRepost covers bucket 0). Drained by the fanout job.
table retracts:
  repostId: id
  postId: posts
  reposterId: principal
  at: time
  unique byRepost: repostId
  read <- deny
  insert <- .reposterId = viewer
  delete <- deny

-- M2/M8: complete bucket-0 fan-out now; the job covers the rest.
job fanout():
  chunk t in retracts first 5 by byId:
    for f in follows[t.reposterId] first 1000 by byFollowed:
      if exists feedEntries[f.followerId, t.postId, t.reposterId, t.repostId]:
        delete feedEntries[f.followerId, t.postId, t.reposterId, t.repostId]
    delete retracts[t.id]
  chunk w in fanouts first 5 by byId:
    for f in follows[w.authorId] first 1000 by byFollowed:
      -- Bucket 0 fanned out (entries + digest bump) inline at write time;
      -- the job covers the rest, so skip it here to avoid double bumps.
      if f.bucket != 0:
        insert feedEntries { readerId: f.followerId, postId: w.postId, authorId: w.authorId, repostedBy: w.repostedBy, repostId: w.repostId, body: w.body, kind: w.kind, posterId: w.posterId, at: w.at } if absent
        rm = appConfig['replayMode']
        quiet = rm.num = 1 if rm != null else false
        if not quiet:
          pc = appConfig['digestProfile']
          prf = pc.num if pc != null else 0
          fdur = 120000 if prf = 1 else 86400000
          fbase = w.at if prf = 1 else w.at - 28800000
          (fq, fr) = divmod(fbase, fdur)
          fpstart = fq * fdur if prf = 1 else fq * fdur + 28800000
          bumpPostDigest(f.followerId, fpstart)
    delete fanouts[w.id]

-- M8: one digest per user per period, driven by the schedule alone.
job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    u = p.principal
    rm = appConfig['replayMode']
    quiet = rm.num = 1 if rm != null else false
    pc = appConfig['digestProfile']
    prf = pc.num if pc != null else 0
    dur = periodEnd - periodStart
    want = dur = 120000 if prf = 1 else dur = 86400000
    if quiet or not want:
      break
    done = digests[u, periodStart]
    if done = null:
      t = digestTotals[u, periodStart]
      f = t.followers if t != null else 0
      np = t.posts if t != null else 0
      um = t.unread if t != null else 0
      uc = t.unreadChats if t != null else 0
      if f != 0 or np != 0 or um != 0:
        emit notify { targetUserId: u, kind: 'digest', periodStart: periodStart, periodEnd: periodEnd, newFollowers: f, newPostsInFollowing: np, unreadMessages: um, unreadChats: uc }
        insert digests { userId: u, periodStart: periodStart, emittedAt: now }
      if t != null:
        delete digestTotals[u, periodStart]
      for r in digestUnread[u, periodStart] first 500 by byUserPeriod:
        delete digestUnread[r.id]

schedule fanoutEveryMinute every 1m: fanout
schedule digestShort every 2m: digest
schedule digestDaily every 1d at 08:00: digest

-- M7: tombstone ledger. The visible-message count (chat settings) is
-- messageCounts minus tombstoneCounts: tombstoned rows stay in messages
-- (rendered as tombstones) but must not count. The ledger row mirrors the
-- message's expiresAt so an expired-then-swept tombstone stops counting
-- on both sides together. Backfilled trivially: no tombstones pre-M7.
table tombstones:
  messageId: messages
  chatId: chats
  principal: principal
  expiresAt: time ?
  unique byMessage: messageId
  by byChat: chatId, messageId
  by byExpiresAt: expiresAt
  immutable messageId, chatId, principal
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer
  update <- deny
  delete <- deny
  retain delivered-history
  expire at .expiresAt
  sync to members[.chatId]

maintain tombstoneCounts: count tombstones by chatId
  read <- exists members[.chatId, viewer]

-- M7: group polls. A poll is an ordinary text message (body carries the
-- question, so polls count as messages, search, expire, and tombstone
-- like any message) plus one polls row and 2-4 option rows. Votes are
-- idempotent set-state rows: one per user per poll, changeable via
-- upsert, carrying the client's mutation id so retried intents converge.
table polls:
  messageId: messages
  chatId: chats
  question: text 1..200
  at: time
  unique byMessage: messageId
  by byChat: chatId, at, id
  immutable messageId, chatId, question, at
  read <- exists members[.chatId, viewer]
  insert <- exists members[.chatId, viewer]
  update <- deny
  delete <- deny
  retain delivered-history
  sync to members[.chatId]

table pollOptions:
  chatId: chats
  messageId: messages
  optionId: text 1..50
  label: text 1..50
  unique byMsgOption: messageId, optionId
  by byChatMsg: chatId, messageId, optionId
  cap 4 by messageId
  immutable chatId, messageId, optionId, label
  read <- exists members[.chatId, viewer]
  insert <- exists members[.chatId, viewer]
  update <- deny
  delete <- deny
  retain delivered-history
  sync to members[.chatId]

table pollVotes:
  chatId: chats
  messageId: messages
  principal: principal
  optionId: text 1..50
  mutationId: id ?
  at: time
  unique byMsgVoter: messageId, principal
  by byChatMsg: chatId, messageId, principal
  immutable chatId, messageId, principal
  read <- exists members[.chatId, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  retain delivered-history
  sync to members[.chatId]

maintain pollTallies: count pollVotes by chatId, messageId, optionId
  read <- exists members[.chatId, viewer]

maintain pollTotals: count pollVotes by chatId, messageId
  read <- exists members[.chatId, viewer]

-- M7: read shapes.
shape pollCard = { *, options: pollOptions[.messageId] first 4 by byMsgOption { *, tally: pollTallies[.chatId, .messageId, .optionId] }, total: pollTotals[.chatId, .messageId], mine: pollVotes[.messageId, viewer] }

query pollOf(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists members[msg.chatId, viewer] else NOT_MEMBER
  return polls[messageId] pollCard

query threadPolls(chatId: chats):
  require exists members[chatId, viewer] else NOT_MEMBER
  return polls[chatId] first 100 by byChat pollCard

-- M7: create a group poll. Idempotent on the client-generated message
-- id: a retry returns the existing poll without duplicating options.
mutation createPoll(chatId: chats, msgId: id, question: text 1..200, optIdA: text 1..50, optA: text 1..50, optIdB: text 1..50, optB: text 1..50, optIdC: text 1..50 ?, optC: text 1..50 ?, optIdD: text 1..50 ?, optD: text 1..50 ?):
  ch = chats[chatId] ! else NOT_FOUND
  require exists members[chatId, viewer] else NOT_MEMBER
  require ch.kind = 'group' else POLL_GROUP_ONLY
  require optIdA != optIdB else DUP_OPTION
  require (optC = null) = (optIdC = null) else BAD_OPTIONS
  require (optD = null) = (optIdD = null) else BAD_OPTIONS
  require optC != null or optD = null else BAD_OPTIONS
  require optIdC != null or optIdD = null else BAD_OPTIONS
  if optIdC != null:
    require optIdA != optIdC else DUP_OPTION
    require optIdB != optIdC else DUP_OPTION
  if optIdD != null:
    require optIdA != optIdD else DUP_OPTION
    require optIdB != optIdD else DUP_OPTION
    require optIdC != optIdD else DUP_OPTION
  c24 = appConfig['ttl24h']
  c7 = appConfig['ttl7d']
  s24 = c24.num if c24 != null else 86400
  s7 = c7.num if c7 != null else 604800
  ttl = s24 if ch.disappearing = '24h' else (s7 if ch.disappearing = '7d' else null)
  m = insert messages { id: msgId, chatId: chatId, authorId: viewer, kind: 'text', body: question, quoteId: null, tombstoned: false, viewOnce: false, expiresAt: now + ttl if ttl != null else null, at: now } if absent
  if m = null:
    return polls[msgId] by byMessage
  mm = messages[msgId] ! else NOT_FOUND
  insert polls { messageId: mm.id, chatId: chatId, question: question, at: now }
  insert pollOptions { chatId: chatId, messageId: mm.id, optionId: optIdA, label: optA }
  insert pollOptions { chatId: chatId, messageId: mm.id, optionId: optIdB, label: optB }
  -- ?? defaults are unreachable inside these branches; they narrow the
  -- optional args to non-null for the insert (guide types).
  if optIdC != null:
    insert pollOptions { chatId: chatId, messageId: mm.id, optionId: optIdC ?? optIdA, label: optC ?? optA }
  if optIdD != null:
    insert pollOptions { chatId: chatId, messageId: mm.id, optionId: optIdD ?? optIdA, label: optD ?? optA }
  prof = profiles[viewer]
  nm = prof.displayName if prof != null else 'Someone'
  sendTail(chatId, slice(question, 0, 80), nm)
  return polls[mm.id] by byMessage

-- M7: cast or change a poll vote as an idempotent set-state intent.
-- Retrying the same intent (same mutation id or same option) converges
-- on the same state; voting another option moves the single vote.
mutation setVote(messageId: messages, optionId: text 1..50, mutId: id ?):
  msg = messages[messageId] ! else NOT_FOUND
  require exists members[msg.chatId, viewer] else NOT_MEMBER
  poll = polls[messageId] ! else NOT_A_POLL
  require poll.chatId = msg.chatId else POLL_CHAT_MISMATCH
  require msg.tombstoned = false else MESSAGE_DELETED
  opt = pollOptions[messageId, optionId] ! else UNKNOWN_OPTION
  require opt.messageId = msg.id else POLL_CHAT_MISMATCH
  upsert pollVotes[messageId, viewer] { chatId: msg.chatId, optionId: optionId, mutationId: mutId, at: now }
  return pollTallies[msg.chatId, messageId, optionId]
