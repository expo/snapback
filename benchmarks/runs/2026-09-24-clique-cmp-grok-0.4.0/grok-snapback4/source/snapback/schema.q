-- Clique: accounts, profiles, follow graph, posts, feeds, insights.
-- Window durations match config/windows.json (shortened grading profile).
-- Digest period matches config/digest.json (every 2m).
use identity password
use personas alice, bob, carol, dave, erin, frank, grace, henry
effect notify

table profiles:
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  bio: text <=200 default ""
  location: text <=50 default ""
  link: text <=200 format url ?
  avatar: image <=10000000 ?
  unique byPrincipal: principal
  unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'
  search displayName, handle
  cap 1008
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default now
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  immutable followerId, followedId, at
  cap 1000 by followerId
  cap 1000 by followedId
  cap 5921
  public 'public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table posts:
  authorId: principal
  body: text <=500 default ""
  image1: image <=10000000 ?
  image2: image <=10000000 ?
  image3: image <=10000000 ?
  image4: image <=10000000 ?
  clip: video <=50000000 ?
  at: time
  removed: bool default false
  likeCount: count likes
  replyCount: count replies
  repostCount: count reposts
  by byHourScore: hour(at), likeCount, at, id
  cap 60000
  immutable authorId, at
  public 'public cards retained for reposts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table replies:
  postId: posts
  authorId: principal
  body: text <=500
  at: time
  by byPost: postId, at, id
  cap 60000
  immutable postId, authorId, at
  public 'public thread replies outside Following'
  insert <- .authorId = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  cap 60000
  immutable actorId, postId, at
  public 'public repost attribution'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time default now
  unique byPair: postId, principal
  immutable postId, principal
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table events:
  postId: posts
  actorId: principal
  repost: bool
  at: time
  unique byActorPostType: actorId, postId, repost
  by byTime: at, id
  cap 60000
  immutable postId, actorId, repost, at
  public 'Global public events'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

maintain feed: timeline
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId

view followerCounts: count follows by .followedId
  online only
view followingCounts: count follows by .followerId
  online only
view insightPosts: count posts where not .removed by .authorId
  online only
view insightLikesReceived: count likes by .postId.authorId
  online only
view insightRepostsReceived: count reposts by .postId.authorId
  online only
view insightRepliesReceived: count replies by .postId.authorId
  online only
view dailyPosts: count posts where not .removed by .authorId, day(.at)
  online only
view dailyLikesReceived: count likes by .postId.authorId, day(.at)
  online only

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query myProfile():
  return profiles[principal = viewer]

query profileByHandle(handle: text 3..20 format handle):
  return profiles[handle = handle]

query profileByPrincipal(owner: principal):
  return profiles[principal = owner]

query isFollowing(owner: principal):
  return exists follows[viewer, owner]

query followerCount(owner: principal):
  return followerCounts[owner]

query followingCount(owner: principal):
  return followingCounts[owner]

query peopleSearch(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .id

query peopleDirectory(c: cursor ?):
  return profiles after c first 20 by .id

query followingFeed(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId], actor: profiles[principal = .actorId], author: profiles[principal = .authorId], liked: exists likes[.postId, viewer], reposted: exists reposts[viewer, .postId] }

query globalFeed(c: cursor ?):
  return events after c last 20 by byTime { *, post: posts[id = .postId], actor: profiles[principal = .actorId], author: profiles[principal = .actorId], liked: exists likes[.postId, viewer], reposted: exists reposts[viewer, .postId] }

query trending(c: cursor ?):
  return posts where .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at after c { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }

query postById(postId: posts):
  return posts[postId] { *, author: profiles[principal = .authorId], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }

query threadReplies(postId: posts, c: cursor ?):
  return replies[postId] after c first 50 by byPost { *, author: profiles[principal = .authorId] }

query profilePosts(owner: principal, c: cursor ?):
  return posts where .authorId = owner and not .removed last 20 by .at after c { *, liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }

query myInsights():
  p = profiles[principal = viewer] ! else PROFILE_REQUIRED
  return {
    posts: insightPosts[viewer],
    likesReceived: insightLikesReceived[postId.authorId = viewer],
    repostsReceived: insightRepostsReceived[postId.authorId = viewer],
    repliesReceived: insightRepliesReceived[postId.authorId = viewer],
    followers: followerCounts[viewer],
    following: followingCounts[viewer]
  }

query myDailyPosts(c: cursor ?):
  return dailyPosts where .authorId = viewer last 14 by .day after c { day, count: .value }

query myDailyLikes(c: cursor ?):
  return dailyLikesReceived where .postId.authorId = viewer last 14 by .day after c { day, count: .value }

query calendar():
  return { day: day(now), now }

mutation saveProfile(displayName: text 1..50, handle: text 3..20 format handle, bio: text <=200, location: text <=50, link: text <=200 format url ?):
  existing = profiles[principal = viewer]
  if existing = null:
    return insert profiles { principal: viewer, displayName, handle, bio, location, link }
  update profiles[existing] { displayName, handle, bio, location, link }
  return profiles[principal = viewer]

mutation placeAvatar(avatar: image <=10000000):
  p = profiles[principal = viewer] ! else PROFILE_REQUIRED
  update profiles[p] { avatar }
  return null

mutation follow(authorId: principal):
  require authorId != viewer else CANNOT_FOLLOW_SELF
  target = profiles[principal = authorId] ! else PROFILE_NOT_FOUND
  insert follows { followerId: viewer, followedId: authorId, at: now } if absent
  return null

mutation unfollow(authorId: principal):
  if exists follows[viewer, authorId]:
    delete follows[viewer, authorId]
  return null

mutation setFollow(authorId: principal, enabled: bool):
  require authorId != viewer else CANNOT_FOLLOW_SELF
  if enabled:
    require exists profiles[principal = authorId] else PROFILE_NOT_FOUND
    insert follows { followerId: viewer, followedId: authorId, at: now } if absent
  else if exists follows[viewer, authorId]:
    delete follows[viewer, authorId]
  return null

mutation createPost(postId: id, body: text <=500, image1: image <=10000000 ?, image2: image <=10000000 ?, image3: image <=10000000 ?, image4: image <=10000000 ?, clip: video <=50000000 ?):
  if clip != null:
    require image1 = null and image2 = null and image3 = null and image4 = null else MEDIA_MIXED
    require clip.duration != null else DURATION_UNKNOWN
    require clip.duration <= 60000 else VIDEO_TOO_LONG
  p = insert posts { id: postId, authorId: viewer, body, image1, image2, image3, image4, clip, at: now }
  insert events { postId: p.id, actorId: viewer, repost: false, at: now }
  return p

mutation replyToPost(replyId: id, postId: posts, body: text <=500):
  require exists posts[id = postId] else POST_NOT_FOUND
  return insert replies { id: replyId, postId, authorId: viewer, body, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if liked:
    require not p.removed else POST_REMOVED
    insert likes { postId, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
  return null

mutation setRepost(postId: posts, enabled: bool):
  p = posts[id = postId] ! else POST_NOT_FOUND
  if enabled:
    require not p.removed else POST_REMOVED
    r = insert reposts { actorId: viewer, postId, at: now } if absent
    if r != null:
      insert events { postId, actorId: viewer, repost: true, at: now }
  else if exists reposts[viewer, postId]:
    delete events[viewer, postId, true]
    delete reposts[viewer, postId]
  return null
