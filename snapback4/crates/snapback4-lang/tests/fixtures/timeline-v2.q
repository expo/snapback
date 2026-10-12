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

maintain feed: timeline
  events posts where .parentId = null and not .removed by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

mutation post(postId: id, parentId: posts ?):
  return insert posts { id: postId, authorId: viewer, parentId: (posts[parentId] ! else NOT_FOUND).id if parentId != null else null, at: now }
mutation repost(postId: posts):
  return insert reposts { actorId: viewer, postId: (posts[postId] ! else NOT_FOUND).id, at: now } if absent
mutation unrepost(postId: posts):
  delete reposts[viewer, postId]
mutation follow(actor: principal):
  return insert follows { followerId: viewer, followedId: actor } if absent
mutation unfollow(actor: principal):
  delete follows[viewer, actor]
mutation remove(postId: posts):
  update posts[postId] { removed: true }
query home(c: cursor ?):
  return feed[viewer] after c last 20
