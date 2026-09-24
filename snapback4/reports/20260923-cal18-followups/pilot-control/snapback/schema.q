-- Original posts and their public replies.
table posts:
  body: text <=1000
  public 'Original posts are public discussion content.'

table replies:
  postId: posts
  body: text <=100
  by byPostId: postId, id
  cap 10 by postId
  public 'Replies are public discussion content.'

-- A replies reference denotes a reply identity, never its parent post.
query openReply(replyId: replies):
  return replies[id = replyId] by byId

-- The schema cap bounds the entire ascending group to ten rows.
query thread(postId: posts):
  return replies[postId = postId] by byPostId

-- Null is an absent argument; only a present replies reference is a key.
query optionalReply(replyId: replies ?):
  if replyId != null:
    return replies[id = replyId] by byId
  return null
