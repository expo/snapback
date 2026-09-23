
table profiles:
  principal: principal
  unique byPrincipal: principal
  immutable principal
  public 'profiles'
  insert <- .principal = viewer
  sync public
table posts:
  authorId: principal
  at: time
  removed: bool default false
  immutable authorId, at
  public 'cards'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public
table reposts:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  immutable actorId, postId, at
  public 'reposts'
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
  cap 100000
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public
table notes:
  owner: principal
  insert <- .owner = viewer
