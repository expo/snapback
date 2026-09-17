use personas alice, bob

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  public 'posts are public'
  insert <- .authorId = viewer
  sync public

query following(c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followedId] for f in follows[viewer] first 1000 by byPair

mutation post(body: text <=500):
  return insert posts { authorId: viewer, body, at: now }

mutation follow(who: principal):
  insert follows { followerId: viewer, followedId: who } if absent
  return null
