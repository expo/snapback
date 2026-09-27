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
  public 'Registered profiles are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  sync public

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
  author: principal
  parent: posts ?
  body: text <=500
  image1: image <=10000000 ?
  image2: image <=10000000 ?
  image3: image <=10000000 ?
  image4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  immutable author, parent, at
  public 'Posts are public.'
  insert <- .author = viewer
  update <- .author = viewer
  sync public last 1000 by .at

table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public 'Follow relationships are public.'
  insert <- .follower = viewer
  delete <- .follower = viewer
  sync public

table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public 'Post likes are public.'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by .at

table reposts:
  actor: principal
  post: posts
  at: time
  unique actor, post
  immutable actor, post, at
  public 'Reposts are public.'
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public last 1000 by .at

view followerCount: count follows by .followed
  online only
view followingCount: count follows by .follower
  online only
view repostCount: count reposts by .post
  online only
view replyCount: count posts by .parent
  online only
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view following: activity where .actor = viewer or exists follows[viewer, .actor]
shape postCard = { *, authorProfile: profiles[principal = .author], likes: .likeCount, reposts: repostCount[.id], replies: replyCount[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query global(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query home(c: cursor ?):
  return following last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query post(id: posts):
  return posts[id] postCard
query replies(parent: posts, c: cursor ?):
  return posts where .parent = parent first 20 by .at after c postCard
query social(owner: principal):
  return { followers: followerCount[owner], following: followingCount[owner], followed: exists follows[viewer, owner] }
mutation setFollow(target: principal, active: bool):
  require target != viewer else SELF_FOLLOW
  require exists profiles[principal = target] else USER_NOT_FOUND
  if active:
    insert follows { follower: viewer, followed: target, at: now } if absent
  else if exists follows[viewer, target]:
    delete follows[viewer, target]
mutation publish(id: id, body: text <=500, parent: posts ?, image1: image <=10000000 ?, image2: image <=10000000 ?, image3: image <=10000000 ?, image4: image <=10000000 ?, video: video <=50000000 ?):
  require video = null or (image1 = null and image2 = null and image3 = null and image4 = null) else MIXED_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_DURATION
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  return insert posts { id, author: viewer, parent, body, image1, image2, image3, image4, video, at: now }
mutation setLike(post: posts, active: bool):
  require exists posts[post] else POST_NOT_FOUND
  if active:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, active: bool):
  require exists posts[post] else POST_NOT_FOUND
  if active:
    insert reposts { post, actor: viewer, at: now } if absent
  else if exists reposts[viewer, post]:
    delete reposts[viewer, post]

-- Public, paged exports also support independent replay verification.
query exportPosts(c: cursor ?):
  return posts first 256 by .id after c
query exportFollows(c: cursor ?):
  return follows first 256 by .id after c
query exportLikes(c: cursor ?):
  return likes first 256 by .id after c
query exportReposts(c: cursor ?):
  return reposts first 256 by .id after c
