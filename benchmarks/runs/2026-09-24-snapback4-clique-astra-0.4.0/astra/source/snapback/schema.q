use identity password

table profiles:
  principal: principal
  handle: text 3..20 format handle
  displayName: text 1..50
  bio: text <=200
  location: text <=50
  link: text <=500 format url ?
  avatar: image <=10000000 ?
  unique principal
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  immutable principal
  search displayName, handle
  public 'Registered profiles are discoverable.'
  insert <- .principal = viewer
  update <- .principal = viewer
  cap 1 by principal
  sync public
query me():
  return profiles[principal = viewer]
query profile(handle: text 3..20 format handle):
  return profiles[handle = handle]
query people(q: text <=100, c: cursor ?):
  if q = '':
    return profiles first 50 by .handle after c
  return profiles matching q first 20 by .handle after c
mutation saveProfile(handle: text 3..20 format handle, displayName: text 1..50, bio: text <=200, location: text <=50, link: text <=500 format url ?):
  upsert profiles[principal = viewer] { principal: viewer, handle, displayName, bio, location, link }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }

table posts:
  author: principal
  parent: posts ?
  body: text <=500
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  likes: count likes by post
  reposts: count reposts by post
  replies: count posts by parent
  immutable author, parent, at
  public
  insert <- .author = viewer
  update <- .author = viewer
  sync public
table follows:
  follower: principal
  followed: principal
  at: time
  unique follower, followed
  immutable follower, followed, at
  public
  insert <- .follower = viewer and .followed != viewer
  delete <- .follower = viewer
  sync public
table likes:
  post: posts
  principal: principal
  at: time
  unique post, principal
  immutable post, principal, at
  public
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public
table reposts:
  actor: principal
  post: posts
  at: time
  unique actor, post
  immutable actor, post, at
  public
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public
table feedEvents:
  post: posts
  actor: principal
  at: time
  repost: bool
  unique actor, post, repost
  by byActorTime: actor, at
  immutable post, actor, at, repost
  public
  insert <- .actor = viewer
  delete <- .actor = viewer
  sync public
job backfillFeedEvents():
  for p in posts:
    if p.parent = null and not p.removed:
      insert feedEvents { id: p.id, post: p.id, actor: p.author, at: p.at, repost: false } if absent
  for r in reposts:
    insert feedEvents { id: r.id, post: r.post, actor: r.actor, at: r.at, repost: true } if absent
view activity:
  posts where .parent = null and not .removed { post: .id, actor: .author, at, repost: false }
  reposts { post, actor, at, repost: true }
view followerCounts: count follows by .followed
view followingCounts: count follows by .follower
shape postCard = { *, authorProfile: profiles[principal = .author], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query globalFeed(c: cursor ?):
  return activity last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
query homeFeed(c: cursor ?):
  actors = [viewer]
  for f in follows where .follower = viewer first 10000 by .followed:
    actors = actors + [f.followed]
  if count(actors) > 100:
    return feedEvents where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }
  rows = merge feedEvents after c last 20 by byActorTime:
    [a] for a in actors
  return rows { *, card: posts[.post] postCard, actorProfile: profiles[principal = .actor] }

query userPosts(owner: principal, c: cursor ?):
  return posts where .author = owner and .parent = null last 20 by .at after c postCard
query postDetail(post: posts):
  return posts[post] postCard
query replies(post: posts, c: cursor ?):
  return posts where .parent = post first 20 by .at after c postCard
query socialProfile(handle: text 3..20 format handle):
  p = profiles[handle = handle] ! else PROFILE_NOT_FOUND
  return { profile: p, followerCount: followerCounts[p.principal], followingCount: followingCounts[p.principal], following: exists follows[viewer, p.principal] }
mutation setFollow(owner: principal, enabled: bool):
  require owner != viewer else SELF_FOLLOW
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if enabled:
    insert follows { follower: viewer, followed: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]
mutation createPost(id: id, body: text <=500, parent: posts ?, photo1: image <=10000000 ?, photo2: image <=10000000 ?, photo3: image <=10000000 ?, photo4: image <=10000000 ?, video: video <=50000000 ?):
  require video = null or (photo1 = null and photo2 = null and photo3 = null and photo4 = null) else MIXED_MEDIA
  if video != null:
    duration = video.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  if parent != null:
    require exists posts[parent] else POST_NOT_FOUND
  p = insert posts { id, author: viewer, body, parent, photo1, photo2, photo3, photo4, video, at: now }
  if parent = null:
    insert feedEvents { id: p.id, post: p.id, actor: viewer, at: p.at, repost: false }
  return p
mutation setLike(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    insert likes { post, principal: viewer, at: now } if absent
  else if exists likes[post, viewer]:
    delete likes[post, viewer]
mutation setRepost(post: posts, enabled: bool):
  require exists posts[post] else POST_NOT_FOUND
  if enabled:
    r = insert reposts { post, actor: viewer, at: now } if absent
    if r != null:
      insert feedEvents { id: r.id, post, actor: viewer, at: r.at, repost: true }
  else if exists reposts[viewer, post]:
    delete feedEvents[viewer, post, true]
    delete reposts[viewer, post]
