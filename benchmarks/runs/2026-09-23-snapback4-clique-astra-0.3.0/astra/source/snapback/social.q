table posts:
  authorId: principal
  body: text <=500
  photo1: image <=10000000 ?
  photo2: image <=10000000 ?
  photo3: image <=10000000 ?
  photo4: image <=10000000 ?
  video: video <=50000000 ?
  at: time
  removed: bool default false
  score: count likes by postId
  by byHourLikes: hour(at), score, at, id
  by byTime: at, id
  by byAuthorTime: authorId, at, id
  cap 60000
  immutable authorId, at
  public 'Public social posts'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public

table replies:
  postId: posts
  replyTarget: replies ?
  authorId: principal
  body: text <=500
  at: time
  by byPost: postId, at, id
  by byAuthorTime: authorId, at, id
  cap 60000
  immutable postId, replyTarget, authorId, at
  public 'Public direct replies, excluded from feeds'
  insert <- .authorId = viewer
  sync public

table likes:
  postId: posts
  replyTarget: replies ?
  principal: principal
  at: time
  unique byPair: postId, principal
  by byPrincipal: principal, id
  immutable postId, replyTarget, principal, at
  public 'Public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
  sync public

table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  by byTime: at, id
  cap 60000
  immutable actorId, postId, at
  public 'Public repost attribution'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
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
  cap 20000
  public 'Public follow graph'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

maintain feed: timeline
  authors profiles by principal
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId
  size authors 2000, edges 20000
maintain likeCounts: count likes by postId
  read <- allow
maintain replyCounts: count replies by postId
  read <- allow
maintain repostCounts: count reposts by postId
  read <- allow
maintain followerCounts: count follows by followedId
  read <- allow
maintain followingCounts: count follows by followerId
  read <- allow

shape postCard = { *, author: profiles[principal = .authorId], likeCount: likeCounts[.id], replyCount: replyCounts[.id], repostCount: repostCounts[.id], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
fn replyIsLiked(postId: id): exists likes[postId, viewer]
fn replyLikesCount(postId: id): likeCounts[postId]
fn childReplyCount(postId: id): replyCounts[postId]
shape replyCard = { *, author: profiles[principal = .authorId], likeCount: replyLikesCount(.id), replyCount: childReplyCount(.id), liked: replyIsLiked(.id) }
query following(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId] postCard, actor: profiles[principal = .actorId] }
query global(c: cursor ?):
  return events after c last 20 by byTime { *, post: posts[.postId] postCard, actor: profiles[principal = .actorId] }
query userPosts(owner: principal, c: cursor ?):
  return posts[owner] after c last 20 by byAuthorTime postCard
query post(postId: id):
  return posts[postId] postCard
query reply(postId: id):
  return replies[postId] replyCard
query thread(postId: id, c: cursor ?):
  return replies[postId] after c first 20 by byPost replyCard
query counts(owner: principal):
  return { followers: followerCounts[owner], following: followingCounts[owner], isFollowing: exists follows[viewer, owner] }
mutation createPost(postId: id, body: text <=500, photo1: image <=10000000 ?, photo2: image <=10000000 ?, photo3: image <=10000000 ?, photo4: image <=10000000 ?, video: video <=50000000 ?):
  require not (video != null and (photo1 != null or photo2 != null or photo3 != null or photo4 != null)) else MIXED_MEDIA
  if video != null:
    require video.duration != null and video.duration <= 60000 else VIDEO_TOO_LONG
  require count(body) > 0 or photo1 != null or video != null else EMPTY_POST
  if exists posts[postId]:
    return posts[postId]
  p = insert posts { id: postId, authorId: viewer, body, photo1, photo2, photo3, photo4, video, at: now }
  insert events { postId: p.id, actorId: viewer, repost: false, at: now }
  return p
mutation createReply(replyId: id, postId: id, body: text 1..500):
  require exists posts[postId] or exists replies[postId] else POST_NOT_FOUND
  return insert replies { id: replyId, postId, replyTarget: replies[postId].id, authorId: viewer, body, at: now } if absent
mutation setLike(postId: id, set: bool):
  require exists posts[postId] or exists replies[postId] else POST_NOT_FOUND
  if set:
    insert likes { postId, replyTarget: replies[postId].id, principal: viewer, at: now } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation setRepost(postId: posts, set: bool):
  require exists posts[postId] else POST_NOT_FOUND
  if set:
    if not exists reposts[viewer, postId]:
      r = insert reposts { postId, actorId: viewer, at: now }
      insert events { postId, actorId: viewer, repost: true, at: now }
  else if exists reposts[viewer, postId]:
    r = reposts[viewer, postId] ! else REPOST_NOT_FOUND
    delete events[viewer, postId, true]
    delete reposts[viewer, postId]
mutation setFollow(owner: principal, set: bool):
  require owner != viewer else CANNOT_FOLLOW_SELF
  require exists profiles[principal = owner] else PROFILE_NOT_FOUND
  if set:
    insert follows { followerId: viewer, followedId: owner, at: now } if absent
  else if exists follows[viewer, owner]:
    delete follows[viewer, owner]

table events:
  postId: posts
  actorId: principal
  repost: bool
  at: time
  by byTime: at, id
  unique byActorPostType: actorId, postId, repost
  immutable postId, actorId, repost, at
  public 'Global social feed events'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

query userReplies(owner: principal, c: cursor ?):
  return replies[owner] after c last 20 by byAuthorTime replyCard
