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
  postHour: int
  postAt: time
  unique byPair: postId, principal
  immutable postId, principal, postHour, postAt
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain trend: count likes by postHour, postAt, postId
  read <- allow
  by byScore: postHour, value, id

mutation create(body: text <=500):
  return insert posts { authorId: viewer, body, at: now }

mutation setLike(postId: posts, liked: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if liked:
    insert likes { postId: p.id, principal: viewer, postHour: hour(p.at), postAt: p.at } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]

query trending():
  since = now - 86400000
  liked = merge trend last 10 by byScore where .postAt > since:
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
  unliked = posts[at > since] last 10 by byTime where trend[hour(.at), .at, .id] = 0
  out = []
  for l in liked:
    out = out + [{ postId: l.postId, score: l.value, at: l.postAt }]
  for p in unliked:
    if count(out) < 10:
      out = out + [{ postId: p.id, score: 0, at: p.at }]
  return out
