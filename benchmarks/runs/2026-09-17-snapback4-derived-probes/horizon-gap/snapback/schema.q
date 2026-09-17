use personas alice, bob

table posts:
  authorId: principal
  body: text <=200
  at: time
  score: int default 0
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  update <- allow
  sync public last 5 by byTime

mutation like(postId: posts):
  p = posts[postId] ! else NOT_FOUND
  update posts[p.id] { score: p.score + 1 }

query timeline(c: cursor ?):
  return posts after c last 3 by byTime { id, score }
