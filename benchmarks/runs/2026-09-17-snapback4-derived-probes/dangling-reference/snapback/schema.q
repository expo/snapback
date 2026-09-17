use personas alice

table posts:
  authorId: principal
  public 'posts'
  insert <- .authorId = viewer

table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
  public 'likes'
  insert <- .principal = viewer

mutation likeBlind(postId: posts):
  return insert likes { postId, principal: viewer }
