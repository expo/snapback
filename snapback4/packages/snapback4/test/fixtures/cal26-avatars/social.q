table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  repostCount: count reposts
  replyCount: count posts
  immutable authorId, parentId, at
  public 'public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at with own keys .principal

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'public reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at with own keys .actorId

view followers: count follows by .followedId
view followingCounts: count follows by .followerId
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]

query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], reposter: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post], author: profiles[principal = posts[.post].authorId], reposter: profiles[principal = .actor] }
query authorPosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null last 20 by .at after c
query postDetail(id: posts):
  return posts[id]
query replies(parent: posts, c: cursor ?):
  return posts where .parentId = parent first 20 by .at after c
query postState(postId: posts):
  return { liked: exists likes[postId, viewer], reposted: exists reposts[viewer, postId] }
query followState(principal: principal):
  return { following: exists follows[viewer, principal], followers: followers[principal], followingCount: followingCounts[principal] }
mutation publish(id: id, body: text <=500, parentId: posts ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require images = null or video = null else MIXED_MEDIA
  if images != null:
    require count(images) >= 1 else EMPTY_IMAGES
  if video != null:
    duration = video.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  return insert posts { id, authorId: viewer, parentId, body, images, video, at: now }
mutation setFollow(principal: principal, state: bool):
  require principal != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = principal] else PROFILE_NOT_FOUND
  if state:
    insert follows { followerId: viewer, followedId: principal, at: now } if absent
  else if exists follows[viewer, principal]:
    delete follows[viewer, principal]
mutation setLike(postId: posts, state: bool): server
  require exists posts[postId] else POST_NOT_FOUND
  if state:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, state: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  require p.parentId = null else ORIGINAL_REQUIRED
  if state:
    insert reposts { actorId: viewer, postId, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
