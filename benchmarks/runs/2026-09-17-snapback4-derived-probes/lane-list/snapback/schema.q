table posts:
  authorId: principal
  at: time
  by byAuthorTime: authorId, at, id
  public 'posts'
  insert <- .authorId = viewer

query byAuthors(authors: [principal] <=50, c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [a] for a in authors
