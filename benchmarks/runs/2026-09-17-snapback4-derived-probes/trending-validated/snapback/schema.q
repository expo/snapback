use personas alice, bob, carol

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  postAt: time                                   -- the one copied fact; the insert rule checks it against the post
  unique byPair: postId, principal
  immutable postId, principal, postAt
  public 'likes are public'
  insert <- .principal = viewer and exists posts[id = .postId, at = .postAt]
  delete <- .principal = viewer

maintain trend: count likes by hour(.postAt), postAt, postId
  read <- allow
  by byScore: hour, value, id

mutation create(body: text <=500):
  return insert posts { authorId: viewer, body, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if liked:
    insert likes { postId: p.id, principal: viewer, postAt: p.at } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

mutation forgeLike(postId: posts, postAt: time):
  insert likes { postId, principal: viewer, postAt } if absent

query trending(c: cursor ?):
  return merge trend after c last 10 by byScore where .postAt > now - 86400000:
    [hour(now) - 0]
    [hour(now) - 1]
    [hour(now) - 2]
    [hour(now) - 3]
    [hour(now) - 4]
    [hour(now) - 5]
    [hour(now) - 6]
    [hour(now) - 7]
    [hour(now) - 8]
    [hour(now) - 9]
    [hour(now) - 10]
    [hour(now) - 11]
    [hour(now) - 12]
    [hour(now) - 13]
    [hour(now) - 14]
    [hour(now) - 15]
    [hour(now) - 16]
    [hour(now) - 17]
    [hour(now) - 18]
    [hour(now) - 19]
    [hour(now) - 20]
    [hour(now) - 21]
    [hour(now) - 22]
    [hour(now) - 23]
    [hour(now) - 24]
