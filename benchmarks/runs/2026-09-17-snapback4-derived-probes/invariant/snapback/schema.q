use personas alice, bob

table posts:
  authorId: principal
  at: time
  immutable authorId, at
  public 'posts'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

table ranked:
  postId: posts
  score: int
  at: time
  expiresAt: time
  unique byPost: postId
  by byScore: score, at, postId, id
  by byExpiresAt: expiresAt
  immutable postId, at, expiresAt
  public 'ranking'
  insert <- exists likeCounts[postId = .postId, value = .score] or (.score = 0 and not exists likeCounts[.postId])
  update (old, next) <- exists likeCounts[postId = next.postId, value = next.score] or (next.score = 0 and not exists likeCounts[next.postId])
  expire at .expiresAt

mutation setLike(postId: posts, liked: bool):
  p = posts[postId] ! else POST_NOT_FOUND
  if liked:
    insert likes { postId, principal: viewer } if absent
  else if exists likes[postId, viewer]:
    delete likes[postId, viewer]
  upsert ranked[postId] { postId, score: likeCounts[postId], at: p.at, expiresAt: p.at + 86400000 }

mutation forge(postId: posts, score: int):
  p = posts[postId] ! else POST_NOT_FOUND
  upsert ranked[postId] { postId, score, at: p.at, expiresAt: p.at + 86400000 }
