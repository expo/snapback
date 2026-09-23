table posts:
  body: text <=4000
  at: time
  likeCount: count likes by postId
  by byLikes: likeCount, at, id
  public
  sync public
table likes:
  postId: posts
  public
  update <- allow
  sync public
mutation move(id: likes, to: posts):
  update likes[id] { postId: to }
query one(id: posts):
  return posts[id]
