table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'public posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at
table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at
table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
  immutable followerId, followedId
  public 'public follows'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
query home(c: cursor ?):
  return following last 20 by .at after c
query planned(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c
query exportPosts(c: cursor ?):
  return posts first 32 by .id after c
query exportReposts(c: cursor ?):
  return reposts first 32 by .id after c
query exportFollows(c: cursor ?):
  return follows first 32 by .id after c
mutation post(postId: id, parentId: posts ?):
  insert posts { id: postId, authorId: viewer, parentId, body: 'body', at: now }
mutation repost(postId: posts):
  insert reposts { actorId: viewer, postId, at: now } if absent
mutation follow(actor: principal):
  insert follows { followerId: viewer, followedId: actor } if absent
mutation remove(postId: posts):
  update posts[postId] { removed: true }
mutation unrepost(postId: posts):
  delete reposts[viewer, postId]
mutation unfollow(actor: principal):
  delete follows[viewer, actor]
