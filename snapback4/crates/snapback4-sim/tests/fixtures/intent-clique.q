-- The acceptance target for LLP 3000.013: calibration #18's Clique backend,
-- restated in the new forms. No `by` lines, no index names, no caps except
-- product rules, no application-maintained derived tables.

use identity password
effect push

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text <=2000 format url ?
  avatar: image <=10000000 ?
  createdAt: time default now
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  immutable principal, createdAt
  public 'Clique profiles are discoverable'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

table posts:                       -- originals and replies; a reply has a parent
  authorId: principal
  parentId: posts ?
  body: text <=500
  photo1: image <=10000000 ?
  video: video <=50000000 ?
  at: time default now
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  immutable authorId, parentId, at
  public 'Public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time default now
  unique postId, principal
  immutable postId, principal, at
  public 'Public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table reposts:
  postId: posts
  actorId: principal
  at: time default now
  unique actorId, postId
  immutable postId, actorId, at
  public 'Public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default now
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'Public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

view activity:                     -- planned at read time: Global
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }

view following: activity where .actor = viewer or exists follows[viewer, .actor]   -- materialized per reader

view replyCount: count posts by .parentId
view followerCount: count follows by .followedId
view followingCount: count follows by .followerId
view receivedLikes: count likes by .postId.authorId
view dailyLikes: count likes by .postId.authorId, day(.at)
view receivedReplies: count posts by .parentId.authorId
view receivedReposts: count reposts by .postId.authorId
view originalPosts: count posts where .parentId = null by .authorId
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)

shape postCard = { *, author: profiles[principal = .authorId], replyCount: replyCount[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
shape activityCard = { *, post: posts[.post] postCard, actor: profiles[principal = .actor] }

query home(c: cursor ?):
  return following last 20 by .at after c activityCard
query global(c: cursor ?):
  return activity last 20 by .at after c activityCard
query trending():
  return posts where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at postCard
query userPosts(owner: principal, c: cursor ?):
  return posts where .authorId = owner and .parentId = null last 20 by .at after c postCard
query thread(postId: posts, c: cursor ?):
  return posts where .parentId = postId first 20 by .at after c postCard
query people(q: text <=100, c: cursor ?):
  return profiles matching q last 20 by .createdAt after c
query socialProfile(handle: text 3..20 format handle):
  p = profiles[handle = handle] ! else NOT_FOUND
  return { ...p, followers: followerCount[p.principal], following: exists follows[viewer, p.principal] }
query insights():
  days = []
  for d in range(day(now) - 6, day(now) + 1):
    days = days + [{ day: d, posts: dailyPosts[viewer, d], likes: dailyLikes[viewer, d] }]
  return { posts: originalPosts[viewer], likesReceived: receivedLikes[viewer], repliesReceived: receivedReplies[viewer], repostsReceived: receivedReposts[viewer], followers: followerCount[viewer], following: followingCount[viewer], days }

mutation createPost(postId: id, body: text <=500, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, body } if absent
mutation setLike(postId: posts, set: bool):
  if set:
    insert likes { postId, principal: viewer } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setFollow(owner: principal, set: bool):
  require owner != viewer else CANNOT_FOLLOW_SELF
  if set:
    insert follows { followerId: viewer, followedId: owner } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]

-- Messaging (abridged to the forms that change)
table members:
  conversationId: id
  principal: principal
  role: enum('member', 'admin')
  readOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId          -- a product rule from the brief
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer, role = 'admin']
  sync to members[.conversationId]

table messages:
  conversationId: id
  senderId: principal
  body: text <=2000
  ordinal: int
  tombstone: bool default false
  at: time default now
  expiresAt: time ?
  search body
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  retain delivered-history
  expire at .expiresAt
  sync to members[.conversationId]

query history(conversationId: id, c: cursor ?):
  return messages where .conversationId = conversationId last 50 by .ordinal after c
query searchAll(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.conversationId, viewer] and not .tombstone last 20 by .at after c

job daily(periodStart: time, periodEnd: time):
  for p in profiles:
    unreadChats = 0
    unreadMessages = 0
    for m in members where .principal = p.principal:
      n = count(messages where .conversationId = m.conversationId and .at >= periodStart and .at < periodEnd and .senderId != p.principal and .ordinal > m.readOrdinal and not .tombstone)
      if n > 0:
        unreadChats = unreadChats + 1
        unreadMessages = unreadMessages + n
    if unreadMessages > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unreadMessages, unreadChats } once [p.principal, periodEnd]
schedule dailyDigest every 2m: daily
