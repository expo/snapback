-- Clique integration: Following, Trending, received counts and threads.
-- Built from guide feeds and guide maintains; six application source tables.

table profiles:
  principal: principal
  name: text <=80
  unique byPrincipal: principal
  cap 1008
  immutable principal
  public 'public profiles'
  insert <- .principal = viewer
  sync public

table posts:
  authorId: principal
  body: text <=4000
  at: time
  removed: bool default false
  likeCount: count likes by postId
  by byHourLikes: hour(at), likeCount, at, id
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
  immutable postId, authorId
  public 'public thread replies outside Following'
  insert <- .authorId = viewer
  sync public

table likes:
  postId: posts
  principal: principal
  at: time
  unique byPair: postId, principal
  immutable postId, principal, at
  public 'public likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
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

table follows:
  followerId: principal
  followedId: principal
  at: time default 0
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

maintain feed: timeline
  authors profiles by principal
  events posts by authorId, at removed by removed
  reposts reposts by actorId, postId, at
  edges follows by followerId, followedId
  size authors 1008, edges 5921

maintain receivedLikes: count likes by postId.authorId
  read <- allow
  online only
maintain receivedReplies: count replies by postId.authorId
  read <- allow
  online only
maintain dailyReceivedLikes: count likes by postId.authorId, day(postId.at)
  read <- allow
  online only
maintain dailyReceivedReplies: count replies by postId.authorId, day(postId.at)
  read <- allow
  online only

query following(c: cursor ?):
  return feed[viewer] after c last 20 { *, post: posts[.postId], actor: profiles[.actorId], author: profiles[.authorId] }

query thread(postId: posts, c: cursor ?):
  return replies[postId] after c first 20 by byPost

query trending(c: cursor ?):
  return merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now:
    [h] for h in range(hour(now) - 24, hour(now) + 1)

query insights(authorId: principal, d: int):
  return { likes: receivedLikes[authorId], replies: receivedReplies[authorId], dailyLikes: dailyReceivedLikes[authorId, d], dailyReplies: dailyReceivedReplies[authorId, d] }

mutation register(name: text <=80):
  return insert profiles { principal: viewer, name } if absent
mutation post(body: text <=4000):
  return insert posts { authorId: viewer, body, at: now }
mutation reply(postId: posts, body: text <=500):
  require exists posts[postId] else FEED_APP_NOT_FOUND
  return insert replies { postId, authorId: viewer, body, at: now }
mutation like(postId: posts):
  insert likes { postId, principal: viewer, at: now } if absent
mutation unlike(postId: posts):
  if exists likes[postId, viewer]:
    delete likes[postId, viewer]
mutation repost(postId: posts):
  return insert reposts { actorId: viewer, postId, at: now } if absent
mutation remove(postId: posts):
  update posts[postId] { removed: true }
mutation unrepost(postId: posts):
  if exists reposts[viewer, postId]:
    delete reposts[viewer, postId]
mutation follow(authorId: principal):
  insert follows { followerId: viewer, followedId: authorId, at: now } if absent
mutation unfollow(authorId: principal):
  if exists follows[viewer, authorId]:
    delete follows[viewer, authorId]
