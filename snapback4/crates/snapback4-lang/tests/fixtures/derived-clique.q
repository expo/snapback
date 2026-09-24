-- LLP 3000.013 lane B: the target Clique aggregate declarations in maintain
-- spelling. Named indexes are retained for the pre-planner binder.
table posts:
  authorId: principal
  parentId: posts ?
  at: time
  likeCount: count likes
  repostCount: count reposts
  immutable authorId, parentId, at
  public 'Public posts'
  insert <- .authorId = viewer
  delete <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  at: time
  weight: int
  immutable postId, principal, at
  unique byPostPrincipal: postId, principal
  public 'Public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer

table reposts:
  postId: posts
  actorId: principal
  at: time
  immutable postId, actorId, at
  unique byActorPost: actorId, postId
  public 'Public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer

table follows:
  followerId: principal
  followedId: principal
  unique byFollowerFollowed: followerId, followedId
  public 'Public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer

maintain replyCount: count posts by parentId
maintain followerCount: count follows by followedId
maintain followingCount: count follows by followerId
maintain receivedLikes: count likes by postId.authorId
maintain dailyLikes: count likes by postId.authorId, day(.at)
maintain receivedReplies: count posts by parentId.authorId
maintain receivedReposts: count reposts by postId.authorId
maintain originalPosts: count posts where .parentId = null by authorId
maintain dailyPosts: count posts where .parentId = null by authorId, day(.at)

query totals(owner: principal, postId: posts, day: int):
  return { replies: replyCount[postId], followers: followerCount[owner], following: followingCount[owner], likes: receivedLikes[owner], dailyLikes: dailyLikes[owner, day], receivedReplies: receivedReplies[owner], reposts: receivedReposts[owner], posts: originalPosts[owner], dailyPosts: dailyPosts[owner, day], post: posts[postId] }
mutation post(id: id, parentId: posts ?, at: time):
  return insert posts { id, authorId: viewer, parentId, at }
mutation like(id: id, postId: posts, at: time, weight: int):
  return insert likes { id, postId, principal: viewer, at, weight }
mutation repost(id: id, postId: posts, at: time):
  return insert reposts { id, postId, actorId: viewer, at }
mutation follow(id: id, owner: principal):
  insert follows { id, followerId: viewer, followedId: owner }
mutation unlike(id: id):
  delete likes[id = id]
mutation removePost(id: id):
  delete posts[id = id]
