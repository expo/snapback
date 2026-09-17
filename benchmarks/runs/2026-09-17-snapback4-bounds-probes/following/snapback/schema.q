use personas alice, bob, carol

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  cap 1000 by followerId
  public 'the follow graph is public'
  online only

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  public 'posts are public'
  online only

-- the Following feed a builder writes first: merge on read, one cursor
query following(c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followedId] for f in follows[viewer] first 1000 by byPair
