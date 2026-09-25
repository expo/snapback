use personas alice
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byPair: actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  immutable followerId, followedId
  public 'public edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view feed: activity where .actor = viewer or exists follows[viewer, .actor]

mutation post(postId: id, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId, at: now }
mutation repost(postId: posts):
  return insert reposts { actorId: viewer, postId, at: now } if absent
mutation unrepost(postId: posts):
  delete reposts[viewer, postId]
mutation follow(actor: principal):
  return insert follows { followerId: viewer, followedId: actor } if absent
mutation unfollow(actor: principal):
  delete follows[viewer, actor]
mutation remove(postId: posts):
  update posts[postId] { removed: true }
query home(c: cursor ?):
  return feed last 20 by .at after c

query cards(c: cursor ?):
  return feed last 20 by .at after c { *, post: posts[.post] }
