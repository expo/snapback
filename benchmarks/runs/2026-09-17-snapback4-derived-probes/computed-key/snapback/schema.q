table posts:
  authorId: principal
  score: int
  at: time
  by byHourScore: hour(at), score, at, id
  immutable authorId, at
  public 'posts'
  insert <- .authorId = viewer
