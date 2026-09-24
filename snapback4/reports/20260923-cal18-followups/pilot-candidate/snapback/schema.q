-- Original posts are separate from replies, so postId always names an original.
table posts:
  body: text <=1000
  public 'Original discussion posts are public.'

table replies:
  postId: posts
  body: text <=100
  by byPostId: postId, id
  cap 10 by postId
  after insert <- exists posts[.postId]
  public 'Discussion replies are public.'

-- A reply identity selects exactly one reply, or null when absent.
query openReply(replyId: replies):
  return replies[id = replyId]

-- A post identity selects its ascending, schema-capped group of replies.
query thread(postId: posts):
  return replies[postId = postId] by byPostId

-- Omitted or null input gives null, as does an absent reply identity.
query optionalReply(replyId: replies ?):
  return replies[id = replyId]
