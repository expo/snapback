use identity password

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200
  location: text <=50
  link: text format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Registered profiles are discoverable by everyone'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public last 1200 by .id
query me():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  return profiles matching q first 20 by .handle after c
mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text format url ?):
  return upsert profiles[principal = viewer] { principal: viewer, displayName, handle, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  authorId: principal
  parentId: posts ?
  body: text <=500
  images: [image <=10000000] <=4 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable authorId, parentId, at
  public 'Public posts and replies'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'Public following graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table likes:
  postId: posts
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal, at
  public 'Public post likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 1000 by .at

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'Public repost activity'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 1000 by .at

view followerCounts: count follows by .followedId
view followingCounts: count follows by .followerId
view repostCounts: count reposts by .postId
view replyCounts: count posts by .parentId
view activity:
  posts where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
shape postCard = { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id], repostCount: repostCounts[.id], replyCount: replyCounts[.id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(author: principal, c: cursor ?):
  return posts where .authorId = author and .parentId = null last 20 by .at after c postCard
query post(id: posts):
  return posts[id] postCard
query replies(parent: posts, c: cursor ?):
  return posts where .parentId = parent first 20 by .at after c postCard
query followState(principal: principal):
  return { followers: followerCounts[principal], following: followingCounts[principal], mine: exists follows[viewer, principal] }
mutation setFollow(principal: principal, value: bool):
  require principal != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = principal] else USER_NOT_FOUND
  if value:
    insert follows { followerId: viewer, followedId: principal, at: now } if absent
  else if exists follows[viewer, principal]:
    delete follows[viewer, principal]
mutation publish(postId: id, body: text <=500, parentId: posts ?, images: [image <=10000000] <=4 ?, video: video <=50000000 ?):
  require not (images != null and video != null) else MIXED_MEDIA
  if images != null:
    require count(images) >= 1 else IMAGE_REQUIRED
  if video != null:
    require video.duration != null else DURATION_UNKNOWN
    require video.duration <= 60000 else VIDEO_TOO_LONG
  if parentId != null:
    require exists posts[parentId] else POST_NOT_FOUND
  return insert posts { id: postId, authorId: viewer, body, parentId, images, video, at: now } if absent
mutation setLike(postId: posts, value: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if value:
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, value: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  require p.parentId = null else ORIGINAL_REQUIRED
  if value:
    insert reposts { postId, actorId: viewer, at: now } if absent
  else if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
