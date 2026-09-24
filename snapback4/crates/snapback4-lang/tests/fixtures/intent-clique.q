-- Lane A acceptance subset: explicit aggregate foreign keys await Lane B;
-- aggregate views, Following and the digest job belong to lanes B, C and D.
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
  likeCount: count likes by postId
  repostCount: count reposts by postId
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



shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
shape activityCard = { *, post: posts[.post] postCard, actor: profiles[principal = .actor] }

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
  insert <- exists members[conversationId = .conversationId, principal = viewer, role = 'admin']
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

