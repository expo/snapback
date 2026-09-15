table posts:
  authorId: principal
  text: text <=500
  kind: enum('text', 'images', 'video')
  photo1: image <=10485760 ?
  photo2: image <=10485760 ?
  photo3: image <=10485760 ?
  photo4: image <=10485760 ?
  video: video <=52428800 ?
  parentId: posts ?
  parentAuthor: principal ?
  period: time ?
  at: time
  day: int
  by byAuthorTime: authorId, at, id
  by byParentTime: parentId, at, id
  by byTime: at, id
  immutable authorId, parentId, at, day
  public 'All posts and direct replies are public'
  insert <- .authorId = viewer
  sync public last 300 by byTime

table timelines:
  actorId: principal
  postAuthor: principal ?
  postId: posts
  repost: bool
  at: time
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  immutable actorId, postId
  public 'Public original posts and attributed reposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public last 500 by byTime

table follows:
  followerId: principal
  followedId: principal
  at: time
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  immutable followerId, followedId
  public 'Public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table likes:
  postId: posts
  principal: principal
  authorId: principal
  at: time
  day: int
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  immutable postId, principal, authorId, at, day
  public 'Public post likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public last 2000 by byId

maintain followerCounts: count follows by followedId
  read <- allow
  online only
maintain followingCounts: count follows by followerId
  read <- allow
  online only
maintain likeCounts: count likes by postId
  read <- allow
maintain repostCounts: count timelines by postId, repost
  read <- allow
  online only
maintain replyCounts: count posts by parentId
  read <- allow
  online only

shape postCard = { *, author: profiles[.authorId], likeCount: likeCounts[.id], repostCount: repostCounts[.id, true], replyCount: replyCounts[.id], liked: exists likes[.id, viewer], reposted: exists timelines[viewer, .id, true] }
shape timelineCard = { *, actor: profiles[.actorId], post: posts[.postId] postCard }

query global(c: cursor ?):
  return timelines after c last 20 by byTime timelineCard

query following(c: cursor ?):
  page = merge timelines after c last 20 by byActorTime:
    [viewer]
    [f.followedId] for f in follows[viewer] first 1000 by byPair
  return page timelineCard

query author(authorId: principal, c: cursor ?):
  return posts[authorId] after c last 20 by byAuthorTime where .parentId = null { ...postCard }

query thread(postId: posts, c: cursor ?):
  return posts[postId] after c first 20 by byParentTime postCard

query post(postId: posts):
  return posts[postId] postCard

query counts(principal: principal):
  return { followers: followerCounts[principal], following: followingCounts[principal], followed: exists follows[followerId = viewer, followedId = principal] }

mutation follow(target: principal, set: bool):
  require target != viewer else SELF_FOLLOW
  require exists profiles[target] else USER_NOT_FOUND
  if set:
    insert follows { followerId: viewer, followedId: target, at: now } if absent
  else:
    if exists follows[followerId = viewer, followedId = target]:
      delete follows[followerId = viewer, followedId = target]
  return null

mutation create(postId: id, text: text <=500, kind: enum('text', 'images', 'video'), photo1: image <=10485760 ?, photo2: image <=10485760 ?, photo3: image <=10485760 ?, photo4: image <=10485760 ?, video: video <=52428800 ?, parentId: posts ?):
  if exists posts[postId]:
    return { id: postId }
  if kind = 'text':
    require photo1 = null and photo2 = null and photo3 = null and photo4 = null and video = null else MIXED_MEDIA
    require count(trim(text)) > 0 else EMPTY_POST
  else if kind = 'images':
    require photo1 != null and video = null else INVALID_IMAGES
  else:
    require video != null and photo1 = null and photo2 = null and photo3 = null and photo4 = null else INVALID_VIDEO
    duration = video.duration
    require duration != null else DURATION_UNKNOWN
    require duration <= 60000 else VIDEO_TOO_LONG
  if parentId != null:
    require exists posts[parentId] else PARENT_NOT_FOUND
  p = insert posts { id: postId, authorId: viewer, text, kind, photo1, photo2, photo3, photo4, video, parentId, parentAuthor: posts[parentId].authorId, period: digestPeriod(now), at: now, day: now / 86400000 }
  if parentId = null:
    insert timelines { actorId: viewer, postAuthor: viewer, postId: p.id, repost: false, at: now }
    insert postRanks { postId: p.id, score: 0, at: now, expiresAt: now + 86400000 }
  return { id: p.id }

mutation like(postId: posts, set: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if set:
    insert likes { postId, principal: viewer, authorId: p.authorId, at: now, day: now / 86400000 } if absent
  else:
    if exists likes[postId, viewer]:
      delete likes[postId, viewer]
  if p.parentId = null and p.at > now - 86400000:
    upsert postRanks[postId] { score: likeCounts[postId], at: p.at, expiresAt: p.at + 86400000 }
  return null

mutation repost(postId: posts, set: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  require p.parentId = null else REPLY_NOT_REPOSTABLE
  if set:
    insert timelines { actorId: viewer, postAuthor: p.authorId, postId, repost: true, at: now } if absent
  else:
    if exists timelines[viewer, postId, true]:
      delete timelines[viewer, postId, true]
  return null
